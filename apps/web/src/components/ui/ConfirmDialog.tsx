/*
 * Reusable Confirmation & Action Modal Dialog (`modern-web-guidance/dialog`):
 * - Supports both pure confirmation prompts (`onConfirm` click) and form-backed prompts (`onSubmit` `<form>`).
 * - Automatically places `autoFocus` on the safe Cancel button when `tone === 'danger'`
 *   so pressing Enter accidentally never triggers a destructive action.
 */

import { type FormEvent, type ReactNode, useId } from 'react';
import { ModalDialog } from './ModalDialog';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  confirmDisabled?: boolean;
  maxWidthClass?: string;
  onConfirm?: () => void;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  busy = false,
  confirmDisabled = false,
  maxWidthClass = 'max-w-sm',
  onConfirm,
  onSubmit,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const isDanger = tone === 'danger';

  const bodyContent = (
    <>
      <h3
        id={titleId}
        className="text-lg font-semibold text-ink-primary"
        style={{ fontFamily: 'var(--font-hand)' }}
      >
        {title}
      </h3>

      {description && (
        <p className="text-xs text-ink-secondary leading-relaxed">
          {description}
        </p>
      )}

      {children}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          autoFocus={isDanger && !children}
          disabled={busy}
          onClick={onClose}
          className="min-h-9 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary hover:underline cursor-pointer disabled:opacity-50"
        >
          {cancelLabel}
        </button>

        <button
          type={onSubmit ? 'submit' : 'button'}
          disabled={busy || confirmDisabled}
          onClick={onSubmit ? undefined : onConfirm}
          className={
            isDanger
              ? 'min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-danger cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
              : 'min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
          }
        >
          {confirmLabel}
        </button>
      </div>
    </>
  );

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      ariaLabelledBy={titleId}
      maxWidthClass={maxWidthClass}
    >
      {onSubmit ? (
        <form onSubmit={onSubmit} className="p-5 flex flex-col gap-4">
          {bodyContent}
        </form>
      ) : (
        <div className="p-5 flex flex-col gap-4">{bodyContent}</div>
      )}
    </ModalDialog>
  );
}
