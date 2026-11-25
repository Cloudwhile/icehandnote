use crate::error::ApiError;
use chrono::{DateTime, Utc};
use icehandnote_core::{
    auth::{is_deliverable_email, is_valid_email, validate_and_normalize_email},
    error::ErrorCode,
    mail_templates::{
        build_email_logo_html, default_localized_template, html_to_plain_text,
        is_valid_cloudflare_account_id, localize_anomaly_reason, normalize_mail_provider,
        render_mail_html, render_mail_subject, resolve_email_footer_template, SmtpSettingsDto,
    },
    reading_time::strip_html_tags,
};
use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
        extension::ClientId,
    },
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fmt, fs,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

const DEFAULT_CLOUDFLARE_API_BASE: &str = "https://api.cloudflare.com";
const DEFAULT_PRIMARY_DOH_URL: &str = "https://cloudflare-dns.com/dns-query";
const DEFAULT_FALLBACK_DOH_URL: &str = "https://dns.google/resolve";

const MAX_SUPPRESSED_RECIPIENTS: usize = 4096;
const DOMAIN_CACHE_MAX: usize = 4096;
const DOMAIN_VALID_TTL: Duration = Duration::from_secs(3600);
const DOMAIN_INVALID_TTL: Duration = Duration::from_secs(1800);
const DOMAIN_FALLBACK_VALID_TTL: Duration = Duration::from_secs(300);

const ROLLING_WINDOW_SECS: i64 = 3600;
const ROLLING_WINDOW_MAX: usize = 100;
const CONSECUTIVE_HARD_FAIL_TRIP: u32 = 5;
const ROLLING_MIN_SAMPLES_FOR_RATIO: usize = 10;
const ROLLING_HARD_FAIL_RATIO_PCT: usize = 15;
const CIRCUIT_OPEN_DURATION_SECS: i64 = 1800;
const AMBIGUOUS_TIMEOUT_DEDUP_SECS: u64 = 60;
const DROPPED_INFLIGHT_DEDUP_SECS: u64 = 30;
const DEFAULT_AUTO_DEDUP_SECS: u64 = 12;

#[derive(Debug, Clone, Copy)]
pub struct MailBrandContext<'a> {
    pub site_name: &'a str,
    pub logo_url: &'a str,
    pub origin: &'a str,
    pub locale: &'a str,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MailCredentials<'a> {
    pub smtp_password: &'a str,
    pub cloudflare_api_token: &'a str,
}

#[derive(Clone, Copy)]
pub struct MailSendContext<'a> {
    pub guard: &'a Arc<MailDeliveryGuard>,
    pub http_client: &'a reqwest::Client,
    pub smtp: &'a SmtpSettingsDto,
    pub creds: MailCredentials<'a>,
    pub brand: MailBrandContext<'a>,
    pub dedup_key: Option<&'a str>,
    pub cooldown_secs: u64,
    /// Only enabled for admin "Send Test Email" so admins can test unsaved/disabled settings safely.
    pub allow_disabled_draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuppressedRecipientDto {
    pub email: String,
    pub reason: String,
    pub provider: String,
    pub suppressed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailGuardStatusDto {
    pub circuit_open: bool,
    pub circuit_reason: Option<String>,
    pub circuit_provider: Option<String>,
    pub circuit_retry_after_secs: u64,
    pub rolling_sent: usize,
    pub rolling_hard_failures: usize,
    pub consecutive_hard_failures: u32,
    pub suppressed_count: usize,
    pub suppressed_recipients: Vec<SuppressedRecipientDto>,
    pub total_sent: u64,
    pub total_bounced: u64,
    pub total_blocked_domain: u64,
    pub total_blocked_suppressed: u64,
    pub total_deduped: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedMailGuard {
    #[serde(default)]
    suppressed: HashMap<String, SuppressedRecipientDto>,
    #[serde(default)]
    circuit_open_until: Option<i64>,
    #[serde(default)]
    circuit_reason: Option<String>,
    #[serde(default)]
    circuit_provider: Option<String>,
}

#[derive(Debug, Clone)]
enum DomainVerdict {
    Valid,
    Invalid(String),
}

struct MailGuardInner {
    in_flight: HashMap<String, Instant>,
    recent_sends: HashMap<String, (Instant, Duration)>,
    domain_cache: HashMap<String, (DomainVerdict, Instant, Duration)>,
    suppressed: HashMap<String, SuppressedRecipientDto>,
    rolling_outcomes: VecDeque<(i64, bool)>,
    consecutive_hard_failures: u32,
    circuit_open_until: Option<i64>,
    circuit_reason: Option<String>,
    circuit_provider: Option<String>,
    total_sent: u64,
    total_bounced: u64,
    total_blocked_domain: u64,
    total_blocked_suppressed: u64,
    total_deduped: u64,
}

pub struct MailDeliveryGuard {
    inner: Mutex<MailGuardInner>,
    persist_path: Option<PathBuf>,
    cloudflare_api_base: String,
    dns_doh_url: Option<String>,
    allow_fallback_doh: bool,
    transport_timeout: Duration,
}

#[derive(Debug, Clone)]
pub enum MailSendError {
    NotConfigured(String),
    InvalidInput(String),
    DomainInvalid(String),
    RecipientSuppressed { email: String, reason: String },
    CircuitOpen { reason: String, retry_after_secs: u64 },
    InFlightDuplicate,
    CooldownDuplicate { retry_after_secs: u64 },
    DeliveryTimeout(String),
    PermanentBounce(String),
    DeliveryFailed(String),
}

impl fmt::Display for MailSendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotConfigured(m)
            | Self::InvalidInput(m)
            | Self::DomainInvalid(m)
            | Self::DeliveryTimeout(m)
            | Self::PermanentBounce(m)
            | Self::DeliveryFailed(m) => write!(f, "{m}"),
            Self::RecipientSuppressed { email, reason } => {
                write!(f, "Recipient '{email}' is suppressed due to previous bounce/failure: {reason}")
            }
            Self::CircuitOpen {
                reason,
                retry_after_secs,
            } => write!(
                f,
                "Outbound mail delivery is temporarily paused ({retry_after_secs}s remaining): {reason}"
            ),
            Self::InFlightDuplicate => write!(
                f,
                "An identical email request is already in progress. Please wait before retrying."
            ),
            Self::CooldownDuplicate { retry_after_secs } => write!(
                f,
                "Please wait {retry_after_secs} seconds before requesting another email."
            ),
        }
    }
}

impl std::error::Error for MailSendError {}

impl MailSendError {
    /// Returns `true` when the upstream provider may have already accepted or queued the message
    /// despite a client-side timeout; callers MUST NOT roll back verification codes or auto-retry.
    pub fn is_ambiguous_outcome(&self) -> bool {
        matches!(self, Self::DeliveryTimeout(_))
    }

    pub fn to_api_error(&self, context_prefix: &str) -> ApiError {
        match self {
            Self::NotConfigured(m) => ApiError::new(ErrorCode::SmtpNotConfigured, m.clone()),
            Self::InvalidInput(m) => ApiError::new(ErrorCode::InvalidEmail, m.clone()),
            Self::DomainInvalid(m) => ApiError::new(ErrorCode::MailDomainInvalid, m.clone()),
            Self::RecipientSuppressed { .. } | Self::PermanentBounce(_) => {
                ApiError::new(ErrorCode::MailRecipientSuppressed, self.to_string())
            }
            Self::CircuitOpen {
                retry_after_secs, ..
            } => ApiError::new(ErrorCode::MailCircuitOpen, self.to_string())
                .with_meta(serde_json::json!({ "retry_after_secs": retry_after_secs })),
            Self::InFlightDuplicate => ApiError::new(ErrorCode::MailSendInProgress, self.to_string())
                .with_meta(serde_json::json!({ "retry_after_secs": 10 })),
            Self::CooldownDuplicate { retry_after_secs } => {
                ApiError::new(ErrorCode::VerificationCodeRateLimited, self.to_string())
                    .with_meta(serde_json::json!({ "retry_after_secs": retry_after_secs }))
            }
            Self::DeliveryTimeout(m) | Self::DeliveryFailed(m) => {
                ApiError::new(ErrorCode::SmtpSendFailed, format!("{context_prefix}: {m}"))
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SlotOutcome {
    Pending,
    Sent,
    Ambiguous,
    PreSendRejected,
}

struct SendSlotPermit {
    guard: Arc<MailDeliveryGuard>,
    key: String,
    cooldown: Duration,
    outcome: SlotOutcome,
}

impl SendSlotPermit {
    fn mark_sent(&mut self) {
        self.outcome = SlotOutcome::Sent;
    }

    fn mark_ambiguous(&mut self) {
        self.outcome = SlotOutcome::Ambiguous;
    }

    fn mark_pre_send_rejected(&mut self) {
        self.outcome = SlotOutcome::PreSendRejected;
    }
}

impl Drop for SendSlotPermit {
    fn drop(&mut self) {
        let mut st = self
            .guard
            .inner
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        st.in_flight.remove(&self.key);
        let now = Instant::now();
        match self.outcome {
            SlotOutcome::Sent => {
                if !self.cooldown.is_zero() {
                    st.recent_sends
                        .insert(self.key.clone(), (now, self.cooldown));
                }
            }
            SlotOutcome::Ambiguous => {
                let keep = self
                    .cooldown
                    .max(Duration::from_secs(AMBIGUOUS_TIMEOUT_DEDUP_SECS));
                st.recent_sends.insert(self.key.clone(), (now, keep));
            }
            SlotOutcome::Pending => {
                // Task was cancelled / client dropped mid-flight: hold a protective dedup window
                // so rapid client/proxy retries do not trigger a second email.
                let keep = self
                    .cooldown
                    .max(Duration::from_secs(DROPPED_INFLIGHT_DEDUP_SECS));
                st.recent_sends.insert(self.key.clone(), (now, keep));
            }
            SlotOutcome::PreSendRejected => {}
        }
    }
}

impl MailDeliveryGuard {
    pub fn load_or_default(persist_path: Option<PathBuf>) -> Self {
        let persisted = persist_path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<PersistedMailGuard>(&raw).ok())
            .unwrap_or_default();

        Self {
            inner: Mutex::new(MailGuardInner {
                in_flight: HashMap::new(),
                recent_sends: HashMap::new(),
                domain_cache: HashMap::new(),
                suppressed: persisted.suppressed,
                rolling_outcomes: VecDeque::with_capacity(ROLLING_WINDOW_MAX),
                consecutive_hard_failures: 0,
                circuit_open_until: persisted.circuit_open_until,
                circuit_reason: persisted.circuit_reason,
                circuit_provider: persisted.circuit_provider,
                total_sent: 0,
                total_bounced: 0,
                total_blocked_domain: 0,
                total_blocked_suppressed: 0,
                total_deduped: 0,
            }),
            persist_path,
            cloudflare_api_base: DEFAULT_CLOUDFLARE_API_BASE.to_string(),
            dns_doh_url: Some(DEFAULT_PRIMARY_DOH_URL.to_string()),
            allow_fallback_doh: true,
            transport_timeout: Duration::from_secs(20),
        }
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self::load_or_default(None)
    }

    #[cfg(test)]
    pub fn with_test_endpoints(
        mut self,
        cloudflare_api_base: impl Into<String>,
        dns_doh_url: Option<String>,
        transport_timeout: Duration,
    ) -> Self {
        self.cloudflare_api_base = cloudflare_api_base.into();
        self.dns_doh_url = dns_doh_url;
        self.allow_fallback_doh = false;
        self.transport_timeout = transport_timeout;
        self
    }

    fn persist_locked(&self, st: &MailGuardInner) {
        let Some(ref path) = self.persist_path else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let snapshot = PersistedMailGuard {
            suppressed: st.suppressed.clone(),
            circuit_open_until: st.circuit_open_until,
            circuit_reason: st.circuit_reason.clone(),
            circuit_provider: st.circuit_provider.clone(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
            let tmp = path.with_extension(format!("tmp-{}", Uuid::new_v4().simple()));
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(&tmp, path);
            }
        }
    }

    pub fn status_dto(&self) -> MailGuardStatusDto {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now_ts = Utc::now().timestamp();
        Self::prune_rolling(&mut st, now_ts);

        let (circuit_open, retry_after_secs) = match st.circuit_open_until {
            Some(until) if until > now_ts => (true, (until - now_ts) as u64),
            _ => {
                if st.circuit_open_until.is_some() {
                    st.circuit_open_until = None;
                    st.circuit_reason = None;
                    st.circuit_provider = None;
                }
                (false, 0)
            }
        };

        let rolling_hard_failures = st.rolling_outcomes.iter().filter(|(_, bad)| *bad).count();
        let rolling_sent = st.rolling_outcomes.len().saturating_sub(rolling_hard_failures);

        let mut list: Vec<SuppressedRecipientDto> = st.suppressed.values().cloned().collect();
        list.sort_by_key(|a| std::cmp::Reverse(a.suppressed_at));
        let suppressed_count = list.len();
        list.truncate(50);

        MailGuardStatusDto {
            circuit_open,
            circuit_reason: if circuit_open {
                st.circuit_reason.clone()
            } else {
                None
            },
            circuit_provider: if circuit_open {
                st.circuit_provider.clone()
            } else {
                None
            },
            circuit_retry_after_secs: retry_after_secs,
            rolling_sent,
            rolling_hard_failures,
            consecutive_hard_failures: st.consecutive_hard_failures,
            suppressed_count,
            suppressed_recipients: list,
            total_sent: st.total_sent,
            total_bounced: st.total_bounced,
            total_blocked_domain: st.total_blocked_domain,
            total_blocked_suppressed: st.total_blocked_suppressed,
            total_deduped: st.total_deduped,
        }
    }

    pub fn reset_circuit(&self) -> MailGuardStatusDto {
        {
            let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            st.circuit_open_until = None;
            st.circuit_reason = None;
            st.circuit_provider = None;
            st.consecutive_hard_failures = 0;
            st.rolling_outcomes.clear();
            self.persist_locked(&st);
        }
        self.status_dto()
    }

    pub fn reset_circuit_if_provider_changed(&self, active_provider: &str) {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if st
            .circuit_provider
            .as_deref()
            .is_some_and(|p| p != active_provider)
        {
            st.circuit_open_until = None;
            st.circuit_reason = None;
            st.circuit_provider = None;
            st.consecutive_hard_failures = 0;
            st.rolling_outcomes.clear();
            self.persist_locked(&st);
        }
    }

    pub fn clear_suppression(&self, email: Option<&str>, clear_all: bool) -> MailGuardStatusDto {
        {
            let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            if clear_all {
                st.suppressed.clear();
            } else if let Some(raw) = email {
                let key = raw.trim().to_ascii_lowercase();
                st.suppressed.remove(&key);
            }
            self.persist_locked(&st);
        }
        self.status_dto()
    }

    fn prune_rolling(st: &mut MailGuardInner, now_ts: i64) {
        while let Some(&(ts, _)) = st.rolling_outcomes.front() {
            if now_ts - ts > ROLLING_WINDOW_SECS {
                st.rolling_outcomes.pop_front();
            } else {
                break;
            }
        }
        while st.rolling_outcomes.len() > ROLLING_WINDOW_MAX {
            st.rolling_outcomes.pop_front();
        }
    }

    pub fn check_circuit(&self, provider: &str) -> Result<(), MailSendError> {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now_ts = Utc::now().timestamp();
        if let Some(until) = st.circuit_open_until {
            if until > now_ts {
                let applies = st
                    .circuit_provider
                    .as_deref()
                    .map(|p| p == provider)
                    .unwrap_or(true);
                if applies {
                    return Err(MailSendError::CircuitOpen {
                        reason: st
                            .circuit_reason
                            .clone()
                            .unwrap_or_else(|| "Elevated bounce/failure rate detected".to_string()),
                        retry_after_secs: (until - now_ts).max(1) as u64,
                    });
                }
            } else {
                st.circuit_open_until = None;
                st.circuit_reason = None;
                st.circuit_provider = None;
                st.consecutive_hard_failures = 0;
                self.persist_locked(&st);
            }
        }
        Ok(())
    }

    /// Clears a completed dedup cooldown entry (for example after a login OTP challenge
    /// has been verified and consumed), without touching active `in_flight` locks or circuit state.
    pub fn clear_recent_dedup_key(&self, key: &str) {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        st.recent_sends.remove(key);
    }

    pub fn check_suppressed(&self, email: &str) -> Result<(), MailSendError> {
        let key = email.trim().to_ascii_lowercase();
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(rec) = st.suppressed.get(&key).cloned() {
            st.total_blocked_suppressed = st.total_blocked_suppressed.saturating_add(1);
            return Err(MailSendError::RecipientSuppressed {
                email: rec.email,
                reason: rec.reason,
            });
        }
        Ok(())
    }

    pub fn suppress_recipient(&self, email: &str, provider: &str, reason: &str) {
        let key = email.trim().to_ascii_lowercase();
        if key.is_empty() {
            return;
        }
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if st.suppressed.len() >= MAX_SUPPRESSED_RECIPIENTS && !st.suppressed.contains_key(&key) {
            if let Some(oldest_key) = st
                .suppressed
                .iter()
                .min_by_key(|(_, v)| v.suppressed_at)
                .map(|(k, _)| k.clone())
            {
                st.suppressed.remove(&oldest_key);
            }
        }
        st.suppressed.insert(
            key.clone(),
            SuppressedRecipientDto {
                email: key,
                reason: reason.chars().take(240).collect(),
                provider: provider.to_string(),
                suppressed_at: Utc::now(),
            },
        );
        self.persist_locked(&st);
    }

    pub fn record_success(&self) {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now_ts = Utc::now().timestamp();
        Self::prune_rolling(&mut st, now_ts);
        st.rolling_outcomes.push_back((now_ts, false));
        st.consecutive_hard_failures = 0;
        st.total_sent = st.total_sent.saturating_add(1);
    }

    pub fn record_hard_failure(&self, provider: &str, reason: &str) {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now_ts = Utc::now().timestamp();
        Self::prune_rolling(&mut st, now_ts);
        st.rolling_outcomes.push_back((now_ts, true));
        st.consecutive_hard_failures = st.consecutive_hard_failures.saturating_add(1);
        st.total_bounced = st.total_bounced.saturating_add(1);

        let total_window = st.rolling_outcomes.len();
        let hard_failures = st.rolling_outcomes.iter().filter(|(_, bad)| *bad).count();
        let ratio_tripped = total_window >= ROLLING_MIN_SAMPLES_FOR_RATIO
            && hard_failures * 100 >= total_window * ROLLING_HARD_FAIL_RATIO_PCT;
        let consecutive_tripped = st.consecutive_hard_failures >= CONSECUTIVE_HARD_FAIL_TRIP;

        if consecutive_tripped || ratio_tripped {
            let trip_reason = if consecutive_tripped {
                format!(
                    "Circuit paused after {} consecutive hard bounces/failures ({reason})",
                    st.consecutive_hard_failures
                )
            } else {
                format!(
                    "Circuit paused due to elevated hard-failure rate ({hard_failures}/{total_window} in last hour: {reason})"
                )
            };
            st.circuit_open_until = Some(now_ts + CIRCUIT_OPEN_DURATION_SECS);
            st.circuit_reason = Some(trip_reason);
            st.circuit_provider = Some(provider.to_string());
            self.persist_locked(&st);
        }
    }

    pub fn trip_circuit_immediately(&self, provider: &str, reason: &str, duration_secs: i64) {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now_ts = Utc::now().timestamp();
        st.circuit_open_until = Some(now_ts + duration_secs.max(60));
        st.circuit_reason = Some(reason.chars().take(320).collect());
        st.circuit_provider = Some(provider.to_string());
        self.persist_locked(&st);
    }

    pub fn record_domain_blocked(&self) {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        st.total_blocked_domain = st.total_blocked_domain.saturating_add(1);
    }

    fn get_cached_domain(&self, domain: &str) -> Option<DomainVerdict> {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        if let Some((verdict, inserted_at, ttl)) = st.domain_cache.get(domain) {
            if now.duration_since(*inserted_at) < *ttl {
                return Some(verdict.clone());
            }
            st.domain_cache.remove(domain);
        }
        None
    }

    fn put_cached_domain(&self, domain: &str, verdict: DomainVerdict, ttl: Duration) {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        if st.domain_cache.len() >= DOMAIN_CACHE_MAX {
            st.domain_cache
                .retain(|_, (_, ts, item_ttl)| now.duration_since(*ts) < *item_ttl);
            if st.domain_cache.len() >= DOMAIN_CACHE_MAX {
                st.domain_cache.clear();
            }
        }
        st.domain_cache
            .insert(domain.to_string(), (verdict, now, ttl));
    }

    fn acquire_send_slot(
        self: &Arc<Self>,
        key: String,
        cooldown_secs: u64,
    ) -> Result<SendSlotPermit, MailSendError> {
        let mut st = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        // Clean stale entries (safety ceiling: in-flight cannot outlive 120s)
        st.in_flight
            .retain(|_, started| now.duration_since(*started) < Duration::from_secs(120));
        st.recent_sends
            .retain(|_, (ts, ttl)| now.duration_since(*ts) < *ttl);

        if st.in_flight.contains_key(&key) {
            st.total_deduped = st.total_deduped.saturating_add(1);
            return Err(MailSendError::InFlightDuplicate);
        }
        if let Some((last_ts, ttl)) = st.recent_sends.get(&key) {
            let elapsed = now.duration_since(*last_ts);
            if elapsed < *ttl {
                let remaining = ttl.saturating_sub(elapsed).as_secs().max(1);
                st.total_deduped = st.total_deduped.saturating_add(1);
                return Err(MailSendError::CooldownDuplicate {
                    retry_after_secs: remaining,
                });
            }
        }

        st.in_flight.insert(key.clone(), now);
        Ok(SendSlotPermit {
            guard: Arc::clone(self),
            key,
            cooldown: Duration::from_secs(cooldown_secs),
            outcome: SlotOutcome::Pending,
        })
    }
}

/// Returns the strictly single active outbound mail transport (`"smtp"` | `"cloudflare_api"`),
/// or `None` when mail delivery is disabled or the chosen transport is incomplete.
pub fn active_mail_provider(
    smtp: &SmtpSettingsDto,
    creds: &MailCredentials<'_>,
) -> Option<&'static str> {
    if !smtp.enabled || !is_valid_email(&smtp.from_email) {
        return None;
    }
    match normalize_mail_provider(&smtp.provider) {
        "cloudflare_api" => {
            if is_valid_cloudflare_account_id(&smtp.cloudflare_account_id)
                && !creds.cloudflare_api_token.trim().is_empty()
                && is_deliverable_email(&smtp.from_email)
            {
                Some("cloudflare_api")
            } else {
                None
            }
        }
        "smtp" => {
            if !smtp.host.trim().is_empty() {
                Some("smtp")
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn is_mail_ready(smtp: &SmtpSettingsDto, creds: &MailCredentials<'_>) -> bool {
    active_mail_provider(smtp, creds).is_some()
}

fn is_loopback_host(host: &str) -> bool {
    let trimmed = host.trim().trim_matches(['[', ']']);
    if trimmed.eq_ignore_ascii_case("localhost") {
        return true;
    }
    trimmed
        .parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
struct DohResponse {
    #[serde(rename = "Status", default)]
    status: u32,
    #[serde(rename = "Answer", default)]
    answer: Option<Vec<DohAnswer>>,
}

#[derive(Debug, Deserialize)]
struct DohAnswer {
    #[serde(rename = "type", default)]
    rr_type: u16,
    #[serde(default)]
    data: String,
}

async fn query_doh_json(
    http_client: &reqwest::Client,
    doh_base: &str,
    domain: &str,
    rr_type: &str,
) -> Result<DohResponse, reqwest::Error> {
    let sep = if doh_base.contains('?') { '&' } else { '?' };
    let url = format!("{doh_base}{sep}name={domain}&type={rr_type}");
    http_client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/dns-json")
        .timeout(Duration::from_secs(3))
        .send()
        .await?
        .error_for_status()?
        .json::<DohResponse>()
        .await
}

async fn query_doh_with_fallback(
    guard: &MailDeliveryGuard,
    http_client: &reqwest::Client,
    domain: &str,
    rr_type: &str,
) -> Option<DohResponse> {
    let primary = guard.dns_doh_url.as_deref()?;
    match query_doh_json(http_client, primary, domain, rr_type).await {
        Ok(resp) => Some(resp),
        Err(err) => {
            tracing::debug!("Primary DoH {rr_type} query for '{domain}' failed: {err}");
            if guard.allow_fallback_doh {
                query_doh_json(http_client, DEFAULT_FALLBACK_DOH_URL, domain, rr_type)
                    .await
                    .ok()
            } else {
                None
            }
        }
    }
}

fn is_null_mx_record(data: &str) -> bool {
    // RFC 7505 Null MX record: priority 0 and root target "."
    let parts: Vec<&str> = data.split_whitespace().collect();
    if parts.len() >= 2 {
        let target = parts[1].trim();
        target == "." || target.is_empty()
    } else {
        data.trim() == "."
    }
}

async fn verify_recipient_domain_deliverability(
    guard: &MailDeliveryGuard,
    http_client: &reqwest::Client,
    smtp: &SmtpSettingsDto,
    provider: &str,
    to_email: &str,
) -> Result<(), MailSendError> {
    let (_, domain_raw) = to_email
        .split_once('@')
        .ok_or_else(|| MailSendError::InvalidInput("Invalid recipient email format.".to_string()))?;
    let domain = domain_raw.trim().to_ascii_lowercase();

    // Local loopback SMTP relays (e.g. dev Mailpit / unit test sink) bypass external DNS checks
    if provider == "smtp" && is_loopback_host(&smtp.host) {
        return Ok(());
    }

    if !is_deliverable_email(to_email) {
        guard.record_domain_blocked();
        return Err(MailSendError::DomainInvalid(format!(
            "Recipient domain '{domain}' is a reserved or non-deliverable domain."
        )));
    }

    if !smtp.verify_recipient_mx {
        return Ok(());
    }

    if let Some(cached) = guard.get_cached_domain(&domain) {
        return match cached {
            DomainVerdict::Valid => Ok(()),
            DomainVerdict::Invalid(reason) => {
                guard.record_domain_blocked();
                Err(MailSendError::DomainInvalid(reason))
            }
        };
    }

    // 1. Check MX records via DNS-over-HTTPS JSON (works reliably across Linux/Windows/Docker)
    if let Some(mx_resp) = query_doh_with_fallback(guard, http_client, &domain, "MX").await {
        if mx_resp.status == 3 {
            let reason = format!("Recipient domain '{domain}' does not exist (DNS NXDOMAIN).");
            guard.put_cached_domain(&domain, DomainVerdict::Invalid(reason.clone()), DOMAIN_INVALID_TTL);
            guard.record_domain_blocked();
            return Err(MailSendError::DomainInvalid(reason));
        }
        if mx_resp.status == 0 {
            let mx_records: Vec<String> = mx_resp
                .answer
                .unwrap_or_default()
                .into_iter()
                .filter(|a| a.rr_type == 15)
                .map(|a| a.data)
                .collect();

            if !mx_records.is_empty() {
                if mx_records.iter().all(|d| is_null_mx_record(d))
                    || mx_records.iter().any(|d| d.trim() == "0 .")
                {
                    let reason = format!(
                        "Recipient domain '{domain}' explicitly does not accept email (RFC 7505 Null MX)."
                    );
                    guard.put_cached_domain(
                        &domain,
                        DomainVerdict::Invalid(reason.clone()),
                        DOMAIN_VALID_TTL,
                    );
                    guard.record_domain_blocked();
                    return Err(MailSendError::DomainInvalid(reason));
                }
                guard.put_cached_domain(&domain, DomainVerdict::Valid, DOMAIN_VALID_TTL);
                return Ok(());
            }

            // RFC 5321 §5.1: If no MX exists, fallback to A / AAAA records
            let has_a = query_doh_with_fallback(guard, http_client, &domain, "A")
                .await
                .and_then(|r| (r.status == 0).then_some(r.answer))
                .flatten()
                .unwrap_or_default()
                .into_iter()
                .any(|a| a.rr_type == 1 && !a.data.trim().is_empty() && !a.data.starts_with("127."));
            if has_a {
                guard.put_cached_domain(&domain, DomainVerdict::Valid, DOMAIN_VALID_TTL);
                return Ok(());
            }

            let has_aaaa = query_doh_with_fallback(guard, http_client, &domain, "AAAA")
                .await
                .and_then(|r| (r.status == 0).then_some(r.answer))
                .flatten()
                .unwrap_or_default()
                .into_iter()
                .any(|a| a.rr_type == 28 && !a.data.trim().is_empty() && a.data.trim() != "::1");
            if has_aaaa {
                guard.put_cached_domain(&domain, DomainVerdict::Valid, DOMAIN_VALID_TTL);
                return Ok(());
            }

            let reason = format!(
                "Recipient domain '{domain}' has no MX, A, or AAAA mail delivery records."
            );
            guard.put_cached_domain(&domain, DomainVerdict::Invalid(reason.clone()), DOMAIN_INVALID_TTL);
            guard.record_domain_blocked();
            return Err(MailSendError::DomainInvalid(reason));
        }
    }

    // 2. Fallback to OS resolver if DoH endpoints are unreachable
    let os_res = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::net::lookup_host((domain.as_str(), 25)),
    )
    .await;
    if let Ok(Ok(mut addrs)) = os_res {
        if addrs.any(|a| !a.ip().is_loopback() && !a.ip().is_unspecified()) {
            guard.put_cached_domain(&domain, DomainVerdict::Valid, DOMAIN_FALLBACK_VALID_TTL);
            return Ok(());
        }
    }

    // Fail closed when using Cloudflare API so unverifiable / dead domains never risk account suspension
    if provider == "cloudflare_api" {
        let reason = format!(
            "Could not verify DNS mail records for recipient domain '{domain}'; blocked to prevent Cloudflare bounce penalties."
        );
        guard.record_domain_blocked();
        return Err(MailSendError::DomainInvalid(reason));
    }
    Ok(())
}

/// Derive a strictly RFC 5321-compliant ASCII EHLO domain from the sender email so strict
/// SMTP relays (QQ Mail, 163, Exchange, Postfix) never reject or tarpit invalid OS hostnames.
fn derive_ehlo_client_id(from_email: &str) -> ClientId {
    if let Some((_, domain)) = from_email.trim().rsplit_once('@') {
        let clean = domain.trim().trim_matches('.');
        if !clean.is_empty()
            && clean.len() <= 128
            && clean.contains('.')
            && clean
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
            && !clean.starts_with('-')
            && !clean.ends_with('-')
        {
            return ClientId::Domain(clean.to_ascii_lowercase());
        }
    }
    ClientId::Domain("localhost".to_string())
}

/// Resolve SMTP host with IPv4 addresses ordered BEFORE IPv6 so IPv4-only servers/containers
/// never stall for 12–30s waiting on unreachable AAAA records.
async fn resolve_smtp_targets(host: &str, port: u16) -> Vec<String> {
    if host.parse::<std::net::IpAddr>().is_ok() {
        return vec![host.to_string()];
    }
    let resolved = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::net::lookup_host((host, port)),
    )
    .await;

    let Ok(Ok(addrs)) = resolved else {
        return vec![host.to_string()];
    };

    let mut ipv4 = Vec::new();
    let mut ipv6 = Vec::new();
    for addr in addrs {
        match addr {
            SocketAddr::V4(v4) => {
                let ip = v4.ip().to_string();
                if !ipv4.contains(&ip) {
                    ipv4.push(ip);
                }
            }
            SocketAddr::V6(v6) => {
                let ip = v6.ip().to_string();
                if !ipv6.contains(&ip) {
                    ipv6.push(ip);
                }
            }
        }
    }

    let mut ordered = Vec::new();
    ordered.extend(ipv4.into_iter().take(2));
    ordered.extend(ipv6.into_iter().take(1));
    if ordered.is_empty() {
        ordered.push(host.to_string());
    }
    ordered
}

/// When a hostname resolves to multiple IPs, find ONE reachable IP via connect-only TCP probe
/// (zero SMTP commands transmitted) so we never loop `mailer.send()` across multiple endpoints
/// and accidentally double-deliver under high latency.
async fn select_single_reachable_smtp_target(host: &str, port: u16) -> String {
    let targets = resolve_smtp_targets(host, port).await;
    if targets.len() <= 1 {
        return targets.into_iter().next().unwrap_or_else(|| host.to_string());
    }
    for target in &targets {
        if let Ok(Ok(stream)) = tokio::time::timeout(
            Duration::from_secs(2),
            tokio::net::TcpStream::connect((target.as_str(), port)),
        )
        .await
        {
            drop(stream);
            return target.clone();
        }
    }
    targets.into_iter().next().unwrap_or_else(|| host.to_string())
}

#[allow(clippy::too_many_arguments)]
fn build_transport_for_target(
    connect_target: &str,
    sni_host: &str,
    port: u16,
    encryption: &str,
    username: &str,
    password: &str,
    client_id: ClientId,
    op_timeout: Duration,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, MailSendError> {
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(connect_target)
        .port(port)
        .hello_name(client_id)
        .timeout(Some(op_timeout));

    match encryption {
        "none" => {
            builder = builder.tls(Tls::None);
        }
        "starttls" => {
            let tls_params = TlsParameters::new(sni_host.to_string())
                .map_err(|e| MailSendError::DeliveryFailed(format!("STARTTLS init failed: {e}")))?;
            builder = builder.tls(Tls::Required(tls_params));
        }
        _ => {
            let tls_params = TlsParameters::new(sni_host.to_string())
                .map_err(|e| MailSendError::DeliveryFailed(format!("TLS init failed: {e}")))?;
            builder = builder.tls(Tls::Wrapper(tls_params));
        }
    }

    if !username.trim().is_empty() {
        builder = builder.credentials(Credentials::new(
            username.trim().to_string(),
            password.to_string(),
        ));
    }

    Ok(builder.build())
}

fn is_smtp_recipient_permanent_bounce(lower_msg: &str) -> bool {
    let has_55x = lower_msg.contains("550")
        || lower_msg.contains("551")
        || lower_msg.contains("553")
        || lower_msg.contains("554");
    let has_recipient_hint = lower_msg.contains("user")
        || lower_msg.contains("mailbox")
        || lower_msg.contains("recipient")
        || lower_msg.contains("no such")
        || lower_msg.contains("unknown")
        || lower_msg.contains("does not exist")
        || lower_msg.contains("invalid address")
        || lower_msg.contains("undeliverable")
        || lower_msg.contains("not found");
    has_55x && has_recipient_hint
}

fn is_smtp_handshake_tls_error(lower_msg: &str) -> bool {
    lower_msg.contains("tls")
        || lower_msg.contains("ssl")
        || lower_msg.contains("handshake")
        || lower_msg.contains("starttls")
        || lower_msg.contains("corruptmessage")
        || lower_msg.contains("unexpected eof")
}

async fn send_via_smtp(
    guard: &MailDeliveryGuard,
    smtp: &SmtpSettingsDto,
    password: &str,
    from_email: &str,
    to_email: &str,
    subject: &str,
    html_body: &str,
) -> Result<(), MailSendError> {
    let host = smtp.host.trim();
    if host.is_empty() {
        return Err(MailSendError::NotConfigured(
            "SMTP host cannot be empty.".to_string(),
        ));
    }

    let from_mailbox: Mailbox = if smtp.from_name.trim().is_empty() {
        from_email
            .parse()
            .map_err(|e| MailSendError::InvalidInput(format!("Invalid sender email format: {e}")))?
    } else {
        Mailbox::new(
            Some(strip_html_tags(&smtp.from_name)),
            from_email.parse().map_err(|e| {
                MailSendError::InvalidInput(format!("Invalid sender email format: {e}"))
            })?,
        )
    };
    let to_mailbox: Mailbox = to_email
        .parse()
        .map_err(|e| MailSendError::InvalidInput(format!("Invalid recipient email format: {e}")))?;

    let email = Message::builder()
        .from(from_mailbox)
        .to(to_mailbox)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html_body.to_string())
        .map_err(|e| MailSendError::DeliveryFailed(format!("Failed to build email message: {e}")))?;

    let client_id = derive_ehlo_client_id(from_email);
    let primary_enc = smtp.encryption.as_str();
    let fallback_enc: Option<&str> = match (primary_enc, smtp.port) {
        ("tls", 587) => Some("starttls"),
        ("starttls", 465) => Some("tls"),
        _ => None,
    };

    let target = select_single_reachable_smtp_target(host, smtp.port).await;
    let op_timeout = guard.transport_timeout;

    let mailer = build_transport_for_target(
        &target,
        host,
        smtp.port,
        primary_enc,
        &smtp.username,
        password,
        client_id.clone(),
        op_timeout,
    )?;

    let attempt = tokio::time::timeout(op_timeout, mailer.send(email.clone())).await;
    match attempt {
        Ok(Ok(_)) => {
            guard.record_success();
            Ok(())
        }
        Err(_) => Err(MailSendError::DeliveryTimeout(format!(
            "SMTP delivery to {host}:{} timed out after {}s; duplicate resend suppressed.",
            smtp.port,
            op_timeout.as_secs()
        ))),
        Ok(Err(err)) => {
            let msg = err.to_string();
            let lower = msg.to_ascii_lowercase();
            if err.is_timeout() || lower.contains("timed out") || lower.contains("timeout") {
                return Err(MailSendError::DeliveryTimeout(format!(
                    "SMTP delivery to {host}:{} timed out: {msg}",
                    smtp.port
                )));
            }
            if is_smtp_recipient_permanent_bounce(&lower) {
                guard.suppress_recipient(to_email, "smtp", &msg);
                guard.record_hard_failure("smtp", &msg);
                return Err(MailSendError::PermanentBounce(format!(
                    "SMTP permanently rejected recipient '{to_email}': {msg}"
                )));
            }
            // Only attempt paired TLS mode (587+tls <-> 465+starttls) on an unmistakable TLS handshake failure
            // (never on timeout or after message transmission)
            if is_smtp_handshake_tls_error(&lower) {
                if let Some(alt_enc) = fallback_enc {
                    if let Ok(alt_mailer) = build_transport_for_target(
                        &target,
                        host,
                        smtp.port,
                        alt_enc,
                        &smtp.username,
                        password,
                        client_id,
                        Duration::from_secs(10),
                    ) {
                        match tokio::time::timeout(Duration::from_secs(10), alt_mailer.send(email))
                            .await
                        {
                            Ok(Ok(_)) => {
                                tracing::warn!(
                                    "SMTP succeeded via {alt_enc} fallback on {}:{} (configured: {primary_enc})",
                                    host,
                                    smtp.port
                                );
                                guard.record_success();
                                return Ok(());
                            }
                            Err(_) => {
                                return Err(MailSendError::DeliveryTimeout(format!(
                                    "SMTP {alt_enc} fallback timed out on {host}:{}",
                                    smtp.port
                                )));
                            }
                            Ok(Err(alt_err)) => {
                                return Err(MailSendError::DeliveryFailed(format!(
                                    "SMTP delivery via {target}:{} failed: {alt_err}",
                                    smtp.port
                                )));
                            }
                        }
                    }
                }
            }
            Err(MailSendError::DeliveryFailed(format!(
                "SMTP delivery via {target}:{} failed: {msg}",
                smtp.port
            )))
        }
    }
}

#[derive(Debug, Deserialize)]
struct CloudflareErrorItem {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
}

#[derive(Debug, Deserialize)]
struct CloudflareSendResult {
    #[serde(default)]
    delivered: Vec<String>,
    #[serde(default)]
    queued: Vec<String>,
    #[serde(default)]
    permanent_bounces: Vec<String>,
    #[serde(default)]
    suppressed_recipients: Vec<String>,
    #[serde(default)]
    message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CloudflareSendEnvelope {
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    errors: Vec<CloudflareErrorItem>,
    #[serde(default)]
    result: Option<CloudflareSendResult>,
}

fn summarize_cf_errors(errors: &[CloudflareErrorItem]) -> String {
    if errors.is_empty() {
        return String::new();
    }
    errors
        .iter()
        .map(|e| {
            if e.code != 0 {
                format!("[{}] {}", e.code, e.message)
            } else {
                e.message.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

#[allow(clippy::too_many_arguments)]
async fn send_via_cloudflare_api(
    guard: &MailDeliveryGuard,
    http_client: &reqwest::Client,
    smtp: &SmtpSettingsDto,
    api_token: &str,
    from_email: &str,
    to_email: &str,
    subject: &str,
    html_body: &str,
    send_id: &str,
) -> Result<(), MailSendError> {
    let account_id = smtp.cloudflare_account_id.trim();
    if !is_valid_cloudflare_account_id(account_id) {
        return Err(MailSendError::NotConfigured(
            "Cloudflare Account ID is missing or invalid.".to_string(),
        ));
    }
    let clean_token = api_token.trim();
    if clean_token.is_empty() {
        return Err(MailSendError::NotConfigured(
            "Cloudflare Email API Token is not configured.".to_string(),
        ));
    }
    if !is_deliverable_email(from_email) {
        return Err(MailSendError::InvalidInput(
            "Cloudflare Email Sending requires a valid verified sender domain email address."
                .to_string(),
        ));
    }

    let url = format!(
        "{}/client/v4/accounts/{account_id}/email/sending/send",
        guard.cloudflare_api_base.trim_end_matches('/')
    );
    let clean_from_name = strip_html_tags(&smtp.from_name).trim().to_string();
    let from_field = if clean_from_name.is_empty() {
        serde_json::json!(from_email)
    } else {
        serde_json::json!({
            "address": from_email,
            "name": clean_from_name,
        })
    };
    let plain_text = html_to_plain_text(html_body);
    let payload = serde_json::json!({
        "to": to_email,
        "from": from_field,
        "subject": subject,
        "html": html_body,
        "text": plain_text,
        "headers": {
            "X-IceHandnote-Send-Id": send_id,
        }
    });

    // Strictly single-attempt HTTP POST (never auto-retry on timeout/5xx to prevent duplicate mail)
    let resp = match http_client
        .post(&url)
        .bearer_auth(clean_token)
        .timeout(guard.transport_timeout)
        .json(&payload)
        .send()
        .await
    {
        Ok(r) => r,
        Err(err) => {
            if err.is_timeout() {
                return Err(MailSendError::DeliveryTimeout(format!(
                    "Cloudflare Email API request timed out after {}s; duplicate resend suppressed.",
                    guard.transport_timeout.as_secs()
                )));
            }
            return Err(MailSendError::DeliveryFailed(format!(
                "Cloudflare Email API network error: {err}"
            )));
        }
    };

    let status = resp.status();
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(err) => {
            if err.is_timeout() {
                return Err(MailSendError::DeliveryTimeout(format!(
                    "Cloudflare Email API response read timed out (HTTP {}): {err}",
                    status.as_u16()
                )));
            }
            return Err(MailSendError::DeliveryFailed(format!(
                "Failed to read Cloudflare Email API response (HTTP {}): {err}",
                status.as_u16()
            )));
        }
    };

    let parsed: Option<CloudflareSendEnvelope> = serde_json::from_str(&body_text).ok();

    if let Some(ref env) = parsed {
        if let Some(ref result) = env.result {
            let bounced_match = result
                .permanent_bounces
                .iter()
                .any(|addr| addr.eq_ignore_ascii_case(to_email))
                || !result.permanent_bounces.is_empty();
            if bounced_match {
                let reason = "Cloudflare Email API reported a permanent bounce for this recipient.";
                guard.suppress_recipient(to_email, "cloudflare_api", reason);
                guard.record_hard_failure("cloudflare_api", reason);
                return Err(MailSendError::PermanentBounce(reason.to_string()));
            }

            let suppressed_match = result
                .suppressed_recipients
                .iter()
                .any(|addr| addr.eq_ignore_ascii_case(to_email))
                || !result.suppressed_recipients.is_empty();
            if suppressed_match {
                let reason = "Recipient is on Cloudflare's suppression list.";
                guard.suppress_recipient(to_email, "cloudflare_api", reason);
                guard.record_hard_failure("cloudflare_api", reason);
                return Err(MailSendError::RecipientSuppressed {
                    email: to_email.to_string(),
                    reason: reason.to_string(),
                });
            }

            if status.is_success() && env.success != Some(false) {
                let _ = (&result.delivered, &result.queued, &result.message_id);
                guard.record_success();
                return Ok(());
            }
        }
    }

    if status.is_success()
        && parsed
            .as_ref()
            .and_then(|e| e.success)
            .unwrap_or(true)
    {
        guard.record_success();
        return Ok(());
    }

    let err_summary = parsed
        .as_ref()
        .map(|e| summarize_cf_errors(&e.errors))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let snippet: String = body_text.trim().chars().take(240).collect();
            if snippet.is_empty() {
                format!("HTTP {}", status.as_u16())
            } else {
                format!("HTTP {}: {snippet}", status.as_u16())
            }
        });
    let lower = err_summary.to_ascii_lowercase();

    // Immediate circuit breaker on account pause, suspension, quota/rate limit, or unverified sending domain
    let is_account_or_quota_block = status.as_u16() == 429
        || lower.contains("paused")
        || lower.contains("suspended")
        || lower.contains("quota")
        || lower.contains("rate limit")
        || lower.contains("sending limit")
        || lower.contains("domain not verified")
        || lower.contains("unverified")
        || lower.contains("account blocked");
    if is_account_or_quota_block {
        let pause_secs = if status.as_u16() == 429 { 300 } else { CIRCUIT_OPEN_DURATION_SECS };
        guard.trip_circuit_immediately("cloudflare_api", &err_summary, pause_secs);
        return Err(MailSendError::CircuitOpen {
            reason: err_summary,
            retry_after_secs: pause_secs as u64,
        });
    }

    // Recipient-specific suppression/bounce errors reported via HTTP 4xx
    let is_recipient_reject = status.is_client_error()
        && status.as_u16() != 401
        && (lower.contains("suppress")
            || lower.contains("bounce")
            || lower.contains("invalid recipient")
            || lower.contains("recipient")
            || lower.contains("mailbox"));
    if is_recipient_reject {
        guard.suppress_recipient(to_email, "cloudflare_api", &err_summary);
        guard.record_hard_failure("cloudflare_api", &err_summary);
        return Err(MailSendError::PermanentBounce(format!(
            "Cloudflare Email API rejected recipient '{to_email}': {err_summary}"
        )));
    }

    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(MailSendError::DeliveryFailed(format!(
            "Cloudflare Email API authentication/permission failed (verify Account ID and Email Sending: Edit API token): {err_summary}"
        )));
    }

    Err(MailSendError::DeliveryFailed(format!(
        "Cloudflare Email API failed (HTTP {}): {err_summary}",
        status.as_u16()
    )))
}

fn auto_dedup_key(to_email: &str, subject: &str, html_body: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(to_email.as_bytes());
    hasher.update(b"\n");
    hasher.update(subject.as_bytes());
    hasher.update(b"\n");
    hasher.update(html_body.as_bytes());
    let digest = hex::encode(hasher.finalize());
    format!("auto:{to_email}:{}", &digest[..16])
}

pub async fn send_guarded_html_email(
    ctx: &MailSendContext<'_>,
    to_email: &str,
    subject: &str,
    html_body: &str,
) -> Result<(), MailSendError> {
    let clean_to = validate_and_normalize_email(to_email).ok_or_else(|| {
        MailSendError::InvalidInput("Invalid recipient email format.".to_string())
    })?;
    let clean_from = validate_and_normalize_email(&ctx.smtp.from_email).ok_or_else(|| {
        MailSendError::InvalidInput("Invalid sender email format.".to_string())
    })?;

    let mut effective_smtp = ctx.smtp.clone();
    if ctx.allow_disabled_draft {
        effective_smtp.enabled = true;
    }
    let Some(provider) = active_mail_provider(&effective_smtp, &ctx.creds) else {
        return Err(MailSendError::NotConfigured(
            "Outbound email transport is not configured or incomplete.".to_string(),
        ));
    };

    // 1. Fail fast if circuit breaker is open for this transport
    ctx.guard.check_circuit(provider)?;

    // 2. Fail fast if recipient is already on the local bounce suppression list
    ctx.guard.check_suppressed(&clean_to)?;

    // 3. Reserve single-flight in-flight & anti-jitter dedup slot atomically BEFORE any DNS / network I/O
    let (dedup_key, cooldown) = match ctx.dedup_key.map(str::trim).filter(|s| !s.is_empty()) {
        Some(k) => (k.to_ascii_lowercase(), ctx.cooldown_secs),
        None => (
            auto_dedup_key(&clean_to, subject, html_body),
            ctx.cooldown_secs.max(DEFAULT_AUTO_DEDUP_SECS),
        ),
    };
    let mut permit = ctx.guard.acquire_send_slot(dedup_key, cooldown)?;

    // 4. Pre-flight recipient domain existence & DNS MX / RFC 7505 Null-MX validation
    if let Err(err) = verify_recipient_domain_deliverability(
        ctx.guard,
        ctx.http_client,
        &effective_smtp,
        provider,
        &clean_to,
    )
    .await
    {
        permit.mark_pre_send_rejected();
        return Err(err);
    }

    let send_id = Uuid::new_v4().to_string();

    // 5. Dispatch strictly to the ONE active provider (zero cross-provider fallback)
    let result = match provider {
        "cloudflare_api" => {
            send_via_cloudflare_api(
                ctx.guard,
                ctx.http_client,
                &effective_smtp,
                ctx.creds.cloudflare_api_token,
                &clean_from,
                &clean_to,
                subject,
                html_body,
                &send_id,
            )
            .await
        }
        "smtp" => {
            send_via_smtp(
                ctx.guard,
                &effective_smtp,
                ctx.creds.smtp_password,
                &clean_from,
                &clean_to,
                subject,
                html_body,
            )
            .await
        }
        _ => Err(MailSendError::NotConfigured(
            "Unsupported outbound email transport.".to_string(),
        )),
    };

    match &result {
        Ok(()) => permit.mark_sent(),
        Err(err) if err.is_ambiguous_outcome() => permit.mark_ambiguous(),
        Err(MailSendError::PermanentBounce(_) | MailSendError::RecipientSuppressed { .. }) => {
            permit.mark_sent();
        }
        Err(_) => permit.mark_pre_send_rejected(),
    }

    result
}

fn resolve_template_pair(
    kind: &str,
    locale: &str,
    override_subject: &str,
    override_html: &str,
) -> (String, String) {
    let (def_subj, def_html) = default_localized_template(kind, locale);
    let subj = if override_subject.trim().is_empty() {
        def_subj
    } else {
        override_subject.trim().to_string()
    };
    let html = if override_html.trim().is_empty() {
        def_html
    } else {
        override_html.trim().to_string()
    };
    (subj, html)
}

pub async fn send_test_email(
    ctx: &MailSendContext<'_>,
    to_email: &str,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = default_localized_template("test", ctx.brand.locale);
    let vars = [("site_name", clean_site.as_str())];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_registration_code_email(
    ctx: &MailSendContext<'_>,
    to_email: &str,
    code: &str,
    expires_minutes: u32,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "register_code",
        ctx.brand.locale,
        &ctx.smtp.register_code_subject,
        &ctx.smtp.register_code_html,
    );
    let expires_str = expires_minutes.to_string();
    let vars = [
        ("site_name", clean_site.as_str()),
        ("email", to_email),
        ("code", code),
        ("expires_minutes", expires_str.as_str()),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_email_change_code_email(
    ctx: &MailSendContext<'_>,
    recipient_name: &str,
    to_email: &str,
    code: &str,
    expires_minutes: u32,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = default_localized_template("email_change", ctx.brand.locale);
    let expires_str = expires_minutes.to_string();
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", recipient_name),
        ("email", to_email),
        ("code", code),
        ("expires_minutes", expires_str.as_str()),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_login_otp_email(
    ctx: &MailSendContext<'_>,
    recipient_name: &str,
    code: &str,
    expires_minutes: u32,
    to_email: &str,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "login_otp",
        ctx.brand.locale,
        &ctx.smtp.login_otp_subject,
        &ctx.smtp.login_otp_html,
    );
    let expires_str = expires_minutes.to_string();
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", recipient_name),
        ("code", code),
        ("expires_minutes", expires_str.as_str()),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_login_anomaly_alert_email(
    ctx: &MailSendContext<'_>,
    recipient_name: &str,
    ip_address: &str,
    device_label: &str,
    anomaly_reason: &str,
    to_email: &str,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let legacy_has_code = ctx.smtp.login_anomaly_subject.contains("{{code}}")
        || ctx.smtp.login_anomaly_html.contains("{{code}}");
    let (subj_tpl, html_tpl) = if legacy_has_code {
        default_localized_template("login_anomaly", ctx.brand.locale)
    } else {
        resolve_template_pair(
            "login_anomaly",
            ctx.brand.locale,
            &ctx.smtp.login_anomaly_subject,
            &ctx.smtp.login_anomaly_html,
        )
    };
    let occurred_at = Utc::now().format("%Y-%m-%d %H:%M UTC").to_string();
    let anomaly_summary = localize_anomaly_reason(anomaly_reason, ctx.brand.locale);
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", recipient_name),
        ("anomaly_summary", anomaly_summary),
        ("ip_address", ip_address),
        ("device_label", device_label),
        ("occurred_at", occurred_at.as_str()),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_collaborator_invite_email(
    ctx: &MailSendContext<'_>,
    inviter_name: &str,
    article_title: &str,
    action_url: &str,
    to_email: &str,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let clean_title = strip_html_tags(article_title);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "invite",
        ctx.brand.locale,
        &ctx.smtp.invite_subject,
        &ctx.smtp.invite_html,
    );
    let vars = [
        ("site_name", clean_site.as_str()),
        ("inviter_name", inviter_name),
        ("article_title", clean_title.as_str()),
        ("action_url", action_url),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_password_reset_email(
    ctx: &MailSendContext<'_>,
    recipient_name: &str,
    otp_code: &str,
    action_url: &str,
    to_email: &str,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "reset",
        ctx.brand.locale,
        &ctx.smtp.reset_subject,
        &ctx.smtp.reset_html,
    );
    let expires_str = icehandnote_core::auth::PASSWORD_RESET_TTL_MINUTES.to_string();
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", recipient_name),
        ("code", otp_code),
        ("expires_minutes", expires_str.as_str()),
        ("action_url", action_url),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_takedown_notice_email(
    ctx: &MailSendContext<'_>,
    recipient_name: &str,
    article_title: &str,
    reason: &str,
    action_url: &str,
    to_email: &str,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let clean_title = strip_html_tags(article_title);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "takedown",
        ctx.brand.locale,
        &ctx.smtp.takedown_subject,
        &ctx.smtp.takedown_html,
    );
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", recipient_name),
        ("article_title", clean_title.as_str()),
        ("reason", reason),
        ("action_url", action_url),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

pub async fn send_user_ban_notice_email(
    ctx: &MailSendContext<'_>,
    recipient_name: &str,
    username: &str,
    reason: &str,
    to_email: &str,
) -> Result<(), MailSendError> {
    let clean_site = strip_html_tags(ctx.brand.site_name);
    let logo_html = build_email_logo_html(ctx.brand.logo_url, &clean_site, ctx.brand.origin);
    let footer_tpl =
        resolve_email_footer_template(Some(&ctx.smtp.email_footer_text), ctx.brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "account_ban",
        ctx.brand.locale,
        &ctx.smtp.ban_subject,
        &ctx.smtp.ban_html,
    );
    let effective_reason = if reason.trim().is_empty() {
        match ctx.brand.locale {
            "en" => "Violation of community content and usage guidelines",
            "zh-TW" => "違反社群內容與使用規範",
            "ja" => "コミュニティのコンテンツおよび利用規約違反",
            _ => "违反社区内容与使用规范",
        }
    } else {
        reason.trim()
    };
    let occurred_at = Utc::now().format("%Y-%m-%d %H:%M UTC").to_string();
    let display = if recipient_name.trim().is_empty() {
        username.trim()
    } else {
        recipient_name.trim()
    };
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", display),
        ("username", username.trim()),
        ("reason", effective_reason),
        ("occurred_at", occurred_at.as_str()),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_guarded_html_email(ctx, to_email, &subject, &html).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_clean_rfc5321_ehlo_domain() {
        assert_eq!(
            derive_ehlo_client_id("noreply@Notes.Example.COM"),
            ClientId::Domain("notes.example.com".to_string())
        );
        assert_eq!(
            derive_ehlo_client_id("invalid_user@bad_host"),
            ClientId::Domain("localhost".to_string())
        );
    }

    #[test]
    fn enforces_strict_mutual_exclusivity_between_smtp_and_cloudflare_api() {
        let mut cfg = SmtpSettingsDto {
            enabled: true,
            provider: "smtp".to_string(),
            host: "smtp.example.org".to_string(),
            cloudflare_account_id: "0123456789abcdef0123456789abcdef".to_string(),
            from_email: "noreply@icehandnote.dev".to_string(),
            ..Default::default()
        };
        let both_creds = MailCredentials {
            smtp_password: "smtp-secret",
            cloudflare_api_token: "cf-token-secret",
        };
        assert_eq!(active_mail_provider(&cfg, &both_creds), Some("smtp"));

        cfg.provider = "cloudflare_api".to_string();
        assert_eq!(
            active_mail_provider(&cfg, &both_creds),
            Some("cloudflare_api")
        );

        // Missing Cloudflare token must NOT fall back to SMTP even when SMTP host+password exist
        let smtp_only_creds = MailCredentials {
            smtp_password: "smtp-secret",
            cloudflare_api_token: "",
        };
        assert_eq!(active_mail_provider(&cfg, &smtp_only_creds), None);

        // Missing SMTP host must NOT fall back to Cloudflare even when CF credentials exist
        cfg.provider = "smtp".to_string();
        cfg.host.clear();
        assert_eq!(active_mail_provider(&cfg, &both_creds), None);
    }

    #[tokio::test]
    async fn delivers_email_change_code_fast_to_local_smtp_sink() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind smtp sink");
        let port = listener.local_addr().unwrap().port();
        let sink = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (r, mut w) = stream.into_split();
            let mut reader = BufReader::new(r);
            w.write_all(b"220 sink.local ESMTP Ready\r\n").await.unwrap();
            let mut seen_ehlo = String::new();
            let mut in_data = false;
            let mut line = String::new();
            loop {
                line.clear();
                let n = reader.read_line(&mut line).await.unwrap();
                if n == 0 {
                    break;
                }
                if in_data {
                    if line.trim_end_matches(['\r', '\n']) == "." {
                        in_data = false;
                        w.write_all(b"250 OK queued\r\n").await.unwrap();
                    }
                    continue;
                }
                let upper = line.to_ascii_uppercase();
                if upper.starts_with("EHLO ") || upper.starts_with("HELO ") {
                    seen_ehlo = line.trim().to_string();
                    w.write_all(b"250-sink.local\r\n250 OK\r\n").await.unwrap();
                } else if upper.starts_with("MAIL FROM:") || upper.starts_with("RCPT TO:") {
                    w.write_all(b"250 OK\r\n").await.unwrap();
                } else if upper.starts_with("DATA") {
                    in_data = true;
                    w.write_all(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                        .await
                        .unwrap();
                } else if upper.starts_with("QUIT") {
                    w.write_all(b"221 Bye\r\n").await.unwrap();
                    break;
                } else {
                    w.write_all(b"250 OK\r\n").await.unwrap();
                }
            }
            seen_ehlo
        });

        let smtp = SmtpSettingsDto {
            enabled: true,
            provider: "smtp".to_string(),
            host: "127.0.0.1".to_string(),
            port,
            encryption: "none".to_string(),
            username: String::new(),
            from_name: "IceHandnote".to_string(),
            from_email: "noreply@icehandnote.dev".to_string(),
            ..Default::default()
        };
        let guard = Arc::new(MailDeliveryGuard::in_memory());
        let client = reqwest::Client::new();
        let ctx = MailSendContext {
            guard: &guard,
            http_client: &client,
            smtp: &smtp,
            creds: MailCredentials::default(),
            brand: MailBrandContext {
                site_name: "IceHandnote",
                logo_url: "",
                origin: "https://notes.test",
                locale: "zh-CN",
            },
            dedup_key: Some("test-email-change-sink"),
            cooldown_secs: 60,
            allow_disabled_draft: false,
        };
        let started = std::time::Instant::now();
        send_email_change_code_email(&ctx, "Alice", "alice.new@example.com", "591842", 10)
            .await
            .expect("smtp send must succeed quickly");
        assert!(started.elapsed() < Duration::from_secs(3));
        let ehlo = sink.await.unwrap();
        assert_eq!(ehlo, "EHLO icehandnote.dev");
    }

    #[tokio::test]
    async fn cloudflare_api_enforces_mx_check_bounce_suppression_circuit_breaker_and_anti_jitter() {
        use axum::{
            extract::{Query, State as AxumState},
            http::{HeaderMap as AxumHeaders, StatusCode},
            routing::{get, post},
            Json, Router,
        };
        use std::sync::atomic::{AtomicUsize, Ordering};

        #[derive(Clone)]
        struct MockState {
            cf_calls: Arc<AtomicUsize>,
            last_auth: Arc<Mutex<String>>,
            last_payload: Arc<Mutex<Option<serde_json::Value>>>,
            delay_ms: Arc<AtomicUsize>,
        }

        let mock_state = MockState {
            cf_calls: Arc::new(AtomicUsize::new(0)),
            last_auth: Arc::new(Mutex::new(String::new())),
            last_payload: Arc::new(Mutex::new(None)),
            delay_ms: Arc::new(AtomicUsize::new(0)),
        };

        let mock_app = Router::new()
            .route(
                "/dns-query",
                get(|Query(q): Query<HashMap<String, String>>| async move {
                    let name = q.get("name").cloned().unwrap_or_default();
                    let rr = q.get("type").cloned().unwrap_or_default();
                    if name == "nonexistent-domain.invalidtest" {
                        return Json(serde_json::json!({ "Status": 3 }));
                    }
                    if name == "nullmx.dev" {
                        return Json(serde_json::json!({
                            "Status": 0,
                            "Answer": [{ "type": 15, "data": "0 ." }]
                        }));
                    }
                    if rr == "MX" && name == "goodmail.dev" {
                        return Json(serde_json::json!({
                            "Status": 0,
                            "Answer": [{ "type": 15, "data": "10 mx.goodmail.dev." }]
                        }));
                    }
                    Json(serde_json::json!({ "Status": 0, "Answer": [] }))
                }),
            )
            .route(
                "/client/v4/accounts/0123456789abcdef0123456789abcdef/email/sending/send",
                post(
                    |AxumState(st): AxumState<MockState>,
                     headers: AxumHeaders,
                     Json(body): Json<serde_json::Value>| async move {
                        let delay = st.delay_ms.load(Ordering::SeqCst) as u64;
                        if delay > 0 {
                            tokio::time::sleep(Duration::from_millis(delay)).await;
                        }
                        st.cf_calls.fetch_add(1, Ordering::SeqCst);
                        let auth = headers
                            .get(axum::http::header::AUTHORIZATION)
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("")
                            .to_string();
                        *st.last_auth.lock().unwrap() = auth;
                        *st.last_payload.lock().unwrap() = Some(body.clone());

                        let to = body["to"].as_str().unwrap_or("");
                        if to.starts_with("bounce") {
                            return (
                                StatusCode::OK,
                                Json(serde_json::json!({
                                    "success": true,
                                    "result": {
                                        "delivered": [],
                                        "queued": [],
                                        "permanent_bounces": [to],
                                        "suppressed_recipients": [],
                                        "message_id": "msg-bounce"
                                    }
                                })),
                            );
                        }
                        if to.starts_with("paused") {
                            return (
                                StatusCode::TOO_MANY_REQUESTS,
                                Json(serde_json::json!({
                                    "success": false,
                                    "errors": [{ "code": 10042, "message": "Account sending paused due to bounce rate" }]
                                })),
                            );
                        }
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({
                                "success": true,
                                "result": {
                                    "delivered": [to],
                                    "queued": [],
                                    "permanent_bounces": [],
                                    "suppressed_recipients": [],
                                    "message_id": "msg-ok-1"
                                }
                            })),
                        )
                    },
                ),
            )
            .with_state(mock_state.clone());

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, mock_app).await;
        });

        let base = format!("http://{addr}");
        let guard = Arc::new(MailDeliveryGuard::in_memory().with_test_endpoints(
            &base,
            Some(format!("{base}/dns-query")),
            Duration::from_millis(450),
        ));
        let client = reqwest::Client::new();
        let smtp = SmtpSettingsDto {
            enabled: true,
            provider: "cloudflare_api".to_string(),
            cloudflare_account_id: "0123456789abcdef0123456789abcdef".to_string(),
            verify_recipient_mx: true,
            from_name: "IceHandnote".to_string(),
            from_email: "noreply@icehandnote.dev".to_string(),
            ..Default::default()
        };
        let creds = MailCredentials {
            smtp_password: "",
            cloudflare_api_token: "cf-secret-token-123",
        };
        let brand = MailBrandContext {
            site_name: "IceHandnote",
            logo_url: "",
            origin: "https://notes.icehandnote.dev",
            locale: "en",
        };

        // 1. Non-existent domain (NXDOMAIN) & Null MX blocked BEFORE hitting Cloudflare API
        let nx_ctx = MailSendContext {
            guard: &guard,
            http_client: &client,
            smtp: &smtp,
            creds,
            brand,
            dedup_key: Some("k-nx"),
            cooldown_secs: 60,
            allow_disabled_draft: false,
        };
        assert!(matches!(
            send_test_email(&nx_ctx, "user@nonexistent-domain.invalidtest").await,
            Err(MailSendError::DomainInvalid(_))
        ));
        assert!(matches!(
            send_test_email(&nx_ctx, "user@nullmx.dev").await,
            Err(MailSendError::DomainInvalid(_))
        ));
        assert_eq!(
            mock_state.cf_calls.load(Ordering::SeqCst),
            0,
            "Invalid domains must never call Cloudflare Email API"
        );

        // 2. Valid MX domain succeeds and sends Bearer token + html + text + from object
        let ok_ctx = MailSendContext {
            dedup_key: Some("k-ok"),
            ..nx_ctx
        };
        send_test_email(&ok_ctx, "alice@goodmail.dev")
            .await
            .expect("valid recipient succeeds");
        assert_eq!(mock_state.cf_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            mock_state.last_auth.lock().unwrap().as_str(),
            "Bearer cf-secret-token-123"
        );
        let payload = mock_state.last_payload.lock().unwrap().clone().unwrap();
        assert_eq!(payload["to"], "alice@goodmail.dev");
        assert_eq!(payload["from"]["address"], "noreply@icehandnote.dev");
        assert_eq!(payload["from"]["name"], "IceHandnote");
        assert!(!payload["text"].as_str().unwrap_or("").is_empty());

        // 3. Anti-jitter: slow upstream + 2 concurrent requests with same dedup key => ONLY 1 Cloudflare POST
        mock_state.delay_ms.store(220, Ordering::SeqCst);
        let calls_before = mock_state.cf_calls.load(Ordering::SeqCst);
        let jitter_ctx = MailSendContext {
            dedup_key: Some("k-jitter-same"),
            cooldown_secs: 60,
            ..nx_ctx
        };
        let (r1, r2) = tokio::join!(
            send_test_email(&jitter_ctx, "bob@goodmail.dev"),
            send_test_email(&jitter_ctx, "bob@goodmail.dev")
        );
        let ok_count = usize::from(r1.is_ok()) + usize::from(r2.is_ok());
        let dup_count = usize::from(matches!(
            r1,
            Err(MailSendError::InFlightDuplicate | MailSendError::CooldownDuplicate { .. })
        )) + usize::from(matches!(
            r2,
            Err(MailSendError::InFlightDuplicate | MailSendError::CooldownDuplicate { .. })
        ));
        assert_eq!(ok_count, 1);
        assert_eq!(dup_count, 1);
        assert_eq!(
            mock_state.cf_calls.load(Ordering::SeqCst) - calls_before,
            1,
            "Concurrent duplicate during latency jitter must only send once"
        );

        // 4. Timeout retains dedup lock so immediate retry cannot double-send
        mock_state.delay_ms.store(650, Ordering::SeqCst);
        let timeout_ctx = MailSendContext {
            dedup_key: Some("k-timeout-jitter"),
            cooldown_secs: 60,
            ..nx_ctx
        };
        let t1 = send_test_email(&timeout_ctx, "slow@goodmail.dev").await;
        assert!(matches!(t1, Err(MailSendError::DeliveryTimeout(_))));
        let t2 = send_test_email(&timeout_ctx, "slow@goodmail.dev").await;
        assert!(
            matches!(t2, Err(MailSendError::CooldownDuplicate { .. })),
            "Immediate retry after ambiguous timeout must be deduplicated, got: {t2:?}"
        );

        // 5. Permanent bounce automatically suppresses recipient locally
        mock_state.delay_ms.store(0, Ordering::SeqCst);
        let bounce_ctx = MailSendContext {
            dedup_key: Some("k-bounce-1"),
            ..nx_ctx
        };
        assert!(matches!(
            send_test_email(&bounce_ctx, "bounce1@goodmail.dev").await,
            Err(MailSendError::PermanentBounce(_))
        ));
        let calls_after_bounce = mock_state.cf_calls.load(Ordering::SeqCst);
        let bounce_ctx2 = MailSendContext {
            dedup_key: Some("k-bounce-2"),
            ..nx_ctx
        };
        assert!(matches!(
            send_test_email(&bounce_ctx2, "bounce1@goodmail.dev").await,
            Err(MailSendError::RecipientSuppressed { .. })
        ));
        assert_eq!(
            mock_state.cf_calls.load(Ordering::SeqCst),
            calls_after_bounce,
            "Suppressed recipient must be blocked locally before calling Cloudflare API"
        );

        // 6. Provider pause/429 trips circuit breaker and blocks all further traffic until reset
        let pause_ctx = MailSendContext {
            dedup_key: Some("k-pause"),
            ..nx_ctx
        };
        assert!(matches!(
            send_test_email(&pause_ctx, "paused@goodmail.dev").await,
            Err(MailSendError::CircuitOpen { .. })
        ));
        let calls_after_trip = mock_state.cf_calls.load(Ordering::SeqCst);
        let blocked_ctx = MailSendContext {
            dedup_key: Some("k-after-trip"),
            ..nx_ctx
        };
        assert!(matches!(
            send_test_email(&blocked_ctx, "fresh@goodmail.dev").await,
            Err(MailSendError::CircuitOpen { .. })
        ));
        assert_eq!(mock_state.cf_calls.load(Ordering::SeqCst), calls_after_trip);

        // Resetting circuit restores delivery cleanly
        let reset_status = guard.reset_circuit();
        assert!(!reset_status.circuit_open);
        send_test_email(&blocked_ctx, "fresh@goodmail.dev")
            .await
            .expect("sending resumes after admin resets circuit");

        server.abort();
    }
}
