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
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const isClosingRef = useRef(false);
  const hasEnteredRef = useRef(false);
  const didEmitCloseRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const openRafRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const hideOnDesktopRef = useRef(className.includes('lg:hidden'));
  hideOnDesktopRef.current = className.includes('lg:hidden');

  const clearTimers = useCallback(() => {
    if (openRafRef.current !== null) {
      cancelAnimationFrame(openRafRef.current);
      openRafRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const finishClose = useCallback(() => {
    clearTimers();
    const dialog = dialogRef.current;
    isClosingRef.current = false;
    hasEnteredRef.current = false;
    didEmitCloseRef.current = true;
    if (dialog && dialog.open) {
      dialog.close();
    }
    onCloseRef.current();
  }, [clearTimers]);

  const slideClose = useCallback(() => {
    const dialog = dialogRef.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!dialog || !dialog.open) return;

    if (openRafRef.current !== null) {
      cancelAnimationFrame(openRafRef.current);
      openRafRef.current = null;
    }
    isClosingRef.current = true;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (
      !scroller ||
      !sheet ||
      reducedMotion ||
      scroller.scrollLeft >= sheet.offsetWidth - 2
    ) {
      finishClose();
      return;
    }

    scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'auto' });
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (dialog.open && isClosingRef.current) {
        finishClose();
      }
    }, 420);
  }, [finishClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!dialog || !scroller || !sheet) return;

    const visibleThreshold = Math.min(0.05, 1 / Math.max(window.innerWidth, 320));
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry || !dialog.open) return;
        if (entry.intersectionRatio >= 0.25) {
          hasEnteredRef.current = true;
        }
        // Only dismiss after the sheet has actually entered view or an explicit close was started,
        // ignoring the initial off-screen snap frame (`scroll-initial-target` / jump-scroll) on open.
        if (
          entry.intersectionRatio < visibleThreshold &&
          (hasEnteredRef.current || isClosingRef.current)
        ) {
          finishClose();
        }
      },
      { root: dialog, threshold: [visibleThreshold, 0.25, 1] },
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
    const onNativeClose = () => {
      if (dialog.open) return;
      clearTimers();
      isClosingRef.current = false;
      hasEnteredRef.current = false;
      if (!didEmitCloseRef.current) {
        didEmitCloseRef.current = true;
        onCloseRef.current();
      }
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onNativeClose);

    const desktopMq =
      typeof window !== 'undefined'
        ? window.matchMedia('(min-width: 1024px)')
        : null;
    const onBreakpointChange = (e: MediaQueryListEvent) => {
      if (hideOnDesktopRef.current && e.matches && dialog.open) {
        finishClose();
      }
    };
    desktopMq?.addEventListener('change', onBreakpointChange);

    return () => {
      clearTimers();
      observer.disconnect();
      if (!supportsScrollTimeline) {
        scroller.removeEventListener('scroll', onScrollFallback);
      }
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onNativeClose);
      desktopMq?.removeEventListener('change', onBreakpointChange);
    };
  }, [clearTimers, finishClose, slideClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!dialog || !scroller) return;

    if (open && !dialog.open) {
      clearTimers();
      isClosingRef.current = false;
      hasEnteredRef.current = false;
      didEmitCloseRef.current = false;
      dialog.showModal();
      closeBtnRef.current?.focus({ preventScroll: true });

      const supportsScrollTimeline =
        typeof CSS !== 'undefined' &&
        CSS.supports('animation-timeline', 'scroll()');
      const reducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      if (reducedMotion) {
        scroller.scrollTo({ left: 0, behavior: 'instant' });
        if (!supportsScrollTimeline) {
          dialog.style.setProperty('--drawer-backdrop', '1');
        }
        hasEnteredRef.current = true;
      } else {
        const closedLeft = scroller.offsetWidth;
        const sheetWidth = sheet?.offsetWidth ?? closedLeft;
        if (scroller.scrollLeft < sheetWidth - 2) {
          scroller.scrollTo({ left: closedLeft, behavior: 'instant' });
        }
        if (!supportsScrollTimeline) {
          dialog.style.setProperty('--drawer-backdrop', '0');
        }
        openRafRef.current = requestAnimationFrame(() => {
          openRafRef.current = requestAnimationFrame(() => {
            openRafRef.current = null;
            if (dialog.open && !isClosingRef.current) {
              scroller.scrollTo({ left: 0, behavior: 'auto' });
            }
          });
        });
      }
    } else if (!open && dialog.open && !isClosingRef.current) {
      slideClose();
    }
  }, [clearTimers, open, slideClose]);

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
              ref={closeBtnRef}
              type="button"
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
