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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getLanguageDisplayLabel,
  highlightCodeToLines,
} from '../../lib/codeHighlight';
import type { StickerTone } from '../../lib/types';
import { normalizeCodeCardStyle } from '../../lib/visualBlocks';
import { IconCheck, IconCopy } from '../ui/Icons';
import {
  PaperclipOrnament,
  SpiralBindingRings,
  STICKER_TONE_TOKENS,
  TornBottomEdge,
  WashiTapeOrnament,
} from './StationeryStickers';

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
  const timerRef = useRef<number | null>(null);

  const sheetStyle = normalizeCodeCardStyle(style);

  const highlightedLines = useMemo(
    () => highlightCodeToLines(code, language),
    [code, language],
  );
  const langLabel = useMemo(() => getLanguageDisplayLabel(language), [language]);

  const tapePreset = useMemo(() => {
    const idx =
      hashSeed(`${language}:${filename ?? ''}:${code.length}`) %
      WASHI_TAPE_CYCLE.length;
    return WASHI_TAPE_CYCLE[idx];
  }, [language, filename, code.length]);

  const tapeTokens = STICKER_TONE_TOKENS[tapePreset.tone];

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
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    timerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      timerRef.current = null;
    }, 1800);
  };

  const lineDigits = Math.max(2, String(highlightedLines.length).length);

  return (
    <div
      className={`my-6 relative group min-w-0 max-w-full ${
        sheetStyle === 'washi' || sheetStyle === 'index' ? 'pt-2' : ''
      }`}
    >
      {/* Top Washi Tape (`washi` default) */}
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

      {/* Top Paperclip (`index` card) */}
      {sheetStyle === 'index' && (
        <div className="pointer-events-none absolute -top-2 end-8 z-10">
          <PaperclipOrnament stroke="var(--accent-ice-ink)" />
        </div>
      )}

      {/* Corner Tape (`torn` draft slip) */}
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
        {/* Spiral Wire Binding (`spiral` ruled sheet) */}
        {sheetStyle === 'spiral' && <SpiralBindingRings />}

        {/* Stationery Header Bar: Notebook Punch Holes + Handwritten Filename Tab + Stamped Language + Tactile Copy */}
        <div
          className={`washi-code-header flex items-center justify-between gap-3 px-3.5 sm:px-4 py-2 ${
            sheetStyle === 'spiral' ? '' : 'rounded-t-[12px]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {sheetStyle !== 'spiral' && (
              <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
                <span
                  className="w-2.5 h-2.5 rounded-full border-[1.5px]"
                  style={{
                    backgroundColor: 'var(--surface-page)',
                    borderColor: 'var(--border-ink)',
                  }}
                />
                <span
                  className="w-2.5 h-2.5 rounded-full border-[1.5px]"
                  style={{
                    backgroundColor: 'var(--surface-page)',
                    borderColor: 'var(--border-ink)',
                  }}
                />
                <span
                  className="w-2.5 h-2.5 rounded-full border-[1.5px]"
                  style={{
                    backgroundColor: 'var(--surface-page)',
                    borderColor: 'var(--border-ink)',
                  }}
                />
              </div>
            )}

            {filename ? (
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
                className="font-hand text-sm text-ink-muted select-none"
              >
                #
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Rubber-Stamped Language Tag */}
            <span
              className="px-2 py-0.5 rounded font-mono text-xs font-semibold uppercase tracking-wider border border-dashed select-none"
              style={{
                backgroundColor: tapeTokens.badgeBg,
                borderColor: tapeTokens.border,
                color: tapeTokens.badgeFg,
                transform: 'rotate(-1deg)',
              }}
            >
              {langLabel}
            </span>

            {/* Tactile Ink Copy Button */}
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="min-h-7 px-2.5 py-1 rounded-lg font-hand text-xs sm:text-sm font-semibold border-[1.5px] inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-transform active:translate-x-px active:translate-y-px"
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
                <IconCheck className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <IconCopy className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {copyState === 'copied'
                  ? copiedLabel
                  : copyState === 'failed'
                    ? copyFailedLabel
                    : copyLabel}
              </span>
            </button>
          </div>
        </div>

        {/* Code Sheet Body (20px Drafting Grid or 24px Spiral Ruled Lines) */}
        <div
          className={`washi-code-body overflow-hidden ${
            sheetStyle === 'torn' ? 'rounded-b-[3px]' : 'rounded-b-[12px]'
          }`}
        >
          <pre className="washi-code-pre m-0 py-3 w-full max-w-full overflow-x-auto font-mono text-xs sm:text-sm">
            <code className="block w-max min-w-full">
              {highlightedLines.map((line, i) => (
                <div
                  key={i}
                  className={`washi-code-line flex ${
                    line.diffKind === 'added'
                      ? 'washi-code-line-added'
                      : line.diffKind === 'removed'
                        ? 'washi-code-line-removed'
                        : ''
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="washi-code-gutter font-hand text-sm shrink-0 ps-3.5 pe-2.5 me-3 text-end select-none tabular-nums"
                    style={{ minWidth: `${lineDigits + 2.6}ch` }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="pe-5 whitespace-pre flex-1"
                    style={{ color: 'var(--code-fg)' }}
                    dangerouslySetInnerHTML={{
                      __html: line.html || ' ',
                    }}
                  />
                </div>
              ))}
            </code>
          </pre>

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
