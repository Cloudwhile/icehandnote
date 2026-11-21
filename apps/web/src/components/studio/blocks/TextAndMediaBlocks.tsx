/*
 * Text & Media Visual Block Bodies:
 * - `HeadingBlockBody`: `<SegmentedControl>` for H2/H3/H4 + `<SwitchRow>` for section-level checkable task.
 * - `ParagraphBlockBody`: Inline markdown toolbar + auto-growing textarea + `<AuthorMarginNoteInput>`.
 * - `ImageBlockBody`: `<FileUploadButton>` + URL/alt/caption fields + preview + `<AuthorMarginNoteInput>`.
 * - `QuoteBlockBody` & `RawMarkdownBlockBody`.
 */

import { useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { LocaleCode } from '../../../lib/types';
import type { VisualBlock } from '../../../lib/visualBlocks';
import { FileUploadButton } from '../../ui/FileUploadButton';
import { SwitchRow } from '../../ui/FormControls';
import { SegmentedControl } from '../../ui/Tabs';
import { useToast } from '../../ui/ToastProvider';
import { AuthorMarginNoteInput } from './AuthorMarginNoteInput';

const HEADING_LEVEL_OPTIONS = [
  { value: 2 as const, label: 'H2' },
  { value: 3 as const, label: 'H3' },
  { value: 4 as const, label: 'H4' },
];

export function HeadingBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'heading' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'heading' }>) => void;
}) {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
        <SegmentedControl
          options={HEADING_LEVEL_OPTIONS}
          value={block.level}
          onChange={(lvl) => onUpdate({ ...block, level: lvl })}
          ariaLabel={v.types.heading}
          surface="sheet"
          className="font-mono shrink-0"
        />
        <input
          type="text"
          value={block.text}
          onChange={(e) => onUpdate({ ...block, text: e.target.value })}
          placeholder={v.headingPlaceholder}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
        />
      </div>

      <div className="flex items-center px-3 py-2 rounded-xl bg-surface-sheet border border-border-subtle">
        <SwitchRow
          variant="inline"
          labelPosition="end"
          checked={Boolean(block.isTask)}
          onChange={(checked) =>
            onUpdate({
              ...block,
              isTask: checked,
              defaultChecked: checked ? Boolean(block.defaultChecked) : false,
            })
          }
          label={
            <span className="font-semibold text-ink-primary">
              {copy.sectionTaskToggleLabel}
            </span>
          }
        />
      </div>
    </div>
  );
}

export function ParagraphBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'paragraph' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'paragraph' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const wrapSelection = (before: string, after: string, fallback: string) => {
    const el = textareaRef.current;
    if (!el) {
      onUpdate({ ...block, text: `${block.text}${before}${fallback}${after}` });
      return;
    }
    const start = el.selectionStart ?? block.text.length;
    const end = el.selectionEnd ?? block.text.length;
    const selected = block.text.slice(start, end) || fallback;
    const nextText =
      block.text.slice(0, start) +
      before +
      selected +
      after +
      block.text.slice(end);
    onUpdate({ ...block, text: nextText });
    requestAnimationFrame(() => {
      el.focus();
      const selStart = start + before.length;
      el.setSelectionRange(selStart, selStart + selected.length);
    });
  };

  const rows = Math.min(10, Math.max(3, block.text.split('\n').length + 1));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => wrapSelection('**', '**', 'text')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtBold}
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('*', '*', 'text')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs italic bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtItalic}
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('`', '`', 'code')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-mono bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtCode}
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('[', '](https://)', 'label')}
          className="min-h-7 px-2 py-0.5 rounded-lg text-xs bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary hover:text-ink-primary cursor-pointer"
        >
          {v.fmtLink}
        </button>
      </div>

      <textarea
        ref={textareaRef}
        rows={rows}
        value={block.text}
        onChange={(e) => onUpdate({ ...block, text: e.target.value })}
        placeholder={v.paragraphPlaceholder}
        className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle focus:border-border-ink text-sm leading-relaxed ink-input-inset ink-auto-textarea"
      />

      <AuthorMarginNoteInput
        locale={locale}
        rawValue={block.marginNote}
        onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
      />
    </div>
  );
}

export function ImageBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'image' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'image' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;
  const extStudio = EXT_COPY[locale].studio;
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  const handleSelectFile = async (file: File) => {
    if (uploading) return;
    setUploading(true);
    try {
      const uploaded = await api.uploadStudioMedia(file);
      onUpdate({
        ...block,
        src: uploaded.url,
        alt: block.alt || file.name.replace(/\.[^.]+$/, ''),
      });
      toast.success(extStudio.imageUploadedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileUploadButton
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon,image/svg+xml"
          uploading={uploading}
          label={v.imageUploadBtn}
          uploadingLabel={v.imageUploading}
          onSelectFile={(file) => void handleSelectFile(file)}
        />

        <input
          type="text"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          aria-label={v.imageUrlLabel}
          value={block.src}
          onChange={(e) => onUpdate({ ...block, src: e.target.value })}
          placeholder={v.imageUrlPlaceholder}
          className="flex-1 min-w-44 px-3 py-1.5 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          type="text"
          aria-label={v.imageAltLabel}
          value={block.alt}
          onChange={(e) => onUpdate({ ...block, alt: e.target.value })}
          placeholder={v.imageAltLabel}
          className="w-full px-3 py-1.5 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-xs"
        />
        <input
          type="text"
          aria-label={v.imageCaptionLabel}
          value={block.caption}
          onChange={(e) => onUpdate({ ...block, caption: e.target.value })}
          placeholder={v.imageCaptionLabel}
          className="w-full px-3 py-1.5 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-xs"
        />
      </div>

      {block.src.trim() && (
        <div className="rounded-xl overflow-hidden border border-border-subtle bg-surface-sunken p-2">
          <img
            src={block.src}
            alt={block.alt}
            loading="lazy"
            className="max-h-48 mx-auto rounded-lg object-contain"
          />
        </div>
      )}

      <AuthorMarginNoteInput
        locale={locale}
        rawValue={block.marginNote}
        onChange={(nextRaw) => onUpdate({ ...block, marginNote: nextRaw })}
      />
    </div>
  );
}

export function QuoteBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'quote' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'quote' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;
  return (
    <textarea
      rows={Math.min(8, Math.max(2, block.text.split('\n').length + 1))}
      value={block.text}
      onChange={(e) => onUpdate({ ...block, text: e.target.value })}
      placeholder={v.quotePlaceholder}
      className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm leading-relaxed ink-input-inset ink-auto-textarea"
      style={{ borderInlineStart: '4px solid var(--marker-h1)' }}
    />
  );
}

export function RawMarkdownBlockBody({
  block,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'raw_markdown' }>;
  onUpdate: (next: Extract<VisualBlock, { type: 'raw_markdown' }>) => void;
}) {
  return (
    <textarea
      rows={Math.min(12, Math.max(4, block.content.split('\n').length + 1))}
      value={block.content}
      onChange={(e) => onUpdate({ ...block, content: e.target.value })}
      spellCheck={false}
      className="w-full p-3 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle font-mono text-xs leading-relaxed ink-input-inset"
    />
  );
}
