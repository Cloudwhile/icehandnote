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
  DiffLineDto,
  LocaleCode,
  RevisionDiffDto,
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
  const [viewMode, setViewMode] = useState<'snapshot' | 'diff'>('snapshot');
  const [loading, setLoading] = useState(false);
  const [revisions, setRevisions] = useState<StepRevisionDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<CollaborationAuditLogDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<
    Record<string, { status: 'ok'; diff: RevisionDiffDto } | { status: 'error' }>
  >({});
  const [loadingDiffId, setLoadingDiffId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !trackSlug || !stepSlug) return;
    let active = true;
    setLoading(true);
    setDiffCache({});
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

  useEffect(() => {
    if (!open || viewMode !== 'diff' || !selectedRev) return;
    const targetId = selectedRev.id;
    if (Object.prototype.hasOwnProperty.call(diffCache, targetId)) return;
    let active = true;
    setLoadingDiffId(targetId);
    void api
      .getStepRevisionDiff(trackSlug, chapterSlug, stepSlug, editLocale, targetId)
      .then((diff) => {
        if (active) {
          setDiffCache((prev) => ({ ...prev, [targetId]: { status: 'ok', diff } }));
        }
      })
      .catch((err) => {
        if (active) {
          toast.error(err);
          setDiffCache((prev) => ({ ...prev, [targetId]: { status: 'error' } }));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingDiffId((prev) => (prev === targetId ? null : prev));
        }
      });
    return () => {
      active = false;
    };
  }, [
    open,
    viewMode,
    selectedRev,
    diffCache,
    trackSlug,
    chapterSlug,
    stepSlug,
    editLocale,
    toast,
  ]);

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
          closeLabel={ui.closeLabel}
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
            <div className="h-16 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
            <div className="h-32 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
          </div>
        ) : tab === 'revisions' ? (
          revisions.length === 0 ? (
            <div className="py-10 px-4 text-center rounded-xl border border-dashed border-border-subtle bg-surface-raised/60 text-xs text-ink-muted">
              {c.noRevisionsYet}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-3 md:max-h-[58dvh]">
              {/* Left revision timeline list */}
              <div className="max-h-52 md:max-h-none overflow-y-auto ink-thin-scrollbar space-y-1.5 pe-1">
                {revisions.map((rev, idx) => {
                  const isSelected = selectedRev?.id === rev.id;
                  const isLatest = idx === 0;
                  return (
                    <button
                      key={rev.id}
                      type="button"
                      aria-current={isSelected ? 'true' : undefined}
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
                      <div className="text-xs text-ink-muted truncate">
                        {rev.author_name} · {rev.created_at.slice(0, 16).replace('T', ' ')}
                      </div>
                      {rev.change_note && (
                        <div className="text-xs text-ink-secondary truncate">
                          {rev.change_note}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right snapshot detail & diff */}
              {selectedRev && (
                <div className="rounded-xl border border-border-subtle bg-surface-raised p-3.5 flex flex-col gap-3 min-h-0 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border-subtle">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink-primary truncate">
                        {selectedRev.title}
                      </div>
                      <div className="text-xs font-mono text-ink-muted">
                        #{selectedRev.edit_seq} · sha256:{selectedRev.content_sha256.slice(0, 10)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <UnderlineTabs
                        variant="segmented"
                        ariaLabel={c.historyTitle}
                        value={viewMode}
                        onChange={setViewMode}
                        items={[
                          { value: 'snapshot', label: c.snapshotViewTab },
                          { value: 'diff', label: c.diffViewTab },
                        ]}
                      />
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
                  </div>
                  {viewMode === 'snapshot' ? (
                    <pre className="m-0 flex-1 overflow-y-auto ink-thin-scrollbar text-xs font-mono text-ink-secondary whitespace-pre-wrap break-words bg-surface-sheet rounded-lg p-3 border border-border-subtle">
                      {selectedRev.body_markdown}
                    </pre>
                  ) : loadingDiffId === selectedRev.id ? (
                    <div className="py-8 text-center text-xs text-ink-muted">
                      {c.diffLoading}
                    </div>
                  ) : (() => {
                    const cached = diffCache[selectedRev.id];
                    if (!cached) {
                      return (
                        <div className="py-8 text-center text-xs text-ink-muted">
                          {c.diffLoading}
                        </div>
                      );
                    }
                    if (cached.status === 'error') {
                      return (
                        <div className="py-8 text-center space-y-2.5 bg-surface-sheet rounded-lg border border-border-subtle">
                          <div className="text-xs text-accent-danger font-semibold">
                            {ui.loadErrorTitle}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDiffCache((prev) => {
                                const next = { ...prev };
                                delete next[selectedRev.id];
                                return next;
                              })
                            }
                            className="min-h-8 px-3 py-1 rounded-lg text-xs font-semibold ink-btn-secondary cursor-pointer"
                          >
                            {ui.retryBtn}
                          </button>
                        </div>
                      );
                    }
                    const diff = cached.diff;
                    const hasChanges = diff.additions > 0 || diff.deletions > 0;
                    return (
                      <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono px-1">
                          <span className="text-ink-muted">
                            {c.diffBaselineLabel(diff.base_edit_seq)}
                          </span>
                          <span className="font-semibold tabular-nums text-ink-secondary">
                            {c.diffSummary(diff.additions, diff.deletions)}
                          </span>
                        </div>
                        {!hasChanges ? (
                          <div className="py-8 text-center text-xs text-ink-muted bg-surface-sheet rounded-lg border border-border-subtle">
                            {c.diffEmpty}
                          </div>
                        ) : (
                          <div className="flex-1 overflow-y-auto ink-thin-scrollbar rounded-lg border border-border-subtle bg-surface-sheet font-mono text-xs leading-relaxed">
                            {diff.lines.map((line: DiffLineDto, idx: number) => {
                              const isIns = line.op === 'insert';
                              const isDel = line.op === 'delete';
                              const rowStyle = isIns
                                ? {
                                    backgroundColor: 'var(--inline-bg-emerald)',
                                    color: 'var(--inline-fg-emerald)',
                                  }
                                : isDel
                                  ? {
                                      backgroundColor: 'var(--inline-bg-rose)',
                                      color: 'var(--inline-fg-rose)',
                                    }
                                  : undefined;
                              return (
                                <div
                                  key={`${idx}-${line.op}`}
                                  style={rowStyle}
                                  className="grid grid-cols-[2.75rem_2.75rem_1.25rem_minmax(0,1fr)] gap-1 px-2 py-0.5 border-b border-border-subtle/40 last:border-b-0"
                                >
                                  <span className="text-end tabular-nums select-none">
                                    {line.left_line ?? ''}
                                  </span>
                                  <span className="text-end tabular-nums select-none">
                                    {line.right_line ?? ''}
                                  </span>
                                  <span className="text-center font-bold select-none">
                                    {isIns ? '+' : isDel ? '-' : ' '}
                                  </span>
                                  <span className="whitespace-pre-wrap break-words">
                                    {line.text || ' '}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )
        ) : auditLogs.length === 0 ? (
          <div className="py-10 px-4 text-center rounded-xl border border-dashed border-border-subtle bg-surface-raised/60 text-xs text-ink-muted">
            {c.noAuditLogsYet}
          </div>
        ) : (
          <div className="max-h-[56dvh] overflow-y-auto ink-thin-scrollbar space-y-1.5 pe-1">
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
                <span className="text-xs font-mono text-ink-muted tabular-nums shrink-0">
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
