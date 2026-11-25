/*
 * Hand-Drawn Notebook & Drafting-Pad Code Card (`WashiCodeCard`)
 * - Theme-adaptive paper surface (`--code-*` tokens: warm cream drafting grid in Light, dusk blueprint in Dark;
 *   every syntax token >= 5.87:1 WCAG AA in both schemes).
 * - Supports 4 physical stationery sheet styles (`washi` | `spiral` | `index` | `torn`):
 *   - `washi`: Zig-zag torn washi tape + 3 loose-leaf punch holes + 20px graph grid
 *   - `spiral`: Twin-wire top spiral binding rings + 24px horizontal ruled notebook lines aligned per code row
 *   - `index`: Sketched wire paperclip + classic 3x5 index-card double red rule + 20px graph grid
 *   - `torn`: Corner masking tape + serrated hand-torn bottom edge + 20px graph grid
 */

import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  getLanguageDisplayLabel,
  highlightCodeToLines,
} from '../../lib/codeHighlight';
import type { StickerTone } from '../../lib/types';
import { normalizeCodeCardStyle } from '../../lib/visualBlocks';
import { IconCheck, IconCode, IconCopy } from '../ui/Icons';
import {
  PaperclipOrnament,
  SpiralBindingRings,
  STICKER_TONE_TOKENS,
  type StickerToneTokens,
  TornBottomEdge,
  WashiTapeOrnament,
} from './StationeryStickers';

export function WashiCodeFrame({
  style,
  seedKey,
  className = 'my-6',
  headerStart,
  headerEnd,
  children,
}: {
  style?: string | null;
  seedKey: string;
  className?: string;
  headerStart: ReactNode;
  headerEnd: (tapeTokens: StickerToneTokens) => ReactNode;
  children: ReactNode;
}) {
  const sheetStyle = normalizeCodeCardStyle(style);
  const tapePreset = useMemo(() => {
    const idx = hashSeed(seedKey) % WASHI_TAPE_CYCLE.length;
    return WASHI_TAPE_CYCLE[idx];
  }, [seedKey]);
  const tapeTokens = STICKER_TONE_TOKENS[tapePreset.tone];

  return (
    <div
      className={`relative group min-w-0 max-w-full ${className} ${
        sheetStyle === 'washi' || sheetStyle === 'index' ? 'pt-2' : ''
      }`.trim()}
    >
      {sheetStyle === 'washi' && (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 z-10">
          <WashiTapeOrnament
            fill={tapeTokens.badgeBg}
            stroke={tapeTokens.border}
            pattern={tapePreset.pattern}
            tiltDeg={tapePreset.tilt}
          />
        </div>
      )}

      {sheetStyle === 'index' && (
        <div className="pointer-events-none absolute -top-2 end-8 z-10">
          <PaperclipOrnament stroke="var(--accent-ice-ink)" />
        </div>
      )}

      {sheetStyle === 'torn' && (
        <div className="pointer-events-none absolute -top-2 -start-2 z-10">
          <WashiTapeOrnament
            fill={STICKER_TONE_TOKENS.kraft.badgeBg}
            stroke={STICKER_TONE_TOKENS.kraft.border}
            pattern="stripe"
            tiltDeg={-28}
            compact
          />
        </div>
      )}

      <div
        data-code-style={sheetStyle}
        className="washi-code-surface w-full max-w-full min-w-0 overflow-visible"
      >
        {sheetStyle === 'spiral' && <SpiralBindingRings />}

        <div
          className={`washi-code-header flex flex-wrap items-center justify-between gap-2.5 px-3.5 sm:px-4 py-2 ${
            sheetStyle === 'spiral' ? '' : 'rounded-t-[12px]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-36 sm:min-w-0 flex-1">
            {sheetStyle !== 'spiral' && (
              <div
                className="hidden sm:flex items-center gap-1.5 shrink-0"
                aria-hidden="true"
              >
                {[0, 1, 2].map((hole) => (
                  <span
                    key={hole}
                    className="w-2.5 h-2.5 rounded-full border-[1.5px]"
                    style={{
                      backgroundColor: 'var(--surface-page)',
                      borderColor: 'var(--border-ink)',
                    }}
                  />
                ))}
              </div>
            )}
            {headerStart}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {headerEnd(tapeTokens)}
          </div>
        </div>

        <div
          className={`washi-code-body overflow-hidden ${
            sheetStyle === 'torn' ? 'rounded-b-[3px]' : 'rounded-b-[12px]'
          }`}
        >
          {children}

          {sheetStyle === 'torn' && (
            <div
              className="px-0.5 pb-0.5"
              style={{ backgroundColor: 'var(--code-header-bg)' }}
            >
              <TornBottomEdge borderStroke="var(--code-border-subtle)" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface WashiCodeCardProps {
  language: string;
  filename?: string | null;
  code: string;
  style?: string | null;
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel?: string;
}

const WASHI_TAPE_CYCLE: {
  tone: StickerTone;
  pattern: 'stripe' | 'dots' | 'grid';
  tilt: number;
}[] = [
  { tone: 'amber', pattern: 'stripe', tilt: -1.5 },
  { tone: 'ice', pattern: 'grid', tilt: 1.3 },
  { tone: 'mint', pattern: 'dots', tilt: -1.1 },
  { tone: 'violet', pattern: 'stripe', tilt: 1.6 },
];

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

let lastCopyAnnouncement = '';

function legacyCopyText(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const field = Object.assign(document.createElement('textarea'), {
    value: text,
  });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.focus({ preventScroll: true });
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export function WashiCodeCard({
  language,
  filename,
  code,
  style,
  copyLabel,
  copiedLabel,
  copyFailedLabel = 'Copy failed',
}: WashiCodeCardProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [liveStatus, setLiveStatus] = useState('');
  const timerRef = useRef<number | null>(null);

  const sheetStyle = normalizeCodeCardStyle(style);

  const highlightedLines = useMemo(
    () => highlightCodeToLines(code, language),
    [code, language],
  );
  const langLabel = useMemo(() => getLanguageDisplayLabel(language), [language]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    let ok = false;
    if (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      navigator.clipboard?.writeText
    ) {
      try {
        await navigator.clipboard.writeText(code);
        ok = true;
      } catch {
        ok = legacyCopyText(code);
      }
    } else {
      ok = legacyCopyText(code);
    }

    setCopyState(ok ? 'copied' : 'failed');
    let msg = ok ? copiedLabel : copyFailedLabel;
    if (msg === lastCopyAnnouncement) {
      msg += '\u00A0';
    }
    lastCopyAnnouncement = msg;
    setLiveStatus('');
    requestAnimationFrame(() => setLiveStatus(msg));

    timerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      setLiveStatus('');
      timerRef.current = null;
    }, 1800);
  };

  const lineDigits = Math.max(2, String(highlightedLines.length).length);

  return (
    <WashiCodeFrame
      style={sheetStyle}
      seedKey={`${language}:${filename ?? ''}:${code.length}`}
      headerStart={
        filename ? (
          <span
            className="font-hand text-sm sm:text-base font-semibold truncate px-2 py-0.5 rounded-md border border-dashed"
            style={{
              color: 'var(--code-fg)',
              backgroundColor: 'var(--code-bg)',
              borderColor: 'var(--code-border-subtle)',
            }}
          >
            {filename}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex items-center text-ink-muted select-none"
          >
            <IconCode className="w-3.5 h-3.5" />
          </span>
        )
      }
      headerEnd={(tokens) => (
        <>
          <span
            className="px-2 py-0.5 rounded font-mono text-xs font-semibold uppercase tracking-wider border border-dashed select-none"
            style={{
              backgroundColor: tokens.badgeBg,
              borderColor: tokens.border,
              color: tokens.badgeFg,
              transform: 'rotate(-1deg)',
            }}
          >
            {langLabel}
          </span>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className="min-h-7 px-2.5 py-1 rounded-lg font-hand text-xs sm:text-sm font-semibold border-[1.5px] inline-flex items-center gap-1.5 shrink-0 cursor-pointer motion-safe:transition-transform active:translate-x-px active:translate-y-px"
            style={
              copyState === 'copied'
                ? {
                    backgroundColor: 'var(--alert-mint-badge-bg)',
                    borderColor: 'var(--alert-mint-border)',
                    color: 'var(--alert-mint-badge-fg)',
                    boxShadow: '1.5px 1.5px 0 0 var(--alert-mint-border)',
                  }
                : {
                    backgroundColor: 'var(--surface-sheet)',
                    borderColor: 'var(--border-ink)',
                    color: 'var(--ink-primary)',
                    boxShadow: '1.5px 1.5px 0 0 var(--border-ink)',
                  }
            }
          >
            {copyState === 'copied' ? (
              <IconCheck className="w-3.5 h-3.5 shrink-0 text-current" />
            ) : (
              <IconCopy className="w-3.5 h-3.5 shrink-0 text-ink-muted" />
            )}
            <span>
              {copyState === 'copied'
                ? copiedLabel
                : copyState === 'failed'
                  ? copyFailedLabel
                  : copyLabel}
            </span>
          </button>
          <span role="status" className="sr-only">
            {liveStatus}
          </span>
        </>
      )}
    >
      <pre
        tabIndex={0}
        aria-label={filename ? `${langLabel}: ${filename}` : langLabel}
        className="washi-code-pre m-0 py-3 w-full max-w-full overflow-x-auto font-mono text-xs sm:text-sm"
      >
        <code
          className="washi-code-grid"
          style={
            {
              '--code-gutter-width': `calc(${lineDigits}ch + 2.25rem)`,
            } as CSSProperties
          }
        >
          {highlightedLines.map((line, i) => (
            <div
              key={i}
              className={`washi-code-line ${
                line.diffKind === 'added'
                  ? 'washi-code-line-added'
                  : line.diffKind === 'removed'
                    ? 'washi-code-line-removed'
                    : ''
              }`}
            >
              <span
                aria-hidden="true"
                className="washi-code-gutter font-hand text-sm ps-3.5 pe-2.5 text-end select-none tabular-nums"
              >
                {i + 1}
              </span>
              <span
                className="ps-3 pe-5 whitespace-pre"
                style={{ color: 'var(--code-fg)' }}
                dangerouslySetInnerHTML={{
                  __html: line.html || ' ',
                }}
              />
            </div>
          ))}
        </code>
      </pre>
    </WashiCodeFrame>
  );
}
