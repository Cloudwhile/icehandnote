use anyhow::{bail, Context, Result};
use chrono::Utc;
use icehandnote_core::{
    mail_templates::{
        build_email_logo_html, default_localized_template, localize_anomaly_reason,
        render_mail_html, render_mail_subject, resolve_email_footer_template, SmtpSettingsDto,
    },
    reading_time::strip_html_tags,
};
use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct MailBrandContext<'a> {
    pub site_name: &'a str,
    pub logo_url: &'a str,
    pub origin: &'a str,
    pub locale: &'a str,
}

pub fn is_smtp_ready(smtp: &SmtpSettingsDto) -> bool {
    smtp.enabled && !smtp.host.trim().is_empty() && !smtp.from_email.trim().is_empty()
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

    let mut builder = match smtp.encryption.as_str() {
        "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
            .context("Failed to initialize STARTTLS transport")?
            .port(smtp.port),
        "none" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host).port(smtp.port),
        _ => AsyncSmtpTransport::<Tokio1Executor>::relay(host)
            .context("Failed to initialize TLS transport")?
            .port(smtp.port),
    }
    .timeout(Some(Duration::from_secs(12)));

    if !smtp.username.trim().is_empty() {
        builder = builder.credentials(Credentials::new(
            smtp.username.trim().to_string(),
            password.to_string(),
        ));
    }

    let mailer = builder.build();
    mailer.send(email).await.context("Failed to send SMTP email")?;
    Ok(())
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
