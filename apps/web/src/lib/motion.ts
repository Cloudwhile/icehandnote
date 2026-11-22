/*
 * Unified View-Transition & Scoped Layout Animation Helpers
 * Implements `modern-web-guidance`:
 * - `scoped-component-transitions`: Prefers `scopeEl.startViewTransition(...)` when available so
 *   external top-layer overlays (`[popover]`, `<dialog>`) remain above and non-scoped UI stays interactive,
 *   always attaching `.ready.catch(() => {})` on rapid re-triggers.
 * - `group-element-transitions`: Falls back to `document.startViewTransition({ update, types: ['layout'] })`
 *   where `:root { view-transition-name: none; }` animates only `.vt-layout-item` cards/blocks.
 * - `directional-navigation-transitions`: Coordinates directional `forward` / `backward` page transitions.
 */

import { flushSync } from 'react-dom';

interface ScopedViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Normalizes an arbitrary string ID into a valid CSS `<custom-ident>` for `view-transition-name`.
 */
export function toViewTransitionIdent(prefix: string, rawId: string): string {
  const clean = rawId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${prefix}-${clean}`;
}

/**
 * Smoothly animates layout rearrangements inside a subtree (block insert/delete/reorder,
 * panel collapse/expand, margin-note list updates) with automatic reduced-motion and legacy fallbacks.
 */
export function runLayoutTransition(
  scopeEl: HTMLElement | null | undefined,
  updateDOM: () => void,
): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    updateDOM();
    return;
  }

  const scoped = scopeEl as
    | (HTMLElement & {
        startViewTransition?: (cb: () => void) => ScopedViewTransition;
      })
    | null
    | undefined;

  if (
    scoped &&
    typeof HTMLElement !== 'undefined' &&
    'startViewTransition' in Element.prototype &&
    typeof scoped.startViewTransition === 'function'
  ) {
    try {
      const transition = scoped.startViewTransition(() => {
        flushSync(updateDOM);
      });
      transition?.ready?.catch(() => {});
      return;
    } catch {
      updateDOM();
      return;
    }
  }

  const doc = document as Document & {
    startViewTransition?: (arg: {
      update: () => void;
      types?: string[];
    }) => ScopedViewTransition;
  };
  if (
    typeof doc.startViewTransition === 'function' &&
    !document.querySelector('dialog[open], :popover-open')
  ) {
    try {
      const transition = doc.startViewTransition({
        update: () => {
          flushSync(updateDOM);
        },
        types: ['layout'],
      });
      transition?.ready?.catch(() => {});
      return;
    } catch {
      updateDOM();
      return;
    }
  }

  updateDOM();
}

/**
 * Smoothly transitions SPA route/article navigation with directional spatial context (`forward` / `backward`).
 */
export function runDirectionalTransition(
  updateDOM: () => void,
  direction: 'forward' | 'backward',
  afterFinished?: () => void,
): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    updateDOM();
    afterFinished?.();
    return;
  }
  const doc = document as Document & {
    startViewTransition?: (arg: {
      update: () => void;
      types?: string[];
    }) => ScopedViewTransition;
  };
  if (typeof doc.startViewTransition !== 'function') {
    updateDOM();
    afterFinished?.();
    return;
  }
  try {
    const transition = doc.startViewTransition({
      update: () => {
        flushSync(updateDOM);
      },
      types: [direction],
    });
    transition?.ready?.catch(() => {});
    if (afterFinished && transition?.finished) {
      void transition.finished.finally(afterFinished);
    } else if (afterFinished) {
      afterFinished();
    }
  } catch {
    updateDOM();
    afterFinished?.();
  }
}
