/*
 * Accessible Hidden-Input File Upload Trigger (`modern-web-guidance/forms` §6):
 * - Keeps the real `<input type="file">` in the accessibility tree via `sr-only` (never `display: none`).
 * - Resets `e.target.value = ''` automatically so re-selecting the same file always fires `onSelectFile`.
 */

import { type ChangeEvent, type ReactNode, useRef } from 'react';
import { IconUpload } from './Icons';

export interface FileUploadButtonProps {
  accept: string;
  label: ReactNode;
  uploadingLabel?: ReactNode;
  uploading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  buttonClassName?: string;
  onSelectFile: (file: File) => void;
}

const DEFAULT_BTN_CLASS =
  'min-h-8 px-3 py-1 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0 transition-colors';

export function FileUploadButton({
  accept,
  label,
  uploadingLabel,
  uploading = false,
  disabled = false,
  icon,
  buttonClassName = DEFAULT_BTN_CLASS,
  onSelectFile,
}: FileUploadButtonProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploading || disabled) return;
    onSelectFile(file);
  };

  return (
    <span className="inline-flex shrink-0">
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleChange}
        className="sr-only"
      />
      <button
        type="button"
        disabled={uploading || disabled}
        onClick={() => fileRef.current?.click()}
        className={buttonClassName}
      >
        {icon ?? <IconUpload className="w-3.5 h-3.5 text-ink-muted" />}
        <span>{uploading ? (uploadingLabel ?? label) : label}</span>
      </button>
    </span>
  );
}
