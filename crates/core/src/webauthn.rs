//! W3C WebAuthn Level 3 / FIDO2 Passkey Registration & Assertion Verifier.
//!
//! Supports COSE algorithms:
//! - `-7` (`ES256` — ECDSA P-256 with SHA-256)
//! - `-8` (`EdDSA` — Ed25519)
//! - `-257` (`RS256` — RSASSA-PKCS1-v1_5 with SHA-256)
//!
//! Follows `modern-web-guidance` passkey standards:
//! - Unpadded Base64URL encoding (`[A-Za-z0-9_-]`, `length % 4 != 1`) for all credential IDs & user IDs.
//! - Server-supplied `rp.id` / `rpId` verification via `SHA-256(rp_id)`.
//! - Relaxed `userVerification: "preferred"` verification (`UP == true`, `UV` not strictly required).
//! - AAGUID UX-only provider name resolution (`00000000-0000-0000-0000-000000000000` -> device fallback).

use crate::{
    crypto::constant_time_str_eq,
    error::{DomainError, ErrorCode},
};
use anyhow::Result;
use base64::{
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{DateTime, Utc};
use rand_core::{OsRng, RngCore};
use ring::signature::{
    UnparsedPublicKey, ECDSA_P256_SHA256_ASN1, ED25519, RSA_PKCS1_2048_8192_SHA256,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const ALG_ES256: i32 = -7;
pub const ALG_EDDSA: i32 = -8;
pub const ALG_RS256: i32 = -257;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPasskeyDto {
    pub id: String,
    pub name: String,
    pub aaguid: String,
    pub device_type: String, // "singleDevice" | "multiDevice"
    pub backed_up: bool,
    #[serde(default)]
    pub transports: Vec<String>,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPasskeyCredential {
    pub credential_id: String,
    pub user_id: Uuid,
    pub public_key_b64: String,
    pub alg: i32,
    pub counter: u32,
    pub aaguid: String,
    pub name: String,
    #[serde(default)]
    pub transports: Vec<String>,
    pub device_type: String,
    pub backed_up: bool,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<DateTime<Utc>>,
}

impl StoredPasskeyCredential {
    pub fn to_dto(&self) -> UserPasskeyDto {
        UserPasskeyDto {
            id: self.credential_id.clone(),
            name: self.name.clone(),
            aaguid: self.aaguid.clone(),
            device_type: self.device_type.clone(),
            backed_up: self.backed_up,
            transports: self.transports.clone(),
            created_at: self.created_at,
            last_used_at: self.last_used_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RegistrationCredentialJson {
    pub id: String,
    #[serde(default)]
    pub raw_id: Option<String>,
    #[serde(rename = "type", default)]
    pub cred_type: String,
    pub response: AttestationResponseJson,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttestationResponseJson {
    pub client_data_json: Option<String>,
    #[serde(rename = "clientDataJSON", default)]
    pub client_data_json_upper: Option<String>,
    pub attestation_object: String,
    #[serde(default)]
    pub transports: Vec<String>,
}

impl AttestationResponseJson {
    pub fn client_data_b64(&self) -> Option<&str> {
        self.client_data_json_upper
            .as_deref()
            .or(self.client_data_json.as_deref())
    }
}

#[derive(Debug, Deserialize)]
pub struct AssertionCredentialJson {
    pub id: String,
    #[serde(rename = "type", default)]
    pub cred_type: String,
    pub response: AssertionResponseJson,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionResponseJson {
    pub client_data_json: Option<String>,
    #[serde(rename = "clientDataJSON", default)]
    pub client_data_json_upper: Option<String>,
    pub authenticator_data: String,
    pub signature: String,
    #[serde(default)]
    pub user_handle: Option<String>,
}

impl AssertionResponseJson {
    pub fn client_data_b64(&self) -> Option<&str> {
        self.client_data_json_upper
            .as_deref()
            .or(self.client_data_json.as_deref())
    }
}

#[derive(Debug, Deserialize)]
struct CollectedClientData {
    #[serde(rename = "type")]
    kind: String,
    challenge: String,
    origin: String,
    #[serde(default, rename = "crossOrigin")]
    cross_origin: Option<bool>,
}

pub fn encode_passkey_user_id(user_id: Uuid) -> String {
    URL_SAFE_NO_PAD.encode(user_id.as_bytes())
}

pub fn generate_webauthn_challenge() -> String {
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

pub fn is_valid_unpadded_base64url(s: &str) -> bool {
    !s.is_empty()
        && s.len() % 4 != 1
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn decode_base64url_flexible(raw: &str) -> Result<Vec<u8>> {
    let trimmed = raw.trim().trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| URL_SAFE.decode(raw.trim()))
        .map_err(|_| DomainError::new(ErrorCode::PasskeyInvalid, "Invalid Base64URL encoding.").into())
}

/// UX-only AAGUID lookup for common platform & roaming passkey providers.
pub fn resolve_passkey_provider_name(aaguid: &str, fallback_device_label: &str) -> String {
    let clean = aaguid.trim().to_ascii_lowercase();
    if clean.is_empty() || clean == "00000000-0000-0000-0000-000000000000" {
        let fb = fallback_device_label.trim();
        return if fb.is_empty() || fb == "Unknown Device" {
            "Passkey".to_string()
        } else {
            fb.chars().take(80).collect()
        };
    }
    match clean.as_str() {
        "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4" => "Google Password Manager".to_string(),
        "fbfc3007-154e-4ecc-8c0b-6e020557d7bd" | "dd4ec289-e01d-41c9-bb89-70fa845d4bf2" => {
            "iCloud Keychain".to_string()
        }
        "08987058-cadc-4b81-b6e1-30de50dcbe96" | "9ddd1817-af5a-4672-a2b9-3e3dd95000a9" => {
            "Windows Hello".to_string()
        }
        "bada5566-a7aa-401f-bd96-45619a55120d" => "1Password".to_string(),
        "d548826e-79b4-db40-a3d8-11116f7e8349" => "Bitwarden".to_string(),
        "531126d6-e717-415c-9320-3d9aa6981239" => "Dashlane".to_string(),
        "f8a011f3-8c0a-4d15-8006-17111f9edc7d" | "2fc0579f-8113-47ea-b116-bb5a8db9202a" => {
            "YubiKey".to_string()
        }
        _ => {
            let fb = fallback_device_label.trim();
            if fb.is_empty() || fb == "Unknown Device" {
                "Passkey".to_string()
            } else {
                fb.chars().take(80).collect()
            }
        }
    }
}

// ============================================================================
// Minimal Safe RFC 8949 CBOR Decoder (bounded depth, zero unsafe)
// ============================================================================

#[derive(Debug, Clone)]
enum CborValue {
    Int(i128),
    Bytes(Vec<u8>),
    Text(String),
    Array,
    Map(Vec<(CborValue, CborValue)>),
    Simple,
}

impl CborValue {
    fn as_int(&self) -> Option<i128> {
        match self {
            Self::Int(v) => Some(*v),
            _ => None,
        }
    }

    fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Self::Bytes(b) => Some(b.as_slice()),
            _ => None,
        }
    }

    fn map_get_str(&self, key: &str) -> Option<&CborValue> {
        let Self::Map(entries) = self else {
            return None;
        };
        entries.iter().find_map(|(k, v)| match k {
            Self::Text(s) if s == key => Some(v),
            _ => None,
        })
    }

    fn map_get_int(&self, key: i128) -> Option<&CborValue> {
        let Self::Map(entries) = self else {
            return None;
        };
        entries.iter().find_map(|(k, v)| match k {
            Self::Int(n) if *n == key => Some(v),
            _ => None,
        })
    }
}

fn read_cbor_uint(data: &[u8], pos: &mut usize, addl: u8) -> Option<u64> {
    match addl {
        0..=23 => Some(addl as u64),
        24 => {
            let b = *data.get(*pos)?;
            *pos += 1;
            Some(b as u64)
        }
        25 => {
            let slice = data.get(*pos..*pos + 2)?;
            *pos += 2;
            Some(u16::from_be_bytes([slice[0], slice[1]]) as u64)
        }
        26 => {
            let slice = data.get(*pos..*pos + 4)?;
            *pos += 4;
            Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]) as u64)
        }
        27 => {
            let slice = data.get(*pos..*pos + 8)?;
            *pos += 8;
            Some(u64::from_be_bytes([
                slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
            ]))
        }
        _ => None,
    }
}

fn decode_cbor_item(data: &[u8], pos: &mut usize, depth: u8) -> Option<CborValue> {
    if depth > 8 {
        return None;
    }
    let initial = *data.get(*pos)?;
    *pos += 1;
    let major = initial >> 5;
    let addl = initial & 0x1f;

    match major {
        0 => {
            let n = read_cbor_uint(data, pos, addl)?;
            Some(CborValue::Int(n as i128))
        }
        1 => {
            let n = read_cbor_uint(data, pos, addl)?;
            Some(CborValue::Int(-1i128 - (n as i128)))
        }
        2 => {
            let len = usize::try_from(read_cbor_uint(data, pos, addl)?).ok()?;
            if len > 65536 {
                return None;
            }
            let slice = data.get(*pos..*pos + len)?;
            *pos += len;
            Some(CborValue::Bytes(slice.to_vec()))
        }
        3 => {
            let len = usize::try_from(read_cbor_uint(data, pos, addl)?).ok()?;
            if len > 16384 {
                return None;
            }
            let slice = data.get(*pos..*pos + len)?;
            *pos += len;
            let s = std::str::from_utf8(slice).ok()?.to_string();
            Some(CborValue::Text(s))
        }
        4 => {
            let count = usize::try_from(read_cbor_uint(data, pos, addl)?).ok()?;
            if count > 256 {
                return None;
            }
            for _ in 0..count {
                let _ = decode_cbor_item(data, pos, depth + 1)?;
            }
            Some(CborValue::Array)
        }
        5 => {
            let count = usize::try_from(read_cbor_uint(data, pos, addl)?).ok()?;
            if count > 256 {
                return None;
            }
            let mut entries = Vec::with_capacity(count);
            for _ in 0..count {
                let k = decode_cbor_item(data, pos, depth + 1)?;
                let v = decode_cbor_item(data, pos, depth + 1)?;
                entries.push((k, v));
            }
            Some(CborValue::Map(entries))
        }
        6 => {
            let _tag = read_cbor_uint(data, pos, addl)?;
            decode_cbor_item(data, pos, depth + 1)
        }
        7 => match addl {
            0..=23 => Some(CborValue::Simple),
            24 => {
                let _ = *data.get(*pos)?;
                *pos += 1;
                Some(CborValue::Simple)
            }
            25 => {
                let _ = data.get(*pos..*pos + 2)?;
                *pos += 2;
                Some(CborValue::Simple)
            }
            26 => {
                let _ = data.get(*pos..*pos + 4)?;
                *pos += 4;
                Some(CborValue::Simple)
            }
            27 => {
                let _ = data.get(*pos..*pos + 8)?;
                *pos += 8;
                Some(CborValue::Simple)
            }
            _ => None,
        },
        _ => None,
    }
}

fn encode_asn1_len(len: usize) -> Vec<u8> {
    if len < 0x80 {
        vec![len as u8]
    } else if len <= 0xff {
        vec![0x81, len as u8]
    } else {
        vec![0x82, (len >> 8) as u8, (len & 0xff) as u8]
    }
}

fn encode_asn1_uint(raw: &[u8]) -> Vec<u8> {
    let trimmed = match raw.iter().position(|&b| b != 0) {
        Some(idx) => &raw[idx..],
        None => &[0u8],
    };
    let needs_pad = (trimmed[0] & 0x80) != 0;
    let content_len = trimmed.len() + usize::from(needs_pad);
    let mut out = vec![0x02];
    out.extend_from_slice(&encode_asn1_len(content_len));
    if needs_pad {
        out.push(0x00);
    }
    out.extend_from_slice(trimmed);
    out
}

fn build_rsa_pkcs1_public_key_der(n: &[u8], e: &[u8]) -> Vec<u8> {
    let mut seq_body = encode_asn1_uint(n);
    seq_body.extend_from_slice(&encode_asn1_uint(e));
    let mut der = vec![0x30];
    der.extend_from_slice(&encode_asn1_len(seq_body.len()));
    der.extend_from_slice(&seq_body);
    der
}

/// Extract `(alg, verification_public_key_bytes)` from a COSE_Key CBOR map.
fn extract_cose_verification_key(cose: &CborValue) -> Result<(i32, Vec<u8>)> {
    let kty = cose
        .map_get_int(1)
        .and_then(CborValue::as_int)
        .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing COSE kty."))?;
    let alg = cose
        .map_get_int(3)
        .and_then(CborValue::as_int)
        .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing COSE alg."))?;

    match (kty, alg) {
        // EC2 + ES256 (P-256)
        (2, -7) => {
            let crv = cose.map_get_int(-1).and_then(CborValue::as_int).unwrap_or(0);
            let x = cose
                .map_get_int(-2)
                .and_then(CborValue::as_bytes)
                .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing EC2 x coordinate."))?;
            let y = cose
                .map_get_int(-3)
                .and_then(CborValue::as_bytes)
                .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing EC2 y coordinate."))?;
            if crv != 1 || x.len() != 32 || y.len() != 32 {
                return Err(DomainError::new(
                    ErrorCode::PasskeyInvalid,
                    "Invalid P-256 COSE public key parameters.",
                )
                .into());
            }
            let mut sec1 = Vec::with_capacity(65);
            sec1.push(0x04);
            sec1.extend_from_slice(x);
            sec1.extend_from_slice(y);
            Ok((ALG_ES256, sec1))
        }
        // OKP + EdDSA (Ed25519)
        (1, -8) => {
            let crv = cose.map_get_int(-1).and_then(CborValue::as_int).unwrap_or(0);
            let x = cose
                .map_get_int(-2)
                .and_then(CborValue::as_bytes)
                .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing OKP x key."))?;
            if crv != 6 || x.len() != 32 {
                return Err(DomainError::new(
                    ErrorCode::PasskeyInvalid,
                    "Invalid Ed25519 COSE public key parameters.",
                )
                .into());
            }
            Ok((ALG_EDDSA, x.to_vec()))
        }
        // RSA + RS256
        (3, -257) => {
            let n = cose
                .map_get_int(-1)
                .and_then(CborValue::as_bytes)
                .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing RSA modulus."))?;
            let e = cose
                .map_get_int(-2)
                .and_then(CborValue::as_bytes)
                .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing RSA exponent."))?;
            if n.len() < 256 || e.is_empty() {
                return Err(DomainError::new(
                    ErrorCode::PasskeyInvalid,
                    "RSA public key must be at least 2048 bits.",
                )
                .into());
            }
            Ok((ALG_RS256, build_rsa_pkcs1_public_key_der(n, e)))
        }
        _ => Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            format!("Unsupported WebAuthn COSE key algorithm (kty={kty}, alg={alg})."),
        )
        .into()),
    }
}

fn verify_constant_bytes_32(a: &[u8], b: &[u8]) -> bool {
    if a.len() != 32 || b.len() != 32 {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

#[allow(clippy::too_many_arguments)]
pub fn verify_passkey_registration(
    user_id: Uuid,
    expected_challenge: &str,
    expected_rp_id: &str,
    expected_origins: &[String],
    fallback_device_label: &str,
    custom_nickname: Option<&str>,
    cred: &RegistrationCredentialJson,
) -> Result<StoredPasskeyCredential> {
    let client_data_b64 = cred
        .response
        .client_data_b64()
        .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing clientDataJSON."))?;
    let client_data_bytes = decode_base64url_flexible(client_data_b64)?;
    let client_data: CollectedClientData = serde_json::from_slice(&client_data_bytes)
        .map_err(|_| DomainError::new(ErrorCode::PasskeyInvalid, "Malformed clientDataJSON."))?;

    if client_data.kind != "webauthn.create" {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Unexpected WebAuthn ceremony type.",
        )
        .into());
    }
    if client_data.cross_origin == Some(true) {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Cross-origin WebAuthn ceremonies are not permitted.",
        )
        .into());
    }
    if !constant_time_str_eq(client_data.challenge.trim_end_matches('='), expected_challenge) {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "WebAuthn registration challenge mismatch.",
        )
        .into());
    }
    if !expected_origins
        .iter()
        .any(|orig| orig.eq_ignore_ascii_case(client_data.origin.trim()))
    {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            format!("WebAuthn origin '{}' is not allowed.", client_data.origin),
        )
        .into());
    }

    let att_bytes = decode_base64url_flexible(&cred.response.attestation_object)?;
    let mut pos = 0usize;
    let att_cbor = decode_cbor_item(&att_bytes, &mut pos, 0).ok_or_else(|| {
        DomainError::new(ErrorCode::PasskeyInvalid, "Invalid CBOR attestationObject.")
    })?;
    let auth_data = att_cbor
        .map_get_str("authData")
        .and_then(CborValue::as_bytes)
        .ok_or_else(|| {
            DomainError::new(ErrorCode::PasskeyInvalid, "Missing authData in attestation.")
        })?;

    if auth_data.len() < 55 {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Attested authenticatorData is truncated.",
        )
        .into());
    }

    let expected_rp_hash = Sha256::digest(expected_rp_id.as_bytes());
    if !verify_constant_bytes_32(&auth_data[0..32], expected_rp_hash.as_slice()) {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "WebAuthn RP ID hash mismatch.",
        )
        .into());
    }

    let flags = auth_data[32];
    let user_present = (flags & 0x01) != 0;
    let attested_cred_present = (flags & 0x40) != 0;
    if !user_present || !attested_cred_present {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Authenticator presence or credential data flag missing.",
        )
        .into());
    }
    let backup_eligible = (flags & 0x08) != 0;
    let backed_up = (flags & 0x10) != 0;
    let device_type = if backup_eligible {
        "multiDevice".to_string()
    } else {
        "singleDevice".to_string()
    };

    let sign_count = u32::from_be_bytes([auth_data[33], auth_data[34], auth_data[35], auth_data[36]]);
    let mut aaguid_bytes = [0u8; 16];
    aaguid_bytes.copy_from_slice(&auth_data[37..53]);
    let aaguid_str = Uuid::from_bytes(aaguid_bytes).to_string();

    let cred_id_len = u16::from_be_bytes([auth_data[53], auth_data[54]]) as usize;
    if cred_id_len == 0 || cred_id_len > 384 || auth_data.len() <= 55 + cred_id_len {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Invalid attested credential ID length.",
        )
        .into());
    }
    let cred_id_raw = &auth_data[55..55 + cred_id_len];
    let cred_id_b64 = URL_SAFE_NO_PAD.encode(cred_id_raw);

    let claimed_id_raw = decode_base64url_flexible(&cred.id)?;
    if claimed_id_raw != cred_id_raw || !is_valid_unpadded_base64url(&cred_id_b64) {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Attested credential ID does not match response ID.",
        )
        .into());
    }

    let mut cose_pos = 55 + cred_id_len;
    let cose_cbor = decode_cbor_item(auth_data, &mut cose_pos, 0).ok_or_else(|| {
        DomainError::new(ErrorCode::PasskeyInvalid, "Invalid COSE public key CBOR.")
    })?;
    let (alg, pk_bytes) = extract_cose_verification_key(&cose_cbor)?;

    let clean_transports: Vec<String> = cred
        .response
        .transports
        .iter()
        .map(|t| t.trim().to_ascii_lowercase())
        .filter(|t| {
            matches!(
                t.as_str(),
                "internal" | "hybrid" | "usb" | "nfc" | "ble" | "smart-card"
            )
        })
        .take(6)
        .collect();

    let resolved_name = custom_nickname
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(80).collect())
        .unwrap_or_else(|| resolve_passkey_provider_name(&aaguid_str, fallback_device_label));

    Ok(StoredPasskeyCredential {
        credential_id: cred_id_b64,
        user_id,
        public_key_b64: URL_SAFE_NO_PAD.encode(pk_bytes),
        alg,
        counter: sign_count,
        aaguid: aaguid_str,
        name: resolved_name,
        transports: clean_transports,
        device_type,
        backed_up,
        created_at: Utc::now(),
        last_used_at: None,
    })
}

pub fn verify_passkey_assertion(
    stored: &StoredPasskeyCredential,
    expected_challenge: &str,
    expected_rp_id: &str,
    expected_origins: &[String],
    assertion: &AssertionCredentialJson,
) -> Result<u32> {
    let client_data_b64 = assertion
        .response
        .client_data_b64()
        .ok_or_else(|| DomainError::new(ErrorCode::PasskeyInvalid, "Missing clientDataJSON."))?;
    let client_data_bytes = decode_base64url_flexible(client_data_b64)?;
    let client_data: CollectedClientData = serde_json::from_slice(&client_data_bytes)
        .map_err(|_| DomainError::new(ErrorCode::PasskeyInvalid, "Malformed clientDataJSON."))?;

    if client_data.kind != "webauthn.get" {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Unexpected WebAuthn assertion type.",
        )
        .into());
    }
    if client_data.cross_origin == Some(true) {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Cross-origin WebAuthn ceremonies are not permitted.",
        )
        .into());
    }
    if !constant_time_str_eq(client_data.challenge.trim_end_matches('='), expected_challenge) {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "WebAuthn authentication challenge mismatch.",
        )
        .into());
    }
    if !expected_origins
        .iter()
        .any(|orig| orig.eq_ignore_ascii_case(client_data.origin.trim()))
    {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            format!("WebAuthn origin '{}' is not allowed.", client_data.origin),
        )
        .into());
    }

    let auth_data = decode_base64url_flexible(&assertion.response.authenticator_data)?;
    if auth_data.len() < 37 {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Assertion authenticatorData is truncated.",
        )
        .into());
    }

    let expected_rp_hash = Sha256::digest(expected_rp_id.as_bytes());
    if !verify_constant_bytes_32(&auth_data[0..32], expected_rp_hash.as_slice()) {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "WebAuthn RP ID hash mismatch.",
        )
        .into());
    }

    let flags = auth_data[32];
    if (flags & 0x01) == 0 {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Authenticator user presence flag is false.",
        )
        .into());
    }

    let new_sign_count =
        u32::from_be_bytes([auth_data[33], auth_data[34], auth_data[35], auth_data[36]]);
    if stored.counter > 0 && new_sign_count <= stored.counter {
        return Err(DomainError::new(
            ErrorCode::PasskeyInvalid,
            "Passkey signature counter regression detected.",
        )
        .into());
    }

    let sig_bytes = decode_base64url_flexible(&assertion.response.signature)?;
    let pk_bytes = decode_base64url_flexible(&stored.public_key_b64)?;

    let client_data_hash = Sha256::digest(&client_data_bytes);
    let mut signed_payload = Vec::with_capacity(auth_data.len() + 32);
    signed_payload.extend_from_slice(&auth_data);
    signed_payload.extend_from_slice(client_data_hash.as_slice());

    let verify_res = match stored.alg {
        ALG_ES256 => UnparsedPublicKey::new(&ECDSA_P256_SHA256_ASN1, &pk_bytes)
            .verify(&signed_payload, &sig_bytes),
        ALG_EDDSA => UnparsedPublicKey::new(&ED25519, &pk_bytes).verify(&signed_payload, &sig_bytes),
        ALG_RS256 => UnparsedPublicKey::new(&RSA_PKCS1_2048_8192_SHA256, &pk_bytes)
            .verify(&signed_payload, &sig_bytes),
        _ => Err(ring::error::Unspecified),
    };

    if verify_res.is_err() {
        return Err(DomainError::new(
            ErrorCode::InvalidCredentials,
            "Passkey cryptographic signature verification failed.",
        )
        .into());
    }

    let next_counter = if new_sign_count > stored.counter {
        new_sign_count
    } else {
        stored.counter
    };
    Ok(next_counter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::{
        rand::SystemRandom,
        signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING},
    };

    fn cbor_bytes(b: &[u8]) -> Vec<u8> {
        let mut out = if b.len() < 24 {
            vec![0x40 | (b.len() as u8)]
        } else if b.len() <= 255 {
            vec![0x58, b.len() as u8]
        } else {
            vec![0x59, (b.len() >> 8) as u8, (b.len() & 0xff) as u8]
        };
        out.extend_from_slice(b);
        out
    }

    fn cbor_text(s: &str) -> Vec<u8> {
        let b = s.as_bytes();
        let mut out = vec![0x60 | (b.len() as u8)];
        out.extend_from_slice(b);
        out
    }

    #[test]
    fn registers_and_verifies_es256_passkey_end_to_end() {
        let rng = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &rng).unwrap();
        let kp = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &rng)
            .unwrap();
        let pub_uncompressed = kp.public_key().as_ref(); // 0x04 || x(32) || y(32)
        let x = &pub_uncompressed[1..33];
        let y = &pub_uncompressed[33..65];

        // Build COSE_Key map: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
        let mut cose = vec![0xa5];
        cose.extend_from_slice(&[0x01, 0x02]); // kty: EC2
        cose.extend_from_slice(&[0x03, 0x26]); // alg: -7
        cose.extend_from_slice(&[0x20, 0x01]); // crv: P-256
        cose.push(0x21); // -2: x
        cose.extend_from_slice(&cbor_bytes(x));
        cose.push(0x22); // -3: y
        cose.extend_from_slice(&cbor_bytes(y));

        let rp_id = "notes.example.com";
        let origin = "https://notes.example.com".to_string();
        let reg_challenge = generate_webauthn_challenge();
        let cred_id_raw = b"demo-passkey-cred-id-001";
        let cred_id_b64 = URL_SAFE_NO_PAD.encode(cred_id_raw);

        let mut auth_data = Vec::new();
        auth_data.extend_from_slice(Sha256::digest(rp_id.as_bytes()).as_slice());
        auth_data.push(0x01 | 0x04 | 0x08 | 0x10 | 0x40); // UP + UV + BE + BS + AT
        auth_data.extend_from_slice(&1u32.to_be_bytes());
        auth_data.extend_from_slice(
            Uuid::parse_str("ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4")
                .unwrap()
                .as_bytes(),
        );
        auth_data.extend_from_slice(&(cred_id_raw.len() as u16).to_be_bytes());
        auth_data.extend_from_slice(cred_id_raw);
        auth_data.extend_from_slice(&cose);

        // Build attestationObject CBOR map: {"fmt": "none", "authData": <bytes>}
        let mut att_obj = vec![0xa2];
        att_obj.extend_from_slice(&cbor_text("fmt"));
        att_obj.extend_from_slice(&cbor_text("none"));
        att_obj.extend_from_slice(&cbor_text("authData"));
        att_obj.extend_from_slice(&cbor_bytes(&auth_data));

        let reg_client_data = serde_json::json!({
            "type": "webauthn.create",
            "challenge": reg_challenge,
            "origin": origin,
        })
        .to_string();

        let reg_payload = RegistrationCredentialJson {
            id: cred_id_b64.clone(),
            raw_id: Some(cred_id_b64.clone()),
            cred_type: "public-key".to_string(),
            response: AttestationResponseJson {
                client_data_json: None,
                client_data_json_upper: Some(URL_SAFE_NO_PAD.encode(reg_client_data.as_bytes())),
                attestation_object: URL_SAFE_NO_PAD.encode(&att_obj),
                transports: vec!["internal".to_string(), "hybrid".to_string()],
            },
        };

        let user_id = Uuid::new_v4();
        assert!(is_valid_unpadded_base64url(&encode_passkey_user_id(user_id)));

        let stored = verify_passkey_registration(
            user_id,
            &reg_challenge,
            rp_id,
            std::slice::from_ref(&origin),
            "Chrome on Windows",
            None,
            &reg_payload,
        )
        .expect("passkey registration succeeds");
        assert_eq!(stored.name, "Google Password Manager");
        assert_eq!(stored.device_type, "multiDevice");
        assert!(stored.backed_up);

        // Now verify an assertion signed by the same P-256 private key
        let auth_challenge = generate_webauthn_challenge();
        let get_client_data = serde_json::json!({
            "type": "webauthn.get",
            "challenge": auth_challenge,
            "origin": origin,
        })
        .to_string();

        let mut get_auth_data = Vec::new();
        get_auth_data.extend_from_slice(Sha256::digest(rp_id.as_bytes()).as_slice());
        get_auth_data.push(0x01); // UP only (UV false, allowed by preferred)
        get_auth_data.extend_from_slice(&2u32.to_be_bytes());

        let mut to_sign = get_auth_data.clone();
        to_sign.extend_from_slice(Sha256::digest(get_client_data.as_bytes()).as_slice());
        let sig = kp.sign(&rng, &to_sign).unwrap();

        let assertion = AssertionCredentialJson {
            id: cred_id_b64.clone(),
            cred_type: "public-key".to_string(),
            response: AssertionResponseJson {
                client_data_json: None,
                client_data_json_upper: Some(URL_SAFE_NO_PAD.encode(get_client_data.as_bytes())),
                authenticator_data: URL_SAFE_NO_PAD.encode(&get_auth_data),
                signature: URL_SAFE_NO_PAD.encode(sig.as_ref()),
                user_handle: Some(encode_passkey_user_id(user_id)),
            },
        };

        let next_cnt = verify_passkey_assertion(
            &stored,
            &auth_challenge,
            rp_id,
            std::slice::from_ref(&origin),
            &assertion,
        )
        .expect("assertion verified");
        assert_eq!(next_cnt, 2);

        // Wrong challenge must fail
        assert!(verify_passkey_assertion(
            &stored,
            "tampered-challenge",
            rp_id,
            std::slice::from_ref(&origin),
            &assertion,
        )
        .is_err());
    }

    #[test]
    fn rejects_cross_origin_and_counter_regression_assertions() {
        let rng = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &rng).unwrap();
        let kp = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &rng)
            .unwrap();
        let rp_id = "notes.example.com";
        let origin = "https://notes.example.com".to_string();
        let user_id = Uuid::new_v4();

        let stored = StoredPasskeyCredential {
            credential_id: URL_SAFE_NO_PAD.encode(b"cred-security-check"),
            user_id,
            public_key_b64: URL_SAFE_NO_PAD.encode(kp.public_key().as_ref()),
            alg: ALG_ES256,
            counter: 5,
            aaguid: "00000000-0000-0000-0000-000000000000".to_string(),
            name: "Security Test Key".to_string(),
            transports: vec!["internal".to_string()],
            device_type: "multiDevice".to_string(),
            backed_up: true,
            created_at: Utc::now(),
            last_used_at: None,
        };

        let make_assertion = |challenge: &str, cross_origin: Option<bool>, sign_count: u32| {
            let mut client_json = serde_json::json!({
                "type": "webauthn.get",
                "challenge": challenge,
                "origin": origin,
            });
            if let Some(co) = cross_origin {
                client_json["crossOrigin"] = serde_json::json!(co);
            }
            let client_data_str = client_json.to_string();
            let mut auth_data = Vec::new();
            auth_data.extend_from_slice(Sha256::digest(rp_id.as_bytes()).as_slice());
            auth_data.push(0x01); // UP bit
            auth_data.extend_from_slice(&sign_count.to_be_bytes());

            let mut signed = auth_data.clone();
            signed.extend_from_slice(Sha256::digest(client_data_str.as_bytes()).as_slice());
            let sig = kp.sign(&rng, &signed).unwrap();

            AssertionCredentialJson {
                id: stored.credential_id.clone(),
                cred_type: "public-key".to_string(),
                response: AssertionResponseJson {
                    client_data_json: None,
                    client_data_json_upper: Some(URL_SAFE_NO_PAD.encode(client_data_str.as_bytes())),
                    authenticator_data: URL_SAFE_NO_PAD.encode(&auth_data),
                    signature: URL_SAFE_NO_PAD.encode(sig.as_ref()),
                    user_handle: Some(encode_passkey_user_id(user_id)),
                },
            }
        };

        let ch_ok = generate_webauthn_challenge();
        let next = verify_passkey_assertion(
            &stored,
            &ch_ok,
            rp_id,
            std::slice::from_ref(&origin),
            &make_assertion(&ch_ok, None, 6),
        )
        .expect("advancing counter without crossOrigin succeeds");
        assert_eq!(next, 6);

        let ch_cross = generate_webauthn_challenge();
        assert!(
            verify_passkey_assertion(
                &stored,
                &ch_cross,
                rp_id,
                std::slice::from_ref(&origin),
                &make_assertion(&ch_cross, Some(true), 7),
            )
            .is_err(),
            "crossOrigin: true must be rejected"
        );

        let ch_same = generate_webauthn_challenge();
        assert!(
            verify_passkey_assertion(
                &stored,
                &ch_same,
                rp_id,
                std::slice::from_ref(&origin),
                &make_assertion(&ch_same, None, 5),
            )
            .is_err(),
            "non-advancing signCount when stored.counter > 0 must be rejected"
        );

        let ch_reg = generate_webauthn_challenge();
        assert!(
            verify_passkey_assertion(
                &stored,
                &ch_reg,
                rp_id,
                std::slice::from_ref(&origin),
                &make_assertion(&ch_reg, None, 2),
            )
            .is_err(),
            "signCount regression when stored.counter > 0 must be rejected"
        );
    }
}
