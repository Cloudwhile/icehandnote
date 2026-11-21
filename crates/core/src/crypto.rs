use anyhow::{anyhow, bail, Result};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlogSsoClaims {
    pub wp_user_id: i64,
    pub username: String,
    pub display_name: String,
    pub email: String,
    #[serde(default)]
    pub avatar_url: String,
    #[serde(default)]
    pub wp_roles: Vec<String>,
    #[serde(default)]
    pub blog_origin: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn sign_blog_sso_token(claims: &BlogSsoClaims, secret: &str) -> Result<String> {
    let json = serde_json::to_vec(claims)?;
    let b64 = URL_SAFE_NO_PAD.encode(json);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| anyhow!("Invalid SSO secret key length"))?;
    mac.update(b64.as_bytes());
    let sig_hex = hex::encode(mac.finalize().into_bytes());
    Ok(format!("{b64}.{sig_hex}"))
}

pub fn verify_blog_sso_token(token: &str, secret: &str) -> Result<BlogSsoClaims> {
    let Some((b64, sig_hex)) = token.trim().split_once('.') else {
        bail!("Malformed SSO token");
    };
    let sig_bytes = hex::decode(sig_hex).map_err(|_| anyhow!("Invalid SSO signature encoding"))?;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| anyhow!("Invalid SSO secret key length"))?;
    mac.update(b64.as_bytes());
    mac.verify_slice(&sig_bytes)
        .map_err(|_| anyhow!("Invalid external SSO signature"))?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(b64)
        .map_err(|_| anyhow!("Invalid base64url payload"))?;
    let claims: BlogSsoClaims = serde_json::from_slice(&payload_bytes)?;

    let now = Utc::now().timestamp();
    if claims.exp < now {
        bail!("SSO ticket has expired");
    }
    Ok(claims)
}

pub fn hash_session_token(raw_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"icetowne_session_v1:");
    hasher.update(raw_token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn hash_action_token(domain: &str, raw_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update(b":");
    hasher.update(raw_token.trim().as_bytes());
    hex::encode(hasher.finalize())
}

pub fn generate_action_token(prefix: &str, domain: &str) -> (String, String) {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let mut random_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut random_bytes);
    let raw = format!("{prefix}_{}", URL_SAFE_NO_PAD.encode(random_bytes));
    let hashed = hash_action_token(domain, &raw);
    (raw, hashed)
}

/// Bind a 6-digit registration verification code to its normalized recipient email via SHA-256.
pub fn hash_email_verification_code(email: &str, code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"email_verify_v1:");
    hasher.update(email.trim().to_ascii_lowercase().as_bytes());
    hasher.update(b":");
    hasher.update(code.trim().as_bytes());
    hex::encode(hasher.finalize())
}

/// Cryptographically uniform 6-digit numeric email verification code + email-bound hash.
pub fn generate_email_verification_code(email: &str) -> (String, String) {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    const MODULUS: u32 = 1_000_000;
    let limit = u32::MAX - (u32::MAX % MODULUS);
    let digit_num = loop {
        let candidate = OsRng.next_u32();
        if candidate < limit {
            break candidate % MODULUS;
        }
    };
    let raw = format!("{digit_num:06}");
    let hashed = hash_email_verification_code(email, &raw);
    (raw, hashed)
}

pub fn hash_password(_username: &str, password: &str) -> String {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut OsRng);
    argon2::Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .unwrap_or_default()
}

pub(crate) fn legacy_sha256_password(username: &str, password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"icetowne_pw_v1:");
    hasher.update(username.trim().to_ascii_lowercase().as_bytes());
    hasher.update(b":");
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn verify_password(username: &str, password: &str, expected_hash: &str) -> bool {
    if expected_hash.starts_with("$argon2") {
        use argon2::password_hash::{PasswordHash, PasswordVerifier};
        return PasswordHash::new(expected_hash)
            .map(|parsed| {
                argon2::Argon2::default()
                    .verify_password(password.as_bytes(), &parsed)
                    .is_ok()
            })
            .unwrap_or(false);
    }

    let computed = legacy_sha256_password(username, password);
    constant_time_str_eq(&computed, expected_hash)
}

pub fn is_legacy_password_hash(hash: &str) -> bool {
    !hash.starts_with("$argon2")
}

pub fn constant_time_str_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn generate_oauth_flow_tokens() -> (String, String, String) {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let mut state_bytes = [0u8; 32];
    let mut verifier_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut state_bytes);
    OsRng.fill_bytes(&mut verifier_bytes);

    let state = URL_SAFE_NO_PAD.encode(state_bytes);
    let code_verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let challenge_digest = Sha256::digest(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(challenge_digest);
    (state, code_verifier, code_challenge)
}

pub fn percent_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn form_urlencode(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode_component(k), percent_encode_component(v)))
        .collect::<Vec<_>>()
        .join("&")
}

pub fn encode_basic_client_credentials(client_id: &str, client_secret: &str) -> String {
    let raw = format!(
        "{}:{}",
        percent_encode_component(client_id),
        percent_encode_component(client_secret)
    );
    STANDARD.encode(raw.as_bytes())
}

pub fn sanitize_internal_return_path(raw: Option<&str>, fallback_locale: &str) -> String {
    if let Some(p) = raw {
        let trimmed = p.trim();
        if trimmed.starts_with('/')
            && !trimmed.starts_with("//")
            && !trimmed.contains('\\')
            && !trimmed.chars().any(|c| c.is_control())
        {
            return trimmed.to_string();
        }
    }
    format!("/{fallback_locale}")
}

/// Pure-Rust MD5 lowercase hex digest used exclusively for Gravatar / Gravatar-mirror email hashing.
pub fn md5_lower_hex(data: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20,
        5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    for chunk in msg.chunks_exact(64) {
        let mut m = [0u32; 16];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            m[i] = u32::from_le_bytes([word[0], word[1], word[2], word[3]]);
        }
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | ((!b) & d), i),
                16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };
            let temp = d;
            d = c;
            c = b;
            let sum = a.wrapping_add(f).wrapping_add(K[i]).wrapping_add(m[g]);
            b = b.wrapping_add(sum.rotate_left(S[i]));
            a = temp;
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut out = [0u8; 16];
    out[0..4].copy_from_slice(&a0.to_le_bytes());
    out[4..8].copy_from_slice(&b0.to_le_bytes());
    out[8..12].copy_from_slice(&c0.to_le_bytes());
    out[12..16].copy_from_slice(&d0.to_le_bytes());
    hex::encode(out)
}

pub fn build_gravatar_url(email: &str, gravatar_base_url: &str) -> String {
    let normalized_email = email.trim().to_ascii_lowercase();
    if normalized_email.is_empty() {
        return String::new();
    }
    let base = {
        let trimmed = gravatar_base_url.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            "https://www.gravatar.com/avatar"
        } else {
            trimmed
        }
    };
    let hash = md5_lower_hex(normalized_email.as_bytes());
    format!("{base}/{hash}?d=identicon&s=160")
}

/// Resolve effective avatar URL from the user's selected `avatar_source`:
/// `"oauth"` | `"gravatar"` | `"upload"` | `"default"`
pub fn resolve_avatar_url(
    avatar_source: &str,
    email: &str,
    oauth_avatar_url: &str,
    uploaded_avatar_url: &str,
    fallback_avatar_url: &str,
    gravatar_base_url: &str,
) -> String {
    match avatar_source.trim().to_ascii_lowercase().as_str() {
        "oauth" => {
            let trimmed = oauth_avatar_url.trim();
            if !trimmed.is_empty() {
                trimmed.to_string()
            } else {
                String::new()
            }
        }
        "gravatar" => build_gravatar_url(email, gravatar_base_url),
        "upload" => {
            let trimmed = uploaded_avatar_url.trim();
            if !trimmed.is_empty() {
                trimmed.to_string()
            } else {
                String::new()
            }
        }
        "default" => String::new(),
        _ => {
            if !uploaded_avatar_url.trim().is_empty() {
                uploaded_avatar_url.trim().to_string()
            } else if !oauth_avatar_url.trim().is_empty() {
                oauth_avatar_url.trim().to_string()
            } else {
                fallback_avatar_url.trim().to_string()
            }
        }
    }
}
