/*
 * Shared Hand-Drawn Stationery Ornaments, Sticker Palettes & Codec Helpers
 * Used by:
 * - `NotebookAlert.tsx` (9 sticker types × 7 physical silhouettes × 6 dual-theme palettes)
 * - `WashiCodeCard.tsx` (4 notebook code sheet styles: washi / spiral / index / torn)
 * - `MarginNoteLayer.tsx` (Author & Reader margin stickies with customizable style, color & tag)
 * - `VisualBlockEditor.tsx` (Studio visual picker controls)
 */

import { type ReactNode, useId } from 'react';
import type {
  AlertKind,
  CodeCardStyle,
  MarginStickerTag,
  StickerStyle,
  StickerTone,
} from '../../lib/types';
import {
  normalizeStickerStyle,
  normalizeStickerTone,
} from '../../lib/visualBlocks';

export const ALL_ALERT_KINDS: AlertKind[] = [
  'tip',
  'note',
  'info',
  'idea',
  'question',
  'check',
  'bookmark',
  'warning',
  'danger',
];

export const ALL_STICKER_STYLES: StickerStyle[] = [
  'tape',
  'pin',
  'torn',
  'clip',
  'stamp',
  'looseleaf',
  'tag',
];

export const ALL_STICKER_TONES: StickerTone[] = [
  'amber',
  'mint',
  'ice',
  'violet',
  'coral',
  'kraft',
];

export const ALL_CODE_CARD_STYLES: CodeCardStyle[] = [
  'washi',
  'spiral',
  'index',
  'torn',
];

export const ALL_MARGIN_TAGS: MarginStickerTag[] = [
  'note',
  'idea',
  'ask',
  'star',
  'todo',
];

export interface StickerToneTokens {
  bg: string;
  border: string;
  title: string;
  body: string;
  badgeBg: string;
  badgeFg: string;
  swatch: string;
  swatchFg: string;
}

export const STICKER_TONE_TOKENS: Record<StickerTone, StickerToneTokens> = {
  amber: {
    bg: 'var(--alert-tip-bg)',
    border: 'var(--alert-tip-border)',
    title: 'var(--alert-tip-title)',
    body: 'var(--alert-tip-body)',
    badgeBg: 'var(--alert-tip-badge-bg)',
    badgeFg: 'var(--alert-tip-badge-fg)',
    swatch: '#f59e0b',
    swatchFg: '#1f1411',
  },
  mint: {
    bg: 'var(--alert-mint-bg)',
    border: 'var(--alert-mint-border)',
    title: 'var(--alert-mint-title)',
    body: 'var(--alert-mint-body)',
    badgeBg: 'var(--alert-mint-badge-bg)',
    badgeFg: 'var(--alert-mint-badge-fg)',
    swatch: '#129854',
    swatchFg: '#1f1411',
  },
  ice: {
    bg: 'var(--alert-info-bg)',
    border: 'var(--alert-info-border)',
    title: 'var(--alert-info-title)',
    body: 'var(--alert-info-body)',
    badgeBg: 'var(--alert-info-badge-bg)',
    badgeFg: 'var(--alert-info-badge-fg)',
    swatch: '#0aa8d6',
    swatchFg: '#1f1411',
  },
  violet: {
    bg: 'var(--alert-note-bg)',
    border: 'var(--alert-note-border)',
    title: 'var(--alert-note-title)',
    body: 'var(--alert-note-body)',
    badgeBg: 'var(--alert-note-badge-bg)',
    badgeFg: 'var(--alert-note-badge-fg)',
    swatch: '#8b3dff',
    swatchFg: '#ffffff',
  },
  coral: {
    bg: 'var(--alert-danger-bg)',
    border: 'var(--alert-danger-border)',
    title: 'var(--alert-danger-title)',
    body: 'var(--alert-danger-body)',
    badgeBg: 'var(--alert-danger-badge-bg)',
    badgeFg: 'var(--alert-danger-badge-fg)',
    swatch: '#e02454',
    swatchFg: '#ffffff',
  },
  kraft: {
    bg: 'var(--alert-kraft-bg)',
    border: 'var(--alert-kraft-border)',
    title: 'var(--alert-kraft-title)',
    body: 'var(--alert-kraft-body)',
    badgeBg: 'var(--alert-kraft-badge-bg)',
    badgeFg: 'var(--alert-kraft-badge-fg)',
    swatch: '#a47449',
    swatchFg: '#1f1411',
  },
};

export const DEFAULT_ALERT_PRESET: Record<
  AlertKind,
  { style: StickerStyle; tone: StickerTone }
> = {
  tip: { style: 'tape', tone: 'amber' },
  note: { style: 'looseleaf', tone: 'violet' },
  info: { style: 'clip', tone: 'ice' },
  idea: { style: 'pin', tone: 'mint' },
  question: { style: 'torn', tone: 'kraft' },
  check: { style: 'stamp', tone: 'mint' },
  bookmark: { style: 'tag', tone: 'ice' },
  warning: { style: 'tape', tone: 'amber' },
  danger: { style: 'stamp', tone: 'coral' },
};

export function resolveAlertAppearance(
  kind: AlertKind,
  rawStyle?: string | null,
  rawTone?: string | null,
): {
  style: StickerStyle;
  tone: StickerTone;
  tokens: StickerToneTokens;
} {
  const fallback = DEFAULT_ALERT_PRESET[kind] ?? DEFAULT_ALERT_PRESET.note;
  const style = normalizeStickerStyle(rawStyle) || fallback.style;
  const tone = normalizeStickerTone(rawTone) || fallback.tone;
  return {
    style,
    tone,
    tokens: STICKER_TONE_TOKENS[tone],
  };
}

export const ALERT_DOODLE_ICONS: Record<AlertKind, ReactNode> = {
  tip: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.1 18 Q12 17.7 14.9 18" />
      <path d="M10.1 20.9 Q12 20.7 13.9 20.9" />
      <path d="M12 3.1 C8.3 3 5.5 6.4 6.2 10.1 C6.6 11.9 7.5 13 8.1 14.1 Q8.3 15 8.5 15.8 Q12 15.5 15.5 15.8 Q15.7 15 15.9 14.1 C16.6 12.9 17.6 11.8 17.8 9.9 C18.3 6.3 15.6 3.2 12 3.1 Z" />
      <path d="M18.9 4.2 Q19.7 3.4 20.4 2.7" />
      <path d="M5.1 4.2 Q4.3 3.4 3.6 2.7" />
    </svg>
  ),
  note: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.8 3.3 C18.1 2.2 19.8 2.4 20.7 3.4 C21.7 4.4 21.8 6.1 20.6 7.3 Q14.2 13.8 7.7 20.2 Q4.9 21 2.6 21.4 Q3 19.1 3.9 16.3 Q10.3 9.8 16.8 3.3 Z" />
      <path d="M14.7 5.4 Q16.8 7.2 18.6 9.3" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.1 3.1 C17 3 21 6.9 20.9 12 C20.8 17 16.9 21 11.9 20.9 C6.9 20.8 3 16.9 3.1 11.9 C3.2 7 7 3.2 12.1 3.1 Z" />
      <path d="M12 16 Q11.8 14 12.1 12" />
      <path d="M11.9 8.1 Q12.1 7.8 12.3 8.2" />
    </svg>
  ),
  idea: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.4 C12.8 6.1 15.6 8.3 19.4 9 C15.6 9.7 12.8 12.2 12 16.4 C11.2 12.2 8.4 9.7 4.6 9 C8.4 8.3 11.2 6.1 12 2.4 Z" />
      <path d="M18.9 15.9 Q19.4 17.9 21.8 18.9 Q19.4 19.4 18.9 21.8 Q18.3 19.4 16 18.9 Q18.4 17.9 18.9 15.9 Z" />
    </svg>
  ),
  question: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.1 9.1 C9.2 7.1 10.6 6 12.3 6.1 C14.1 6.2 15.1 7.3 15 8.9 C14.9 10.7 12.3 11.4 12.1 13.4" />
      <path d="M11.9 17.8 Q12.1 17.5 12.3 17.9" />
      <path d="M20.8 11.5 C21.1 16.4 17.3 20.6 12.4 20.8 C7.4 21 3.3 17.2 3.2 12.2 C3.1 7.3 6.9 3.2 11.9 3.1 C13.7 3.1 15.3 3.6 16.6 4.4" />
    </svg>
  ),
  check: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19.8 6.9 Q14.8 12 9.9 16.9 Q7.5 14.4 5.1 12.1" />
      <path d="M4.2 19.6 Q12 19.1 19.8 19.6" />
    </svg>
  ),
  bookmark: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.4 3.2 Q12 2.8 17.6 3.2 Q18.8 3.5 18.9 4.7 Q19.1 12.8 18.8 20.8 Q15.4 18.6 12 16.7 Q8.6 18.7 5.2 20.8 Q4.9 12.8 5.2 4.7 Q5.3 3.5 6.4 3.2 Z" />
      <path d="M9.4 8.5 Q12 8.2 14.6 8.5" />
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.4 4.1 Q6.3 11.1 2.6 18.1 C2 19.3 2.8 20.7 4.2 20.8 Q12 21.1 19.8 20.8 C21.2 20.7 22 19.3 21.4 18.1 Q17.6 11.1 13.6 4.1 C12.9 2.9 11.1 2.9 10.4 4.1 Z" />
      <path d="M12 9.1 Q11.8 11.2 12.1 13.2" />
      <path d="M11.9 17.1 Q12.1 16.8 12.3 17.2" />
    </svg>
  ),
  danger: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21.7 C16.3 19.8 19.6 15.7 19.7 11.4 Q19.8 8.2 19.5 5.2 Q15.8 3.7 12 2.4 Q8.2 3.8 4.5 5.3 Q4.2 8.4 4.3 11.6 C4.4 15.9 7.8 19.8 12 21.7 Z" />
      <path d="M9.6 9.6 Q12 12 14.4 14.4" />
      <path d="M14.4 9.6 Q12 12 9.6 14.4" />
    </svg>
  ),
};

export const MARGIN_TAG_ICONS: Record<MarginStickerTag, ReactNode> = {
  note: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.8 3.3 C18.1 2.2 19.8 2.4 20.7 3.4 C21.7 4.4 21.8 6.1 20.6 7.3 Q14.2 13.8 7.7 20.2 Q4.9 21 2.6 21.4 Q3 19.1 3.9 16.3 Q10.3 9.8 16.8 3.3 Z" />
    </svg>
  ),
  idea: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.4 C12.8 6.1 15.6 8.3 19.4 9 C15.6 9.7 12.8 12.2 12 16.4 C11.2 12.2 8.4 9.7 4.6 9 C8.4 8.3 11.2 6.1 12 2.4 Z" />
    </svg>
  ),
  ask: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.1 3.1 C17 3 21 6.9 20.9 12 C20.8 17 16.9 21 11.9 20.9 C6.9 20.8 3 16.9 3.1 11.9 C3.2 7 7 3.2 12.1 3.1 Z" />
      <path d="M9.6 9.1 C9.8 7.4 11 6.4 12.4 6.5 C13.8 6.6 14.6 7.5 14.5 8.8 C14.4 10.3 12.2 10.9 12.1 12.6" />
      <path d="M11.9 17.1 Q12.1 16.8 12.3 17.2" />
    </svg>
  ),
  star: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.7 Q13.7 5.8 15.1 8.4 Q18.4 8.9 21.7 9.4 Q19.2 11.7 17 14.1 Q17.6 17.5 18.1 20.9 Q15 19.2 12 17.7 Q9 19.3 5.9 20.9 Q6.5 17.5 7 14.1 Q4.6 11.7 2.3 9.4 Q5.7 8.9 8.9 8.4 Q10.4 5.7 12 2.7 Z" />
    </svg>
  ),
  todo: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.6 4.1 Q12 3.7 19.4 4.1 Q20.7 4.4 20.8 5.8 Q21 12 20.8 18.2 Q20.6 19.6 19.3 19.8 Q12 20.1 4.7 19.8 Q3.4 19.6 3.2 18.2 Q3 12 3.2 5.8 Q3.4 4.4 4.6 4.1 Z" />
      <path d="M8.5 12.1 Q9.9 13.5 11.1 14.4 Q13.2 12.1 15.5 9.9" />
    </svg>
  ),
};

export interface ReaderNoteSpec {
  tone: StickerTone;
  style: StickerStyle;
  tag: MarginStickerTag;
}

const VALID_MARGIN_TAGS = new Set<MarginStickerTag>([
  'note',
  'idea',
  'ask',
  'star',
  'todo',
]);

/**
 * Encodes reader sticky configuration into existing `note_color VARCHAR(24)` column
 * (e.g. `"mint:pin:idea"`, max 19 chars — 100% backwards-compatible with PostgreSQL schema).
 */
export function encodeReaderNoteSpec(spec: ReaderNoteSpec): string {
  return `${spec.tone}:${spec.style}:${spec.tag}`;
}

export function decodeReaderNoteSpec(raw?: string | null): ReaderNoteSpec {
  const clean = (raw ?? '').trim().toLowerCase();
  if (!clean || clean === 'yellow') {
    return { tone: 'amber', style: 'tape', tag: 'note' };
  }
  if (clean === 'ice') {
    return { tone: 'ice', style: 'pin', tag: 'note' };
  }
  if (clean === 'violet') {
    return { tone: 'violet', style: 'clip', tag: 'note' };
  }
  if (clean === 'coral') {
    return { tone: 'coral', style: 'torn', tag: 'star' };
  }
  const parts = clean.split(':');
  const tone = normalizeStickerTone(parts[0]) || 'amber';
  const style = normalizeStickerStyle(parts[1]) || 'tape';
  const tag = VALID_MARGIN_TAGS.has(parts[2] as MarginStickerTag)
    ? (parts[2] as MarginStickerTag)
    : 'note';
  return { tone, style, tag };
}

/**
 * Hand-torn zig-zag Washi Tape SVG strip (`tape` sticker & `washi` code card).
 */
export function WashiTapeOrnament({
  fill,
  stroke,
  pattern = 'stripe',
  tiltDeg = -1.6,
  compact = false,
  className = '',
}: {
  fill: string;
  stroke: string;
  pattern?: 'stripe' | 'dots' | 'grid' | 'caution';
  tiltDeg?: number;
  compact?: boolean;
  className?: string;
}) {
  const patId = useId().replace(/:/g, '');
  const w = compact ? 72 : 108;
  const h = compact ? 18 : 22;
  const tearPath = compact
    ? 'M3,1 L69,1 L66,5 L70,9 L66,13 L69,17 L3,17 L6,13 L2,9 L6,5 Z'
    : 'M4,1 L104,1 L100,6 L105,11 L100,16 L104,21 L4,21 L8,16 L3,11 L8,6 Z';

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${w} ${h}`}
      className={`pointer-events-none select-none ${compact ? 'w-16 h-4' : 'w-26 h-5.5'} ${className}`}
      style={{
        transform: `rotate(${tiltDeg}deg)`,
        opacity: 0.92,
      }}
    >
      <defs>
        {pattern === 'stripe' && (
          <pattern
            id={`wt-${patId}`}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-35)"
          >
            <line x1="0" y1="0" x2="0" y2="8" stroke={stroke} strokeWidth="1.6" strokeOpacity="0.28" />
          </pattern>
        )}
        {pattern === 'caution' && (
          <pattern
            id={`wt-${patId}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="5" height="10" fill={stroke} fillOpacity="0.24" />
          </pattern>
        )}
        {pattern === 'dots' && (
          <pattern id={`wt-${patId}`} width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1.2" fill={stroke} fillOpacity="0.32" />
          </pattern>
        )}
        {pattern === 'grid' && (
          <pattern id={`wt-${patId}`} width="7" height="7" patternUnits="userSpaceOnUse">
            <path d="M 7 0 L 0 0 0 7" fill="none" stroke={stroke} strokeWidth="0.9" strokeOpacity="0.26" />
          </pattern>
        )}
      </defs>
      <path d={tearPath} fill={fill} />
      <path d={tearPath} fill={`url(#wt-${patId})`} />
      <path
        d={tearPath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.2"
        strokeDasharray="3 2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Sketched 3D thumbtack / pushpin (`pin` sticker).
 */
export function PushpinOrnament({
  fill,
  stroke,
  compact = false,
  className = '',
}: {
  fill: string;
  stroke: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 30"
      fill="none"
      className={`pointer-events-none select-none ${compact ? 'w-5 h-5.5' : 'w-6.5 h-7'} ${className}`}
    >
      <ellipse cx="15" cy="25" rx="4.5" ry="1.8" fill="currentColor" fillOpacity="0.16" />
      <path d="M14 17L14 26" stroke="var(--border-ink)" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="14" cy="10" r="7.5" fill={fill} stroke="var(--border-ink)" strokeWidth="2" />
      <circle cx="14" cy="10" r="5" fill={stroke} fillOpacity="0.35" />
      <circle cx="11.5" cy="7.5" r="1.7" fill="#ffffff" fillOpacity="0.8" />
    </svg>
  );
}

/**
 * Sketched bent wire paperclip (`clip` sticker & `index` code card).
 */
export function PaperclipOrnament({
  stroke,
  compact = false,
  className = '',
}: {
  stroke: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 38"
      fill="none"
      className={`pointer-events-none select-none ${compact ? 'w-5 h-7' : 'w-6 h-9'} ${className}`}
    >
      <path
        d="M8 11V26a6 6 0 0 0 12 0V8a4.2 4.2 0 0 0-8.4 0v17a2.1 2.1 0 0 0 4.2 0V12"
        stroke={stroke}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Hand-drawn circular postmark + wavy cancellation lines (`stamp` sticker).
 */
export function PostmarkOrnament({
  stroke,
  compact = false,
  className = '',
}: {
  stroke: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 68 32"
      fill="none"
      className={`pointer-events-none select-none ${compact ? 'w-12 h-6' : 'w-16 h-8'} ${className}`}
      style={{ opacity: 0.48, transform: 'rotate(-6deg)' }}
    >
      <circle cx="16" cy="16" r="12" stroke={stroke} strokeWidth="1.6" strokeDasharray="3 2" />
      <circle cx="16" cy="16" r="8" stroke={stroke} strokeWidth="1.2" />
      <path
        d="M31 10c4-2.5 8 2.5 12 0s8 2.5 12 0s7 2 10 0M31 16c4-2.5 8 2.5 12 0s8 2.5 12 0s7 2 10 0M31 22c4-2.5 8 2.5 12 0s8 2.5 12 0s7 2 10 0"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Reinforced bookmark / luggage tag eyelet + hand-drawn string loop (`tag` sticker).
 */
export function TagEyeletOrnament({
  stroke,
  badgeBg,
  className = '',
}: {
  stroke: string;
  badgeBg: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 30 30"
      fill="none"
      className={`pointer-events-none select-none w-7 h-7 ${className}`}
    >
      <path
        d="M14 13 C 6 8, 2 3, 7 1 C 12 0, 15 6, 15 12"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="5.5" fill={badgeBg} stroke={stroke} strokeWidth="1.8" />
      <circle cx="16" cy="16" r="2.5" fill="var(--surface-sheet)" stroke={stroke} strokeWidth="1.4" />
    </svg>
  );
}

/**
 * Serrated hand-torn bottom edge SVG strip (`torn` sticker & `torn` code card).
 */
export function TornBottomEdge({
  borderStroke,
  className = '',
}: {
  borderStroke: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 240 8"
      preserveAspectRatio="none"
      className={`pointer-events-none select-none block w-full h-2 ${className}`}
    >
      <path
        d="M0,1 L8,6 L16,1.5 L24,6.5 L32,1 L40,5.5 L48,1.5 L56,6 L64,1 L72,6.5 L80,1.5 L88,5.5 L96,1 L104,6.5 L112,1.5 L120,6 L128,1 L136,5.5 L144,1.5 L152,6.5 L160,1 L168,6 L176,1.5 L184,5.5 L192,1 L200,6.5 L208,1.5 L216,6 L224,1 L232,5.5 L240,1"
        fill="none"
        stroke={borderStroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Spiral twin-wire top binding rings (`spiral` notebook code card).
 */
export function SpiralBindingRings() {
  const rings = Array.from({ length: 9 }, (_, i) => i);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none flex items-center justify-around px-6 -mt-2.5 mb-0.5"
    >
      {rings.map((idx) => (
        <div key={idx} className="flex flex-col items-center">
          <span
            className="w-2 h-4 rounded-full border-2"
            style={{
              borderColor: 'var(--border-ink)',
              backgroundColor: 'var(--surface-raised)',
            }}
          />
          <span
            className="w-2.5 h-2 -mt-1 rounded-full border"
            style={{
              backgroundColor: 'var(--surface-page)',
              borderColor: 'var(--border-ink)',
            }}
          />
        </div>
      ))}
    </div>
  );
}
