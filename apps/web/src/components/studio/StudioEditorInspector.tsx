/*
 * WordPress Gutenberg / Canva-Inspired Collapsible Article Info Inspector (`信息栏`).
 * Cleanly separated from the Editor Toolbar (`工具栏`) and Writing Canvas (`编辑区`).
 */

import { type FormEvent, useRef } from 'react';
import { MAX_EMAIL_LENGTH } from '../../lib/email';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import { ALL_LICENSE_OPTIONS, normalizeLicenseId } from '../../lib/licenses';
import type {
  ArticleAuthorDto,
  CollaboratorInviteDto,
  LicenseId,
  LocaleCode,
  SiteSettingsDto,
} from '../../lib/types';
import { useAccessibleFormValidation } from '../../lib/useFormValidation';
import { FieldErrorText } from '../ui/FormControls';
import { IconClose, IconCopy } from '../ui/Icons';
import { StatusBadge } from '../ui/StatusBadge';
import { UserAvatar } from '../ui/UserAvatar';

interface StudioEditorInspectorProps {
  locale: LocaleCode;
  siteSettings: SiteSettingsDto;
  trackTitle: string;
  chapterTitle: string;
  stepSlug: string;
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
  inviteEmail: string;
  onChangeInviteEmail: (val: string) => void;
  inviting: boolean;
  lastInviteUrl: string;
  onInviteCollaborator: (e: FormEvent) => void;
  onCopyInviteLink: () => void;
  onRevokeInvite: (inviteId: string) => void;
  onRemoveCollaborator: (userId: string) => void;
  onClose: () => void;
}

export function StudioEditorInspector({
  locale,
  siteSettings,
  trackTitle,
  chapterTitle,
  stepSlug,
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
  inviteEmail,
  onChangeInviteEmail,
  inviting,
  lastInviteUrl,
  onInviteCollaborator,
  onCopyInviteLink,
  onRevokeInvite,
  onRemoveCollaborator,
  onClose,
}: StudioEditorInspectorProps) {
  const copy = UI_COPY[locale];
  const s = copy.studio;
  const extCopy = EXT_COPY[locale];
  const inviteFormRef = useRef<HTMLFormElement | null>(null);

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
              <label htmlFor="doc-license-select" className="ink-field-label">
                {s.licenseSelectLabel}
              </label>
              <select
                id="doc-license-select"
                name="license"
                value={docLicense}
                onChange={(e) => onChangeLicense(normalizeLicenseId(e.target.value))}
                className="ink-select w-full px-2.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs"
              >
                <option value="">
                  {s.licenseFollowSite(
                    (
                      copy.licenseNames[
                        normalizeLicenseId(siteSettings.default_license) ||
                          'cc-by-nc-sa-4.0'
                      ] || 'CC BY-NC-SA 4.0'
                    ).split(' · ')[0],
                  )}
                </option>
                {ALL_LICENSE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {copy.licenseNames[opt.id]}
                  </option>
                ))}
              </select>
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

        {/* Section 3: Co-Authors & Collaboration Invites */}
        {docExists && (docAuthors.length > 0 || canManageCollaborators) && (
          <section className="p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-ink-secondary">
                {extCopy.studio.collabSectionTitle}
              </h3>
              <span className="text-xs font-mono text-ink-muted tabular-nums">
                {docAuthors.length}
              </span>
            </div>

            {docAuthors.length > 0 && (
              <div className="space-y-1.5">
                {docAuthors.map((author) => (
                  <div
                    key={author.user_id || author.username}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-surface-raised border border-border-subtle text-xs"
                  >
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusBadge
                        tone={author.is_owner ? 'info' : 'neutral'}
                        mono
                        className="px-1.5"
                      >
                        {author.is_owner
                          ? extCopy.studio.ownerBadge
                          : extCopy.studio.coAuthorBadge}
                      </StatusBadge>
                      {canManageCollaborators &&
                        !author.is_owner &&
                        author.user_id && (
                          <button
                            type="button"
                            onClick={() => onRemoveCollaborator(author.user_id!)}
                            className="text-xs font-semibold text-accent-danger hover:underline cursor-pointer"
                          >
                            {extCopy.studio.removeCollaboratorBtn}
                          </button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canManageCollaborators && (
              <div className="space-y-2.5 pt-1">
                <form
                  ref={inviteFormRef}
                  onSubmit={onInviteCollaborator}
                  className="auth-field"
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
                    <button
                      type="submit"
                      disabled={inviting}
                      className="min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-60 shrink-0"
                    >
                      {inviting ? extCopy.studio.invitingBtn : extCopy.studio.inviteBtn}
                    </button>
                  </div>
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
                      className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle inline-flex items-center gap-1 cursor-pointer shrink-0"
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
                      {docPendingInvites.map((inv) => (
                        <li
                          key={inv.id}
                          className="px-2.5 py-1.5 rounded-lg bg-surface-raised flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-mono text-ink-secondary studio-ellipsis">
                            {inv.email}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRevokeInvite(inv.id)}
                            className="text-xs font-semibold text-accent-danger hover:underline cursor-pointer shrink-0"
                          >
                            {extCopy.studio.revokeInviteBtn}
                          </button>
                        </li>
                      ))}
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
