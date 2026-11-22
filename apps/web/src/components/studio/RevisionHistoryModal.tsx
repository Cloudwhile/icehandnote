/*
 * Immutable Revision History & Collaboration Audit Log Modal (`RevisionHistoryModal`)
 * - Built on native `<ModalDialog>` + `<ModalHeader>` + `<UnderlineTabs>`.
 * - Restores historical snapshots safely with RFC 9110 `If-Match` (creates a new monotonic `edit_seq`).
 */

import { useEffect, useId, useState } from 'react';
import { api } from '../../lib/api';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type {
  CollaborationAuditLogDto,
  LocaleCode,
  StepRevisionDto,
  StudioStepEditorDto,
} from '../../lib/types';
import { IconLayers } from '../ui/Icons';
import { ModalDialog, ModalHeader } from '../ui/ModalDialog';
import { StatusBadge } from '../ui/StatusBadge';
import { UnderlineTabs } from '../ui/Tabs';
import { useToast } from '../ui/ToastProvider';

interface RevisionHistoryModalProps {
  open: boolean;
  onClose: () => void;
  locale: LocaleCode;
  trackSlug: string;
  chapterSlug: string;
  stepSlug: string;
  editLocale: LocaleCode;
  currentEtag: string;
  canEdit: boolean;
  onRestored: (saved: StudioStepEditorDto) => void;
}

export function RevisionHistoryModal({
  open,
  onClose,
  locale,
  trackSlug,
  chapterSlug,
  stepSlug,
  editLocale,
  currentEtag,
  canEdit,
  onRestored,
}: RevisionHistoryModalProps) {
  const titleId = useId();
  const toast = useToast();
  const ui = UI_COPY[locale];
  const c = EXT_COPY[locale].collab;

  const [tab, setTab] = useState<'revisions' | 'audit'>('revisions');
  const [loading, setLoading] = useState(false);
  const [revisions, setRevisions] = useState<StepRevisionDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<CollaborationAuditLogDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !trackSlug || !stepSlug) return;
    let active = true;
    setLoading(true);
    void Promise.all([
      api
        .listStepRevisions(trackSlug, chapterSlug, stepSlug, editLocale)
        .catch(() => []),
      api
        .listStepAuditLogs(trackSlug, chapterSlug, stepSlug)
        .catch(() => []),
    ])
      .then(([revs, logs]) => {
        if (!active) return;
        setRevisions(revs);
        setAuditLogs(logs);
        setSelectedId((prev) =>
          prev && revs.some((r) => r.id === prev) ? prev : (revs[0]?.id ?? null),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, trackSlug, chapterSlug, stepSlug, editLocale]);

  const selectedRev =
    revisions.find((r) => r.id === selectedId) ?? revisions[0] ?? null;

  const handleRestore = async (rev: StepRevisionDto) => {
    if (!canEdit || restoringId) return;
    setRestoringId(rev.id);
    try {
      const saved = await api.restoreStepRevision(
        trackSlug,
        chapterSlug,
        stepSlug,
        editLocale,
        rev.id,
        currentEtag || undefined,
      );
      toast.success(c.restoredToast(rev.edit_seq));
      onRestored(saved);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-3xl"
      stableScrollbarGutter
    >
      <div className="p-5 sm:p-6 space-y-4">
        <ModalHeader
          titleId={titleId}
          title={c.historyTitle}
          icon={<IconLayers className="w-5 h-5 text-link-ink shrink-0" />}
          closeLabel={ui.cancelBtn}
          onClose={onClose}
          handFont
          trailing={
            <span className="text-xs font-mono text-ink-muted">
              {editLocale}
            </span>
          }
        />

        <UnderlineTabs
          variant="segmented"
          ariaLabel={c.historyTitle}
          value={tab}
          onChange={setTab}
          items={[
            {
              value: 'revisions',
              label: `${c.revisionsTab} (${revisions.length})`,
            },
            {
              value: 'audit',
              label: `${c.auditTab} (${auditLogs.length})`,
            },
          ]}
        />

        {loading ? (
          <div className="space-y-2.5 py-2">
            <div className="h-16 rounded-xl bg-surface-raised animate-pulse" />
            <div className="h-32 rounded-xl bg-surface-raised animate-pulse" />
          </div>
        ) : tab === 'revisions' ? (
          revisions.length === 0 ? (
            <div className="py-10 px-4 text-center rounded-xl border border-dashed border-border-subtle bg-surface-raised/60 text-xs text-ink-muted">
              {c.noRevisionsYet}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-3 max-h-[58vh]">
              {/* Left revision timeline list */}
              <div className="overflow-y-auto ink-thin-scrollbar space-y-1.5 pe-1">
                {revisions.map((rev, idx) => {
                  const isSelected = selectedRev?.id === rev.id;
                  const isLatest = idx === 0;
                  return (
                    <button
                      key={rev.id}
                      type="button"
                      onClick={() => setSelectedId(rev.id)}
                      className={`w-full text-start p-2.5 rounded-xl border text-xs cursor-pointer transition-colors space-y-1 ${
                        isSelected
                          ? 'bg-action-subtle border-action-bg text-ink-primary'
                          : 'bg-surface-raised border-border-subtle text-ink-secondary hover:text-ink-primary'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono font-semibold tabular-nums">
                          #{rev.edit_seq}
                        </span>
                        <div className="flex items-center gap-1">
                          {isLatest && (
                            <StatusBadge tone="info" className="px-1.5">
                              {c.currentVersionBadge}
                            </StatusBadge>
                          )}
                          <StatusBadge
                            tone={rev.status === 'published' ? 'success' : 'neutral'}
                            className="px-1.5"
                          >
                            {rev.status}
                          </StatusBadge>
                        </div>
                      </div>
                      <div className="text-[11px] text-ink-muted truncate">
                        {rev.author_name} · {rev.created_at.slice(0, 16).replace('T', ' ')}
                      </div>
                      {rev.change_note && (
                        <div className="text-[11px] text-ink-secondary truncate">
                          {rev.change_note}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right snapshot detail & restore */}
              {selectedRev && (
                <div className="rounded-xl border border-border-subtle bg-surface-raised p-3.5 flex flex-col gap-3 min-h-0 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border-subtle">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink-primary truncate">
                        {selectedRev.title}
                      </div>
                      <div className="text-[11px] font-mono text-ink-muted">
                        #{selectedRev.edit_seq} · sha256:{selectedRev.content_sha256.slice(0, 10)}
                      </div>
                    </div>
                    {canEdit && selectedRev.id !== revisions[0]?.id && (
                      <button
                        type="button"
                        disabled={restoringId !== null}
                        onClick={() => void handleRestore(selectedRev)}
                        className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {restoringId === selectedRev.id
                          ? c.restoringBtn
                          : c.restoreBtn}
                      </button>
                    )}
                  </div>
                  <pre className="m-0 flex-1 overflow-y-auto ink-thin-scrollbar text-xs font-mono text-ink-secondary whitespace-pre-wrap break-words bg-surface-sheet rounded-lg p-3 border border-border-subtle">
                    {selectedRev.body_markdown}
                  </pre>
                </div>
              )}
            </div>
          )
        ) : auditLogs.length === 0 ? (
          <div className="py-10 px-4 text-center rounded-xl border border-dashed border-border-subtle bg-surface-raised/60 text-xs text-ink-muted">
            {c.noAuditLogsYet}
          </div>
        ) : (
          <div className="max-h-[56vh] overflow-y-auto ink-thin-scrollbar space-y-1.5 pe-1">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="px-3 py-2 rounded-xl border border-border-subtle bg-surface-raised flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge tone="neutral" mono className="px-1.5 shrink-0">
                    {log.action}
                  </StatusBadge>
                  <span className="font-semibold text-ink-primary shrink-0">
                    {log.actor_name}
                  </span>
                  {log.detail && (
                    <span className="text-ink-secondary truncate">
                      {log.detail}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-mono text-ink-muted tabular-nums shrink-0">
                  {log.created_at.slice(0, 16).replace('T', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
