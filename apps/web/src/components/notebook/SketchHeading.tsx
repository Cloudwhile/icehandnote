import { SafeHtml, stripHtmlTags } from '../../lib/sanitizer';
import { IconCheck } from '../ui/Icons';

interface SectionTaskControl {
  checked: boolean;
  readOnly?: boolean;
  scopeLabel?: string;
  doneLabel: string;
  onToggle?: (checked: boolean) => void;
}

interface SketchHeadingProps {
  id: string;
  level: number;
  number: string;
  text: string;
  align?: string | null;
  jumpAriaLabel?: string;
  taskControl?: SectionTaskControl;
  /** Suppresses outer top margin when rendered as the top header of `.notebook-section-task` */
  inSectionTask?: boolean;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function SketchHeading({
  id,
  level,
  number,
  text,
  align,
  jumpAriaLabel,
  taskControl,
  inSectionTask = false,
}: SketchHeadingProps) {
  const alignWrapClass =
    align === 'center'
      ? 'ink-align-center'
      : align === 'right'
        ? 'ink-align-right'
        : '';
  const svgAlignClass =
    align === 'center'
      ? 'mx-auto'
      : align === 'right'
        ? 'ms-auto'
        : '';
  const seed = hashSeed(id + text);
  const y1 = 5.5 + (seed % 3) * 0.6;
  const y2 = 2.4 + ((seed >> 3) % 3) * 0.7;
  const y3 = 7.6 - ((seed >> 6) % 3) * 0.6;
  const y4 = 4.2 + ((seed >> 9) % 3) * 0.5;

  const markerVar = taskControl?.checked
    ? 'var(--accent-success-ink)'
    : level === 1
      ? 'var(--marker-h1)'
      : level === 2
        ? 'var(--marker-h2)'
        : level === 3
          ? 'var(--marker-h3)'
          : 'var(--marker-h4)';

  const sizeClass =
    level === 1
      ? 'text-2xl sm:text-3xl tracking-tight'
      : level === 2
        ? 'text-xl sm:text-2xl'
        : level === 3
          ? 'text-lg sm:text-xl'
          : 'text-base sm:text-lg';

  const Tag = (level === 1 ? 'h2' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4') as
    | 'h2'
    | 'h3'
    | 'h4';

  if (taskControl) {
    const isChecked = taskControl.checked;
    const isDisabled = Boolean(taskControl.readOnly || !taskControl.onToggle);

    return (
      <div
        id={id}
        className={`${inSectionTask ? 'mt-0 mb-3' : 'mt-10 mb-3'} scroll-mt-24 group ${alignWrapClass}`.trim()}
      >
        <div className="flex items-start justify-between gap-2">
          <Tag
            className={`${sizeClass} font-semibold m-0 leading-snug flex-1 min-w-0`}
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            <label
              className={`flex items-start gap-2.5 min-h-11 py-1 ${
                align === 'center'
                  ? 'justify-center'
                  : align === 'right'
                    ? 'justify-end'
                    : ''
              } ${isDisabled ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                className="notebook-step-checkbox mt-1!"
                checked={isChecked}
                disabled={isDisabled}
                onChange={(e) => taskControl.onToggle?.(e.target.checked)}
              />
              <span className="flex-1 min-w-0 leading-snug">
                <span
                  className={`inline-block align-middle font-mono text-xs font-semibold px-1.5 py-0.5 me-2 rounded-lg transition-colors ${
                    isChecked
                      ? 'bg-surface-sheet border border-border-subtle text-accent-success'
                      : 'bg-action-subtle text-link-ink'
                  }`}
                >
                  §{number}
                </span>
                <SafeHtml
                  as="span"
                  html={text}
                  className={`align-middle transition-colors ${
                    isChecked ? 'text-ink-secondary' : 'text-ink-primary'
                  }`}
                />
                {isChecked && (
                  <span className="inline-flex align-middle items-center gap-1 ms-2 px-2 py-0.5 rounded-md text-xs font-sans font-semibold leading-none ui-badge-pop bg-surface-sheet text-accent-success border border-border-subtle">
                    <IconCheck className="w-3 h-3" />
                    <span>{taskControl.doneLabel}</span>
                  </span>
                )}
              </span>
            </label>
          </Tag>

          <a
            href={`#${id}`}
            aria-label={jumpAriaLabel ?? `Jump to ${stripHtmlTags(text)}`}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-sm font-mono text-ink-muted hover:text-link-ink transition-opacity no-underline px-1.5 py-2 shrink-0"
          >
            #
          </a>
        </div>

        {/* Hand-drawn SVG wobbly marker underline (shifts to emerald when section task completed) */}
        <svg
          aria-hidden="true"
          className={`h-2.5 w-56 max-w-full -mt-1 block pointer-events-none ${svgAlignClass}`}
          viewBox="0 0 220 11"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d={`M3 ${y1} C 58 ${y2}, 118 ${y3}, 172 ${y4} C 192 ${y2 + 1}, 206 ${y3 - 1}, 217 ${y1}`}
            stroke={markerVar}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      id={id}
      className={`mt-10 mb-3 scroll-mt-24 group ${alignWrapClass}`.trim()}
    >
      <Tag
        className={`${sizeClass} font-semibold text-ink-primary inline-flex items-baseline gap-2.5 leading-snug m-0`}
        style={{ fontFamily: 'var(--font-hand)' }}
      >
        <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded-lg bg-surface-sunken text-ink-muted shrink-0">
          §{number}
        </span>
        <SafeHtml as="span" html={text} />
        <a
          href={`#${id}`}
          aria-label={jumpAriaLabel ?? `Jump to ${stripHtmlTags(text)}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-sm font-mono text-ink-muted hover:text-link-ink transition-opacity no-underline px-1"
        >
          #
        </a>
      </Tag>

      {/* Hand-drawn SVG wobbly marker underline */}
      <svg
        aria-hidden="true"
        className={`h-2.5 w-56 max-w-full -mt-0.5 block pointer-events-none ${svgAlignClass}`}
        viewBox="0 0 220 11"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d={`M3 ${y1} C 58 ${y2}, 118 ${y3}, 172 ${y4} C 192 ${y2 + 1}, 206 ${y3 - 1}, 217 ${y1}`}
          stroke={markerVar}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
