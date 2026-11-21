use crate::auth::normalize_supported_locale;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpSettingsDto {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_smtp_port")]
    pub port: u16,
    /// `"tls"` (implicit TLS, e.g. 465) | `"starttls"` (e.g. 587) | `"none"`
    #[serde(default = "default_smtp_encryption")]
    pub encryption: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub from_name: String,
    #[serde(default)]
    pub from_email: String,
    /// Optional custom email footer text (supports `{{site_name}}`). Empty = localized built-in footer.
    #[serde(default)]
    pub email_footer_text: String,
    /// Empty string = automatically use built-in localized template matching user's active locale.
    #[serde(default)]
    pub register_code_subject: String,
    #[serde(default)]
    pub register_code_html: String,
    #[serde(default)]
    pub login_anomaly_subject: String,
    #[serde(default)]
    pub login_anomaly_html: String,
    #[serde(default)]
    pub invite_subject: String,
    #[serde(default)]
    pub invite_html: String,
    #[serde(default)]
    pub reset_subject: String,
    #[serde(default)]
    pub reset_html: String,
    #[serde(default)]
    pub takedown_subject: String,
    #[serde(default)]
    pub takedown_html: String,
}

fn default_smtp_port() -> u16 {
    465
}

fn default_smtp_encryption() -> String {
    "tls".to_string()
}

impl Default for SmtpSettingsDto {
    fn default() -> Self {
        Self {
            enabled: false,
            host: String::new(),
            port: default_smtp_port(),
            encryption: default_smtp_encryption(),
            username: String::new(),
            from_name: "IceHandnote".to_string(),
            from_email: String::new(),
            email_footer_text: String::new(),
            register_code_subject: String::new(),
            register_code_html: String::new(),
            login_anomaly_subject: String::new(),
            login_anomaly_html: String::new(),
            invite_subject: String::new(),
            invite_html: String::new(),
            reset_subject: String::new(),
            reset_html: String::new(),
            takedown_subject: String::new(),
            takedown_html: String::new(),
        }
    }
}

impl SmtpSettingsDto {
    pub fn sanitize(mut self) -> Self {
        self.host = self.host.trim().chars().take(255).collect();
        if self.port == 0 {
            self.port = 465;
        }
        self.encryption = match self.encryption.trim().to_ascii_lowercase().as_str() {
            "starttls" => "starttls".to_string(),
            "none" | "plain" => "none".to_string(),
            _ => "tls".to_string(),
        };
        self.username = self.username.trim().chars().take(255).collect();
        self.from_name = self.from_name.trim().chars().take(80).collect();
        self.from_email = self.from_email.trim().chars().take(160).collect();
        self.email_footer_text = crate::sanitize_email_footer_html(&self.email_footer_text, 1200);
        self.register_code_subject = self.register_code_subject.trim().to_string();
        self.register_code_html = self.register_code_html.trim().to_string();
        self.login_anomaly_subject = self.login_anomaly_subject.trim().to_string();
        self.login_anomaly_html = self.login_anomaly_html.trim().to_string();
        self.invite_subject = self.invite_subject.trim().to_string();
        self.invite_html = self.invite_html.trim().to_string();
        self.reset_subject = self.reset_subject.trim().to_string();
        self.reset_html = self.reset_html.trim().to_string();
        self.takedown_subject = self.takedown_subject.trim().to_string();
        self.takedown_html = self.takedown_html.trim().to_string();
        self
    }
}

fn escape_html_value(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Resolve absolute logo URL for emails (`/uploads/...` joins against site origin).
pub fn resolve_email_logo_url(logo_url: &str, origin: &str) -> String {
    let trimmed = logo_url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return trimmed.to_string();
    }
    if trimmed.starts_with('/') {
        let base = origin.trim().trim_end_matches('/');
        if !base.is_empty() {
            return format!("{base}{trimmed}");
        }
    }
    String::new()
}

/// Build email-safe site logo fragment matching the configured site logo (or hand-framed default snowflake mark).
pub fn build_email_logo_html(logo_url: &str, site_name: &str, origin: &str) -> String {
    let resolved = resolve_email_logo_url(logo_url, origin);
    if !resolved.is_empty() {
        let safe_src = escape_html_value(&resolved);
        let safe_alt = escape_html_value(site_name);
        format!(
            r#"<img src="{safe_src}" alt="{safe_alt}" width="34" height="34" style="display:inline-block;width:34px;height:34px;object-fit:contain;border-radius:9px 11px 10px 8px;border:1.5px solid #2b211c;background-color:#fffef8;padding:3px;vertical-align:middle;margin-right:10px;box-sizing:border-box;box-shadow:2px 2px 0 #dfd6c3;" />"#
        )
    } else {
        // Mirrors the exact site navbar default snowflake emblem in a hand-inked stationery tile
        r#"<span style="display:inline-block;width:34px;height:34px;line-height:30px;text-align:center;border-radius:9px 11px 10px 8px;background-color:#fffef8;color:#005a9e;font-size:18px;font-weight:700;border:1.5px solid #2b211c;vertical-align:middle;margin-right:10px;box-sizing:border-box;box-shadow:2px 2px 0 #dfd6c3;">&#10052;&#xFE0E;</span>"#
            .to_string()
    }
}

pub fn default_email_footer(locale: &str) -> &'static str {
    let loc = normalize_supported_locale(Some(locale), "en");
    match loc {
        "zh-CN" => "由 {{site_name}} 手账信笺自动寄出 · 系统通知邮件，请勿直接回复。",
        "zh-TW" => "由 {{site_name}} 手帳信箋自動寄出 · 系統通知郵件，請勿直接回覆。",
        "ja" => "{{site_name}} より自動送信 · システム通知メールのため返信しないでください。",
        _ => "Sent from {{site_name}} &middot; Automated stationery note, please do not reply directly.",
    }
}

/// Returns HTML-safe footer template text (allowing safe HTML tags like `<a>`, `<strong>`, `<br>`
/// while preserving `{{site_name}}` for subsequent interpolation and injecting email-safe link styles).
pub fn resolve_email_footer_template(custom_footer: Option<&str>, locale: &str) -> String {
    match custom_footer.map(str::trim).filter(|s| !s.is_empty()) {
        Some(custom) => {
            let cleaned = crate::sanitize_email_footer_html(custom, 1200);
            if cleaned.trim().is_empty() {
                default_email_footer(locale).to_string()
            } else {
                cleaned.replace(
                    "<a ",
                    r#"<a style="color:#4c1d95;text-decoration:underline;font-weight:600;" "#,
                )
            }
        }
        None => default_email_footer(locale).to_string(),
    }
}

pub fn localize_anomaly_reason(reason_code: &str, locale: &str) -> &'static str {
    let loc = normalize_supported_locale(Some(locale), "en");
    match (reason_code, loc) {
        ("new_ip_and_device", "zh-CN") => "检测到来自陌生 IP 地址与新设备的登录尝试",
        ("new_ip_and_device", "zh-TW") => "偵測到來自陌生 IP 位址與新裝置的登入嘗試",
        ("new_ip_and_device", "ja") => "新しい IP アドレスおよび未確認の端末からのサインイン試行",
        ("new_ip_and_device", _) => "Sign-in attempt from an unrecognized IP address and new device",

        ("new_ip", "zh-CN") => "检测到来自异地或陌生 IP 地址的登录活动",
        ("new_ip", "zh-TW") => "偵測到來自異地或陌生 IP 位址的登入活動",
        ("new_ip", "ja") => "通常と異なる場所または新しい IP アドレスからのサインイン活動",
        ("new_ip", _) => "Sign-in activity from a new or unusual IP location",

        ("new_device", "zh-CN") => "检测到来自未识别新设备或浏览器的登录活动",
        ("new_device", "zh-TW") => "偵測到來自未識別新裝置或瀏覽器的登入活動",
        ("new_device", "ja") => "新しい端末またはブラウザからのサインイン活動",
        ("new_device", _) => "Sign-in activity from an unrecognized device or browser",

        (_, "zh-CN") => "检测到异常地点或可疑登录活动",
        (_, "zh-TW") => "偵測到異常地點或可疑登入活動",
        (_, "ja") => "通常とは異なるサインイン活動を検知しました",
        (_, _) => "Unusual sign-in location or activity detected",
    }
}

struct StampBadge<'a> {
    label: &'a str,
    bg_color: &'a str,
    border_color: &'a str,
    text_color: &'a str,
}

/// Hand-drawn loose-leaf stationery shell with ZERO top horizontal color bar.
/// Echoes IceHandnote's tactile drafting-paper aesthetic: dot-grid desk canvas,
/// sepia-ink outlined archival paper sheet, subtle asymmetric corners, layered paper stack shadow,
/// tilted rubber-stamp pill, dashed notebook dividers, and customizable footer slot.
fn wrap_stationery_email(stamp: StampBadge<'_>, body_html: &str) -> String {
    format!(
        r#"<div style="margin:0;padding:30px 14px;background-color:#f4efe3;background-image:radial-gradient(#cfc5b0 1px,transparent 1px);background-size:18px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',Roboto,Helvetica,Arial,sans-serif;color:#1f1411;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#fffef8;border:2px solid #2b211c;border-radius:16px 20px 17px 19px;overflow:hidden;border-collapse:separate;border-spacing:0;box-shadow:4px 4px 0 #dfd6c3,6px 6px 0 #2b211c;">
          <tr>
            <td style="padding:18px 26px;border-bottom:1.5px dashed #bfb49f;background-color:#faf6ec;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td style="vertical-align:middle;">
                    {{{{logo_html}}}}<span style="font-size:15.5px;font-weight:700;color:#1f1411;vertical-align:middle;letter-spacing:-0.015em;">{{{{site_name}}}}</span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block;padding:4px 11px;border-radius:8px 10px 9px 11px;background-color:{bg};border:1.5px dashed {border};color:{fg};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.06em;white-space:nowrap;transform:rotate(-1.8deg);">{label}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 26px;background-color:#fffef8;">
{body_html}
            </td>
          </tr>
          <tr>
            <td style="padding:15px 26px;border-top:1.5px dashed #bfb49f;background-color:#f7f2e7;">
              <p style="margin:0;font-size:12px;line-height:1.65;color:#5c5046;"><span style="color:#8a7a68;margin-right:6px;">&#9998;</span>{{{{footer_text}}}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>"#,
        bg = stamp.bg_color,
        border = stamp.border_color,
        fg = stamp.text_color,
        label = stamp.label,
    )
}

fn hand_heading_html(heading: &str, highlighter_color: &str) -> String {
    format!(
        r#"              <h1 style="margin:0;font-size:21px;line-height:1.35;font-weight:700;color:#1f1411;letter-spacing:-0.02em;">{heading}</h1>
              <div style="width:72px;height:6px;margin:7px 0 18px;border-radius:99px 40px 80px 30px;background-color:{highlighter_color};transform:rotate(-0.9deg);"></div>"#
    )
}

pub fn default_localized_template(kind: &str, locale: &str) -> (String, String) {
    let loc = normalize_supported_locale(Some(locale), "en");

    match kind.trim().to_ascii_lowercase().as_str() {
        "register_code" | "register" => {
            let (subj, stamp_label, heading, intro, code_label, expiry, ignore) = match loc {
                "zh-CN" => (
                    "[{{site_name}}] 注册邮箱验证码：{{code}}",
                    "邮箱验证",
                    "验证你的注册邮箱",
                    r#"请将下方 6 位数字验证码填入注册页面，以验证邮箱 <strong style="color:#1f1411;">{{email}}</strong> 并完成账号创建："#,
                    "注册验证码",
                    r#"有效期 <strong style="color:#1f1411;">{{expires_minutes}} 分钟</strong> · 仅限单次使用"#,
                    "如果这不是你本人发起的注册操作，请直接忽略此邮件，系统不会创建账号。",
                ),
                "zh-TW" => (
                    "[{{site_name}}] 註冊信箱驗證碼：{{code}}",
                    "信箱驗證",
                    "驗證您的註冊信箱",
                    r#"請將下方 6 位數字驗證碼填入註冊頁面，以驗證信箱 <strong style="color:#1f1411;">{{email}}</strong> 並完成帳號建立："#,
                    "註冊驗證碼",
                    r#"有效期限 <strong style="color:#1f1411;">{{expires_minutes}} 分鐘</strong> · 僅限單次使用"#,
                    "若這不是您本人發起的註冊操作，請直接忽略此信件，系統不會建立帳號。",
                ),
                "ja" => (
                    "[{{site_name}}] 登録用確認コード：{{code}}",
                    "メール確認",
                    "メールアドレスを確認してください",
                    r#"アカウント登録を完了するため、<strong style="color:#1f1411;">{{email}}</strong> 宛の 6 桁の確認コードを入力画面にご入力ください："#,
                    "確認コード",
                    r#"有効期限 <strong style="color:#1f1411;">{{expires_minutes}} 分</strong> · 1 回限り有効"#,
                    "この登録に心当たりがない場合は、このメールを破棄してください。アカウントは作成されません。",
                ),
                _ => (
                    "[{{site_name}}] Your registration verification code: {{code}}",
                    "VERIFY EMAIL",
                    "Verify your email address",
                    r#"Enter the 6-digit verification code below to confirm <strong style="color:#1f1411;">{{email}}</strong> and finish creating your account:"#,
                    "VERIFICATION CODE",
                    r#"Valid for <strong style="color:#1f1411;">{{expires_minutes}} minutes</strong> &middot; Single use"#,
                    "If you did not try to create an account on {{site_name}}, you can safely ignore this email.",
                ),
            };
            let title_block = hand_heading_html(heading, "#ddd2fe");
            let body = format!(
                r#"{title_block}
              <p style="margin:0 0 22px;font-size:14.5px;line-height:1.7;color:#433831;">{intro}</p>
              <div style="margin:0 0 22px;padding:22px 18px;text-align:center;background-color:#f9f5ea;border:1.5px dashed #7c6f61;border-radius:13px 16px 14px 15px;box-shadow:inset 0 0 0 3px #fffef8,2px 2px 0 #e5dcc8;">
                <div style="margin:0 0 9px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5c5046;">&#8212; {code_label} &#8212;</div>
                <div style="margin:0 0 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:35px;line-height:1.15;font-weight:700;letter-spacing:0.28em;padding-left:0.28em;color:#1f1411;">{{{{code}}}}</div>
                <div style="margin:0;font-size:12px;line-height:1.5;color:#5c5046;">{expiry}</div>
              </div>
              <p style="margin:0;font-size:13px;line-height:1.68;color:#5c5046;">{ignore}</p>"#
            );
            (
                subj.to_string(),
                wrap_stationery_email(
                    StampBadge {
                        label: stamp_label,
                        bg_color: "#f3effe",
                        border_color: "#9f87e8",
                        text_color: "#4c1d95",
                    },
                    &body,
                ),
            )
        }

        "login_anomaly" | "anomaly" => {
            let (
                subj,
                stamp_label,
                heading,
                intro,
                sec_title,
                lbl_reason,
                lbl_ip,
                lbl_device,
                lbl_time,
                code_label,
                expiry,
                warning,
            ) = match loc {
                "zh-CN" => (
                    "[{{site_name}}] 异常登录安全验证：{{code}}",
                    "异常登录提醒",
                    "检测到异常地点或新设备登录",
                    r#"你好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，系统检测到你的账号正在尝试从非常用 IP 地点或未识别的新设备登录，为保障账号安全，需要输入一次性验证码完成确认："#,
                    "异常活动记录",
                    "检测原因",
                    "来源 IP",
                    "设备与浏览器",
                    "发生时间",
                    "安全登录验证码",
                    r#"有效期 <strong style="color:#1f1411;">{{expires_minutes}} 分钟</strong> · 仅限本次登录"#,
                    "若这不是你本人的登录操作，请切勿向任何人提供此验证码，并立即修改密码、前往「个人中心 → 设备与会话」检查并下线异常设备。",
                ),
                "zh-TW" => (
                    "[{{site_name}}] 異常登入安全驗證：{{code}}",
                    "異常登入提醒",
                    "偵測到異常地點或新裝置登入",
                    r#"您好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，系統偵測到您的帳號正嘗試從非常用 IP 地點或未識別的新裝置登入，請輸入一次性驗證碼確認為本人操作："#,
                    "異常活動紀錄",
                    "偵測原因",
                    "來源 IP",
                    "裝置與瀏覽器",
                    "發生時間",
                    "安全登入驗證碼",
                    r#"有效期限 <strong style="color:#1f1411;">{{expires_minutes}} 分鐘</strong> · 僅限本次登入"#,
                    "若這並非您本人的登入操作，請勿洩漏此驗證碼，並立即變更密碼、前往「個人中心 → 裝置與工作階段」檢查並登出異常裝置。",
                ),
                "ja" => (
                    "[{{site_name}}] 不審なサインインの確認コード：{{code}}",
                    "異常ログイン警告",
                    "新しい場所または端末からのサインインを検知しました",
                    r#"<strong style="color:#1f1411;">{{recipient_name}}</strong> 様、通常と異なる IP 場所または未確認の端末からのサインイン試行を検知しました。ご本人確認のため、以下の 6 桁コードを入力してください："#,
                    "検知されたアクティビティ",
                    "検知理由",
                    "IP アドレス",
                    "端末・ブラウザ",
                    "発生時刻",
                    "セキュリティ確認コード",
                    r#"有効期限 <strong style="color:#1f1411;">{{expires_minutes}} 分</strong> · 今回のみ有効"#,
                    "このサインインに心当たりがない場合は、コードを誰にも共有せず、直ちにパスワードを変更のうえ「プロフィール → 端末とセッション」で不審なセッションを終了してください。",
                ),
                _ => (
                    "[{{site_name}}] Unusual sign-in alert — verification code: {{code}}",
                    "UNUSUAL ACTIVITY",
                    "Unusual sign-in location or device",
                    r#"Hello <strong style="color:#1f1411;">{{recipient_name}}</strong>, we noticed a sign-in attempt to your account from an unrecognized IP location or new device. Enter the one-time code below to confirm it&apos;s you:"#,
                    "ACTIVITY LOG",
                    "Detected",
                    "IP Address",
                    "Device",
                    "Time (UTC)",
                    "SECURITY VERIFICATION CODE",
                    r#"Valid for <strong style="color:#1f1411;">{{expires_minutes}} minutes</strong> &middot; Single use"#,
                    "If you did not attempt to sign in, do not share this code. Change your password right away and review active devices in your Account Sessions page.",
                ),
            };
            let title_block = hand_heading_html(heading, "#fde08d");
            let body = format!(
                r#"{title_block}
              <p style="margin:0 0 20px;font-size:14.5px;line-height:1.7;color:#433831;">{intro}</p>
              <div style="margin:0 0 20px;padding:15px 18px;background-color:#fdf8ea;border:1.5px dashed #c9ad68;border-left:4px solid #b45309;border-radius:10px 14px 12px 11px;">
                <div style="margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#854d0e;">{sec_title}</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-size:13px;line-height:1.55;">
                  <tr>
                    <td style="padding:7px 12px 7px 0;color:#5c5046;white-space:nowrap;vertical-align:top;border-bottom:1px dashed #e2d4ae;">{lbl_reason}</td>
                    <td style="padding:7px 0;color:#7c2d12;font-weight:600;border-bottom:1px dashed #e2d4ae;">{{{{anomaly_summary}}}}</td>
                  </tr>
                  <tr>
                    <td style="padding:7px 12px 7px 0;color:#5c5046;white-space:nowrap;vertical-align:top;border-bottom:1px dashed #e2d4ae;">{lbl_ip}</td>
                    <td style="padding:7px 0;color:#1f1411;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700;border-bottom:1px dashed #e2d4ae;">{{{{ip_address}}}}</td>
                  </tr>
                  <tr>
                    <td style="padding:7px 12px 7px 0;color:#5c5046;white-space:nowrap;vertical-align:top;border-bottom:1px dashed #e2d4ae;">{lbl_device}</td>
                    <td style="padding:7px 0;color:#1f1411;border-bottom:1px dashed #e2d4ae;">{{{{device_label}}}}</td>
                  </tr>
                  <tr>
                    <td style="padding:7px 12px 4px 0;color:#5c5046;white-space:nowrap;vertical-align:top;">{lbl_time}</td>
                    <td style="padding:7px 0 4px;color:#433831;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">{{{{occurred_at}}}}</td>
                  </tr>
                </table>
              </div>
              <div style="margin:0 0 20px;padding:22px 18px;text-align:center;background-color:#f9f5ea;border:1.5px dashed #7c6f61;border-radius:13px 16px 14px 15px;box-shadow:inset 0 0 0 3px #fffef8,2px 2px 0 #e5dcc8;">
                <div style="margin:0 0 9px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5c5046;">&#8212; {code_label} &#8212;</div>
                <div style="margin:0 0 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:35px;line-height:1.15;font-weight:700;letter-spacing:0.28em;padding-left:0.28em;color:#1f1411;">{{{{code}}}}</div>
                <div style="margin:0;font-size:12px;line-height:1.5;color:#5c5046;">{expiry}</div>
              </div>
              <div style="padding:10px 14px;background-color:#fffef8;border:1px dashed #d6c8ad;border-left:3.5px solid #b45309;border-radius:8px 11px 10px 9px;font-size:12.5px;line-height:1.68;color:#433831;">{warning}</div>"#
            );
            (
                subj.to_string(),
                wrap_stationery_email(
                    StampBadge {
                        label: stamp_label,
                        bg_color: "#fef7e0",
                        border_color: "#d49a2a",
                        text_color: "#854d0e",
                    },
                    &body,
                ),
            )
        }

        "reset" => {
            let (subj, stamp_label, heading, intro, code_label, expiry, btn, tip, fallback_lbl) =
                match loc {
                    "zh-CN" => (
                        "[{{site_name}}] 重置账号密码：{{code}}",
                        "密码安全",
                        "重置你的登录密码",
                        r#"你好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，我们收到了你的密码重置请求。请在验证页面输入下方 6 位验证码，或直接点击按钮设置新密码（<strong style="color:#1f1411;">{{expires_minutes}} 分钟</strong>内有效）："#,
                        "密码重置验证码",
                        r#"有效期 <strong style="color:#1f1411;">{{expires_minutes}} 分钟</strong> · 仅限单次使用"#,
                        "立即设置新密码 &rarr;",
                        "如果这不是你本人发起的操作，请放心忽略此邮件，你的当前密码不会被更改。",
                        "若按钮无法打开，也可复制以下链接到浏览器：",
                    ),
                    "zh-TW" => (
                        "[{{site_name}}] 重設帳號密碼：{{code}}",
                        "密碼安全",
                        "重設您的登入密碼",
                        r#"您好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，我們收到了您的密碼重設請求。請在驗證頁面輸入下方 6 位驗證碼，或直接點擊按鈕設定新密碼（<strong style="color:#1f1411;">{{expires_minutes}} 分鐘</strong>內有效）："#,
                        "密碼重設驗證碼",
                        r#"有效期限 <strong style="color:#1f1411;">{{expires_minutes}} 分鐘</strong> · 僅限單次使用"#,
                        "立即設定新密碼 &rarr;",
                        "若這不是您本人發起的操作，請放心忽略此郵件，您目前的密碼不會受到變更。",
                        "若按鈕無法開啟，亦可複製以下連結至瀏覽器：",
                    ),
                    "ja" => (
                        "[{{site_name}}] パスワード再設定コード：{{code}}",
                        "セキュリティ",
                        "パスワードを再設定",
                        r#"<strong style="color:#1f1411;">{{recipient_name}}</strong> 様、パスワード再設定のリクエストを受け付けました。確認画面で下の 6 桁コードを入力するか、ボタンから <strong style="color:#1f1411;">{{expires_minutes}} 分</strong>以内に新しいパスワードを設定してください："#,
                        "再設定確認コード",
                        r#"有効期限 <strong style="color:#1f1411;">{{expires_minutes}} 分</strong> · 1 回限り有効"#,
                        "新しいパスワードを設定 &rarr;",
                        "このリクエストに心当たりがない場合は、このメールを無視してください。現在のパスワードは変更されません。",
                        "ボタンが開けない場合は以下のリンクをコピーしてください：",
                    ),
                    _ => (
                        "[{{site_name}}] Reset your password — code: {{code}}",
                        "SECURITY",
                        "Reset your password",
                        r#"Hello <strong style="color:#1f1411;">{{recipient_name}}</strong>, we received a request to reset your password. Enter the 6-digit code below to verify your email, or use the button within <strong style="color:#1f1411;">{{expires_minutes}} minutes</strong>:"#,
                        "RESET VERIFICATION CODE",
                        r#"Valid for <strong style="color:#1f1411;">{{expires_minutes}} minutes</strong> &middot; Single use"#,
                        "Set New Password &rarr;",
                        "If you did not request a password reset, you can safely ignore this message. Your current password remains unchanged.",
                        "Button not working? Copy and open this link:",
                    ),
                };
            let title_block = hand_heading_html(heading, "#bae6fd");
            let body = format!(
                r#"{title_block}
              <p style="margin:0 0 20px;font-size:14.5px;line-height:1.7;color:#433831;">{intro}</p>
              <div style="margin:0 0 22px;padding:22px 18px;text-align:center;background-color:#f9f5ea;border:1.5px dashed #7c6f61;border-radius:13px 16px 14px 15px;box-shadow:inset 0 0 0 3px #fffef8,2px 2px 0 #e5dcc8;">
                <div style="margin:0 0 9px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5c5046;">&#8212; {code_label} &#8212;</div>
                <div style="margin:0 0 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:35px;line-height:1.15;font-weight:700;letter-spacing:0.28em;padding-left:0.28em;color:#1f1411;">{{{{code}}}}</div>
                <div style="margin:0;font-size:12px;line-height:1.5;color:#5c5046;">{expiry}</div>
              </div>
              <p style="margin:0 0 22px;">
                <a href="{{{{action_url}}}}" style="display:inline-block;padding:12px 24px;background-color:#5b1ae0;color:#ffffff;text-decoration:none;text-decoration-line:none;border:2px solid #2b211c;border-radius:11px 14px 12px 10px;font-size:14px;font-weight:700;line-height:1.25;box-shadow:3px 3px 0 #2b211c;"><span style="color:#ffffff;text-decoration:none;">{btn}</span></a>
              </p>
              <p style="margin:0 0 18px;font-size:13px;line-height:1.68;color:#5c5046;">{tip}</p>
              <div style="padding:12px 15px;border-radius:10px 13px 11px 12px;background-color:#f9f5ea;border:1px dashed #c8bca6;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#433831;">{fallback_lbl}</p>
                <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;color:#075985;word-break:break-all;">{{{{action_url}}}}</p>
              </div>"#
            );
            (
                subj.to_string(),
                wrap_stationery_email(
                    StampBadge {
                        label: stamp_label,
                        bg_color: "#eef8ff",
                        border_color: "#52a8d8",
                        text_color: "#075985",
                    },
                    &body,
                ),
            )
        }

        "invite" => {
            let (subj, stamp_label, heading, intro, art_lbl, btn, fallback_lbl) = match loc {
                "zh-CN" => (
                    "[{{site_name}}] {{inviter_name}} 邀请你共同撰写《{{article_title}}》",
                    "协作邀请",
                    "你收到一份文章共创邀请",
                    r#"<strong style="color:#1f1411;">{{inviter_name}}</strong> 邀请你在创作后台共同编辑以下文章："#,
                    "邀请文章",
                    "接受协作邀请 &rarr;",
                    "若按钮无法打开，请复制以下链接到浏览器：",
                ),
                "zh-TW" => (
                    "[{{site_name}}] {{inviter_name}} 邀請您共同撰寫《{{article_title}}》",
                    "協作邀請",
                    "您收到一份文章共創邀請",
                    r#"<strong style="color:#1f1411;">{{inviter_name}}</strong> 邀請您在創作後台共同編輯以下文章："#,
                    "邀請文章",
                    "接受協作邀請 &rarr;",
                    "若按鈕無法開啟，請複製以下連結至瀏覽器：",
                ),
                "ja" => (
                    "[{{site_name}}] {{inviter_name}} さんから「{{article_title}}」への共同執筆招待",
                    "共同執筆招待",
                    "共同執筆への招待が届きました",
                    r#"<strong style="color:#1f1411;">{{inviter_name}}</strong> さんより、スタジオでの共同執筆に招待されています："#,
                    "対象記事",
                    "招待を承認する &rarr;",
                    "ボタンが開けない場合は以下のリンクをコピーしてください：",
                ),
                _ => (
                    "[{{site_name}}] {{inviter_name}} invited you to collaborate on \"{{article_title}}\"",
                    "CO-AUTHOR",
                    "You&apos;re invited to collaborate",
                    r#"<strong style="color:#1f1411;">{{inviter_name}}</strong> has invited you to co-author an article in Studio:"#,
                    "ARTICLE",
                    "Accept Invitation &rarr;",
                    "Button not working? Copy and open this link:",
                ),
            };
            let title_block = hand_heading_html(heading, "#ddd2fe");
            let body = format!(
                r#"{title_block}
              <p style="margin:0 0 20px;font-size:14.5px;line-height:1.7;color:#433831;">{intro}</p>
              <div style="margin:0 0 22px;padding:16px 18px;background-color:#f9f5ea;border:1.5px dashed #b9ac96;border-left:4px solid #5b1ae0;border-radius:10px 14px 12px 11px;">
                <div style="margin:0 0 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#5c5046;">{art_lbl}</div>
                <div style="margin:0;font-size:16.5px;line-height:1.45;font-weight:700;color:#1f1411;">{{{{article_title}}}}</div>
              </div>
              <p style="margin:0 0 22px;">
                <a href="{{{{action_url}}}}" style="display:inline-block;padding:12px 24px;background-color:#5b1ae0;color:#ffffff;text-decoration:none;text-decoration-line:none;border:2px solid #2b211c;border-radius:11px 14px 12px 10px;font-size:14px;font-weight:700;line-height:1.25;box-shadow:3px 3px 0 #2b211c;"><span style="color:#ffffff;text-decoration:none;">{btn}</span></a>
              </p>
              <div style="padding:12px 15px;border-radius:10px 13px 11px 12px;background-color:#f9f5ea;border:1px dashed #c8bca6;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#433831;">{fallback_lbl}</p>
                <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;color:#4c1d95;word-break:break-all;">{{{{action_url}}}}</p>
              </div>"#
            );
            (
                subj.to_string(),
                wrap_stationery_email(
                    StampBadge {
                        label: stamp_label,
                        bg_color: "#f3effe",
                        border_color: "#9f87e8",
                        text_color: "#4c1d95",
                    },
                    &body,
                ),
            )
        }

        "takedown" => {
            let (subj, stamp_label, heading, intro, reason_lbl, btn, fallback_lbl) = match loc {
                "zh-CN" => (
                    "[{{site_name}}] 文章《{{article_title}}》已被下架处理",
                    "内容通知",
                    "你的文章已被下架",
                    r#"你好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，你参与创作的文章 <strong style="color:#1f1411;">《{{article_title}}》</strong> 已被站点管理员暂时下架。"#,
                    "下架原因",
                    "前往创作后台修改草稿 &rarr;",
                    "整改完成后可联系管理员恢复上架，后台入口：",
                ),
                "zh-TW" => (
                    "[{{site_name}}] 文章《{{article_title}}》已被下架處理",
                    "內容通知",
                    "您的文章已被下架",
                    r#"您好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，您參與創作的文章 <strong style="color:#1f1411;">《{{article_title}}》</strong> 已被站點管理員暫時下架。"#,
                    "下架原因",
                    "前往創作後台修改草稿 &rarr;",
                    "修改完成後可聯繫管理員恢復上架，後台入口：",
                ),
                "ja" => (
                    "[{{site_name}}] 記事「{{article_title}}」が公開停止になりました",
                    "モデレーション",
                    "記事が公開停止になりました",
                    r#"<strong style="color:#1f1411;">{{recipient_name}}</strong> 様、執筆中の記事 <strong style="color:#1f1411;">「{{article_title}}」</strong> が管理者により公開停止となりました。"#,
                    "公開停止の理由",
                    "スタジオで下書きを確認 &rarr;",
                    "修正後に管理者へ復旧をご依頼ください：",
                ),
                _ => (
                    "[{{site_name}}] Article \"{{article_title}}\" has been taken down",
                    "MODERATION",
                    "Article taken down",
                    r#"Hello <strong style="color:#1f1411;">{{recipient_name}}</strong>, the article <strong style="color:#1f1411;">&ldquo;{{article_title}}&rdquo;</strong> has been taken down from public view by a site administrator."#,
                    "REASON",
                    "Review Draft in Studio &rarr;",
                    "You can revise the draft and contact an administrator to restore it:",
                ),
            };
            let title_block = hand_heading_html(heading, "#fecdd3");
            let body = format!(
                r#"{title_block}
              <p style="margin:0 0 20px;font-size:14.5px;line-height:1.7;color:#433831;">{intro}</p>
              <div style="margin:0 0 22px;padding:15px 18px;background-color:#fff4f5;border:1.5px dashed #e79aa6;border-left:4px solid #be123c;border-radius:10px 14px 12px 11px;">
                <div style="margin:0 0 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9f1239;">{reason_lbl}</div>
                <div style="margin:0;font-size:14px;line-height:1.65;color:#881337;">{{{{reason}}}}</div>
              </div>
              <p style="margin:0 0 22px;">
                <a href="{{{{action_url}}}}" style="display:inline-block;padding:12px 24px;background-color:#2b211c;color:#ffffff;text-decoration:none;text-decoration-line:none;border:2px solid #2b211c;border-radius:11px 14px 12px 10px;font-size:14px;font-weight:700;line-height:1.25;box-shadow:3px 3px 0 #c9bda8;"><span style="color:#ffffff;text-decoration:none;">{btn}</span></a>
              </p>
              <div style="padding:12px 15px;border-radius:10px 13px 11px 12px;background-color:#f9f5ea;border:1px dashed #c8bca6;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#433831;">{fallback_lbl}</p>
                <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;color:#433831;word-break:break-all;">{{{{action_url}}}}</p>
              </div>"#
            );
            (
                subj.to_string(),
                wrap_stationery_email(
                    StampBadge {
                        label: stamp_label,
                        bg_color: "#fff1f3",
                        border_color: "#e27d8e",
                        text_color: "#9f1239",
                    },
                    &body,
                ),
            )
        }

        "email_change" => {
            let (subj, stamp_label, heading, intro, code_label, expiry, ignore) = match loc {
                "zh-CN" => (
                    "[{{site_name}}] 更换绑定邮箱验证码：{{code}}",
                    "邮箱变更",
                    "验证你的新邮箱地址",
                    r#"你好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，你正在将账号绑定邮箱更换为 <strong style="color:#1f1411;">{{email}}</strong>。请输入下方 6 位验证码完成验证："#,
                    "新邮箱验证码",
                    r#"有效期 <strong style="color:#1f1411;">{{expires_minutes}} 分钟</strong> · 仅限单次使用"#,
                    "如果这不是你本人发起的操作，请直接忽略此邮件，你的原邮箱绑定不会发生改变。",
                ),
                "zh-TW" => (
                    "[{{site_name}}] 更換綁定信箱驗證碼：{{code}}",
                    "信箱變更",
                    "驗證您的新信箱地址",
                    r#"你好 <strong style="color:#1f1411;">{{recipient_name}}</strong>，您正在將帳號綁定信箱更換為 <strong style="color:#1f1411;">{{email}}</strong>。請輸入下方 6 位驗證碼完成驗證："#,
                    "新信箱驗證碼",
                    r#"有效期限 <strong style="color:#1f1411;">{{expires_minutes}} 分鐘</strong> · 僅限單次使用"#,
                    "若這不是您本人發起的操作，請直接忽略此信件，您原本的信箱綁定不會改變。",
                ),
                "ja" => (
                    "[{{site_name}}] メールアドレス変更確認コード：{{code}}",
                    "メール変更",
                    "新しいメールアドレスを確認してください",
                    r#"<strong style="color:#1f1411;">{{recipient_name}}</strong> さん、アカウントのメールアドレスを <strong style="color:#1f1411;">{{email}}</strong> に変更するリクエストを受け付けました。以下の 6 桁コードを入力してください："#,
                    "変更確認コード",
                    r#"有効期限 <strong style="color:#1f1411;">{{expires_minutes}} 分</strong> · 1 回限り有効"#,
                    "この変更に心当たりがない場合は、このメールを破棄してください。現在のメールアドレスは変更されません。",
                ),
                _ => (
                    "[{{site_name}}] Verify your new email address: {{code}}",
                    "EMAIL CHANGE",
                    "Confirm your new email address",
                    r#"Hi <strong style="color:#1f1411;">{{recipient_name}}</strong>, enter the 6-digit code below to verify <strong style="color:#1f1411;">{{email}}</strong> as your new account email:"#,
                    "VERIFICATION CODE",
                    r#"Valid for <strong style="color:#1f1411;">{{expires_minutes}} minutes</strong> &middot; Single use"#,
                    "If you did not request this email change, you can safely ignore this message — your current email will remain unchanged.",
                ),
            };
            let title_block = hand_heading_html(heading, "#bae6fd");
            let body = format!(
                r#"{title_block}
              <p style="margin:0 0 22px;font-size:14.5px;line-height:1.7;color:#433831;">{intro}</p>
              <div style="margin:0 0 22px;padding:22px 18px;text-align:center;background-color:#f9f5ea;border:1.5px dashed #7c6f61;border-radius:13px 16px 14px 15px;box-shadow:inset 0 0 0 3px #fffef8,2px 2px 0 #e5dcc8;">
                <div style="margin:0 0 9px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#5c5046;">&#8212; {code_label} &#8212;</div>
                <div style="margin:0 0 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:35px;line-height:1.15;font-weight:700;letter-spacing:0.28em;padding-left:0.28em;color:#1f1411;">{{{{code}}}}</div>
                <div style="margin:0;font-size:12px;line-height:1.5;color:#5c5046;">{expiry}</div>
              </div>
              <p style="margin:0;font-size:13px;line-height:1.68;color:#5c5046;">{ignore}</p>"#
            );
            (
                subj.to_string(),
                wrap_stationery_email(
                    StampBadge {
                        label: stamp_label,
                        bg_color: "#f0f9ff",
                        border_color: "#38bdf8",
                        text_color: "#0369a1",
                    },
                    &body,
                ),
            )
        }

        _ => {
            let (subj, stamp_label, heading, intro, channels) = match loc {
                "zh-CN" => (
                    "[{{site_name}}] SMTP 邮件连接测试成功",
                    "连接正常",
                    "SMTP 邮件通道已就绪",
                    r#"<strong style="color:#1f1411;">{{site_name}}</strong> 的邮件发送配置测试成功，系统可正常投递各类多语言手账通知邮件。"#,
                    "<strong>已启用的邮件场景：</strong>注册邮箱验证码、异常地点/新设备登录 OTP 验证、密码重置、协作者邀请与文章下架通知。",
                ),
                "zh-TW" => (
                    "[{{site_name}}] SMTP 郵件連線測試成功",
                    "連線正常",
                    "SMTP 郵件通道已就緒",
                    r#"<strong style="color:#1f1411;">{{site_name}}</strong> 的郵件寄送設定測試成功，系統可正常投遞各類多語言手帳通知郵件。"#,
                    "<strong>已啟用的郵件場景：</strong>註冊信箱驗證碼、異常地點/新裝置登入 OTP 驗證、密碼重設、協作者邀請與文章下架通知。",
                ),
                "ja" => (
                    "[{{site_name}}] SMTP 接続テスト完了",
                    "接続確認済み",
                    "SMTP メール配信の準備が完了しました",
                    r#"<strong style="color:#1f1411;">{{site_name}}</strong> のメール配信チャネルは正常に動作しています。"#,
                    "<strong>有効な通知：</strong>登録確認コード、異常ログイン OTP 確認、パスワード再設定、共同執筆招待、公開停止通知。",
                ),
                _ => (
                    "[{{site_name}}] SMTP connectivity test",
                    "CONNECTED",
                    "SMTP connection verified",
                    r#"Your mail delivery channel for <strong style="color:#1f1411;">{{site_name}}</strong> is configured and working properly."#,
                    "<strong>Active notifications:</strong> Registration verification codes, unusual sign-in OTP alerts, password resets, co-author invites, and moderation notices.",
                ),
            };
            let title_block = hand_heading_html(heading, "#a7f3d0");
            let body = format!(
                r#"{title_block}
              <p style="margin:0 0 20px;font-size:14.5px;line-height:1.7;color:#433831;">{intro}</p>
              <div style="margin:0;padding:15px 18px;background-color:#f9f5ea;border:1.5px dashed #b9ac96;border-left:4px solid #059669;border-radius:10px 14px 12px 11px;font-size:13px;line-height:1.7;color:#1f1411;">{channels}</div>"#
            );
            (
                subj.to_string(),
                wrap_stationery_email(
                    StampBadge {
                        label: stamp_label,
                        bg_color: "#ecfdf5",
                        border_color: "#43a581",
                        text_color: "#065f46",
                    },
                    &body,
                ),
            )
        }
    }
}

pub fn render_mail_subject(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (k, v) in vars {
        let cleaned: String = v.chars().filter(|c| *c != '\r' && *c != '\n').collect();
        out = out.replace(&format!("{{{{{k}}}}}"), &cleaned);
    }
    out
}

pub fn render_mail_html(
    template: &str,
    vars: &[(&str, &str)],
    logo_html: &str,
    footer_template: &str,
) -> String {
    let mut out = template
        .replace("{{logo_html}}", logo_html)
        .replace("{{footer_text}}", footer_template);
    for (k, v) in vars {
        let escaped = escape_html_value(v);
        out = out.replace(&format!("{{{{{k}}}}}"), &escaped);
    }
    out
}

/// Render a realistic preview of any email template using sample variables in the requested locale,
/// using the actual site logo (`logo_url`), site name, and optional custom footer.
#[allow(clippy::too_many_arguments)]
pub fn render_mail_preview(
    template_kind: &str,
    locale: &str,
    subject_tpl: Option<&str>,
    html_tpl: Option<&str>,
    custom_footer: Option<&str>,
    site_name: &str,
    logo_url: &str,
    origin: &str,
) -> (String, String) {
    let loc = normalize_supported_locale(Some(locale), "zh-CN");
    let clean_site = crate::reading_time::strip_html_tags(site_name);
    let site_label = if clean_site.trim().is_empty() {
        "IceHandnote"
    } else {
        clean_site.trim()
    };
    let clean_origin = if origin.trim().is_empty() {
        "https://notes.example.com"
    } else {
        origin.trim().trim_end_matches('/')
    };
    let logo_html = build_email_logo_html(logo_url, site_label, clean_origin);
    let footer_tpl = resolve_email_footer_template(custom_footer, loc);
    let (def_subj, def_html) = default_localized_template(template_kind, loc);
    let subj = subject_tpl
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or(def_subj);
    let html = html_tpl
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or(def_html);

    match template_kind.trim().to_ascii_lowercase().as_str() {
        "register_code" | "register" => {
            let vars = [
                ("site_name", site_label),
                ("email", "alice@example.com"),
                ("code", "482913"),
                ("expires_minutes", "10"),
            ];
            (
                render_mail_subject(&subj, &vars),
                render_mail_html(&html, &vars, &logo_html, &footer_tpl),
            )
        }
        "login_anomaly" | "anomaly" => {
            let anomaly_summary = localize_anomaly_reason("new_ip_and_device", loc);
            let vars = [
                ("site_name", site_label),
                ("recipient_name", "Alice"),
                ("anomaly_summary", anomaly_summary),
                ("ip_address", "203.0.113.42"),
                ("device_label", "Safari · macOS"),
                ("occurred_at", "2026-11-21 12:30 UTC"),
                ("code", "739204"),
                ("expires_minutes", "10"),
            ];
            (
                render_mail_subject(&subj, &vars),
                render_mail_html(&html, &vars, &logo_html, &footer_tpl),
            )
        }
        "invite" => {
            let action_url =
                format!("{clean_origin}/{loc}/studio?collab_invite=ihn_inv_sample_token_8a92bc");
            let article_title = match loc {
                "zh-CN" => "构建高可靠 Axum API 架构指南",
                "zh-TW" => "建構高可靠 Axum API 架構指南",
                "ja" => "堅牢な Axum API 設計ガイド",
                _ => "Building a Resilient Axum API",
            };
            let vars = [
                ("site_name", site_label),
                ("inviter_name", "Alex Chen"),
                ("article_title", article_title),
                ("action_url", action_url.as_str()),
            ];
            (
                render_mail_subject(&subj, &vars),
                render_mail_html(&html, &vars, &logo_html, &footer_tpl),
            )
        }
        "reset" => {
            let action_url = format!(
                "{clean_origin}/{loc}/auth/reset-password?reset_token=ihn_rst_sample_token_9f31de"
            );
            let vars = [
                ("site_name", site_label),
                ("recipient_name", "Alice"),
                ("code", "615829"),
                ("expires_minutes", "30"),
                ("action_url", action_url.as_str()),
            ];
            (
                render_mail_subject(&subj, &vars),
                render_mail_html(&html, &vars, &logo_html, &footer_tpl),
            )
        }
        "takedown" => {
            let action_url = format!("{clean_origin}/{loc}/studio");
            let (article_title, reason) = match loc {
                "zh-CN" => (
                    "欢迎来到 IceHandnote",
                    "第 2 节包含未脱敏的 API 密钥示例，请脱敏后联系管理员恢复上架。",
                ),
                "zh-TW" => (
                    "歡迎來到 IceHandnote",
                    "第 2 節包含未脫敏的 API 金鑰範例，請脫敏後聯繫管理員恢復上架。",
                ),
                "ja" => (
                    "IceHandnote へようこそ",
                    "第 2 節にマスクされていない API キー例が含まれています。修正後に復旧をご依頼ください。",
                ),
                _ => (
                    "Welcome to IceHandnote",
                    "Contains unredacted API credentials in section 2. Please redact and request review.",
                ),
            };
            let vars = [
                ("site_name", site_label),
                ("recipient_name", "Alice"),
                ("article_title", article_title),
                ("reason", reason),
                ("action_url", action_url.as_str()),
            ];
            (
                render_mail_subject(&subj, &vars),
                render_mail_html(&html, &vars, &logo_html, &footer_tpl),
            )
        }
        "email_change" => {
            let vars = [
                ("site_name", site_label),
                ("recipient_name", "Alice"),
                ("email", "alice.new@example.com"),
                ("code", "591842"),
                ("expires_minutes", "10"),
            ];
            (
                render_mail_subject(&subj, &vars),
                render_mail_html(&html, &vars, &logo_html, &footer_tpl),
            )
        }
        _ => {
            let vars = [("site_name", site_label)];
            (
                render_mail_subject(&subj, &vars),
                render_mail_html(&html, &vars, &logo_html, &footer_tpl),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_all_email_templates_across_locales_with_hand_drawn_craft_and_custom_footer() {
        for loc in ["zh-CN", "en", "zh-TW", "ja"] {
            for kind in [
                "register_code",
                "login_anomaly",
                "reset",
                "email_change",
                "invite",
                "takedown",
                "test",
            ] {
                let (subj, html) = render_mail_preview(
                    kind,
                    loc,
                    None,
                    None,
                    None,
                    "IceHandnote",
                    "/uploads/2026-11/logo.png",
                    "https://notes.test",
                );
                assert!(!subj.is_empty(), "subject empty for {kind}/{loc}");
                assert!(
                    html.contains("https://notes.test/uploads/2026-11/logo.png"),
                    "custom site logo missing for {kind}/{loc}"
                );
                assert!(
                    !html.contains("height:4px;"),
                    "top horizontal color bar must not exist in {kind}/{loc}"
                );
                assert!(
                    html.contains("radial-gradient(#cfc5b0 1px,transparent 1px)"),
                    "hand-drawn dot-grid stationery backdrop missing for {kind}/{loc}"
                );
                assert!(
                    html.contains("border:2px solid #2b211c"),
                    "hand-drawn sepia ink card border missing for {kind}/{loc}"
                );
            }
        }

        // Custom footer supports {{site_name}} and safe HTML tags while stripping XSS payloads
        let (_subj, custom_html) = render_mail_preview(
            "reset",
            "zh-CN",
            None,
            None,
            Some(
                r#"© 2026 <strong>{{site_name}}</strong> · <a href="https://icehandnote.dev" onclick="alert(1)">官网</a><script>alert(1)</script><br><a href="javascript:alert(2)">Bad</a>"#,
            ),
            "IceHandnote",
            "",
            "https://notes.test",
        );
        assert!(custom_html.contains("<strong>IceHandnote</strong>"));
        assert!(custom_html.contains(r#"href="https://icehandnote.dev""#));
        assert!(custom_html.contains("<br>"));
        assert!(!custom_html.contains("<script>"));
        assert!(!custom_html.contains("onclick"));
        assert!(!custom_html.contains("javascript:"));
        assert!(custom_html.contains("&#10052;&#xFE0E;"));

        let escaped = render_mail_html(
            "<p>{{reason}}</p><footer>{{footer_text}}</footer>",
            &[("reason", "<script>alert(1)</script>"), ("site_name", "IceHandnote")],
            "",
            &resolve_email_footer_template(Some("Custom <b>{{site_name}}</b>"), "en"),
        );
        assert_eq!(
            escaped,
            "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><footer>Custom <b>IceHandnote</b></footer>"
        );
    }
}
