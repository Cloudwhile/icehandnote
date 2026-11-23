/*
 * WordPress Gutenberg / Canva-Inspired Collapsible Article Info Inspector (`信息栏`).
 * Cleanly separated from the Editor Toolbar (`工具栏`) and Writing Canvas (`编辑区`).
 */

import { type FormEvent, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MAX_EMAIL_LENGTH } from '../../lib/email';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { sanitizeStepSlugDraft } from '../../lib/slugify';
import { normalizeLicenseId } from '../../lib/licenses';
import { CcLicenseSelector } from '../notebook/CcLicenseCard';
import type {
  ArticleAuthorDto,
  CollaboratorInviteDto,
  CollaboratorRole,
  LicenseId,
  LocaleCode,
  SiteSettingsDto,
} from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { FieldErrorText } from '../ui/FormControls';
import { IconClose, IconCopy, IconExternalLink } from '../ui/Icons';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/ToastProvider';
import { UserAvatar } from '../ui/UserAvatar';

interface StudioEditorInspectorProps {
  locale: LocaleCode;
  editLocale: LocaleCode;
  siteSettings: SiteSettingsDto;
  trackSlug: string;
  trackTitle: string;
  chapterTitle: string;
  stepSlug: string;
  draftStepSlug: string;
  canOpenPublishedPage: boolean;
  suggestedSlug?: string;
  onApplySuggestedSlug?: () => void;
  onChangeStepSlug: (val: string) => void;
  onCommitStepSlug: (cleanSlug: string) => void;
  docExists: boolean;
  docStatus: 'published' | 'draft';
  docVersion: number;
  docMinutes: number;
  docCanonicalRev: number;
  docTitle: string;
  onChangeTitle: (val: string) => void;
  docSummary: string;
  onChangeSummary: (val: string) => void;
  docStepNum: number;
  onChangeStepNum: (val: number) => void;
  docLicense: LicenseId | '';
  onChangeLicense: (val: LicenseId | '') => void;
  docTagsText: string;
  onChangeTagsText: (val: string) => void;
  docAuthors: ArticleAuthorDto[];
  docPendingInvites: CollaboratorInviteDto[];
  canManageCollaborators: boolean;
  canLeave?: boolean;
  inviteEmail: string;
  onChangeInviteEmail: (val: string) => void;
  inviteRole: CollaboratorRole;
  onChangeInviteRole: (val: CollaboratorRole) => void;
  inviting: boolean;
  lastInviteUrl: string;
  onInviteCollaborator: (e: FormEvent) => void;
  onCopyInviteLink: () => void;
  onRevokeInvite: (inviteId: string) => void;
  onRemoveCollaborator: (userId: string) => void;
  onUpdateCollaboratorRole: (userId: string, role: CollaboratorRole) => void;
  onTransferOwnership: (author: ArticleAuthorDto) => void;
  onLeaveCollaboration: () => void;
  onOpenHistory: () => void;
  onClose: () => void;
}

export function StudioEditorInspector({
  locale,
  editLocale,
  siteSettings,
  trackSlug,
  trackTitle,
  chapterTitle,
  stepSlug,
  draftStepSlug,
  canOpenPublishedPage,
  suggestedSlug,
  onApplySuggestedSlug,
  onChangeStepSlug,
  onCommitStepSlug,
  docExists,
  docStatus,
  docVersion,
  docMinutes,
  docCanonicalRev,
  docTitle,
  onChangeTitle,
  docSummary,
  onChangeSummary,
  docStepNum,
  onChangeStepNum,
  docLicense,
  onChangeLicense,
  docTagsText,
  onChangeTagsText,
  docAuthors,
  docPendingInvites,
  canManageCollaborators,
  canLeave = false,
  inviteEmail,
  onChangeInviteEmail,
  inviteRole,
  onChangeInviteRole,
  inviting,
  lastInviteUrl,
  onInviteCollaborator,
  onCopyInviteLink,
  onRevokeInvite,
  onRemoveCollaborator,
  onUpdateCollaboratorRole,
  onTransferOwnership,
  onLeaveCollaboration,
  onOpenHistory,
  onClose,
}: StudioEditorInspectorProps) {
  const copy = UI_COPY[locale];
  const s = copy.studio;
  const extCopy = EXT_COPY[locale];
  const toast = useToast();
  const inviteFormRef = useRef<HTMLFormElement | null>(null);
  const slugInputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurCommitRef = useRef(false);

  const parsedTags = docTagsText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  useAccessibleFormValidation(inviteFormRef, [docExists, canManageCollaborators]);

  return (
    <aside
      aria-label={extCopy.studio.editorInspectorTitle}
      className="studio-editor-inspector studio-panel overflow-hidden"
    >
      {/* Inspector Header */}
      <div className="px-4 py-3 border-b border-border-subtle bg-surface-raised/50 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-secondary m-0">
          {extCopy.studio.editorInspectorTitle}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={extCopy.studio.editorCloseInspectorAria}
          title={extCopy.studio.editorCloseInspectorAria}
          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-sheet cursor-pointer transition-colors"
        >
          <IconClose className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="divide-y divide-border-subtle">
        {/* Section 1: Publishing Status & Auto Metrics */}
        <section className="p-4 space-y-3">
          <h3 className="text-xs font-semibold text-ink-secondary">
            {extCopy.studio.editorStatusSection}
          </h3>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-surface-raised border border-border-subtle space-y-1">
              <div className="text-ink-muted">{extCopy.users.colStatus}</div>
              <StatusBadge tone={docStatus === 'published' ? 'success' : 'info'}>
                {docStatus === 'published'
                  ? extCopy.studio.editorStatusPublished
                  : extCopy.studio.editorStatusDraft}
              </StatusBadge>
            </div>

            <div
              className="p-2.5 rounded-xl bg-surface-raised border border-border-subtle space-y-1"
              title={s.editLocaleLabel(docCanonicalRev)}
            >
              <div className="text-ink-muted">
                {s.settings.currentVersionLabel}
              </div>
              <div className="font-mono font-semibold text-ink-primary tabular-nums">
                {extCopy.studio.autoVersionBadge(docVersion)}
              </div>
            </div>
          </div>

          <div className="px-2.5 py-2 rounded-xl bg-surface-raised border border-border-subtle flex items-baseline justify-between gap-2 text-xs">
            <span className="text-ink-muted truncate" title={`${trackTitle} / ${chapterTitle}`}>
              {trackTitle ? `${trackTitle} / ${chapterTitle}` : stepSlug}
            </span>
            <span className="font-mono text-ink-secondary tabular-nums shrink-0">
              {extCopy.studio.autoReadMinutesBadge(docMinutes)}
            </span>
          </div>
        </section>

        {/* Section 2: Article Metadata */}
        <section className="p-4 space-y-3.5">
          <h3 className="text-xs font-semibold text-ink-secondary">
            {extCopy.studio.editorMetaSection}
          </h3>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label
                htmlFor="doc-url-slug-input"
                className="ink-field-label mb-0!"
              >
                {extCopy.studio.publishedUrl.label}
              </label>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const origin =
                      typeof window !== 'undefined' ? window.location.origin : '';
                    const slugVal = (draftStepSlug || stepSlug).trim();
                    const fullUrl = `${origin}/${editLocale}/series/${trackSlug}/${slugVal}`;
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard
                        .writeText(fullUrl)
                        .then(() => toast.success(extCopy.reader.copiedUrlToast))
                        .catch((err) => toast.error(err));
                    } else {
                      toast.error('BAD_REQUEST');
                    }
                  }}
                  aria-label={extCopy.studio.publishedUrl.copyUrlBtn}
                  title={extCopy.studio.publishedUrl.copyUrlBtn}
                  className="min-h-6 px-2 py-0.5 rounded-lg border border-border-subtle bg-surface-raised hover:border-border-ink text-xs font-semibold text-ink-secondary inline-flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <IconCopy className="w-3.5 h-3.5" />
                  <span>{extCopy.studio.publishedUrl.copyUrlBtn}</span>
                </button>

                {canOpenPublishedPage ? (
                  <Link
                    data-testid="studio-open-published-link"
                    to={`/${editLocale}/series/${trackSlug}/${stepSlug}`}
                    className="min-h-6 px-2 py-0.5 rounded-lg border border-border-subtle bg-action-subtle/70 hover:border-link-ink text-xs font-semibold text-link-ink inline-flex items-center gap-1 transition-colors"
                  >
                    <IconExternalLink className="w-3.5 h-3.5" />
                    <span>{extCopy.studio.publishedUrl.openUrlBtn}</span>
                  </Link>
                ) : (
                  <span
                    data-testid="studio-unpublished-url-badge"
                    className="px-2 py-0.5 rounded-lg bg-surface-raised border border-border-subtle text-xs text-ink-muted"
                  >
                    {extCopy.studio.publishedUrl.unpublishedHint}
                  </span>
                )}
              </div>
            </div>

            <div
              data-testid="inspector-url-slug-shell"
              onClick={() => slugInputRef.current?.focus()}
              className="ink-url-slug-shell"
            >
              <span className="text-xs font-mono text-ink-muted truncate">
                /{editLocale}/series/{trackSlug}/
              </span>
              <input
                ref={slugInputRef}
                id="doc-url-slug-input"
                type="text"
                data-testid="studio-url-slug-input"
                value={draftStepSlug}
                onChange={(e) =>
                  onChangeStepSlug(sanitizeStepSlugDraft(e.target.value))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    skipBlurCommitRef.current = true;
                    onChangeStepSlug(stepSlug);
                    e.currentTarget.blur();
                  }
                }}
                onBlur={() => {
                  if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                    return;
                  }
                  const clean = sanitizeStepSlugDraft(draftStepSlug).replace(
                    /^-+|-+$/g,
                    '',
                  );
                  if (!clean || clean === '-') {
                    onChangeStepSlug(stepSlug);
                    return;
                  }
                  onCommitStepSlug(clean);
                }}
                placeholder={extCopy.studio.publishedUrl.slugPlaceholder}
                className="ink-url-slug-field w-full font-mono text-xs font-semibold text-link-ink"
              />
            </div>

            {suggestedSlug && onApplySuggestedSlug && (
              <button
                type="button"
                data-testid="studio-apply-title-slug-btn"
                onClick={onApplySuggestedSlug}
                className="mt-1.5 min-h-7 px-2.5 py-0.5 rounded-lg border border-border-subtle bg-action-subtle/60 hover:border-link-ink text-xs font-semibold text-link-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>
                  {extCopy.studio.publishedUrl.applySuggestedSlug(suggestedSlug)}
                </span>
              </button>
            )}
          </div>

          <div>
            <label htmlFor="doc-title-input" className="ink-field-label">
              {s.titleInputLabel}
            </label>
            <input
              id="doc-title-input"
              type="text"
              value={docTitle}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder={s.titleInputPlaceholder}
              className="ink-field-input text-xs sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="doc-summary-input" className="ink-field-label">
              {s.summaryInputLabel}
            </label>
            <textarea
              id="doc-summary-input"
              rows={3}
              value={docSummary}
              onChange={(e) => onChangeSummary(e.target.value)}
              placeholder={s.summaryInputPlaceholder}
              className="ink-field-input text-xs leading-relaxed resize-y"
            />
          </div>

          <div className="space-y-3">
            <div>
              <span className="ink-field-label block mb-2">
                {s.licenseSelectLabel}
              </span>
              <CcLicenseSelector
                locale={locale}
                value={docLicense}
                onChange={(id) => onChangeLicense(normalizeLicenseId(id))}
                allowFollowSite
                siteDefaultLicense={siteSettings.default_license}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label htmlFor="doc-stepnum-input" className="ink-field-label mb-0">
                {s.stepNumLabel}
              </label>
              <input
                id="doc-stepnum-input"
                type="number"
                min={1}
                value={docStepNum}
                onChange={(e) => onChangeStepNum(Number(e.target.value) || 1)}
                className="ink-field-input w-24 text-xs font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label htmlFor="doc-tags-input" className="ink-field-label">
                {s.tagsInputLabel}
              </label>
              <input
                id="doc-tags-input"
                type="text"
                value={docTagsText}
                onChange={(e) => onChangeTagsText(e.target.value)}
                placeholder="rust, guide, notes"
                className="ink-field-input text-xs font-mono"
              />
            </div>
            {parsedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {parsedTags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-xs font-mono bg-surface-raised border border-border-subtle text-ink-secondary"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Section 3: Co-Authors, Roles, Revision History & Collaboration Invites */}
        {docExists && (docAuthors.length > 0 || canManageCollaborators || canLeave) && (
          <section className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-1.5">
                <h3 className="text-xs font-semibold text-ink-secondary">
                  {extCopy.studio.collabSectionTitle}
                </h3>
                <span className="text-xs font-mono text-ink-muted tabular-nums">
                  {docAuthors.length}
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-xs font-semibold text-link-ink hover:text-link-hover-ink cursor-pointer transition-colors"
              >
                {extCopy.collab.historyBtn}
              </button>
            </div>

            {docAuthors.length > 0 && (
              <div className="space-y-1.5">
                {docAuthors.map((author) => {
                  const roleKey = author.is_owner
                    ? 'owner'
                    : author.role === 'translator' || author.role === 'reviewer'
                      ? author.role
                      : 'editor';
                  const roleText = extCopy.collab.roles[roleKey];
                  return (
                    <div
                      key={author.user_id || author.username}
                      className="px-2.5 py-2 rounded-xl bg-surface-raised border border-border-subtle text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar
                            name={author.display_name}
                            avatarUrl={author.avatar_url}
                            sizeClass="w-5 h-5"
                            textClass="text-xs"
                          />
                          <span className="font-semibold text-ink-primary truncate">
                            {author.display_name}
                          </span>
                        </div>
                        <StatusBadge
                          tone={author.is_owner ? 'info' : 'neutral'}
                          mono
                          className="px-1.5 shrink-0"
                        >
                          {roleText}
                        </StatusBadge>
                      </div>

                      {canManageCollaborators &&
                        !author.is_owner &&
                        author.user_id && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-dashed border-border-subtle">
                            <select
                              aria-label={extCopy.collab.inviteRoleLabel}
                              value={roleKey}
                              onChange={(e) =>
                                onUpdateCollaboratorRole(
                                  author.user_id!,
                                  e.target.value as CollaboratorRole,
                                )
                              }
                              className="text-[11px] bg-surface-sheet border border-border-subtle rounded-lg px-1.5 py-0.5 text-ink-secondary cursor-pointer"
                            >
                              <option value="editor">{extCopy.collab.roles.editor}</option>
                              <option value="translator">{extCopy.collab.roles.translator}</option>
                              <option value="reviewer">{extCopy.collab.roles.reviewer}</option>
                            </select>
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => onTransferOwnership(author)}
                                className="text-[11px] font-semibold text-ink-muted hover:text-ink-primary cursor-pointer transition-colors"
                              >
                                {extCopy.collab.transferOwnerBtn}
                              </button>
                              <button
                                type="button"
                                onClick={() => onRemoveCollaborator(author.user_id!)}
                                className="text-[11px] font-semibold text-accent-danger/85 hover:text-accent-danger cursor-pointer transition-colors"
                              >
                                {extCopy.studio.removeCollaboratorBtn}
                              </button>
                            </div>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            )}

            {canLeave && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={onLeaveCollaboration}
                  className="text-xs font-semibold text-accent-danger/85 hover:text-accent-danger cursor-pointer transition-colors"
                >
                  {extCopy.collab.leaveCollabBtn}
                </button>
              </div>
            )}

            {canManageCollaborators && (
              <div className="space-y-2.5 pt-1">
                <form
                  ref={inviteFormRef}
                  onSubmit={onInviteCollaborator}
                  className="auth-field space-y-2"
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      id="collab-invite-email"
                      name="email"
                      type="email"
                      required
                      maxLength={MAX_EMAIL_LENGTH}
                      autoComplete="email"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-error="collab-invite-email-err"
                      data-invalid-message={extCopy.auth.errEmailInvalid}
                      value={inviteEmail}
                      onChange={(e) => onChangeInviteEmail(e.target.value)}
                      placeholder={extCopy.studio.inviteEmailPlaceholder}
                      className="ink-field-input flex-1 min-w-0 text-xs py-1.5"
                    />
                    <select
                      aria-label={extCopy.collab.inviteRoleLabel}
                      value={inviteRole}
                      onChange={(e) =>
                        onChangeInviteRole(e.target.value as CollaboratorRole)
                      }
                      className="min-h-8 text-xs bg-surface-raised border border-border-subtle rounded-xl px-2 py-1 text-ink-secondary cursor-pointer shrink-0"
                    >
                      <option value="editor">{extCopy.collab.roles.editor}</option>
                      <option value="translator">{extCopy.collab.roles.translator}</option>
                      <option value="reviewer">{extCopy.collab.roles.reviewer}</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="w-full min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-60"
                  >
                    {inviting ? extCopy.studio.invitingBtn : extCopy.studio.inviteBtn}
                  </button>
                  <FieldErrorText
                    id="collab-invite-email-err"
                    prefixLabel={extCopy.auth.errorPrefixLabel}
                    message={extCopy.auth.errEmailInvalid}
                  />
                </form>

                {lastInviteUrl && (
                  <div className="p-2 rounded-xl bg-surface-raised border border-border-subtle flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={lastInviteUrl}
                      className="flex-1 min-w-0 bg-transparent text-xs font-mono text-ink-secondary outline-none"
                    />
                    <button
                      type="button"
                      onClick={onCopyInviteLink}
                      className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-link-ink hover:text-link-hover-ink inline-flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
                    >
                      <IconCopy className="w-3.5 h-3.5 text-ink-muted" />
                      <span>{extCopy.studio.copyInviteLinkBtn}</span>
                    </button>
                  </div>
                )}

                {docPendingInvites.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-ink-muted">
                      {extCopy.studio.pendingInvitesLabel}
                    </div>
                    <ul className="p-0 list-none space-y-1">
                      {docPendingInvites.map((inv) => {
                        const invRoleKey =
                          inv.role === 'translator' || inv.role === 'reviewer'
                            ? inv.role
                            : 'editor';
                        return (
                          <li
                            key={inv.id}
                            className="px-2.5 py-1.5 rounded-lg bg-surface-raised flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-ink-secondary studio-ellipsis">
                                {inv.email}
                              </span>
                              <StatusBadge tone="neutral" className="px-1.5 shrink-0">
                                {extCopy.collab.roles[invRoleKey]}
                              </StatusBadge>
                            </div>
                            <button
                              type="button"
                              onClick={() => onRevokeInvite(inv.id)}
                              className="text-xs font-semibold text-accent-danger/85 hover:text-accent-danger cursor-pointer shrink-0 transition-colors"
                            >
                              {extCopy.studio.revokeInviteBtn}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
