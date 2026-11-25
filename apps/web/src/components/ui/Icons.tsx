/*
 * Unified Hand-Drawn Pen-and-Ink SVG Icon System (Refactoring UI §2.7.1 & §8.1)
 *
 * Every icon in this library is hand-crafted purely with organic Bézier `<path>` strokes
 * (zero rigid geometric `<rect>`, `<circle>`, `<line>`, `<polygon>`, or `<polyline>` primitives)
 * so every navigation chrome control, metadata chip, rich-text toolbar button, and series emblem
 * shares the unmistakable fountain-pen-on-notebook warmth of IceHandnote.
 *
 * Accessibility (`modern-web-guidance/icons`):
 * - All SVGs carry `aria-hidden="true"` and inherit `currentColor` for automatic light/dark >= 3:1 contrast.
 * - Parent icon-only controls supply their own `aria-label`.
 */

import type { JSX } from 'react';

interface IconProps {
  className?: string;
}

const PEN_DEFAULTS = {
  'aria-hidden': true as const,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.95',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconSnowflake({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 2.4 Q11.6 12 12.2 21.6" />
      <path d="M3.7 7.3 Q12 12.1 20.3 16.7" />
      <path d="M20.3 7.3 Q12 11.9 3.7 16.7" />
      <path d="M9.6 4.7 Q12 6.3 14.5 4.8" />
      <path d="M9.5 19.3 Q12 17.7 14.4 19.2" />
      <path d="M4.8 10.1 Q6.9 9.1 6.7 6.6" />
      <path d="M17.3 17.4 Q17.1 14.9 19.2 13.9" />
      <path d="M17.2 6.6 Q17.1 9.1 19.2 10.1" />
      <path d="M4.8 13.9 Q6.9 14.9 6.8 17.4" />
    </svg>
  );
}

export function IconHome({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.2 10.6 Q7.6 6.7 12.1 3.3 Q16.5 6.8 20.8 10.4" />
      <path d="M5.4 9.7 Q5.1 15 5.4 19.8 Q5.6 20.7 6.6 20.7 Q12 21 17.4 20.6 Q18.4 20.5 18.6 19.6 Q18.9 14.8 18.6 9.6" />
      <path d="M9.6 20.7 Q9.5 17.3 9.7 14.4 Q12 14 14.3 14.4 Q14.5 17.4 14.4 20.7" />
    </svg>
  );
}

export function IconSearch({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M10.8 4.1 C14.9 3.9 17.8 6.8 17.6 10.9 C17.4 14.8 14.6 17.7 10.6 17.6 C6.7 17.4 3.9 14.5 4.1 10.6 C4.3 6.7 7.1 4.2 10.8 4.1 Z" />
      <path d="M15.9 15.8 Q18.2 18 20.2 20.1" />
    </svg>
  );
}

export function IconPen({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M16.8 3.3 C18.1 2.2 19.8 2.4 20.7 3.4 C21.7 4.4 21.8 6.1 20.6 7.3 Q14.2 13.8 7.7 20.2 Q4.9 21 2.6 21.4 Q3 19.1 3.9 16.3 Q10.3 9.8 16.8 3.3 Z" />
      <path d="M14.7 5.4 Q16.8 7.2 18.6 9.3" />
    </svg>
  );
}

export function IconEdit({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M11.2 4.3 Q7.7 4.2 4.8 4.5 Q3.7 4.7 3.6 5.9 Q3.4 12.3 3.7 18.7 Q3.9 20 5.1 20.2 Q11.4 20.4 17.8 20.1 Q19 20 19.2 18.7 Q19.4 15.6 19.2 12.6" />
      <path d="M17.9 3.4 Q19.4 2.5 20.5 3.6 Q21.5 4.7 20.4 6.1 Q15.7 10.9 11 15.5 Q9.2 16 7.9 16.2 Q8.2 14.8 8.7 13.1 Q13.3 8.3 17.9 3.4 Z" />
    </svg>
  );
}

export function IconShield({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 21.7 C16.3 19.8 19.6 15.7 19.7 11.4 Q19.8 8.2 19.5 5.2 Q15.8 3.7 12 2.4 Q8.2 3.8 4.5 5.3 Q4.2 8.4 4.3 11.6 C4.4 15.9 7.8 19.8 12 21.7 Z" />
      <path d="M8.8 12.1 Q10.2 13.6 11.1 14.4 Q13.1 11.9 15.3 9.7" />
    </svg>
  );
}

export function IconPin({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 16.8 Q11.8 19.4 12.1 21.8" />
      <path d="M8.7 3.4 Q12 3 15.4 3.4 Q16.3 5 15 6.1 L15.2 10.5 Q16.7 11.7 18.2 13.1 Q19 14.5 18.7 16.4 Q12 16.8 5.3 16.4 Q5 14.5 5.8 13.1 Q7.4 11.7 8.9 10.5 L9.1 6.1 Q7.8 5 8.7 3.4 Z" />
    </svg>
  );
}

export function IconBook({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.3 19.2 Q4 12 4.3 4.8 C4.4 3.2 5.6 2.3 7.1 2.3 Q13.4 2.1 19.6 2.4 Q19.8 11.8 19.6 21.3 Q13.3 21.5 6.9 21.3 C5.2 21.3 4.2 20.1 4.3 18.6 C4.4 17.2 5.4 16.3 7 16.3 Q13.3 16.2 19.5 16.4" />
      <path d="M8.6 6.9 Q12 6.6 15.6 7" />
    </svg>
  );
}

export function IconNotebook({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.4 3.2 Q12.8 2.9 18.6 3.3 Q19.6 3.5 19.7 4.7 Q19.9 12 19.7 19.3 Q19.5 20.6 18.3 20.7 Q12.4 21 6.5 20.6 Q5.4 20.4 5.3 19.2 Q5.1 11.9 5.3 4.6 Q5.4 3.4 6.4 3.2 Z" />
      <path d="M3.2 7.1 Q4.6 6.8 6.4 7.2" />
      <path d="M3.2 12 Q4.6 11.8 6.4 12.1" />
      <path d="M3.2 16.9 Q4.6 16.7 6.4 17" />
      <path d="M9.3 8.2 Q12.6 7.9 15.8 8.3" />
      <path d="M9.3 12.2 Q12.1 11.9 14.9 12.3" />
    </svg>
  );
}

export function IconFeather({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M20.3 3.7 C15.2 3.4 10.6 5.9 7.8 10.6 Q5.8 14.3 4.8 18.9 Q9.3 18 13.1 16 C17.8 13.3 20.5 8.8 20.3 3.7 Z" />
      <path d="M3.3 20.6 Q10.6 13.4 17.6 6.4" />
      <path d="M12.8 15.9 Q10.2 15.8 8.2 15.6" />
    </svg>
  );
}

export function IconBolt({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M13.2 2.4 Q8.4 7.9 3.9 13.6 Q7.8 13.8 11.8 13.7 Q11.4 17.6 10.8 21.5 Q15.7 15.9 20.2 10.2 Q16.2 10.1 12.2 10.2 Q12.8 6.3 13.2 2.4 Z" />
    </svg>
  );
}

export function IconGrid({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.6 4 Q6.8 3.6 9.9 3.9 Q10.2 6.8 10 9.9 Q6.8 10.2 3.7 10 Q3.4 6.9 3.6 4 Z" />
      <path d="M14.1 3.9 Q17.2 3.6 20.3 4 Q20.6 6.9 20.3 9.9 Q17.2 10.2 14.1 9.9 Q13.8 6.9 14.1 3.9 Z" />
      <path d="M3.7 14.1 Q6.8 13.8 9.9 14.1 Q10.2 17.1 10 20.2 Q6.8 20.5 3.7 20.1 Q3.4 17.1 3.7 14.1 Z" />
      <path d="M14.1 14.1 Q17.2 13.8 20.3 14.1 Q20.5 17.1 20.2 20.2 Q17.2 20.5 14.1 20.1 Q13.8 17.1 14.1 14.1 Z" />
    </svg>
  );
}

export function IconLayers({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 2.7 Q7.2 4.8 2.6 7.1 Q7.2 9.4 12 11.7 Q16.8 9.4 21.4 7.1 Q16.8 4.8 12 2.7 Z" />
      <path d="M2.6 12 Q7.3 14.4 12 16.7 Q16.7 14.4 21.4 12" />
      <path d="M2.6 16.9 Q7.3 19.3 12 21.5 Q16.7 19.3 21.4 16.9" />
    </svg>
  );
}

export function IconMenu({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.2 6.8 Q12 6.3 19.8 6.9" />
      <path d="M4.1 12.1 Q12 11.7 19.9 12.1" />
      <path d="M4.3 17.3 Q12 16.9 19.7 17.2" />
    </svg>
  );
}

export function IconClose({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M17.8 6.1 Q11.8 12 6.2 17.9" />
      <path d="M6.2 6.1 Q12.1 11.9 17.8 17.9" />
    </svg>
  );
}

export function IconSun({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 8.1 C14.5 8 16.1 9.8 16 12.1 C15.9 14.4 14.1 16 11.9 15.9 C9.6 15.8 8 14 8.1 11.8 C8.2 9.7 9.9 8.2 12.1 8.1 Z" />
      <path d="M12 2.4 Q11.8 3.5 12.1 4.4" />
      <path d="M12.1 19.6 Q11.8 20.6 12 21.6" />
      <path d="M5.1 5.1 Q5.9 5.9 6.6 6.6" />
      <path d="M17.4 17.4 Q18.1 18.2 18.9 18.9" />
      <path d="M2.4 12.1 Q3.4 11.8 4.4 12" />
      <path d="M19.6 12 Q20.6 12.2 21.6 12" />
      <path d="M6.6 17.4 Q5.8 18.2 5.1 18.9" />
      <path d="M18.9 5.1 Q18.1 5.9 17.4 6.6" />
    </svg>
  );
}

export function IconMoon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.2 3.3 C9.9 6.8 11.1 11.6 15.1 13.1 C17 13.8 19 13.5 20.6 12.6 C19.9 17.3 15.6 20.8 10.6 20.3 C5.7 19.9 2.4 15.5 3.1 10.7 C3.7 6.1 7.7 3.1 12.2 3.3 Z" />
    </svg>
  );
}

export function IconSidebarToggle({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.6 4.2 Q12 3.8 19.4 4.2 Q20.7 4.4 20.8 5.8 Q21 12 20.8 18.2 Q20.6 19.6 19.3 19.8 Q12 20.1 4.7 19.8 Q3.4 19.6 3.2 18.2 Q3 12 3.2 5.8 Q3.4 4.4 4.6 4.2 Z" />
      <path d="M9.1 4.2 Q8.8 12 9.1 19.8" />
    </svg>
  );
}

export function IconList({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M8.3 6.2 Q14.4 5.8 20.4 6.3" />
      <path d="M8.3 12.1 Q14.4 11.8 20.4 12.1" />
      <path d="M8.3 17.9 Q14.4 17.6 20.4 18" />
      <path d="M3.4 6.2 Q4 5.9 4.5 6.3" />
      <path d="M3.4 12.1 Q4 11.8 4.5 12.1" />
      <path d="M3.4 17.9 Q4 17.7 4.5 18" />
    </svg>
  );
}

export function IconSettings({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 9.1 C13.8 9 15 10.3 14.9 12.1 C14.8 13.8 13.6 15 11.9 14.9 C10.2 14.8 9 13.6 9.1 11.9 C9.2 10.3 10.4 9.2 12.1 9.1 Z" />
      <path d="M19.3 14.9 Q19.7 16 19.9 16.9 C20.4 18.2 18.6 20.2 17.2 19.6 Q16.1 19.2 15.1 19.4 Q14.1 20.4 13.9 21.3 C13.4 22.4 10.6 22.4 10.1 21.3 Q9.8 20.3 8.9 19.4 Q7.9 19.1 6.8 19.6 C5.3 20.1 3.7 18.3 4.2 16.9 Q4.6 15.9 4.4 14.9 Q3.6 14 2.7 13.8 C1.6 13.3 1.6 10.6 2.7 10.1 Q3.7 9.8 4.6 8.9 Q4.8 7.9 4.2 6.9 C3.7 5.4 5.5 3.7 6.9 4.3 Q8 4.7 9 4.4 Q10 3.7 10.2 2.7 C10.7 1.6 13.4 1.6 13.9 2.7 Q14.2 3.7 15.1 4.5 Q16.1 4.8 17.2 4.3 C18.6 3.7 20.3 5.5 19.8 6.9 Q19.3 8 19.6 9 Q20.5 9.9 21.4 10.1 C22.4 10.6 22.4 13.3 21.3 13.9 Q20.2 14.1 19.3 14.9 Z" />
    </svg>
  );
}

export function IconCheck({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} strokeWidth="2.35" className={`${className} shrink-0`}>
      <path d="M4.6 12.2 Q7.2 14.8 9.2 16.9 Q13.8 11.1 19.6 6.2" />
    </svg>
  );
}

export function IconCheckSquare({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M5.2 3.6 Q12 3.2 18.8 3.7 Q20.3 3.9 20.4 5.3 Q20.7 12 20.3 18.7 Q20.1 20.2 18.7 20.4 Q12 20.7 5.3 20.3 Q3.8 20.1 3.7 18.7 Q3.4 12 3.8 5.3 Q3.9 3.8 5.2 3.6 Z" />
      <path d="M8.3 12.4 Q10 14.2 11.2 15.1 Q13.5 12.3 16 9.8" />
    </svg>
  );
}

export function IconSquareEmpty({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M5.4 4.1 Q12 3.7 18.6 4.2 Q19.9 4.4 20 5.6 Q20.2 12 19.9 18.4 Q19.7 19.7 18.5 19.9 Q12 20.2 5.5 19.8 Q4.2 19.6 4.1 18.4 Q3.8 12 4.2 5.6 Q4.3 4.3 5.4 4.1 Z" />
    </svg>
  );
}

export function IconArrowUp({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 19.2 Q11.7 12.1 12 5.1" />
      <path d="M5.4 11.7 Q8.8 8.3 12 5.1 Q15.2 8.4 18.7 11.6" />
    </svg>
  );
}

export function IconArrowDown({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 4.9 Q12.3 11.9 12 19" />
      <path d="M18.6 12.3 Q15.3 15.8 12 19 Q8.7 15.7 5.4 12.4" />
    </svg>
  );
}

export function IconArrowLeft({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M19.1 12.1 Q12.1 11.7 5.1 12" />
      <path d="M11.7 18.6 Q8.3 15.2 5.1 12 Q8.4 8.7 11.6 5.4" />
    </svg>
  );
}

export function IconArrowRight({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.9 12 Q11.9 12.3 19 12" />
      <path d="M12.3 5.4 Q15.8 8.8 19 12 Q15.7 15.2 12.4 18.6" />
    </svg>
  );
}

export function IconChevronDown({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.2 9.2 Q9.2 12.2 12.1 14.9 Q15 12.1 17.9 9.1" />
    </svg>
  );
}

export function IconChevronUp({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.1 14.8 Q9.1 11.9 12 9.1 Q14.9 12 17.9 14.9" />
    </svg>
  );
}

export function IconChevronRight({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M9.1 6.1 Q12.1 9.1 14.9 12 Q12.1 15 9.2 17.9" />
    </svg>
  );
}

export function IconChevronLeft({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M14.9 6.1 Q11.9 9.1 9.1 12 Q11.9 15 14.8 17.9" />
    </svg>
  );
}

export function IconPlus({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 4.8 Q11.7 12 12.1 19.2" />
      <path d="M4.9 12.1 Q12 11.7 19.1 12" />
    </svg>
  );
}

export function IconCopy({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M10.4 9.1 Q15.3 8.9 20.1 9.2 Q21.2 9.4 21.3 10.6 Q21.5 15.2 21.2 19.8 Q21 21 19.8 21.1 Q15.2 21.4 10.5 21.1 Q9.3 20.9 9.2 19.7 Q9 15 9.3 10.4 Q9.4 9.3 10.4 9.1 Z" />
      <path d="M5.1 14.8 Q3.4 14.6 3.2 12.9 Q3 8.6 3.3 4.3 Q3.5 3.1 4.7 3 Q9 2.7 13.3 3 Q14.6 3.2 14.8 4.8" />
    </svg>
  );
}

export function IconTrash({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.6 6.2 Q12 5.7 20.4 6.2" />
      <path d="M8.5 6.1 Q8.7 4.2 9.4 3.4 Q12 3.1 14.6 3.4 Q15.4 4.2 15.5 6.1" />
      <path d="M18.6 6.3 Q18.4 12.7 17.9 19.1 Q17.6 20.4 16.3 20.5 Q12 20.8 7.7 20.5 Q6.4 20.3 6.1 19 Q5.6 12.6 5.4 6.2" />
      <path d="M10.2 10.3 Q10.1 13.5 10.3 16.6" />
      <path d="M13.9 10.3 Q13.7 13.5 13.9 16.6" />
    </svg>
  );
}

export function IconCode({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M15.8 17.7 Q18.7 14.8 21.3 11.9 Q18.6 9.1 15.9 6.3" />
      <path d="M8.2 6.3 Q5.4 9.2 2.7 12.1 Q5.4 14.9 8.1 17.7" />
      <path d="M13.6 4.7 Q11.8 12.1 10.3 19.3" />
    </svg>
  );
}

export function IconTerminal({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.1 4.7 Q12 4.2 19.9 4.7 Q21.1 5 21.2 6.2 Q21.4 12 21.1 17.8 Q20.9 19.1 19.7 19.3 Q12 19.7 4.3 19.3 Q3 19.1 2.9 17.8 Q2.6 12 2.9 6.2 Q3.1 4.9 4.1 4.7 Z" />
      <path d="M6.4 9.4 Q8.4 10.9 9.7 12.1 Q8.3 13.5 6.4 14.8" />
      <path d="M12.2 15.1 Q15 14.8 17.6 15.1" />
    </svg>
  );
}

export function IconCube({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 2.6 Q16.3 4.8 20.1 7.2 Q20.4 12 20.1 16.8 Q16.1 19.3 12 21.5 Q7.9 19.2 3.9 16.8 Q3.6 12 3.9 7.2 Q7.7 4.8 12 2.6 Z" />
      <path d="M4.1 7.3 Q8.1 9.8 12 12 Q15.9 9.7 19.9 7.3" />
      <path d="M12 12 Q11.8 16.7 12.1 21.3" />
    </svg>
  );
}

export function IconQuote({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M10.1 11.1 Q8.1 11.2 6.1 11.1 Q5 10.9 4.9 9.7 Q4.8 8.3 5 7 Q5.2 6 6.2 5.9 Q7.6 5.8 9 6 Q10 6.1 10.1 7.3 Q10.2 10.5 9.9 13.4 C9.6 15.7 8 17.5 5.6 18.2" />
      <path d="M19.1 11.1 Q17.1 11.2 15.1 11.1 Q14 10.9 13.9 9.7 Q13.8 8.3 14 7 Q14.2 6 15.2 5.9 Q16.6 5.8 18 6 Q19 6.1 19.1 7.3 Q19.2 10.5 18.9 13.4 C18.6 15.7 17 17.5 14.6 18.2" />
    </svg>
  );
}

export function IconDiagram({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.2 4.2 Q6.1 3.9 8.8 4.2 Q9.5 4.4 9.6 5.2 Q9.7 7.2 9.5 9.2 Q9.3 10 8.5 10.1 Q5.9 10.3 3.3 10.1 Q2.5 9.9 2.4 9.1 Q2.3 7.1 2.4 5.1 Q2.5 4.3 3.2 4.2 Z" />
      <path d="M15.4 14.1 Q18.2 13.8 20.9 14.1 Q21.6 14.3 21.7 15.1 Q21.8 17.1 21.6 19.1 Q21.4 19.9 20.6 20 Q18 20.2 15.4 20 Q14.6 19.8 14.5 19 Q14.4 17 14.5 15 Q14.6 14.2 15.4 14.1 Z" />
      <path d="M9.7 7 Q12.3 6.9 14.2 7.5 Q15.3 8.1 15.3 10.2 L15.2 13.6" />
      <path d="M13.2 11.9 Q14.3 13 15.2 13.7 Q16.2 12.9 17.2 11.9" />
    </svg>
  );
}

export function IconHeading({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.1 4.2 Q5.8 12 6.2 19.8" />
      <path d="M17.9 4.2 Q18.2 12 17.8 19.8" />
      <path d="M6.1 12.1 Q12 11.6 17.9 12.1" />
    </svg>
  );
}

export function IconParagraph({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.1 6.2 Q12 5.8 19.8 6.2" />
      <path d="M4.1 11.2 Q12 10.9 19.8 11.2" />
      <path d="M4.1 16.3 Q9.6 15.9 15.1 16.3" />
    </svg>
  );
}

export function IconAlertCircle({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 3.1 C17 3 21 6.9 20.9 12 C20.8 17 16.9 21 11.9 20.9 C6.9 20.8 3 16.9 3.1 11.9 C3.2 7 7 3.2 12.1 3.1 Z" />
      <path d="M12 7.9 Q11.8 10.1 12.1 12.2" />
      <path d="M11.9 16.1 Q12.1 15.8 12.3 16.2" />
    </svg>
  );
}

export function IconFileCode({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M14.1 2.4 Q10 2.1 5.9 2.4 Q4.3 2.7 4.2 4.3 Q3.9 12 4.2 19.7 Q4.4 21.3 6 21.5 Q12 21.8 18 21.5 Q19.5 21.3 19.8 19.8 Q20 13.9 19.8 8.1 Q16.9 5.3 14.1 2.4 Z" />
      <path d="M14 2.6 Q13.8 5.4 14.1 8 Q16.9 8.2 19.7 8" />
      <path d="M10.2 13 Q8.9 14.1 8 15 Q9 16.1 10.2 17.1" />
      <path d="M14 17 Q15.3 16 16.2 15 Q15.2 14 14 13" />
    </svg>
  );
}

export function IconGlobe({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 3.1 C17.1 3 21 7 20.9 12.1 C20.8 17.1 16.9 21 11.9 20.9 C6.9 20.8 3 16.9 3.1 11.9 C3.2 7 7.1 3.2 12.1 3.1 Z" />
      <path d="M3.7 9.1 Q12 8.5 20.3 9.1" />
      <path d="M3.7 15.1 Q12 15.7 20.3 15.1" />
      <path d="M12 3.2 C15.2 6.8 15.1 17.1 12 20.8" />
      <path d="M12 3.2 C8.8 6.9 8.9 17.2 12 20.8" />
    </svg>
  );
}

export function IconMoreHorizontal({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} strokeWidth="2.4" className={`${className} shrink-0`}>
      <path d="M5.2 12.1 C5.6 11.4 6.5 11.6 6.3 12.3 C6.1 12.8 5 12.7 5.2 12.1 Z" fill="currentColor" />
      <path d="M11.4 12 C11.8 11.3 12.7 11.6 12.5 12.2 C12.3 12.7 11.2 12.7 11.4 12 Z" fill="currentColor" />
      <path d="M17.6 12.1 C18 11.4 18.9 11.6 18.7 12.3 C18.5 12.8 17.4 12.7 17.6 12.1 Z" fill="currentColor" />
    </svg>
  );
}

export function IconExternalLink({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M14.1 5.1 Q16.6 4.8 18.9 5.1 Q19.2 7.5 18.9 10" />
      <path d="M10.1 13.9 Q14.5 9.5 18.8 5.2" />
      <path d="M18.9 13.2 Q19.1 16.3 18.8 19.3 Q18.5 20.5 17.2 20.7 Q11.5 21 5.8 20.7 Q4.5 20.5 4.3 19.2 Q4 13.5 4.3 7.8 Q4.5 6.5 5.8 6.3 Q8.3 6.1 10.9 6.3" />
    </svg>
  );
}

export function IconLogOut({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M9.1 20.6 Q6.8 20.8 4.4 20.5 Q3.3 20.3 3.2 19 Q2.9 12 3.2 5 Q3.4 3.7 4.5 3.5 Q6.8 3.2 9.1 3.5" />
      <path d="M15.8 16.9 Q18.5 14.5 20.9 12 Q18.4 9.6 15.9 7.1" />
      <path d="M20.7 12.1 Q15 11.7 9.2 12.1" />
    </svg>
  );
}

export function IconImage({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.6 3.3 Q12 2.9 19.4 3.3 Q20.8 3.6 20.9 5.1 Q21.2 12 20.9 18.9 Q20.7 20.4 19.2 20.6 Q12 21 4.8 20.6 Q3.4 20.4 3.2 18.9 Q2.9 12 3.2 5.1 Q3.4 3.5 4.6 3.3 Z" />
      <path d="M8.6 7.3 C9.7 7.2 10.2 8.2 10 9.1 C9.8 10 8.5 10.2 7.8 9.6 C7 8.9 7.5 7.4 8.6 7.3 Z" />
      <path d="M20.7 15.1 Q18.1 12.4 15.7 10.2 Q10.6 15.4 5.3 20.5" />
    </svg>
  );
}

export function IconCoverBanner({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.8 5.2 Q12 4.6 20.2 5.2 Q21.4 5.5 21.5 6.8 Q21.7 12 21.4 17.2 Q21.2 18.5 20 18.7 Q12 19.2 4 18.7 Q2.8 18.5 2.6 17.2 Q2.4 12 2.7 6.8 Q2.8 5.4 3.8 5.2 Z" />
      <path d="M3.1 15.2 Q8.3 10.9 12.1 13.7 Q15.9 9.7 21.1 14.1" />
      <path d="M7.6 8.6 C8.4 8.5 8.9 9.3 8.7 9.9 C8.4 10.5 7.4 10.6 7 10 C6.6 9.4 7 8.7 7.6 8.6 Z" />
    </svg>
  );
}

export function IconUpload({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M20.8 15.1 Q21.1 17.3 20.7 19.3 Q20.4 20.5 19.1 20.7 Q12 21 4.9 20.7 Q3.6 20.5 3.3 19.2 Q3 17.2 3.3 15.1" />
      <path d="M16.9 8.1 Q14.5 5.6 12 3.2 Q9.5 5.7 7.1 8.1" />
      <path d="M12 3.4 Q11.7 9.2 12.1 14.9" />
    </svg>
  );
}

export function IconDownload({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M20.8 15.1 Q21.1 17.3 20.7 19.3 Q20.4 20.5 19.1 20.7 Q12 21 4.9 20.7 Q3.6 20.5 3.3 19.2 Q3 17.2 3.3 15.1" />
      <path d="M7.2 10.3 Q9.6 12.9 12 15.3 Q14.5 12.8 16.8 10.2" />
      <path d="M12 3.5 Q12.3 9.3 12 15" />
    </svg>
  );
}

export function IconMonitor({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.7 3.3 Q12 2.9 20.3 3.4 Q21.6 3.7 21.7 5.1 Q21.9 10.2 21.6 15.3 Q21.4 16.7 20.1 16.9 Q12 17.3 3.9 16.9 Q2.6 16.7 2.4 15.3 Q2.2 10.2 2.4 5.1 Q2.6 3.6 3.7 3.3 Z" />
      <path d="M8.1 20.9 Q12 20.6 15.9 20.9" />
      <path d="M12 17 Q11.8 18.9 12.1 20.8" />
    </svg>
  );
}

export function IconSmartphone({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M7.1 2.4 Q12 2 16.9 2.4 Q18.6 2.7 18.8 4.4 Q19.1 12 18.8 19.6 Q18.6 21.3 16.9 21.6 Q12 22 7.1 21.6 Q5.4 21.3 5.2 19.6 Q4.9 12 5.2 4.4 Q5.4 2.7 7.1 2.4 Z" />
      <path d="M11.1 18 Q12 17.8 12.9 18" />
    </svg>
  );
}

export function IconEye({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M2.3 12 C4.9 7.2 8.2 5.1 12 5.1 C15.8 5.1 19.2 7.2 21.7 12 C19.1 16.8 15.8 18.9 12 18.9 C8.2 18.9 4.8 16.8 2.3 12 Z" />
      <path d="M12.1 9.2 C13.8 9.1 14.9 10.4 14.8 12.1 C14.7 13.7 13.5 14.9 11.9 14.8 C10.3 14.7 9.2 13.5 9.3 11.9 C9.4 10.4 10.5 9.3 12.1 9.2 Z" />
    </svg>
  );
}

export function IconEyeOff({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M10.7 5.3 C15.1 4.9 19.1 7.2 21.7 12 Q20.9 13.4 20.1 14.3" />
      <path d="M14.1 14.1 C12.8 15.2 10.9 15 10 13.8 C9.2 12.9 9.2 11.3 10.1 10.2" />
      <path d="M17.3 17.5 C12.4 20.4 6.2 18.7 2.3 12 Q4.2 8.8 6.8 7" />
      <path d="M2.4 2.4 Q12.1 12 21.6 21.6" />
    </svg>
  );
}

export function IconKey({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M7.6 10.2 C10.8 10.1 13.1 12.5 12.9 15.6 C12.7 18.6 10.5 21 7.4 20.9 C4.4 20.7 2.1 18.4 2.3 15.3 C2.4 12.3 4.7 10.3 7.6 10.2 Z" />
      <path d="M11.6 11.6 Q16.3 6.9 20.9 2.3" />
      <path d="M15.7 7.5 Q17.2 8.9 18.6 10.3 Q20.3 8.6 21.7 7 Q20.3 5.5 18.8 4.2" />
    </svg>
  );
}

export function IconGripVertical({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} strokeWidth="2.3" className={`${className} shrink-0`}>
      <path d="M9 5.5 C9.4 4.8 10.2 5.1 10 5.7 C9.8 6.2 8.8 6.1 9 5.5 Z" fill="currentColor" />
      <path d="M14.4 5.5 C14.8 4.8 15.6 5.1 15.4 5.7 C15.2 6.2 14.2 6.1 14.4 5.5 Z" fill="currentColor" />
      <path d="M9 12 C9.4 11.3 10.2 11.6 10 12.2 C9.8 12.7 8.8 12.6 9 12 Z" fill="currentColor" />
      <path d="M14.4 12 C14.8 11.3 15.6 11.6 15.4 12.2 C15.2 12.7 14.2 12.6 14.4 12 Z" fill="currentColor" />
      <path d="M9 18.5 C9.4 17.8 10.2 18.1 10 18.7 C9.8 19.2 8.8 19.1 9 18.5 Z" fill="currentColor" />
      <path d="M14.4 18.5 C14.8 17.8 15.6 18.1 15.4 18.7 C15.2 19.2 14.2 19.1 14.4 18.5 Z" fill="currentColor" />
    </svg>
  );
}

export function IconPalette({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 2.3 C6.7 2.2 2.2 6.6 2.3 12.1 C2.4 17.5 6.8 21.8 12.1 21.7 C13.2 21.7 13.7 20.9 13.7 20.1 C13.7 19.4 13.1 18.6 13.1 17.8 C13.1 16.9 13.8 16.2 14.8 16.2 L16.7 16.2 C19.8 16.2 21.8 13.7 21.7 10.6 C21.6 6 17.4 2.4 12.1 2.3 Z" />
      <path d="M13.5 6.6 C13.9 6 14.7 6.3 14.4 6.9 C14.1 7.3 13.2 7.2 13.5 6.6 Z" fill="currentColor" />
      <path d="M17.2 10.5 C17.6 9.9 18.4 10.2 18.1 10.8 C17.8 11.2 16.9 11.1 17.2 10.5 Z" fill="currentColor" />
      <path d="M8.5 7.6 C8.9 7 9.7 7.3 9.4 7.9 C9.1 8.3 8.2 8.2 8.5 7.6 Z" fill="currentColor" />
      <path d="M6.4 12.4 C6.8 11.8 7.6 12.1 7.3 12.7 C7 13.1 6.1 13 6.4 12.4 Z" fill="currentColor" />
    </svg>
  );
}

export function IconPixelSticker({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M15 3.3 Q10.5 3.1 6.1 3.4 C4.3 3.6 3.3 4.8 3.2 6.5 Q3 12.2 3.3 17.9 C3.4 19.6 4.6 20.7 6.3 20.8 L13.1 20.8 Q16.9 16.9 20.8 13 L20.8 6.3 C20.7 4.6 19.5 3.4 17.8 3.3 Z" />
      <path d="M13.1 20.7 Q12.9 18 13.2 15.6 C13.5 14 14.7 13.1 16.3 13 Q18.5 12.9 20.7 13" />
      <path d="M7.6 7.8 Q9.1 7.5 10.6 7.8 Q10.8 9.2 10.5 10.6 Q9 10.9 7.6 10.6 Q7.4 9.2 7.6 7.8 Z" fill="currentColor" />
      <path d="M11.6 10.8 Q13.1 10.5 14.5 10.8 Q14.7 12.2 14.4 13.6 Q13 13.8 11.6 13.5 Q11.4 12.2 11.6 10.8 Z" fill="currentColor" />
    </svg>
  );
}

export function IconLock({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M5.4 11 Q12 10.6 18.6 11.1 Q19.9 11.3 20 12.7 Q20.3 16 19.9 19.3 Q19.7 20.6 18.3 20.8 Q12 21.1 5.7 20.7 Q4.4 20.5 4.2 19.2 Q3.9 16 4.2 12.7 Q4.4 11.3 5.4 11 Z" />
      <path d="M8.1 11 Q7.9 8.7 8.1 6.9 C8.3 4.5 10 3.2 12 3.2 C14.1 3.2 15.8 4.6 15.9 7 Q16.1 8.8 15.9 11" />
      <path d="M12 14.9 C12.7 14.9 13 15.6 12.6 16.2 Q12 17.3 12.1 18.4" />
    </svg>
  );
}

export function IconUnlock({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M5.4 11 Q12 10.6 18.6 11.1 Q19.9 11.3 20 12.7 Q20.3 16 19.9 19.3 Q19.7 20.6 18.3 20.8 Q12 21.1 5.7 20.7 Q4.4 20.5 4.2 19.2 Q3.9 16 4.2 12.7 Q4.4 11.3 5.4 11 Z" />
      <path d="M8.1 11 Q7.9 8.7 8.1 6.9 C8.3 4.3 10.3 3 12.5 3.2 C14 3.3 15 4 15.6 5.1" />
      <path d="M12 14.9 C12.7 14.9 13 15.6 12.6 16.2 Q12 17.3 12.1 18.4" />
    </svg>
  );
}

export function IconSparkBullet({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 3.2 C12.9 7.6 16.4 11.1 20.8 12 C16.4 12.9 12.9 16.4 12 20.8 C11.1 16.4 7.6 12.9 3.2 12 C7.6 11.1 11.1 7.6 12 3.2 Z" />
    </svg>
  );
}

export function IconSparkles({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M11.6 3.1 C12.4 7.1 14.9 9.6 18.9 10.4 C14.9 11.2 12.4 13.7 11.6 17.7 C10.8 13.7 8.3 11.2 4.3 10.4 C8.3 9.6 10.8 7.1 11.6 3.1 Z" />
      <path d="M18.6 15.2 Q19.1 17 20.8 17.5 Q19.1 18 18.6 19.8 Q18.1 18 16.4 17.5 Q18.1 17 18.6 15.2 Z" />
      <path d="M5.6 3.8 Q5.9 4.9 7 5.2 Q5.9 5.5 5.6 6.6 Q5.3 5.5 4.2 5.2 Q5.3 4.9 5.6 3.8 Z" />
    </svg>
  );
}

export function IconHeart({
  className = 'w-4 h-4',
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...PEN_DEFAULTS}
      fill={filled ? 'currentColor' : 'none'}
      className={`${className} shrink-0`}
    >
      <path d="M12 20.4 C7.7 17.8 3.9 14.6 3 11.3 C1.8 7.6 4.1 4.5 7.5 4.6 C9.5 4.7 11.1 5.7 12 7.2 C12.9 5.7 14.5 4.7 16.5 4.6 C19.9 4.5 22.2 7.6 21 11.3 C20.1 14.6 16.3 17.8 12 20.4 Z" />
    </svg>
  );
}

export function IconAlertTriangle({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M10.4 4.1 Q6.3 11.1 2.6 18.1 C2 19.3 2.8 20.7 4.2 20.8 Q12 21.1 19.8 20.8 C21.2 20.7 22 19.3 21.4 18.1 Q17.6 11.1 13.6 4.1 C12.9 2.9 11.1 2.9 10.4 4.1 Z" />
      <path d="M12 9.1 Q11.8 11.3 12.1 13.4" />
      <path d="M11.9 17.1 Q12.1 16.8 12.3 17.2" />
    </svg>
  );
}

export function IconArrowLeftRight({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.2 8.1 Q11.8 7.7 19.3 8.1" />
      <path d="M15.7 4.6 Q17.6 6.4 19.5 8.1 Q17.5 9.8 15.6 11.5" />
      <path d="M19.8 16 Q12.2 16.3 4.7 16" />
      <path d="M8.3 12.5 Q6.4 14.2 4.5 16 Q6.5 17.7 8.4 19.4" />
    </svg>
  );
}

export function IconBold({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} strokeWidth="2.35" className={`${className} shrink-0`}>
      <path d="M6.3 4.3 Q10 4 13.4 4.3 C15.7 4.4 17.3 5.9 17.2 8.1 C17.1 10.2 15.6 11.7 13.3 11.9 Q9.8 12.1 6.3 11.9 Q6 8.1 6.3 4.3 Z" />
      <path d="M6.3 11.9 Q10.4 11.7 14.4 12 C16.7 12.1 18.3 13.7 18.2 15.9 C18.1 18.2 16.5 19.7 14.2 19.8 Q10.2 20.1 6.3 19.8 Q6 15.8 6.3 11.9 Z" />
    </svg>
  );
}

export function IconItalic({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M18.8 4.2 Q14.5 3.9 10.2 4.3" />
      <path d="M13.8 19.8 Q9.5 20.1 5.2 19.8" />
      <path d="M14.9 4.3 Q12.1 12 9.2 19.7" />
    </svg>
  );
}

export function IconUnderline({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.2 4.2 Q6 7.7 6.3 11.1 C6.5 14.4 8.9 16.4 12 16.4 C15.1 16.4 17.5 14.4 17.7 11.1 Q18 7.7 17.8 4.2" />
      <path d="M4.2 20 Q12 19.4 19.8 20.1" />
    </svg>
  );
}

export function IconStrikethrough({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.1 12.1 Q12 11.6 19.9 12.1" />
      <path d="M16.4 7.5 C16.3 5.4 14.4 4.1 12 4.1 C9.6 4.1 7.6 5.3 7.6 7.2 C7.6 8.6 8.4 9.3 9.7 9.9" />
      <path d="M14.7 14.3 C15.8 14.9 16.4 15.7 16.4 16.9 C16.4 18.9 14.4 20 11.9 20 C9.4 20 7.6 18.8 7.3 17" />
    </svg>
  );
}

export function IconInlineCode({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path
        d="M5.6 5.2 Q12 4.8 18.4 5.2 Q21.1 5.5 21.3 8.1 Q21.6 12 21.3 15.9 Q21.1 18.5 18.4 18.8 Q12 19.2 5.6 18.8 Q2.9 18.5 2.7 15.9 Q2.4 12 2.7 8.1 Q2.9 5.5 5.6 5.2 Z"
        strokeDasharray="3 2.2"
      />
      <path d="M9.1 9.5 Q7.6 10.9 6.3 12 Q7.7 13.2 9.1 14.5" />
      <path d="M14.9 9.5 Q16.4 10.9 17.7 12 Q16.3 13.2 14.9 14.5" />
    </svg>
  );
}

export function IconKeyboardKey({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M5.4 4.2 Q12 3.8 18.6 4.2 Q20.7 4.5 20.9 6.6 Q21.2 11.2 20.9 15.8 Q20.7 17.8 18.6 18 Q12 18.3 5.4 18 Q3.3 17.8 3.1 15.8 Q2.8 11.2 3.1 6.6 Q3.3 4.5 5.4 4.2 Z" />
      <path d="M4.6 18.6 Q12 20.8 19.4 18.6" />
      <path d="M8.6 11.1 Q12 10.8 15.4 11.1" />
      <path d="M12 8.5 Q11.8 11.2 12.1 14" />
    </svg>
  );
}

export function IconHighlighter({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M9.1 11.1 Q6.1 14.1 3.3 16.9 L3.3 19.8 L6.9 19.8 Q9.9 16.9 12.8 14" />
      <path d="M19.8 8.1 Q17.1 5.3 14.4 2.7 Q11 6.1 7.6 9.5 Q10.3 12.3 13 14.9 Q16.5 11.5 19.8 8.1 Z" />
      <path d="M3.2 21.1 Q12 20.5 20.8 21.1" />
    </svg>
  );
}

export function IconTextColor({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.2 15 Q9 9.5 12 4.2 Q15 9.5 17.8 15" />
      <path d="M8.6 11.1 Q12 10.8 15.4 11.1" />
      <path d="M4.1 19.6 Q12 18.9 19.9 19.6" strokeWidth="2.5" />
    </svg>
  );
}

export function IconBgTint({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.4 5.2 Q12 4.8 17.6 5.2 Q19.7 5.5 19.9 7.6 Q20.1 12 19.9 16.4 Q19.7 18.5 17.6 18.8 Q12 19.2 6.4 18.8 Q4.3 18.5 4.1 16.4 Q3.9 12 4.1 7.6 Q4.3 5.5 6.4 5.2 Z" />
      <path d="M8.2 15 Q10.1 11.9 12 9.1 Q13.9 11.9 15.8 15" />
      <path d="M9.4 13.2 Q12 12.9 14.6 13.2" />
    </svg>
  );
}

export function IconTextSize({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.2 7.1 Q8.1 6.6 13 7.1" />
      <path d="M8.1 7.1 Q7.8 12.5 8.1 17.9" />
      <path d="M14.1 12.1 Q17.5 11.7 20.9 12.1" />
      <path d="M17.5 12.1 Q17.3 15.1 17.6 17.9" />
    </svg>
  );
}

export function IconAlignLeft({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.1 6.1 Q12 5.7 19.9 6.1" />
      <path d="M4.1 10.6 Q9.1 10.2 14.1 10.6" />
      <path d="M4.1 15.1 Q11 14.7 17.9 15.1" />
      <path d="M4.1 19.6 Q8.1 19.2 12.1 19.6" />
    </svg>
  );
}

export function IconAlignCenter({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.1 6.1 Q12 5.7 19.9 6.1" />
      <path d="M7.1 10.6 Q12 10.2 16.9 10.6" />
      <path d="M5.1 15.1 Q12 14.7 18.9 15.1" />
      <path d="M8.1 19.6 Q12 19.2 15.9 19.6" />
    </svg>
  );
}

export function IconAlignRight({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.1 6.1 Q12 5.7 19.9 6.1" />
      <path d="M9.9 10.6 Q14.9 10.2 19.9 10.6" />
      <path d="M6.1 15.1 Q13 14.7 19.9 15.1" />
      <path d="M11.9 19.6 Q15.9 19.2 19.9 19.6" />
    </svg>
  );
}

export function IconLink({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M10.1 13.1 C11.9 14.8 14.8 14.8 16.5 13 Q17.9 11.6 19.2 10.3 C20.9 8.5 20.9 5.7 19.1 4 C17.4 2.3 14.6 2.3 12.9 4.1 Q12.1 4.9 11.4 5.5" />
      <path d="M13.9 10.9 C12.1 9.2 9.2 9.2 7.5 11 Q6.1 12.4 4.8 13.7 C3.1 15.5 3.1 18.3 4.9 20 C6.6 21.7 9.4 21.7 11.1 19.9 Q11.8 19.2 12.5 18.5" />
    </svg>
  );
}

export function IconEraser({ className = 'w-3.5 h-3.5' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M7.1 19.9 Q13 13.9 18.9 8 Q16.7 5.7 14.4 3.6 Q8.5 9.5 2.7 15.4 L2.7 19.9 Q10.8 20.2 18.9 19.9" />
      <path d="M9.6 8.6 Q12.1 11 14.5 13.5" />
    </svg>
  );
}

/* ============================================================================
 * Newly Expanded Hand-Drawn UI, Editorial, Metadata & Series Specialty Icons
 * ============================================================================ */

export function IconClock({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 3.1 C17 3 21 6.9 20.9 12 C20.8 17 16.9 21 11.9 20.9 C6.9 20.8 3 16.9 3.1 11.9 C3.2 7 7 3.2 12.1 3.1 Z" />
      <path d="M12 7.2 Q11.8 9.8 12.1 12.2 Q13.8 13.3 15.4 14.1" />
    </svg>
  );
}

export function IconCalendar({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.6 5.1 Q12 4.7 19.4 5.1 Q20.7 5.4 20.8 6.8 Q21 13.1 20.8 19.4 Q20.6 20.7 19.3 20.9 Q12 21.2 4.7 20.9 Q3.4 20.7 3.2 19.4 Q3 13.1 3.2 6.8 Q3.4 5.4 4.6 5.1 Z" />
      <path d="M8.1 2.7 Q7.9 4.5 8.2 6.2" />
      <path d="M15.9 2.7 Q16.1 4.5 15.8 6.2" />
      <path d="M3.4 10.1 Q12 9.6 20.6 10.1" />
      <path d="M8.2 14.2 Q8.7 14 9.1 14.3" />
      <path d="M12.1 14.2 Q12.6 14 13 14.3" />
      <path d="M15.9 14.2 Q16.4 14 16.8 14.3" />
    </svg>
  );
}

export function IconTag({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M11.8 3.2 Q7.9 3.1 4.2 3.4 Q3.4 3.6 3.3 4.4 Q3.1 8.1 3.3 11.9 Q8.1 16.8 12.9 21.4 C13.7 22 14.8 22 15.5 21.3 Q18.4 18.4 21.3 15.5 C22 14.8 22 13.7 21.3 12.9 Q16.6 8 11.8 3.2 Z" />
      <path d="M7.6 7 C8.2 6.9 8.7 7.5 8.5 8.1 C8.3 8.6 7.4 8.7 7.1 8.1 C6.8 7.6 7.1 7.1 7.6 7 Z" fill="currentColor" />
    </svg>
  );
}

export function IconHash({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.6 9.2 Q12 8.7 19.6 9.2" />
      <path d="M4.2 15.1 Q12 14.6 19.2 15.1" />
      <path d="M10.1 4.1 Q9 12 7.9 19.9" />
      <path d="M16.1 4.1 Q15 12 13.9 19.9" />
    </svg>
  );
}

export function IconBookmark({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M6.4 3.2 Q12 2.8 17.6 3.2 Q18.8 3.5 18.9 4.7 Q19.1 12.8 18.8 20.8 Q15.4 18.6 12 16.7 Q8.6 18.7 5.2 20.8 Q4.9 12.8 5.2 4.7 Q5.3 3.5 6.4 3.2 Z" />
      <path d="M9.1 7.8 Q12 7.5 14.9 7.8" />
    </svg>
  );
}

export function IconRefresh({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M20.2 11.4 C19.9 6.8 16.1 3.4 11.6 3.5 C8.5 3.6 5.9 5.2 4.4 7.7" />
      <path d="M3.8 4.4 Q4.1 6.3 4.3 8 Q6 7.8 7.8 7.5" />
      <path d="M3.8 12.7 C4.1 17.2 7.9 20.6 12.4 20.5 C15.5 20.4 18.1 18.8 19.6 16.3" />
      <path d="M20.2 19.6 Q19.9 17.7 19.7 16 Q18 16.2 16.2 16.5" />
    </svg>
  );
}

export function IconShare({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M18.1 3.2 C19.7 3.1 20.9 4.3 20.8 5.9 C20.7 7.5 19.5 8.6 17.9 8.5 C16.3 8.4 15.2 7.3 15.3 5.7 C15.4 4.2 16.6 3.3 18.1 3.2 Z" />
      <path d="M6.1 9.4 C7.7 9.3 8.9 10.5 8.8 12.1 C8.7 13.7 7.5 14.8 5.9 14.7 C4.3 14.6 3.2 13.5 3.3 11.9 C3.4 10.4 4.6 9.5 6.1 9.4 Z" />
      <path d="M18.1 15.5 C19.7 15.4 20.9 16.6 20.8 18.2 C20.7 19.8 19.5 20.9 17.9 20.8 C16.3 20.7 15.2 19.6 15.3 18 C15.4 16.5 16.6 15.6 18.1 15.5 Z" />
      <path d="M8.6 10.7 Q12 8.8 15.5 7.1" />
      <path d="M8.6 13.4 Q12 15.3 15.5 17" />
    </svg>
  );
}

export function IconFilter({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.4 4.6 Q12 4.1 20.6 4.6 Q17.3 9.2 14.1 13.7 Q13.9 17.1 14.1 20.4 Q12 19.4 9.9 18.3 Q10.1 16 9.9 13.7 Q6.7 9.2 3.4 4.6 Z" />
    </svg>
  );
}

export function IconSliders({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.2 6.2 Q12 5.8 19.8 6.2" />
      <path d="M4.2 12.1 Q12 11.7 19.8 12.1" />
      <path d="M4.2 18 Q12 17.6 19.8 18" />
      <path d="M9.1 4.1 C10.4 4 11.2 5 11.1 6.2 C11 7.4 10.1 8.3 8.9 8.2 C7.7 8.1 6.9 7.2 7 6 C7.1 4.9 8 4.2 9.1 4.1 Z" />
      <path d="M15.1 10 C16.4 9.9 17.2 10.9 17.1 12.1 C17 13.3 16.1 14.2 14.9 14.1 C13.7 14 12.9 13.1 13 11.9 C13.1 10.8 14 10.1 15.1 10 Z" />
      <path d="M10.1 15.9 C11.4 15.8 12.2 16.8 12.1 18 C12 19.2 11.1 20.1 9.9 20 C8.7 19.9 7.9 19 8 17.8 C8.1 16.7 9 16 10.1 15.9 Z" />
    </svg>
  );
}

export function IconPaperclip({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M20.4 11.2 Q15.8 15.9 11.2 20.4 C8.8 22.6 5 22.4 2.9 19.9 C1.1 17.7 1.4 14.2 3.5 12.2 Q9.5 6.4 15.5 3.6 C17.6 2.6 20 3.7 20.6 5.9 C21.1 7.6 20.2 9.4 18.7 10.8 Q13.3 16 8.2 18.3 C6.9 18.9 5.5 18 5.6 16.6 C5.7 15.7 6.3 14.9 7.2 14.1 Q11.4 10.1 15.5 6.4" />
    </svg>
  );
}

export function IconMail({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.1 5.1 Q12 4.7 19.9 5.1 Q21.2 5.4 21.3 6.8 Q21.5 12 21.2 17.2 Q21 18.5 19.8 18.7 Q12 19.1 4.2 18.7 Q3 18.5 2.8 17.2 Q2.6 12 2.8 6.8 Q3 5.4 4.1 5.1 Z" />
      <path d="M3.4 6.5 Q7.8 9.9 12 12.9 Q16.2 9.8 20.6 6.4" />
    </svg>
  );
}

export function IconBell({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M18.1 14.8 Q18.1 11.7 17.9 8.7 C17.7 5.5 15.2 3.2 12 3.2 C8.8 3.2 6.3 5.5 6.1 8.7 Q5.9 11.7 5.9 14.8 Q4.4 16.3 3.4 17.6 Q12 18.1 20.6 17.6 Q19.5 16.3 18.1 14.8 Z" />
      <path d="M9.7 19.6 C10.3 20.7 11.1 21.2 12 21.2 C12.9 21.2 13.7 20.7 14.3 19.6" />
    </svg>
  );
}

export function IconFolderOpen({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M3.4 19 Q3.2 12 3.5 5.1 C3.6 4.1 4.4 3.5 5.4 3.6 Q7.6 3.5 9.6 3.8 Q10.8 5.2 12 6.7 Q15.3 6.5 18.5 6.8 C19.5 6.9 20.2 7.6 20.3 8.6 L20.2 10.6" />
      <path d="M5.1 10.9 Q13.1 10.4 20.9 11 C21.8 11.1 22.3 11.9 22 12.9 Q21.1 15.8 20 18.7 C19.7 19.5 18.9 20 17.9 20 Q11.3 20.2 4.7 19.9 C3.8 19.8 3.3 19 3.5 18.1 Q4.3 14.5 5.1 10.9 Z" />
    </svg>
  );
}

export function IconChapterList({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M4.2 5.4 Q7.2 5 10.1 5.4" />
      <path d="M4.2 10.1 Q11.8 9.7 19.6 10.1" />
      <path d="M7.6 14.5 Q13.8 14.1 19.6 14.5" />
      <path d="M7.6 18.9 Q13.8 18.5 19.6 18.9" />
      <path d="M4.2 14.5 Q4.7 14.3 5.1 14.6" />
      <path d="M4.2 18.9 Q4.7 18.7 5.1 19" />
    </svg>
  );
}

export function IconUsers({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M9.1 5.1 C11.1 5 12.5 6.5 12.4 8.5 C12.3 10.4 10.9 11.8 8.9 11.7 C7 11.6 5.7 10.2 5.8 8.2 C5.9 6.4 7.3 5.2 9.1 5.1 Z" />
      <path d="M3.1 19.7 C3.3 16.5 5.7 14.7 9.1 14.7 C12.5 14.7 14.8 16.5 15.1 19.7" />
      <path d="M16.1 6.1 C17.7 6 18.8 7.2 18.7 8.8 C18.6 10.3 17.5 11.4 15.9 11.3" />
      <path d="M17.2 14.9 C19.5 15.4 20.9 17.1 21.1 19.6" />
    </svg>
  );
}

export function IconAward({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 3.1 C15.7 3 18.3 5.7 18.2 9.3 C18.1 12.8 15.5 15.4 11.9 15.3 C8.4 15.2 5.9 12.6 6 9 C6.1 5.6 8.6 3.2 12.1 3.1 Z" />
      <path d="M8.6 14.4 Q7.8 17.9 7.1 21.3 Q9.6 19.9 12 18.7 Q14.4 20 16.9 21.3 Q16.2 17.9 15.4 14.4" />
    </svg>
  );
}

export function IconCompass({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 3 C17.1 2.9 21.1 6.9 21 12 C20.9 17 16.9 21 11.9 20.9 C6.9 20.8 2.9 16.8 3 11.8 C3.1 6.9 7 3.1 12.1 3 Z" />
      <path d="M15.9 8.1 Q12.6 9.3 9.7 10.2 Q8.9 13.1 8.1 15.9 Q11.3 14.8 14.2 13.9 Q15.1 11 15.9 8.1 Z" />
      <path d="M11.6 12 Q12.1 11.7 12.5 12.1" />
    </svg>
  );
}

export function IconCpu({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M7.4 6.1 Q12 5.8 16.6 6.1 Q17.9 6.3 18 7.6 Q18.2 12 18 16.4 Q17.8 17.7 16.5 17.9 Q12 18.2 7.5 17.9 Q6.2 17.7 6 16.4 Q5.8 12 6 7.6 Q6.2 6.3 7.4 6.1 Z" />
      <path d="M9.6 9.4 Q12 9.1 14.4 9.4 Q14.8 12 14.5 14.6 Q12 14.9 9.5 14.6 Q9.2 12 9.6 9.4 Z" />
      <path d="M9.2 2.9 Q9 4.4 9.3 5.9" />
      <path d="M14.8 2.9 Q14.6 4.4 14.9 5.9" />
      <path d="M9.2 18.1 Q9 19.6 9.3 21.1" />
      <path d="M14.8 18.1 Q14.6 19.6 14.9 21.1" />
      <path d="M2.9 9.3 Q4.4 9 5.9 9.3" />
      <path d="M2.9 14.8 Q4.4 14.5 5.9 14.8" />
      <path d="M18.1 9.3 Q19.6 9 21.1 9.3" />
      <path d="M18.1 14.8 Q19.6 14.5 21.1 14.8" />
    </svg>
  );
}

export function IconDatabase({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12 3.1 C16.5 3.1 19.7 4.4 19.7 6.1 C19.7 7.8 16.5 9.1 12 9.1 C7.5 9.1 4.3 7.8 4.3 6.1 C4.3 4.4 7.5 3.1 12 3.1 Z" />
      <path d="M4.4 6.2 Q4.1 12.1 4.4 17.9 C4.6 19.6 7.7 20.9 12 20.9 C16.3 20.9 19.4 19.6 19.6 17.9 Q19.9 12.1 19.6 6.2" />
      <path d="M4.5 12.1 C4.8 13.7 7.8 14.9 12 14.9 C16.2 14.9 19.2 13.7 19.5 12.1" />
    </svg>
  );
}

export function IconRocket({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.2 2.7 C16.4 4.2 18.8 8.3 17.7 13.6 Q16.1 15.8 14.3 17.3 Q10.6 15.7 6.9 13.9 Q8.4 9.4 12.2 2.7 Z" />
      <path d="M7.6 11.4 Q5.2 11.4 3.4 12.9 Q5 14.3 6.8 15" />
      <path d="M16.7 14.6 Q17.3 16.9 16.1 19 Q14.4 17.9 13.1 16.7" />
      <path d="M12.8 8.2 C13.7 8.1 14.2 8.9 14 9.7 C13.7 10.5 12.7 10.6 12.1 10 C11.6 9.3 12 8.3 12.8 8.2 Z" />
      <path d="M7.1 16.6 Q5.6 18.4 4.5 20.1 Q6.5 19.6 8.3 18.3" />
    </svg>
  );
}

export function IconFlask({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M8.6 3.2 Q12 2.9 15.4 3.2" />
      <path d="M10.1 3.3 Q9.9 6.6 10.1 9.6 Q7.1 13.5 4.4 17.5 C3.7 18.8 4.6 20.4 6.1 20.5 Q12 20.9 17.9 20.5 C19.4 20.4 20.3 18.8 19.6 17.5 Q16.9 13.5 13.9 9.6 Q14.1 6.6 13.9 3.3" />
      <path d="M7.2 15.3 Q12 14.6 16.8 15.4" />
      <path d="M10.9 12.1 Q11.3 11.9 11.6 12.2" />
    </svg>
  );
}

export function IconFlame({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg {...PEN_DEFAULTS} className={`${className} shrink-0`}>
      <path d="M12.1 2.7 C15.2 5.9 19.3 9.2 19.1 14 C19 18.1 15.9 21.1 12 21.1 C8.1 21.1 5 18.1 4.9 14 C4.8 11.1 6.3 8.8 8.1 7.2 Q8.5 9.1 9.6 10.2 C10.1 7.5 11.1 4.9 12.1 2.7 Z" />
      <path d="M12.1 12.9 C13.5 14.1 14.3 15.4 14.2 16.9 C14.1 18.3 13.1 19.2 11.9 19.2 C10.7 19.2 9.8 18.3 9.7 16.9 C9.6 15.7 10.6 14.2 12.1 12.9 Z" />
    </svg>
  );
}

/* ============================================================================
 * 16-Kind Series / Track Hand-Drawn Emblem System
 * ============================================================================ */

export const ALL_TRACK_ICON_KINDS = [
  'snowflake',
  'notebook',
  'feather',
  'terminal',
  'code',
  'cube',
  'compass',
  'layers',
  'cpu',
  'globe',
  'shield',
  'database',
  'rocket',
  'flask',
  'palette',
  'spark',
] as const;

export type TrackIconKind = (typeof ALL_TRACK_ICON_KINDS)[number];

export function TrackHandIcon({
  kind,
  className = 'w-5 h-5',
}: {
  kind?: string | null;
  className?: string;
}): JSX.Element {
  switch ((kind ?? '').trim().toLowerCase()) {
    case 'notebook':
      return <IconNotebook className={className} />;
    case 'feather':
      return <IconFeather className={className} />;
    case 'terminal':
      return <IconTerminal className={className} />;
    case 'code':
      return <IconCode className={className} />;
    case 'cube':
      return <IconCube className={className} />;
    case 'compass':
      return <IconCompass className={className} />;
    case 'layers':
      return <IconLayers className={className} />;
    case 'cpu':
      return <IconCpu className={className} />;
    case 'globe':
      return <IconGlobe className={className} />;
    case 'shield':
      return <IconShield className={className} />;
    case 'database':
      return <IconDatabase className={className} />;
    case 'rocket':
      return <IconRocket className={className} />;
    case 'flask':
      return <IconFlask className={className} />;
    case 'palette':
      return <IconPalette className={className} />;
    case 'spark':
    case 'sparkles':
      return <IconSparkles className={className} />;
    case 'snowflake':
    default:
      return <IconSnowflake className={className} />;
  }
}
