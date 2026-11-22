use anyhow::{anyhow, bail, Context, Result};
use chrono::Utc;
use icehandnote_core::{
    auth::is_valid_email,
    mail_templates::{
        build_email_logo_html, default_localized_template, localize_anomaly_reason,
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
use std::{net::SocketAddr, time::Duration};

#[derive(Debug, Clone, Copy)]
pub struct MailBrandContext<'a> {
    pub site_name: &'a str,
    pub logo_url: &'a str,
    pub origin: &'a str,
    pub locale: &'a str,
}

pub fn is_smtp_ready(smtp: &SmtpSettingsDto) -> bool {
    smtp.enabled && !smtp.host.trim().is_empty() && is_valid_email(&smtp.from_email)
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

    // Try up to 2 IPv4 endpoints first, then at most 1 IPv6 fallback
    let mut ordered = Vec::new();
    ordered.extend(ipv4.into_iter().take(2));
    ordered.extend(ipv6.into_iter().take(1));
    if ordered.is_empty() {
        ordered.push(host.to_string());
    }
    ordered
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
) -> Result<AsyncSmtpTransport<Tokio1Executor>> {
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
                .context("Failed to initialize STARTTLS parameters")?;
            builder = builder.tls(Tls::Required(tls_params));
        }
        _ => {
            let tls_params = TlsParameters::new(sni_host.to_string())
                .context("Failed to initialize TLS parameters")?;
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

pub async fn send_html_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    to_email: &str,
    subject: &str,
    html_body: &str,
) -> Result<()> {
    let host = smtp.host.trim();
    if host.is_empty() {
        bail!("SMTP host cannot be empty.");
    }
    let from_addr_str = smtp.from_email.trim();
    if from_addr_str.is_empty() {
        bail!("Sender email address cannot be empty.");
    }
    let from_mailbox: Mailbox = if smtp.from_name.trim().is_empty() {
        from_addr_str.parse().context("Invalid sender email format")?
    } else {
        Mailbox::new(
            Some(strip_html_tags(&smtp.from_name)),
            from_addr_str.parse().context("Invalid sender email format")?,
        )
    };
    let to_mailbox: Mailbox = to_email
        .trim()
        .parse()
        .context("Invalid recipient email format")?;

    let email = Message::builder()
        .from(from_mailbox)
        .to(to_mailbox)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html_body.to_string())
        .context("Failed to build email message")?;

    let client_id = derive_ehlo_client_id(from_addr_str);
    let primary_enc = smtp.encryption.as_str();

    // Auto-fallback ONLY between encrypted TLS modes when port/mode are swapped (587+tls or 465+starttls)
    let fallback_enc: Option<&str> = match (primary_enc, smtp.port) {
        ("tls", 587) => Some("starttls"),
        ("starttls", 465) => Some("tls"),
        _ => None,
    };

    // Enforce a strict overall 12-second wall-clock deadline so HTTP handlers never hang or trigger proxy 503/504
    let overall = tokio::time::timeout(Duration::from_secs(12), async {
        let targets = resolve_smtp_targets(host, smtp.port).await;
        let mut last_err: Option<anyhow::Error> = None;

        for (idx, target) in targets.iter().enumerate() {
            let op_timeout = if idx == 0 {
                Duration::from_secs(6)
            } else {
                Duration::from_secs(4)
            };
            let mailer = build_transport_for_target(
                target,
                host,
                smtp.port,
                primary_enc,
                &smtp.username,
                password,
                client_id.clone(),
                op_timeout,
            )?;
            match mailer.send(email.clone()).await {
                Ok(_) => return Ok(()),
                Err(err) => {
                    let msg = err.to_string();
                    let lower = msg.to_ascii_lowercase();
                    let is_auth_or_rejected = lower.contains("authentication")
                        || lower.contains("535")
                        || lower.contains("530")
                        || lower.contains("550")
                        || lower.contains("553")
                        || lower.contains("554");
                    if is_auth_or_rejected {
                        return Err(anyhow!("SMTP server rejected message or credentials: {msg}"));
                    }

                    // If port 587/465 TLS mode appears swapped, immediately try the paired TLS mode once
                    if idx == 0 {
                        if let Some(alt_enc) = fallback_enc {
                            if let Ok(alt_mailer) = build_transport_for_target(
                                target,
                                host,
                                smtp.port,
                                alt_enc,
                                &smtp.username,
                                password,
                                client_id.clone(),
                                Duration::from_secs(5),
                            ) {
                                if alt_mailer.send(email.clone()).await.is_ok() {
                                    tracing::warn!(
                                        "SMTP succeeded via {alt_enc} fallback on {}:{} (configured: {primary_enc})",
                                        host,
                                        smtp.port
                                    );
                                    return Ok(());
                                }
                            }
                        }
                    }

                    last_err = Some(anyhow!("SMTP delivery via {target}:{} failed: {msg}", smtp.port));
                }
            }
        }

        Err(last_err.unwrap_or_else(|| anyhow!("Failed to connect to SMTP server {host}:{}", smtp.port)))
    })
    .await;

    match overall {
        Ok(res) => res,
        Err(_) => bail!(
            "SMTP connection to {host}:{} timed out after 12s (check host, port, and TLS/STARTTLS setting).",
            smtp.port
        ),
    }
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
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    to_email: &str,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = default_localized_template("test", brand.locale);
    let vars = [("site_name", clean_site.as_str())];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_html_email(smtp, password, to_email, &subject, &html).await
}

pub async fn send_registration_code_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    to_email: &str,
    code: &str,
    expires_minutes: u32,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "register_code",
        brand.locale,
        &smtp.register_code_subject,
        &smtp.register_code_html,
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
    send_html_email(smtp, password, to_email, &subject, &html).await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_email_change_code_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    recipient_name: &str,
    to_email: &str,
    code: &str,
    expires_minutes: u32,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = default_localized_template("email_change", brand.locale);
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
    send_html_email(smtp, password, to_email, &subject, &html).await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_login_anomaly_otp_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    recipient_name: &str,
    ip_address: &str,
    device_label: &str,
    anomaly_reason: &str,
    code: &str,
    expires_minutes: u32,
    to_email: &str,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "login_anomaly",
        brand.locale,
        &smtp.login_anomaly_subject,
        &smtp.login_anomaly_html,
    );
    let expires_str = expires_minutes.to_string();
    let occurred_at = Utc::now().format("%Y-%m-%d %H:%M UTC").to_string();
    let anomaly_summary = localize_anomaly_reason(anomaly_reason, brand.locale);
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", recipient_name),
        ("anomaly_summary", anomaly_summary),
        ("ip_address", ip_address),
        ("device_label", device_label),
        ("occurred_at", occurred_at.as_str()),
        ("code", code),
        ("expires_minutes", expires_str.as_str()),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_html_email(smtp, password, to_email, &subject, &html).await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_collaborator_invite_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    inviter_name: &str,
    article_title: &str,
    action_url: &str,
    to_email: &str,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let clean_title = strip_html_tags(article_title);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "invite",
        brand.locale,
        &smtp.invite_subject,
        &smtp.invite_html,
    );
    let vars = [
        ("site_name", clean_site.as_str()),
        ("inviter_name", inviter_name),
        ("article_title", clean_title.as_str()),
        ("action_url", action_url),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_html_email(smtp, password, to_email, &subject, &html).await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_password_reset_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    recipient_name: &str,
    otp_code: &str,
    action_url: &str,
    to_email: &str,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "reset",
        brand.locale,
        &smtp.reset_subject,
        &smtp.reset_html,
    );
    let vars = [
        ("site_name", clean_site.as_str()),
        ("recipient_name", recipient_name),
        ("code", otp_code),
        ("expires_minutes", "30"),
        ("action_url", action_url),
    ];
    let subject = render_mail_subject(&subj_tpl, &vars);
    let html = render_mail_html(&html_tpl, &vars, &logo_html, &footer_tpl);
    send_html_email(smtp, password, to_email, &subject, &html).await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_takedown_notice_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    recipient_name: &str,
    article_title: &str,
    reason: &str,
    action_url: &str,
    to_email: &str,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let clean_title = strip_html_tags(article_title);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "takedown",
        brand.locale,
        &smtp.takedown_subject,
        &smtp.takedown_html,
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
    send_html_email(smtp, password, to_email, &subject, &html).await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_user_ban_notice_email(
    smtp: &SmtpSettingsDto,
    password: &str,
    brand: MailBrandContext<'_>,
    recipient_name: &str,
    username: &str,
    reason: &str,
    to_email: &str,
) -> Result<()> {
    let clean_site = strip_html_tags(brand.site_name);
    let logo_html = build_email_logo_html(brand.logo_url, &clean_site, brand.origin);
    let footer_tpl = resolve_email_footer_template(Some(&smtp.email_footer_text), brand.locale);
    let (subj_tpl, html_tpl) = resolve_template_pair(
        "account_ban",
        brand.locale,
        &smtp.ban_subject,
        &smtp.ban_html,
    );
    let effective_reason = if reason.trim().is_empty() {
        match brand.locale {
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
    send_html_email(smtp, password, to_email, &subject, &html).await
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
            host: "127.0.0.1".to_string(),
            port,
            encryption: "none".to_string(),
            username: String::new(),
            from_name: "IceHandnote".to_string(),
            from_email: "noreply@icehandnote.dev".to_string(),
            ..Default::default()
        };
        let started = std::time::Instant::now();
        send_email_change_code_email(
            &smtp,
            "",
            MailBrandContext {
                site_name: "IceHandnote",
                logo_url: "",
                origin: "https://notes.test",
                locale: "zh-CN",
            },
            "Alice",
            "alice.new@example.com",
            "591842",
            10,
        )
        .await
        .expect("smtp send must succeed quickly");
        assert!(started.elapsed() < Duration::from_secs(3));
        let ehlo = sink.await.unwrap();
        assert_eq!(ehlo, "EHLO icehandnote.dev");
    }
}
