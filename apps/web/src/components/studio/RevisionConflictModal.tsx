/*
 * HTTP 412 Precondition Failed Concurrent Edit Conflict Resolution Modal (`RevisionConflictModal`)
 * - Built on native `<ModalDialog>` + `<ModalHeader>`.
 * - Lets collaborator compare local edits against latest server content side-by-side
 *   and either load the server version or re-save with the latest `If-Match` ETag.
 */

import { useId } from 'react';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type { LocaleCode, RevisionConflictMeta } from '../../lib/types';
import { IconAlertTriangle } from '../ui/Icons';
import { ModalDialog, ModalHeader } from '../ui/ModalDialog';

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
}: RevisionConflictModalProps) {
  const titleId = useId();
  const ui = UI_COPY[locale];
  const c = EXT_COPY[locale].collab;

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
          closeLabel={ui.cancelBtn}
          onClose={onClose}
          handFont
        />

        <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed m-0">
          {c.conflictDesc(conflict.updated_by, conflict.current_edit_seq)}
        </p>

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
              <span className="text-[11px] font-mono text-ink-muted tabular-nums">
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

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={resolving}
            onClick={onAdoptRemote}
            className="min-h-8 px-3.5 py-1.5 rounded-xl text-xs font-semibold ink-btn-secondary cursor-pointer disabled:opacity-50"
          >
            {c.adoptRemoteBtn}
          </button>
          <button
            type="button"
            disabled={resolving}
            onClick={() => onOverwriteWithLocal(conflict.current_etag)}
            className="min-h-8 px-4 py-1.5 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-50"
          >
            {c.overwriteWithLocalBtn}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
