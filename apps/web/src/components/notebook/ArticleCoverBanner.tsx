/*
 * Article Cover Thumbnail & Hero Banner (`<ArticleCoverBanner />`)
 *
 * Dual-mode stationery banner shared across:
 * 1. HomePage Recent Articles Grid (`variant="card"`, 16:9 aspect ratio)
 * 2. StepReaderPage Article Header (`variant="hero"`, only rendered when author sets a cover image)
 * 3. StudioEditorInspector Live Preview (`variant="preview"`, 16:9 aspect ratio)
 *
 * When `coverUrl` is unset or fails to load, renders a quiet, understated
 * Archival Field-Notebook Bookplate (`手账活页封签`) seeded by `(trackSlug, stepSlug)`
 * with fine paper ruling, muted ink typography, and fine-nib line art.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { stripHtmlTags } from '../../lib/sanitizer';
import { toSafeMediaUrl } from '../../lib/urlSafety';
import { TrackHandIcon } from '../ui/Icons';
import {
  STICKER_TONE_TOKENS,
  type StickerToneTokens,
} from './StationeryStickers';

export interface ArticleCoverBannerProps {
  coverUrl?: string | null;
  title: string;
  trackSlug: string;
  trackTitle?: string;
  trackIconKind?: string;
  stepSlug: string;
  stepNumber?: number;
  tags?: string[];
  variant?: 'card' | 'hero' | 'preview';
  /** Elevate LCP image priority (`fetchpriority="high"`, never `loading="lazy"`). */
  priority?: boolean;
  className?: string;
}

type BannerToneKey = 'violet' | 'ice' | 'amber' | 'mint' | 'coral' | 'kraft';
type PaperRulingKind = 'grid' | 'dots' | 'ruled';
type VignetteKind =
  | 'manuscript_nib'
  | 'botanical_sprig'
  | 'compass_arc'
  | 'stitched_journal'
  | 'index_cards'
  | 'crystal_prism';

const TONE_KEYS: readonly BannerToneKey[] = [
  'violet',
  'ice',
  'amber',
  'mint',
  'coral',
  'kraft',
];

const RULING_KINDS: readonly PaperRulingKind[] = ['ruled', 'grid', 'dots'];

const VIGNETTE_KINDS: readonly VignetteKind[] = [
  'manuscript_nib',
  'botanical_sprig',
  'compass_arc',
  'stitched_journal',
  'index_cards',
  'crystal_prism',
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickVignette(trackIconKind: string | undefined, seed: number): VignetteKind {
  const cleanKind = (trackIconKind ?? '').trim().toLowerCase();
  const fallbackIdx = (seed >>> 5) % VIGNETTE_KINDS.length;
  if (seed % 2 === 0) {
    switch (cleanKind) {
      case 'terminal':
      case 'code':
      case 'cpu':
      case 'database':
        return 'index_cards';
      case 'compass':
      case 'rocket':
      case 'globe':
        return 'compass_arc';
      case 'flask':
      case 'spark':
      case 'snowflake':
        return 'crystal_prism';
      case 'notebook':
      case 'feather':
      case 'palette':
        return 'manuscript_nib';
      case 'layers':
      case 'cube':
      case 'shield':
        return 'stitched_journal';
      default:
        break;
    }
  }
  return VIGNETTE_KINDS[fallbackIdx];
}

function FineNibVignette({
  vignette,
  accentStroke,
}: {
  vignette: VignetteKind;
  accentStroke: string;
}) {
  switch (vignette) {
    case 'manuscript_nib':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Open archival notebook + fine fountain-pen nib */}
          <path
            d="M36 142 Q34 94 37 52 Q66 47 92 54 Q118 47 147 52 Q150 94 147 142 Q119 136 92 144 Q65 136 36 142 Z"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.55"
            strokeWidth="1.35"
          />
          <path
            d="M92 54 Q91 98 92 143"
            stroke={accentStroke}
            strokeOpacity="0.65"
            strokeWidth="1.3"
          />
          <path
            d="M49 74 Q68 71 81 74 M49 90 Q66 87 79 90 M49 106 Q62 104 74 106"
            stroke="var(--ink-muted)"
            strokeOpacity="0.48"
            strokeWidth="1.15"
          />
          <path
            d="M104 74 Q122 71 135 74 M104 90 Q120 87 132 90"
            stroke="var(--ink-muted)"
            strokeOpacity="0.48"
            strokeWidth="1.15"
          />
          {/* Nib resting diagonally */}
          <path
            d="M148 34 C135 45 123 64 114 88 Q109 98 106 108 Q117 104 127 97 C144 82 154 58 148 34 Z"
            stroke={accentStroke}
            strokeOpacity="0.82"
            strokeWidth="1.45"
          />
          <path
            d="M106 108 Q121 91 134 74"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.6"
            strokeWidth="1.15"
          />
        </g>
      );

    case 'botanical_sprig':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Botanical sprig sketch with fine ink veins */}
          <path
            d="M62 152 C74 116 96 74 134 32"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.6"
            strokeWidth="1.4"
          />
          <path
            d="M78 124 C56 116 46 98 54 84 C70 90 81 106 78 124 Z"
            stroke={accentStroke}
            strokeOpacity="0.72"
            strokeWidth="1.3"
          />
          <path
            d="M96 94 C118 92 134 104 132 119 C114 118 99 108 96 94 Z"
            stroke={accentStroke}
            strokeOpacity="0.72"
            strokeWidth="1.3"
          />
          <path
            d="M111 66 C91 61 82 46 89 34 C103 40 112 52 111 66 Z"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.58"
            strokeWidth="1.25"
          />
          <path
            d="M126 46 C142 46 151 55 148 66 C135 64 127 56 126 46 Z"
            stroke={accentStroke}
            strokeOpacity="0.65"
            strokeWidth="1.2"
          />
        </g>
      );

    case 'compass_arc':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Field map contours + drafting compass */}
          <path
            d="M36 128 C64 98 94 118 124 88 C139 73 148 56 156 44"
            stroke={accentStroke}
            strokeOpacity="0.68"
            strokeWidth="1.35"
            strokeDasharray="4 4"
          />
          <path
            d="M94 52 C119 51 139 71 138 96 C137 121 117 140 92 139 C68 138 49 119 50 94 C51 70 70 53 94 52 Z"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.55"
            strokeWidth="1.35"
          />
          <path
            d="M94 64 C112 63 127 77 126 96 C125 113 111 127 92 126 C75 125 61 112 62 94 C63 77 77 65 94 64 Z"
            stroke="var(--ink-muted)"
            strokeOpacity="0.4"
            strokeWidth="1.1"
            strokeDasharray="3 3"
          />
          <path
            d="M111 75 Q95 83 84 91 Q77 104 74 116 Q89 109 101 101 Q106 88 111 75 Z"
            stroke={accentStroke}
            strokeOpacity="0.82"
            strokeWidth="1.4"
          />
        </g>
      );

    case 'stitched_journal':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Layered hand-stitched notebook pocket + bookmark ribbon */}
          <path
            d="M44 48 Q94 45 142 48 Q144 96 142 144 Q94 147 44 144 Q42 96 44 48 Z"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.58"
            strokeWidth="1.35"
          />
          <path
            d="M58 48 Q57 96 58 144"
            stroke={accentStroke}
            strokeOpacity="0.7"
            strokeWidth="1.3"
            strokeDasharray="3.5 3.5"
          />
          <path
            d="M110 46 Q116 46 122 46 Q123 76 122 104 Q116 97 116 97 Q110 104 110 104 Q109 76 110 46 Z"
            stroke={accentStroke}
            strokeOpacity="0.8"
            strokeWidth="1.35"
          />
          <path
            d="M72 78 Q91 76 102 78 M72 95 Q94 93 102 95 M72 114 Q100 112 126 114"
            stroke="var(--ink-muted)"
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
        </g>
      );

    case 'index_cards':
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Layered drafting index cards & structural nodes */}
          <path
            d="M38 72 Q86 69 134 72 Q136 106 134 140 Q86 143 38 140 Q36 106 38 72 Z"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.55"
            strokeWidth="1.35"
          />
          <path
            d="M38 88 Q86 85 134 88"
            stroke={accentStroke}
            strokeOpacity="0.68"
            strokeWidth="1.25"
          />
          <path
            d="M52 50 Q100 47 148 50 Q150 84 148 118"
            stroke="var(--ink-muted)"
            strokeOpacity="0.45"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
          <path
            d="M52 104 Q66 110 76 116 Q66 123 52 128 M84 128 Q102 126 118 128"
            stroke={accentStroke}
            strokeOpacity="0.8"
            strokeWidth="1.4"
          />
        </g>
      );

    case 'crystal_prism':
    default:
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Geometric ink prism & crystalline rays */}
          <path
            d="M96 38 Q119 64 140 92 Q118 120 96 148 Q74 120 52 92 Q74 64 96 38 Z"
            stroke={accentStroke}
            strokeOpacity="0.78"
            strokeWidth="1.4"
          />
          <path
            d="M96 38 Q95 93 96 148 M52 92 Q96 89 140 92"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.48"
            strokeWidth="1.15"
          />
          <path
            d="M74 65 Q96 78 118 65 M74 119 Q96 106 118 119"
            stroke="var(--ink-muted)"
            strokeOpacity="0.45"
            strokeWidth="1.1"
          />
          <path
            d="M142 42 Q142 49 142 56 M135 49 Q142 49 149 49"
            stroke={accentStroke}
            strokeOpacity="0.72"
            strokeWidth="1.3"
          />
        </g>
      );
  }
}

export function ArticleCoverBanner({
  coverUrl,
  title,
  trackSlug,
  trackTitle,
  trackIconKind,
  stepSlug,
  stepNumber = 1,
  tags = [],
  variant = 'card',
  priority = false,
  className = '',
}: ArticleCoverBannerProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const safeUrl = useMemo(() => toSafeMediaUrl(coverUrl ?? ''), [coverUrl]);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [safeUrl]);

  const ratioClass =
    variant === 'hero'
      ? 'aspect-[16/9] sm:aspect-[21/9]'
      : 'aspect-[16/9]';

  const cleanTitle = stripHtmlTags(title) || stepSlug;

  // 1. Custom Uploaded or Linked Banner Image
  if (safeUrl && !imgFailed) {
    return (
      <div
        className={`relative w-full ${ratioClass} overflow-hidden bg-surface-raised ${className}`.trim()}
      >
        <img
          src={safeUrl}
          alt={variant === 'hero' ? cleanTitle : ''}
          fetchPriority={priority ? 'high' : undefined}
          loading={priority ? undefined : 'lazy'}
          decoding="async"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover block"
        />
      </div>
    );
  }

  // 2. Quiet Archival Field-Notebook Bookplate Fallback (`手账活页封签`)
  const seed = hashSeed(`${trackSlug}:${stepSlug}`);
  const toneKey = TONE_KEYS[seed % TONE_KEYS.length];
  const tokens: StickerToneTokens = STICKER_TONE_TOKENS[toneKey];
  const ruling = RULING_KINDS[(seed >>> 3) % RULING_KINDS.length];
  const vignette = pickVignette(trackIconKind, seed);

  const patternId = `ihn-plate-${uid}`;
  const indexCode = String(Math.max(1, stepNumber)).padStart(2, '0');
  const firstTag = tags[0]?.trim();
  const cleanTrack = stripHtmlTags(trackTitle ?? '').trim();

  return (
    <div
      data-testid="article-cover-fallback"
      aria-hidden={variant === 'card' ? true : undefined}
      className={`relative w-full ${ratioClass} overflow-hidden select-none bg-surface-raised/75 border-b border-border-subtle ${className}`.trim()}
    >
      {/* Subtle vertical notebook binding accent */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 start-0 w-[3px]"
        style={{ backgroundColor: tokens.border, opacity: 0.55 }}
      />

      {/* Full-bleed paper ruling texture */}
      <svg
        aria-hidden="true"
        className="w-full h-full block pointer-events-none"
        viewBox="0 0 480 270"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          {ruling === 'grid' && (
            <pattern id={patternId} width="22" height="22" patternUnits="userSpaceOnUse">
              <path
                d="M22 0 Q21.8 11 22 22 M0 22 Q11 21.8 22 22"
                stroke="var(--code-grid-line)"
                strokeWidth="1"
              />
            </pattern>
          )}
          {ruling === 'dots' && (
            <pattern id={patternId} width="16" height="16" patternUnits="userSpaceOnUse">
              <path
                d="M7.5 7.5 C8.2 7.3 8.7 8 8.2 8.6 C7.7 9.1 7 8.6 7.3 7.9 Z"
                fill="var(--dot-grid-color)"
                fillOpacity="0.7"
              />
            </pattern>
          )}
          {ruling === 'ruled' && (
            <pattern id={patternId} width="40" height="22" patternUnits="userSpaceOnUse">
              <path
                d="M0 21 Q20 20.6 40 21"
                stroke="var(--code-grid-line)"
                strokeWidth="1.05"
              />
            </pattern>
          )}
        </defs>

        <path d="M0 0 H480 V270 H0 Z" fill={`url(#${patternId})`} />
        {ruling === 'ruled' && (
          <path
            d="M44 0 Q43.5 135 44 270"
            stroke={tokens.border}
            strokeOpacity="0.16"
            strokeWidth="1.1"
          />
        )}
      </svg>

      {/* Right fine-nib ink vignette */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-0 w-[42%] h-full opacity-85"
        viewBox="0 0 180 180"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
      >
        <FineNibVignette vignette={vignette} accentStroke={tokens.border} />
      </svg>

      {/* Left editorial bookplate metadata & title */}
      <div className="pointer-events-none absolute inset-y-0 start-0 end-[36%] p-4 sm:p-5 flex flex-col justify-between">
        <div className="flex items-center gap-2 min-w-0 text-xs font-mono text-ink-muted">
          <span
            className="inline-flex items-center justify-center shrink-0"
            style={{ color: tokens.title }}
          >
            <TrackHandIcon kind={trackIconKind} className="w-3.5 h-3.5" />
          </span>
          <span className="tabular-nums shrink-0">{indexCode}</span>
          {cleanTrack && (
            <>
              <span aria-hidden="true">/</span>
              <span className="truncate">{cleanTrack}</span>
            </>
          )}
        </div>

        <div className="space-y-1.5 min-w-0">
          <div
            className="text-sm sm:text-base font-semibold text-ink-primary/90 leading-snug line-clamp-2"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            {cleanTitle}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 border-t border-border-control" />
            {firstTag && (
              <span className="text-xs font-mono text-ink-muted truncate">
                #{firstTag}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
