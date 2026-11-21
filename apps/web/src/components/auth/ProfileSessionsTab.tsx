/*
 * Decoupled Active Sessions Tab (`UserProfileModal` Tab: `'sessions'`).
 */

import { useCallback, useEffect, useState } from 'react';
import { api, clearAuthSession } from '../../lib/api';
import { EXT_COPY } from '../../lib/i18n';
import type { LocaleCode, UserSessionDto } from '../../lib/types';
import { IconMonitor, IconSmartphone } from '../ui/Icons';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/ToastProvider';
import { formatAccountTimestamp } from './ProfileSecurityTab';

export interface ProfileSessionsTabProps {
  open: boolean;
  locale: LocaleCode;
  onClose: () => void;
  onCurrentSessionRevoked?: () => void;
}

export function ProfileSessionsTab({
  open,
  locale,
  onClose,
  onCurrentSessionRevoked,
}: ProfileSessionsTabProps) {
  const p = EXT_COPY[locale].profile;
  const toast = useToast();

  const [sessions, setSessions] = useState<UserSessionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listMySessions();
      setSessions(list);
    } catch (err) {
      toast.error(err);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    void loadSessions();
  }, [open, loadSessions]);

  const handleRevokeSession = async (session: UserSessionDto) => {
    if (revokingId) return;
    setRevokingId(session.id);
    try {
      await api.revokeMySession(session.id);
      if (session.is_current) {
        clearAuthSession();
        toast.info(p.sessionRevokedMsg);
        onClose();
        onCurrentSessionRevoked?.();
        return;
      }
      setSessions((prev) => prev.filter((item) => item.id !== session.id));
      toast.success(p.sessionRevokedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOthers = async () => {
    if (revokingOthers) return;
    setRevokingOthers(true);
    try {
      const res = await api.revokeOtherSessions();
      setSessions((prev) => prev.filter((item) => item.is_current));
      toast.success(p.sessionOthersRevokedMsg(res.revoked_count));
    } catch (err) {
      toast.error(err);
    } finally {
      setRevokingOthers(false);
    }
  };

  return (
    <div
      role="tabpanel"
      aria-labelledby="profile-tab-sessions"
      className="mt-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-ink-primary">
            {p.sessionsTitle}
          </h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            {p.sessionsDesc}
          </p>
        </div>
        {sessions.some((s) => !s.is_current) && (
          <button
            type="button"
            disabled={revokingOthers}
            onClick={() => void handleRevokeOthers()}
            className="min-h-8 px-3 py-1 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-accent-danger text-accent-danger cursor-pointer disabled:opacity-60 shrink-0 transition-colors"
          >
            {p.sessionRevokeOthersBtn}
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2.5" aria-busy="true">
          <div className="h-18 rounded-xl bg-surface-raised animate-pulse" />
          <div className="h-18 rounded-xl bg-surface-raised animate-pulse" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="p-5 rounded-xl bg-surface-raised border border-border-subtle text-center text-xs text-ink-muted">
          {p.sessionsEmpty}
        </div>
      ) : (
        <ul className="list-none p-0 space-y-2.5 max-h-80 overflow-y-auto pr-0.5">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="p-3.5 rounded-xl bg-surface-raised border border-border-subtle flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span
                  aria-hidden="true"
                  className="w-9 h-9 rounded-xl bg-surface-sheet border border-border-subtle flex items-center justify-center text-ink-secondary shrink-0 mt-0.5"
                >
                  {session.device_kind === 'mobile' ? (
                    <IconSmartphone className="w-4 h-4" />
                  ) : (
                    <IconMonitor className="w-4 h-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink-primary truncate">
                      {session.device_label}
                    </span>
                    {session.is_current && (
                      <StatusBadge tone="success" pill>
                        {p.sessionCurrentBadge}
                      </StatusBadge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                    <span className="font-mono text-ink-secondary">
                      {p.sessionIpLabel}: {session.ip_address}
                    </span>
                    <span>
                      {p.sessionLastSeenLabel}:{' '}
                      {formatAccountTimestamp(session.last_seen_at, locale)}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted">
                    {p.sessionCreatedLabel}:{' '}
                    {formatAccountTimestamp(session.created_at, locale)}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={revokingId === session.id}
                onClick={() => void handleRevokeSession(session)}
                className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-accent-danger text-ink-secondary hover:text-accent-danger cursor-pointer disabled:opacity-55 shrink-0 transition-colors"
              >
                {p.sessionRevokeBtn}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
