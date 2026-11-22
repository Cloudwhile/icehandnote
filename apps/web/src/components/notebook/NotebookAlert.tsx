/*
 * Multi-Style Hand-Drawn Stationery Sticker Callout (`NotebookAlert`)
 * - Decouples 3 orthogonal axes for flexible notebook authoring:
 *   1. Semantic Type (`AlertKind`: tip / note / info / idea / question / check / bookmark / warning / danger)
 *   2. Physical Sticker Silhouette (`StickerStyle`: tape / pin / torn / clip / stamp / looseleaf / tag)
 *   3. Dual-Theme Paper Palette (`StickerTone`: amber / mint / ice / violet / coral / kraft — all WCAG AA verified)
 *   + Optional custom badge text (`badge`) overriding the default stamp label.
 */

import type { CSSProperties, ReactNode } from 'react';
import { SafeHtml } from '../../lib/sanitizer';
import type { AlertKind } from '../../lib/types';
import {
  ALERT_DOODLE_ICONS,
  PaperclipOrnament,
  PostmarkOrnament,
  PushpinOrnament,
  resolveAlertAppearance,
  type StickerToneTokens,
  TagEyeletOrnament,
  TornBottomEdge,
  WashiTapeOrnament,
} from './StationeryStickers';
import { getAlertCornerPixelSticker } from './PixelStickers';

export interface StickerCardFrameProps {
  kind: AlertKind;
  style?: string | null;
  tone?: string | null;
  className?: string;
  topRightControl?: ReactNode;
  children: (ctx: {
    tokens: StickerToneTokens;
  }) => ReactNode;
}

/**
 * Shared physical stationery sticker shell (9 semantic kinds × 7 ornaments × 6 palettes),
 * reused by both `<NotebookAlert>` (reader) and `<AlertBlockBody>` (in-place Studio editor).
 */
export function StickerCardFrame({
  kind,
  style: rawStyle,
  tone: rawTone,
  className = 'my-6 max-w-[68ch]',
  topRightControl,
  children,
}: StickerCardFrameProps) {
  const { style, tokens } = resolveAlertAppearance(kind, rawStyle, rawTone);

  const customVars = {
    '--sticker-bg': tokens.bg,
    '--sticker-border': tokens.border,
    '--sticker-body': tokens.body,
  } as CSSProperties;

  let padClass = 'p-4 sm:p-5';
  let radiusStyle = '14px';
  let tiltTransform: string | undefined;

  if (style === 'looseleaf') {
    padClass = 'py-4 pe-4 ps-10 sm:py-5 sm:pe-5 sm:ps-11';
  } else if (style === 'tag') {
    padClass = 'py-4 pe-4 ps-10 sm:py-4.5 sm:pe-5 sm:ps-12';
    radiusStyle = '20px 12px 12px 20px';
  } else if (style === 'pin') {
    padClass = 'pt-5 pb-4 px-4 sm:px-5';
    tiltTransform = 'rotate(-0.35deg)';
  } else if (style === 'tape') {
    padClass = 'pt-5 pb-4 px-4 sm:px-5';
    radiusStyle = '12px 12px 4px 12px';
  } else if (style === 'torn') {
    padClass = 'pt-4 pb-2.5 px-4 sm:px-5';
    radiusStyle = '12px 12px 3px 3px';
  } else if (style === 'stamp') {
    padClass = 'p-4 sm:p-5';
    radiusStyle = '10px';
  }

  return (
    <aside
      role="note"
      data-sticker-style={style}
      className={`sticker-card ${padClass} ${className}`.trim()}
      style={{
        ...customVars,
        borderRadius: radiusStyle,
        transform: tiltTransform,
      }}
    >
      {/* 1. Washi Tape + Folded Corner (`tape`) */}
      {style === 'tape' && (
        <>
          <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 z-10">
            <WashiTapeOrnament
              fill={tokens.badgeBg}
              stroke={tokens.border}
              pattern={kind === 'warning' ? 'caution' : 'stripe'}
              tiltDeg={kind === 'warning' ? 0.8 : -1.6}
            />
          </div>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-0.5 -right-0.5 w-5 h-5"
            viewBox="0 0 20 20"
          >
            <polygon points="0,0 20,0 0,20" fill={tokens.badgeBg} />
            <polygon points="20,0 20,20 0,20" fill="var(--surface-sheet)" />
            <line
              x1="0"
              y1="20"
              x2="20"
              y2="0"
              stroke={tokens.border}
              strokeWidth="1.6"
            />
          </svg>
        </>
      )}

      {/* 2. Sketched 3D Thumbtack (`pin`) */}
      {style === 'pin' && (
        <div className="pointer-events-none absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
          <PushpinOrnament fill={tokens.badgeBg} stroke={tokens.border} />
        </div>
      )}

      {/* 3. Corner Tape (`torn`) */}
      {style === 'torn' && (
        <div className="pointer-events-none absolute -top-2 -start-2 z-10">
          <WashiTapeOrnament
            fill={tokens.badgeBg}
            stroke={tokens.border}
            pattern="dots"
            tiltDeg={-26}
            compact
          />
        </div>
      )}

      {/* 4. Bent Wire Paperclip (`clip`) */}
      {style === 'clip' && (
        <div className="pointer-events-none absolute -top-3.5 end-6 z-10">
          <PaperclipOrnament stroke={tokens.border} />
        </div>
      )}

      {/* 5. Postmark Cancellation Stamp (`stamp`) */}
      {style === 'stamp' && (
        <div className="pointer-events-none absolute top-2.5 end-3 z-0">
          <PostmarkOrnament stroke={tokens.border} />
        </div>
      )}

      {/* 6. Perforated Loose-Leaf Punch Holes (`looseleaf`) */}
      {style === 'looseleaf' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2.5 start-2.5 w-4 flex flex-col justify-around items-center border-e border-dashed"
          style={{ borderColor: tokens.border, opacity: 0.82 }}
        >
          {[0, 1, 2].map((hole) => (
            <span
              key={hole}
              className="w-2.5 h-2.5 rounded-full border-[1.5px]"
              style={{
                backgroundColor: 'var(--surface-sheet)',
                borderColor: tokens.border,
              }}
            />
          ))}
        </div>
      )}

      {/* 7. Bookmark / Luggage Tag Eyelet (`tag`) */}
      {style === 'tag' && (
        <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-1.5 z-10">
          <TagEyeletOrnament stroke={tokens.border} badgeBg={tokens.badgeBg} />
        </div>
      )}

      {topRightControl && (
        <div className="absolute top-2 end-2 z-10">{topRightControl}</div>
      )}

      <div className="relative z-1 flex items-start gap-3">
        {/* Enclosed 32x32 Hand-Drawn Icon Stamp */}
        <div
          className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
          style={{
            backgroundColor: tokens.badgeBg,
            color: tokens.badgeFg,
            border: `1.5px solid ${tokens.border}`,
          }}
        >
          {ALERT_DOODLE_ICONS[kind]}
        </div>

        <div className="min-w-0 flex-1">{children({ tokens })}</div>
      </div>

      {style !== 'torn' && (
        <div
          className="pointer-events-none select-none absolute -bottom-2.5 end-2.5 opacity-85 rotate-6"
          aria-hidden="true"
        >
          {getAlertCornerPixelSticker(kind, 26)}
        </div>
      )}

      {style === 'torn' && (
        <div className="mt-2.5 -mx-2">
          <TornBottomEdge borderStroke={tokens.border} />
        </div>
      )}
    </aside>
  );
}

interface NotebookAlertProps {
  kind: AlertKind;
  stampText: string;
  title: string;
  bodyHtml: string;
  detailSummary?: string | null;
  detailHtml?: string | null;
  style?: string | null;
  tone?: string | null;
  badge?: string | null;
  align?: string | null;
  size?: string | null;
}

export function NotebookAlert({
  kind,
  stampText,
  title,
  bodyHtml,
  detailSummary,
  detailHtml,
  style: rawStyle,
  tone: rawTone,
  badge,
  align,
  size,
}: NotebookAlertProps) {
  const displayBadge = badge?.trim() || stampText;
  const alignCls =
    align === 'center'
      ? 'ink-align-center'
      : align === 'right'
        ? 'ink-align-right'
        : '';
  const rowAlignCls =
    align === 'center'
      ? 'justify-center'
      : align === 'right'
        ? 'justify-end'
        : '';
  const sizeCls =
    size === 'sm' || size === 'lg' || size === 'xl' || size === '2xl'
      ? `ink-size-${size}`
      : 'text-sm';

  return (
    <StickerCardFrame kind={kind} style={rawStyle} tone={rawTone}>
      {({ tokens }) => (
        <div className={alignCls || undefined}>
          {/* Tier 1: Stamp Badge + Handwritten Sticker Title */}
          <div className={`flex flex-wrap items-baseline gap-2 ${rowAlignCls}`}>
            <span
              className="font-hand text-xs sm:text-sm font-semibold tracking-wide px-2 py-0.5 rounded border border-dashed"
              style={{
                backgroundColor: tokens.badgeBg,
                color: tokens.badgeFg,
                borderColor: tokens.border,
              }}
            >
              {displayBadge}
            </span>
            {title && (
              <p
                className="font-hand text-base sm:text-lg font-semibold leading-snug m-0"
                style={{ color: tokens.title }}
              >
                {title}
              </p>
            )}
          </div>

          {/* Tier 2: Same-Hue Body Copy */}
          <div
            className={`mt-1.5 ${sizeCls} leading-relaxed`}
            style={{ color: tokens.body }}
          >
            <SafeHtml html={bodyHtml} />
          </div>

          {/* Tier 3: Searchable Native <details> Disclosure */}
          {detailSummary && detailHtml && (
            <details
              className="alert-disclosure mt-3 pt-2.5 border-t border-dashed"
              style={{ borderColor: tokens.border }}
            >
              <summary
                className="text-xs font-semibold select-none"
                style={{ color: tokens.title }}
              >
                <svg
                  className="disclosure-chevron w-3.5 h-3.5 shrink-0"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span>{detailSummary}</span>
              </summary>
              <div
                className="mt-2 text-xs sm:text-sm leading-relaxed"
                style={{ color: tokens.body }}
              >
                <SafeHtml html={detailHtml} />
              </div>
            </details>
          )}
        </div>
      )}
    </StickerCardFrame>
  );
}
