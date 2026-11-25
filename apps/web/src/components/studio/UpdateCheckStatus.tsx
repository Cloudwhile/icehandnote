/*
 * Shared Site Version & Update Check Hook + Status Badge (`StudioOverviewPanel` & `StudioSettingsPanel`).
 */

import { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { UI_COPY } from '../../lib/i18n';
import { APP_VERSION, type LocaleCode, type UpdateCheckResponse } from '../../lib/types';
import { toSafeHttpUrl } from '../../lib/urlSafety';
import { IconCheck, IconExternalLink } from '../ui/Icons';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/ToastProvider';

export function useSiteUpdateCheck(toastOnError = false) {
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResponse | null>(null);
  const [error, setError] = useState(false);

  const checkUpdate = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setError(false);
    try {
      const res = await api.checkSiteUpdate();
      setResult(res);
    } catch (err) {
      setError(true);
      if (toastOnError) {
        toast.error(err);
      }
    } finally {
      setChecking(false);
    }
  }, [checking, toast, toastOnError]);

  return {
    checking,
    result,
    error,
    currentVersion: result?.current_version ?? APP_VERSION,
    checkUpdate,
  };
}

export interface UpdateCheckStatusProps {
  locale: LocaleCode;
  checking: boolean;
  result: UpdateCheckResponse | null;
  error: boolean;
  compact?: boolean;
}

export function UpdateCheckStatus({
  locale,
  checking,
  result,
  error,
  compact = false,
}: UpdateCheckStatusProps) {
  const st = UI_COPY[locale].studio.settings;

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex flex-wrap items-center gap-2.5 text-xs"
    >
      {!checking && error && (
        <span className="font-semibold text-accent-danger">
          {st.updateCheckFailed}
        </span>
      )}

      {!checking && !error && result && (() => {
        const safeReleaseUrl = toSafeHttpUrl(result.release_url);
        return result.has_update ? (
          compact ? (
            safeReleaseUrl ? (
              <a
                href={safeReleaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono font-semibold text-link-ink no-underline hover:underline inline-flex items-center gap-1"
              >
                <span>{st.updateAvailableBadge(result.latest_version)}</span>
                <IconExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="font-mono font-semibold text-link-ink">
                {st.updateAvailableBadge(result.latest_version)}
              </span>
            )
          ) : (
            <>
              <StatusBadge tone="warn" mono>
                {st.updateAvailableBadge(result.latest_version)}
              </StatusBadge>
              {safeReleaseUrl && (
                <a
                  href={safeReleaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 min-h-7 py-1 font-semibold text-link-ink no-underline hover:underline"
                >
                  <span>{st.viewReleaseLink.replace(/\s*↗$/, '')}</span>
                  <IconExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </>
          )
        ) : (
          <>
            <span className="font-semibold text-accent-success inline-flex items-center gap-1">
              <IconCheck className="w-3.5 h-3.5" />
              <span>{st.upToDateBadge}</span>
            </span>
            {!compact && safeReleaseUrl && (
              <a
                href={safeReleaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center min-h-7 py-1 font-semibold text-link-ink no-underline hover:underline"
              >
                {st.viewReleaseLink}
              </a>
            )}
          </>
        );
      })()}
    </span>
  );
}
