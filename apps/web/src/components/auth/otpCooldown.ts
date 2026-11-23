/*
 * Shared Persisted OTP Resend Cooldown & Rate-Limit Extraction (`AuthFlowPage` & `UserProfileModal`).
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/apiError';

export type OtpFlowKind = 'register' | 'reset' | 'login_anomaly' | 'email_change';

function otpCooldownKey(flow: OtpFlowKind, subject: string): string {
  return `ihn_otp_cd:${flow}:${subject.trim().toLowerCase()}`;
}

export function saveOtpCooldown(
  flow: OtpFlowKind,
  subject: string,
  seconds: number,
): void {
  const clean = subject.trim();
  if (!clean || seconds <= 0) return;
  try {
    sessionStorage.setItem(
      otpCooldownKey(flow, clean),
      String(Date.now() + seconds * 1000),
    );
  } catch {
    // ignore storage errors
  }
}

export function readOtpCooldown(flow: OtpFlowKind, subject: string): number {
  const clean = subject.trim();
  if (!clean) return 0;
  try {
    const raw = sessionStorage.getItem(otpCooldownKey(flow, clean));
    if (!raw) return 0;
    const deadline = Number(raw);
    if (!Number.isFinite(deadline)) return 0;
    const rem = Math.ceil((deadline - Date.now()) / 1000);
    if (rem <= 0) {
      sessionStorage.removeItem(otpCooldownKey(flow, clean));
      return 0;
    }
    return rem;
  } catch {
    return 0;
  }
}

export function extractRateLimitCooldown(err: unknown): number | null {
  if (
    err instanceof ApiError &&
    (err.code === 'VERIFICATION_CODE_RATE_LIMITED' ||
      err.code === 'MAIL_SEND_IN_PROGRESS') &&
    err.meta &&
    typeof err.meta.retry_after_secs === 'number'
  ) {
    return Math.max(1, Math.round(err.meta.retry_after_secs));
  }
  return null;
}

export function useOtpCooldown(flow: OtpFlowKind, subject: string) {
  const [cooldown, setCooldown] = useState(() => readOtpCooldown(flow, subject));

  useEffect(() => {
    setCooldown(readOtpCooldown(flow, subject));
  }, [flow, subject]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const startCooldown = useCallback(
    (seconds: number, targetSubject?: string) => {
      const cleanSecs = Math.max(0, Math.round(seconds));
      saveOtpCooldown(flow, targetSubject ?? subject, cleanSecs);
      setCooldown(cleanSecs);
    },
    [flow, subject],
  );

  const applyRateLimitError = useCallback(
    (err: unknown, targetSubject?: string): boolean => {
      const retrySecs = extractRateLimitCooldown(err);
      if (retrySecs !== null) {
        startCooldown(retrySecs, targetSubject);
        return true;
      }
      return false;
    },
    [startCooldown],
  );

  return { cooldown, setCooldown, startCooldown, applyRateLimitError };
}
