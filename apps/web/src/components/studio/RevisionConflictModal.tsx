/*
 * HTTP 412 Precondition Failed Concurrent Edit Conflict Resolution Modal (`RevisionConflictModal`)
 * - Built on native `<ModalDialog>` + `<ModalHeader>`.
 * - Lets collaborator compare local edits against latest server content side-by-side
 *   and either load the server version or re-save with the latest `If-Match` ETag.
 */

import { useId, useMemo, useState } from 'react';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import {
  buildConflictMergedMarkdown,
  computeClientLineDiff,
} from '../../lib/lineDiff';
import type { DiffLineDto, LocaleCode, RevisionConflictMeta } from '../../lib/types';
import { IconAlertTriangle } from '../ui/Icons';
import { ModalDialog, ModalHeader } from '../ui/ModalDialog';
import { UnderlineTabs } from '../ui/Tabs';

interface RevisionConflictModalProps {
  open: boolean;
  locale: LocaleCode;
  conflict: RevisionConflictMeta | null;
  localTitle: string;
  localBody: string;
  resolving: boolean;
  onClose: () => void;
  onAdoptRemote: () => void;
  onOverwriteWithLocal: (currentEtag: string) => void;
  onMergeIntoEditor?: (mergedBody: string, currentEtag: string) => void;
}

export function RevisionConflictModal({
  open,
  locale,
  conflict,
  localTitle,
  localBody,
  resolving,
  onClose,
  onAdoptRemote,
  onOverwriteWithLocal,
  onMergeIntoEditor,
}: RevisionConflictModalProps) {
  const titleId = useId();
  const ui = UI_COPY[locale];
  const c = EXT_COPY[locale].collab;
  const [viewMode, setViewMode] = useState<'split' | 'diff'>('split');

  const diffLines = useMemo(() => {
    if (!conflict) return [];
    return computeClientLineDiff(conflict.remote_body_markdown, localBody);
  }, [conflict, localBody]);

  const diffStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const l of diffLines) {
      if (l.op === 'insert') added++;
      else if (l.op === 'delete') removed++;
    }
    return { added, removed };
  }, [diffLines]);

  if (!conflict) return null;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-4xl"
      stableScrollbarGutter
    >
      <div className="p-5 sm:p-6 space-y-4">
        <ModalHeader
          titleId={titleId}
          title={c.conflictTitle}
          icon={<IconAlertTriangle className="w-5 h-5 text-accent-amber shrink-0" />}
          closeLabel={ui.closeLabel}
          onClose={onClose}
          handFont
          trailing={
            <UnderlineTabs
              variant="segmented"
              ariaLabel={c.conflictTitle}
              value={viewMode}
              onChange={setViewMode}
              items={[
                { value: 'split', label: c.conflictSplitTab },
                { value: 'diff', label: c.conflictDiffTab },
              ]}
            />
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed m-0">
            {c.conflictDesc(conflict.updated_by, conflict.current_edit_seq)}
          </p>
          {viewMode === 'diff' && (
            <span className="text-xs font-mono font-semibold text-ink-muted tabular-nums">
              {c.diffSummary(diffStats.added, diffStats.removed)}
            </span>
          )}
        </div>

        {viewMode === 'split' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border-subtle bg-surface-raised p-3 space-y-2 min-w-0">
              <div className="text-xs font-semibold text-ink-primary">
                {c.localVersionHeading}
              </div>
              <div className="text-xs font-semibold text-ink-secondary truncate">
                {localTitle}
              </div>
              <pre className="m-0 max-h-64 overflow-y-auto ink-thin-scrollbar rounded-lg bg-surface-sheet border border-border-subtle p-2.5 text-xs font-mono text-ink-primary whitespace-pre-wrap break-words">
                {localBody}
              </pre>
            </div>

            <div className="rounded-xl border border-accent-amber/50 bg-surface-raised p-3 space-y-2 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink-primary">
                  {c.remoteVersionHeading}
                </span>
                <span className="text-xs font-mono text-ink-muted tabular-nums">
                  #{conflict.current_edit_seq}
                </span>
              </div>
              <div className="text-xs font-semibold text-ink-secondary truncate">
                {conflict.remote_title}
              </div>
              <pre className="m-0 max-h-64 overflow-y-auto ink-thin-scrollbar rounded-lg bg-surface-sheet border border-border-subtle p-2.5 text-xs font-mono text-ink-primary whitespace-pre-wrap break-words">
                {conflict.remote_body_markdown}
              </pre>
            </div>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto ink-thin-scrollbar rounded-xl border border-border-subtle bg-surface-sheet font-mono text-xs leading-relaxed">
            {diffLines.map((line: DiffLineDto, idx: number) => {
              const isLocalAdded = line.op === 'insert';
              const isRemoteRemoved = line.op === 'delete';
              const rowStyle = isLocalAdded
                ? {
                    backgroundColor: 'var(--inline-bg-emerald)',
                    color: 'var(--inline-fg-emerald)',
                  }
                : isRemoteRemoved
                  ? {
                      backgroundColor: 'var(--inline-bg-rose)',
                      color: 'var(--inline-fg-rose)',
                    }
                  : undefined;
              return (
                <div
                  key={`${idx}-${line.op}`}
                  style={rowStyle}
                  className="grid grid-cols-[2.75rem_2.75rem_1.25rem_minmax(0,1fr)] gap-1 px-2.5 py-0.5 border-b border-border-subtle/40 last:border-b-0"
                >
                  <span className="text-end tabular-nums select-none">
                    {line.left_line ?? ''}
                  </span>
                  <span className="text-end tabular-nums select-none">
                    {line.right_line ?? ''}
                  </span>
                  <span className="text-center font-bold select-none">
                    {isLocalAdded ? '+' : isRemoteRemoved ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {line.text || ' '}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={resolving}
            onClick={onAdoptRemote}
            className="min-h-8 px-3.5 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-50"
          >
            {c.adoptRemoteBtn}
          </button>
          {onMergeIntoEditor && (
            <button
              type="button"
              disabled={resolving}
              onClick={() => {
                const merged = buildConflictMergedMarkdown(
                  localBody,
                  conflict.remote_body_markdown,
                  c.localVersionHeading,
                  `${c.remoteVersionHeading} #${conflict.current_edit_seq}`,
                );
                onMergeIntoEditor(merged, conflict.current_etag);
              }}
              className="min-h-8 px-3.5 py-1.5 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-50"
            >
              {c.mergeMarkersBtn}
            </button>
          )}
          <button
            type="button"
            disabled={resolving}
            onClick={() => onOverwriteWithLocal(conflict.current_etag)}
            className="min-h-8 px-4 py-1.5 rounded-xl text-xs font-semibold bg-surface-sheet border-2 border-accent-danger text-accent-danger hover:bg-danger-bg hover:text-danger-fg cursor-pointer disabled:opacity-50 transition-colors"
          >
            {c.overwriteWithLocalBtn}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
