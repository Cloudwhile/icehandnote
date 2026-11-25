/*
 * Shared Hand-Drawn Marker Underline SVG (`HomePage`, `StepReaderPage`, `StudioEditorPanel`):
 * Eliminates repeated inline `<svg viewBox="...">` path definitions under headings.
 */

export interface MarkerUnderlineProps {
  variant?: 'hero' | 'h1' | 'canvas';
  className?: string;
}

export function MarkerUnderline({
  variant = 'h1',
  className,
}: MarkerUnderlineProps) {
  if (variant === 'hero') {
    return (
      <svg
        aria-hidden="true"
        className={className ?? 'w-24 sm:w-28 h-2 mt-1 block pointer-events-none'}
        viewBox="0 0 120 10"
        fill="none"
      >
        <path
          d="M2 6.2 C 34 3.2, 74 7.8, 114 4.2"
          stroke="var(--marker-h1)"
          strokeWidth="2.4"
          strokeOpacity="0.72"
          strokeLinecap="round"
        />
        <path
          d="M8 8.4 C 44 6.8, 72 8.8, 96 7.4"
          stroke="var(--marker-h2)"
          strokeWidth="1.4"
          strokeOpacity="0.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (variant === 'canvas') {
    return (
      <svg
        aria-hidden="true"
        className={className ?? 'w-20 max-w-full h-2 mt-0.5 block pointer-events-none'}
        viewBox="0 0 100 10"
        fill="none"
      >
        <path
          d="M2 6 C 30 3, 66 7.5, 96 4"
          stroke="var(--marker-h1)"
          strokeWidth="2.1"
          strokeOpacity="0.65"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={className ?? 'w-24 max-w-full h-2 mt-1 block pointer-events-none'}
      viewBox="0 0 110 10"
      fill="none"
    >
      <path
        d="M2 6.2 C 34 2.8, 72 7.8, 106 4.2"
        stroke="var(--marker-h1)"
        strokeWidth="2.2"
        strokeOpacity="0.68"
        strokeLinecap="round"
      />
    </svg>
  );
}
