/*
 * Two-Step Safe Collaboration Invitation Confirmation Modal (`CollabInviteModal`)
 * - Built on native `<ModalDialog>` (`showModal()`, `closedby="any"`, `overscroll-behavior: contain`).
 * - Calls non-consuming `POST /api/v1/studio/invites/preview` first so email scanners / accidental clicks
 *   never silently burn one-time tokens, and verifies email binding before `POST /api/v1/studio/invites/accept`.
 */

import { useEffect, useId, useState } from 'react';
import { api } from '../../lib/api';
import { resolveLocalizedError } from '../../lib/apiError';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { stripHtmlTags } from '../../lib/sanitizer';
import type {
  InvitePreviewDto,
  LocaleCode,
  UserProfileDto,
} from '../../lib/types';
import { IconAlertTriangle, IconShield } from '../ui/Icons';
import { ModalDialog, ModalHeader } from '../ui/ModalDialog';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/ToastProvider';

interface CollabInviteModalProps {
  open: boolean;
  token: string;
  locale: LocaleCode;
  user: UserProfileDto | null;
  onClose: () => void;
  onRequireSignIn: () => void;
  onAccepted: (res: {
    track_slug: string;
    chapter_slug: string;
    step_slug: string;
    user?: UserProfileDto | null;
  }) => void;
}

export function CollabInviteModal({
  open,
  token,
  locale,
  user,
  onClose,
  onRequireSignIn,
  onAccepted,
}: CollabInviteModalProps) {
  const titleId = useId();
  const toast = useToast();
  const ui = UI_COPY[locale];
  const ext = EXT_COPY[locale];
  const c = ext.collab;

  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [preview, setPreview] = useState<InvitePreviewDto | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    setLoading(true);
    setErrorMsg('');
    setPreview(null);
    void api
      .previewCollaboratorInvite(token)
      .then((dto) => {
        if (active) setPreview(dto);
      })
      .catch((err) => {
        if (active) setErrorMsg(resolveLocalizedError(err, locale));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, token, user?.id, locale]);

  const roleLabel = (role: string) => {
    if (role === 'translator') return c.roles.translator;
    if (role === 'reviewer') return c.roles.reviewer;
    return c.roles.editor;
  };

  const handleAccept = async () => {
    if (accepting || !token) return;
    setAccepting(true);
    try {
      const res = await api.acceptCollaboratorInvite(token);
      toast.success(ext.auth.collabAcceptedMsg);
      onAccepted(res);
    } catch (err) {
      toast.error(err);
    } finally {
      setAccepting(false);
    }
  };

  const emailMismatch =
    Boolean(user) && preview?.email_matches_viewer === false;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-md"
    >
      <div className="p-5 sm:p-6 space-y-4">
        <ModalHeader
          titleId={titleId}
          title={c.inviteModalTitle}
          icon={<IconShield className="w-5 h-5 text-link-ink shrink-0" />}
          closeLabel={ui.closeLabel}
          onClose={onClose}
          handFont
        />

        {loading ? (
          <div className="space-y-2.5 py-2" aria-busy="true">
            <div className="h-12 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
            <div className="h-20 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-xl border border-accent-danger/40 bg-surface-raised p-4 space-y-2">
            <p className="text-sm text-accent-danger font-semibold m-0">
              {errorMsg}
            </p>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer"
              >
                {c.inviteDeclineBtn}
              </button>
            </div>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <dl className="rounded-xl border border-border-subtle bg-surface-raised p-3.5 space-y-2.5 text-xs m-0">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted shrink-0">{c.inviteArticleLabel}</dt>
                <dd className="font-semibold text-ink-primary text-end m-0 break-words">
                  {stripHtmlTags(preview.article_title)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted shrink-0">{c.inviteByLabel}</dt>
                <dd className="text-ink-primary font-medium m-0">
                  {preview.invited_by_name}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted shrink-0">{c.inviteRoleGrantLabel}</dt>
                <dd className="m-0">
                  <StatusBadge tone="info" mono className="px-2">
                    {roleLabel(preview.role)}
                  </StatusBadge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted shrink-0">{c.inviteEmailTargetLabel}</dt>
                <dd className="font-mono text-ink-secondary m-0">
                  {preview.masked_email}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted shrink-0">{c.inviteExpiresLabel}</dt>
                <dd className="font-mono text-ink-muted tabular-nums m-0">
                  {preview.expires_at.slice(0, 10)}
                </dd>
              </div>
            </dl>

            {!user ? (
              <div className="space-y-3">
                <p className="text-xs text-ink-secondary leading-relaxed m-0">
                  {c.inviteSignInPrompt}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-8 px-3 py-1.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                  >
                    {c.inviteDeclineBtn}
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={onRequireSignIn}
                    className="min-h-8 px-4 py-1.5 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
                  >
                    {c.inviteSignInBtn}
                  </button>
                </div>
              </div>
            ) : emailMismatch ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-accent-amber/60 bg-surface-raised p-3 flex items-start gap-2.5 text-xs text-ink-primary">
                  <IconAlertTriangle className="w-4 h-4 text-accent-amber shrink-0 mt-0.5" />
                  <p className="m-0 leading-relaxed">
                    {c.inviteEmailMismatchWarning(preview.masked_email)}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-8 px-3 py-1.5 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer"
                  >
                    {c.inviteDeclineBtn}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-8 px-3 py-1.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                >
                  {c.inviteDeclineBtn}
                </button>
                <button
                  type="button"
                  autoFocus
                  disabled={accepting}
                  onClick={() => void handleAccept()}
                  className="min-h-8 px-4 py-1.5 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
                >
                  {accepting ? c.inviteAcceptingBtn : c.inviteAcceptBtn}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </ModalDialog>
  );
}
