/*
 * Unified Swipeable Navigation Drawer Primitive (`modern-web-guidance/navigation-drawer`):
 * - Uses modal `<dialog>` opened via `showModal()` for native top-layer promotion, inert backdrop,
 *   keyboard focus trapping, and automatic focus restoration to the trigger button on close.
 * - Horizontal CSS scroll-snap (`grid-template-columns: var(--drawer-width) 100%`) + `IntersectionObserver`.
 * - Includes both `scroll-initial-target` double-rAF fallback and non-`animation-timeline` scroll backdrop fallback.
 */

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { IconClose, IconSnowflake } from './Icons';

interface SwipeDrawerDialogProps {
  id: string;
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  title: string;
  closeAriaLabel: string;
  surface?: 'sheet' | 'sunken';
  className?: string;
  children: ReactNode;
}

export function SwipeDrawerDialog({
  id,
  open,
  onClose,
  ariaLabel,
  title,
  closeAriaLabel,
  surface = 'sheet',
  className = '',
  children,
}: SwipeDrawerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const isClosingRef = useRef(false);

  const slideClose = useCallback(() => {
    const scroller = scrollerRef.current;
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open) return;
    isClosingRef.current = true;
    if (scroller) {
      scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'auto' });
    } else {
      dialog.close();
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!dialog || !scroller || !sheet) return;

    const visibleThreshold = Math.min(0.05, 1 / Math.max(window.innerWidth, 320));
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        if (entry.intersectionRatio < visibleThreshold && dialog.open) {
          dialog.close();
          isClosingRef.current = false;
          onClose();
        }
      },
      { root: dialog, threshold: [visibleThreshold, 1] },
    );
    observer.observe(sheet);

    const onScrollFallback = () => {
      if (sheet.offsetWidth <= 0) return;
      const ratio = Math.max(
        0,
        Math.min(1, 1 - scroller.scrollLeft / sheet.offsetWidth),
      );
      dialog.style.setProperty('--drawer-backdrop', String(ratio));
    };

    const supportsScrollTimeline =
      typeof CSS !== 'undefined' &&
      CSS.supports('animation-timeline', 'scroll()');
    if (!supportsScrollTimeline) {
      scroller.addEventListener('scroll', onScrollFallback, { passive: true });
    }

    const onCancel = (event: Event) => {
      if (event.cancelable) {
        event.preventDefault();
        slideClose();
      }
    };
    dialog.addEventListener('cancel', onCancel);

    return () => {
      observer.disconnect();
      if (!supportsScrollTimeline) {
        scroller.removeEventListener('scroll', onScrollFallback);
      }
      dialog.removeEventListener('cancel', onCancel);
    };
  }, [onClose, slideClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const scroller = scrollerRef.current;
    if (!dialog || !scroller) return;

    if (open && !dialog.open) {
      isClosingRef.current = false;
      dialog.showModal();
      const supportsInitialTarget =
        typeof CSS !== 'undefined' &&
        CSS.supports('scroll-initial-target', 'nearest');

      if (!supportsInitialTarget) {
        scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'instant' });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scroller.scrollTo({ left: 0, behavior: 'auto' });
          });
        });
      } else {
        scroller.scrollTo({ left: 0, behavior: 'auto' });
      }
    } else if (!open && dialog.open && !isClosingRef.current) {
      slideClose();
    }
  }, [open, slideClose]);

  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-label={ariaLabel}
      className={`swipe-drawer-dialog ${className}`.trim()}
      onClick={(e) => {
        if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
          slideClose();
        }
      }}
    >
      <div ref={scrollerRef} className="swipe-drawer-scroller">
        <aside
          ref={sheetRef}
          data-surface={surface}
          className="swipe-drawer-sheet"
        >
          <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-2 bg-surface-sheet shrink-0">
            <span
              className="inline-flex items-center gap-2 text-sm font-semibold text-ink-primary"
              style={{ fontFamily: 'var(--font-hand)' }}
            >
              <IconSnowflake className="w-4 h-4 text-accent-ice" />
              <span>{title}</span>
            </span>
            <button
              type="button"
              autoFocus
              aria-label={closeAriaLabel}
              onClick={slideClose}
              className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-surface-raised cursor-pointer transition-colors"
            >
              <IconClose className="w-4 h-4" />
            </button>
          </div>
          {children}
        </aside>
      </div>
    </dialog>
  );
}
