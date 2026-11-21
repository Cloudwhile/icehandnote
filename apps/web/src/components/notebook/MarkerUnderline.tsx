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
        className={className ?? 'w-72 max-w-full h-3 block pointer-events-none'}
        viewBox="0 0 280 12"
        fill="none"
      >
        <path
          d="M4 7 C 78 2, 162 10, 274 4.5"
          stroke="var(--marker-h1)"
          strokeWidth="3.8"
          strokeLinecap="round"
        />
        <path
          d="M28 10.2 C 110 7.5, 198 11, 255 8.5"
          stroke="var(--marker-h2)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (variant === 'canvas') {
    return (
      <svg
        aria-hidden="true"
        className={className ?? 'w-52 max-w-full h-2.5 block pointer-events-none'}
        viewBox="0 0 220 10"
        fill="none"
      >
        <path
          d="M3 6.5 C 65 2.5, 138 9, 216 4.2"
          stroke="var(--marker-h1)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={className ?? 'w-64 max-w-full h-3 mt-0.5 block pointer-events-none'}
      viewBox="0 0 260 12"
      fill="none"
    >
      <path
        d="M3 7.5 C 72 2.5, 155 10.5, 256 4.8"
        stroke="var(--marker-h1)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
