import 'webauthn-polyfills';
import type { LoginOtpChallengeResponse } from './types';

export interface PasskeyClientCapabilities {
  supported: boolean;
  conditionalGet: boolean;
  platformAuthenticator: boolean;
}

type PublicKeyStaticWithExtensions = typeof PublicKeyCredential & {
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
  parseCreationOptionsFromJSON?: (
    options: Record<string, unknown>,
  ) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (
    options: Record<string, unknown>,
  ) => PublicKeyCredentialRequestOptions;
  signalAllAcceptedCredentials?: (params: {
    rpId: string;
    userId: string;
    allAcceptedCredentialIds: string[];
  }) => Promise<void>;
  signalCurrentUserDetails?: (params: {
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }) => Promise<void>;
  signalUnknownCredential?: (params: {
    rpId: string;
    credentialId: string;
  }) => Promise<void>;
};

type PublicKeyInstanceWithJson = PublicKeyCredential & {
  toJSON?: () => Record<string, unknown>;
};

export function isValidUnpaddedBase64Url(value: string): boolean {
  return (
    value.length > 0 &&
    value.length % 4 !== 1 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export async function detectPasskeyCapabilities(): Promise<PasskeyClientCapabilities> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return {
      supported: false,
      conditionalGet: false,
      platformAuthenticator: false,
    };
  }
  const PK = window.PublicKeyCredential as PublicKeyStaticWithExtensions;
  if (typeof PK.getClientCapabilities === 'function') {
    try {
      const caps = await PK.getClientCapabilities();
      const platform = Boolean(caps.passkeyPlatformAuthenticator);
      const conditional = Boolean(caps.conditionalGet);
      return {
        supported: true,
        conditionalGet: conditional,
        platformAuthenticator: platform,
      };
    } catch {
      // fall through to standard checks
    }
  }
  let platform = false;
  let conditional = false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    if (typeof PublicKeyCredential.isConditionalMediationAvailable === 'function') {
      conditional = await PublicKeyCredential.isConditionalMediationAvailable();
    }
  } catch {
    // ignore
  }
  return {
    supported: true,
    conditionalGet: conditional,
    platformAuthenticator: platform,
  };
}

export function parsePasskeyCreationOptions(
  optionsJson: Record<string, unknown>,
): PublicKeyCredentialCreationOptions {
  const PK = window.PublicKeyCredential as PublicKeyStaticWithExtensions;
  if (typeof PK.parseCreationOptionsFromJSON !== 'function') {
    throw new Error('PASSKEY_INVALID');
  }
  return PK.parseCreationOptionsFromJSON(optionsJson);
}

export function parsePasskeyRequestOptions(
  optionsJson: Record<string, unknown>,
): PublicKeyCredentialRequestOptions {
  const PK = window.PublicKeyCredential as PublicKeyStaticWithExtensions;
  if (typeof PK.parseRequestOptionsFromJSON !== 'function') {
    throw new Error('PASSKEY_INVALID');
  }
  return PK.parseRequestOptionsFromJSON(optionsJson);
}

export function serializePasskeyCredential(
  cred: PublicKeyCredential,
): Record<string, unknown> {
  const withJson = cred as PublicKeyInstanceWithJson;
  if (typeof withJson.toJSON === 'function') {
    return withJson.toJSON();
  }
  throw new Error('PASSKEY_INVALID');
}

export async function syncAcceptedPasskeys(
  rpId: string,
  userId: string,
  credentialIds: string[],
): Promise<void> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return;
  const PK = window.PublicKeyCredential as PublicKeyStaticWithExtensions;
  if (typeof PK.signalAllAcceptedCredentials !== 'function') return;
  if (
    !rpId ||
    !isValidUnpaddedBase64Url(userId) ||
    !credentialIds.every(isValidUnpaddedBase64Url)
  ) {
    console.warn(
      'SignalAllAcceptedCredentials skipped: valid server rpId and unpadded Base64URL IDs are required.',
    );
    return;
  }
  try {
    await PK.signalAllAcceptedCredentials({
      rpId,
      userId,
      allAcceptedCredentialIds: credentialIds,
    });
  } catch (err) {
    console.warn('SignalAllAcceptedCredentials sync warning:', err);
  }
}

export async function syncPasskeyUserDetails(
  rpId: string,
  userId: string,
  name: string,
  displayName: string,
): Promise<void> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return;
  const PK = window.PublicKeyCredential as PublicKeyStaticWithExtensions;
  if (typeof PK.signalCurrentUserDetails !== 'function') return;
  if (!rpId || !isValidUnpaddedBase64Url(userId)) {
    console.warn(
      'SignalCurrentUserDetails skipped: valid server rpId and unpadded Base64URL userId are required.',
    );
    return;
  }
  try {
    await PK.signalCurrentUserDetails({
      rpId,
      userId,
      name,
      displayName,
    });
  } catch (err) {
    console.warn('SignalCurrentUserDetails sync warning:', err);
  }
}

export async function signalUnknownPasskey(
  rpId: string,
  credentialId: string,
): Promise<void> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return;
  const PK = window.PublicKeyCredential as PublicKeyStaticWithExtensions;
  if (typeof PK.signalUnknownCredential !== 'function') return;
  if (!rpId || !isValidUnpaddedBase64Url(credentialId)) return;
  try {
    await PK.signalUnknownCredential({ rpId, credentialId });
  } catch (err) {
    console.warn('SignalUnknownCredential warning:', err);
  }
}

const PENDING_OAUTH_OTP_KEY = 'ihn_pending_oauth_otp_v1';

export function savePendingOAuthOtpChallenge(
  challenge: LoginOtpChallengeResponse,
): void {
  try {
    sessionStorage.setItem(PENDING_OAUTH_OTP_KEY, JSON.stringify(challenge));
  } catch {
    // ignore
  }
}

export function consumePendingOAuthOtpChallenge(): LoginOtpChallengeResponse | null {
  try {
    const raw = sessionStorage.getItem(PENDING_OAUTH_OTP_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_OAUTH_OTP_KEY);
    const parsed = JSON.parse(raw) as LoginOtpChallengeResponse;
    if (parsed && parsed.requires_otp && parsed.challenge_id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
