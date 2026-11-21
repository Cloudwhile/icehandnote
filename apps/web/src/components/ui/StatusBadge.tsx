/*
 * Unified Semantic Status Badge (`tokens.css` WCAG AA semantic badge tokens):
 * Eliminates repetitive inline `style={{ backgroundColor: 'var(--alert-*-badge-bg)' }}` objects across components.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
  pill?: boolean;
  uppercase?: boolean;
  children: ReactNode;
}

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  success: {
    backgroundColor: 'var(--alert-mint-badge-bg)',
    color: 'var(--alert-mint-badge-fg)',
  },
  warn: {
    backgroundColor: 'var(--alert-warn-badge-bg)',
    color: 'var(--alert-warn-badge-fg)',
  },
  danger: {
    backgroundColor: 'var(--alert-danger-badge-bg)',
    color: 'var(--alert-danger-badge-fg)',
  },
  info: {
    backgroundColor: 'var(--alert-note-badge-bg)',
    color: 'var(--alert-note-badge-fg)',
  },
  neutral: {
    backgroundColor: 'var(--surface-sunken)',
    color: 'var(--ink-muted)',
  },
};

export function StatusBadge({
  tone = 'neutral',
  mono = false,
  pill = false,
  uppercase = false,
  className = '',
  style,
  children,
  ...rest
}: StatusBadgeProps) {
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-1 px-2 py-0.5 ${
        pill ? 'rounded-full' : 'rounded'
      } text-xs font-semibold shrink-0 ${mono ? 'font-mono tabular-nums' : ''} ${
        uppercase ? 'uppercase tracking-wider' : ''
      } ${className}`.trim()}
      style={{ ...TONE_STYLES[tone], ...style }}
    >
      {children}
    </span>
  );
}
