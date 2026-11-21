/*
 * WordPress Gutenberg / Canva-Inspired Collapsible Article Info Inspector (`信息栏`).
 * Cleanly separated from the Editor Toolbar (`工具栏`) and Writing Canvas (`编辑区`).
 */

import type { FormEvent } from 'react';
import { UI_COPY } from '../../lib/i18n';
import { RC3_COPY } from '../../lib/i18nRc3';
import { ALL_LICENSE_OPTIONS, normalizeLicenseId } from '../../lib/licenses';
import type {
  ArticleAuthorDto,
  CollaboratorInviteDto,
  LicenseId,
  LocaleCode,
  SiteSettingsDto,
} from '../../lib/types';
import { IconClose, IconCopy } from '../ui/Icons';
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
  const rc3 = RC3_COPY[locale];

  const parsedTags = docTagsText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <aside
      aria-label={rc3.studio.editorInspectorTitle}
      className="studio-editor-inspector studio-panel studio-scroll-pane overflow-hidden"
    >
      {/* Inspector Header */}
      <div className="px-4 py-3 border-b border-border-subtle bg-surface-raised/50 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-secondary m-0">
          {rc3.studio.editorInspectorTitle}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={rc3.studio.editorCloseInspectorAria}
          title={rc3.studio.editorCloseInspectorAria}
          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-sheet cursor-pointer transition-colors"
        >
          <IconClose className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="divide-y divide-border-subtle">
        {/* Section 1: Publishing Status & Auto Metrics */}
        <section className="p-4 space-y-3">
          <h3 className="text-xs font-semibold text-ink-secondary m-0">
            {rc3.studio.editorStatusSection}
          </h3>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-surface-raised border border-border-subtle space-y-1">
              <div className="text-ink-muted">{rc3.users.colStatus}</div>
              <span
                className="inline-flex px-2 py-0.5 rounded font-semibold"
                style={
                  docStatus === 'published'
                    ? {
                        backgroundColor: 'var(--alert-mint-badge-bg)',
                        color: 'var(--alert-mint-badge-fg)',
                      }
                    : {
                        backgroundColor: 'var(--alert-note-badge-bg)',
                        color: 'var(--alert-note-badge-fg)',
                      }
                }
              >
                {docStatus === 'published'
                  ? rc3.studio.editorStatusPublished
                  : rc3.studio.editorStatusDraft}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-surface-raised border border-border-subtle space-y-1">
              <div className="text-ink-muted">
                {s.canonicalRevMeta(docCanonicalRev)}
              </div>
              <div className="font-mono font-semibold text-ink-primary tabular-nums">
                {rc3.studio.autoVersionBadge(docVersion)}
              </div>
            </div>
          </div>

          <div className="px-2.5 py-2 rounded-xl bg-surface-raised border border-border-subtle flex items-baseline justify-between gap-2 text-xs">
            <span className="text-ink-muted truncate" title={`${trackTitle} / ${chapterTitle}`}>
              {trackTitle ? `${trackTitle} / ${chapterTitle}` : stepSlug}
            </span>
            <span className="font-mono text-ink-secondary tabular-nums shrink-0">
              {rc3.studio.autoReadMinutesBadge(docMinutes)}
            </span>
          </div>
        </section>

        {/* Section 2: Article Metadata */}
        <section className="p-4 space-y-3.5">
          <h3 className="text-xs font-semibold text-ink-secondary m-0">
            {rc3.studio.editorMetaSection}
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
                    copy.licenseNames[
                      normalizeLicenseId(siteSettings.default_license) ||
                        'cc-by-nc-sa-4.0'
                    ],
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
              <label htmlFor="doc-stepnum-input" className="ink-field-label m-0">
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
              <h3 className="text-xs font-semibold text-ink-secondary m-0">
                {rc3.studio.collabSectionTitle}
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
                      <span
                        className="px-1.5 py-0.5 rounded text-xs font-mono"
                        style={
                          author.is_owner
                            ? {
                                backgroundColor: 'var(--alert-note-badge-bg)',
                                color: 'var(--alert-note-badge-fg)',
                              }
                            : {
                                backgroundColor: 'var(--surface-sheet)',
                                color: 'var(--ink-muted)',
                              }
                        }
                      >
                        {author.is_owner
                          ? rc3.studio.ownerBadge
                          : rc3.studio.coAuthorBadge}
                      </span>
                      {canManageCollaborators &&
                        !author.is_owner &&
                        author.user_id && (
                          <button
                            type="button"
                            onClick={() => onRemoveCollaborator(author.user_id!)}
                            className="text-xs font-semibold text-accent-danger hover:underline cursor-pointer"
                          >
                            {rc3.studio.removeCollaboratorBtn}
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
                  onSubmit={onInviteCollaborator}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => onChangeInviteEmail(e.target.value)}
                    placeholder={rc3.studio.inviteEmailPlaceholder}
                    className="ink-field-input flex-1 min-w-0 text-xs py-1.5"
                  />
                  <button
                    type="submit"
                    disabled={inviting}
                    className="min-h-8 px-2.5 py-1 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-60 shrink-0"
                  >
                    {inviting ? rc3.studio.invitingBtn : rc3.studio.inviteBtn}
                  </button>
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
                      <span>{rc3.studio.copyInviteLinkBtn}</span>
                    </button>
                  </div>
                )}

                {docPendingInvites.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-ink-muted">
                      {rc3.studio.pendingInvitesLabel}
                    </div>
                    <ul className="m-0 p-0 list-none space-y-1">
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
                            {rc3.studio.revokeInviteBtn}
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
