/*
 * Unified Modal Dialog Primitive (`dialog`, `light-dismiss-a-dialog`,
 * `prevent-page-scroll-under-modal-dialog`, & `animate-to-from-top-layer`):
 * - Opens via `showModal()` for native top-layer promotion, inert background, Esc dismiss, and focus restoration.
 * - Declarative `closedby="any"` with mandatory `pointerdown` + `pointerup` outside-rect fallback
 *   so text-selection drags ending on the backdrop never dismiss the dialog.
 * - Cross-browser smooth exit transitions: native `overlay` + `allow-discrete` in Chromium,
 *   plus lazy `canTransitionDisplay()` + `data-closing` animation-await fallback for Firefox/Safari.
 */

import { type ReactNode, useCallback, useEffect, useRef } from 'react';

export interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  maxWidthClass?: string;
  closedBy?: 'any' | 'closerequest' | 'none';
  stableScrollbarGutter?: boolean;
  children: ReactNode;
}

export interface ModalHeaderProps {
  titleId: string;
  title: ReactNode;
  icon?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  handFont?: boolean;
  bordered?: boolean;
  trailing?: ReactNode;
}

export function ModalHeader({
  titleId,
  title,
  icon,
  closeLabel,
  onClose,
  handFont = false,
  bordered = true,
  trailing,
}: ModalHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        bordered ? 'pb-4 border-b border-border-subtle' : ''
      }`}
    >
      <h2
        id={titleId}
        className="text-base sm:text-lg font-semibold text-ink-primary m-0 inline-flex items-center gap-2 min-w-0"
        style={handFont ? { fontFamily: 'var(--font-hand)' } : undefined}
      >
        {icon}
        <span className="truncate">{title}</span>
      </h2>
      <div className="flex items-center gap-2.5 shrink-0">
        {trailing}
        <button
          type="button"
          onClick={onClose}
          className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink-primary border border-border-subtle hover:border-border-ink cursor-pointer shrink-0 transition-colors"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}

let cachedDisplayTransitionSupport: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (cachedDisplayTransitionSupport !== undefined) {
    return cachedDisplayTransitionSupport;
  }
  if (
    typeof window === 'undefined' ||
    !window.CSS?.supports?.('transition-behavior', 'allow-discrete') ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText =
    'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  cachedDisplayTransitionSupport = getComputedStyle(probe).display === 'block';
  probe.remove();
  return cachedDisplayTransitionSupport;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.CSS?.supports?.('overlay', 'auto')) &&
    canTransitionDisplay()
  );
}

export function ModalDialog({
  open,
  onClose,
  ariaLabelledBy,
  ariaLabel,
  maxWidthClass = 'max-w-lg',
  closedBy = 'any',
  stableScrollbarGutter = false,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const closeAnimated = useCallback(async (dialog: HTMLDialogElement) => {
    if (!dialog.open) return;
    if (!supportsTopLayerExit()) {
      if (dialog.hasAttribute('data-closing')) return;
      dialog.setAttribute('data-closing', '');
      const animations = dialog.getAnimations({ subtree: true });
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((a) => a.finished)),
          new Promise((resolve) => window.setTimeout(resolve, 400)),
        ]);
      }
      if (!dialog.hasAttribute('data-closing')) return;
      dialog.removeAttribute('data-closing');
    }
    if (dialog.open) {
      dialog.close();
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.removeAttribute('data-closing');
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      void closeAnimated(dialog);
    }
  }, [open, closeAnimated]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      dialog.removeAttribute('data-closing');
      onCloseRef.current();
    };
    const handleCancel = (event: Event) => {
      if (closedBy === 'none') {
        event.preventDefault();
        return;
      }
      if (!supportsTopLayerExit()) {
        event.preventDefault();
        void closeAnimated(dialog);
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);

    // MANDATORY fallback for `<dialog closedby="any">` (`modern-web-guidance/dialog`):
    // Test pointer coordinates on both pointerdown and pointerup so text-selection drags never close the dialog.
    let cleanupFallback: (() => void) | undefined;
    if (closedBy === 'any' && !('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      let pressedOutside = false;
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = e.target === dialog && isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && e.target === dialog && isOutside(e)) {
          void closeAnimated(dialog);
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      cleanupFallback = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
      cleanupFallback?.();
    };
  }, [closeAnimated, closedBy]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      className={`search-dialog ink-surface-modal w-[calc(100%-2rem)] ${maxWidthClass} m-auto rounded-2xl p-0 overflow-hidden bg-surface-sheet text-ink-primary`}
      {...({ closedby: closedBy } as Record<string, unknown>)}
    >
      <div
        className={`max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto overscroll-contain ink-thin-scrollbar ${
          stableScrollbarGutter ? '[scrollbar-gutter:stable]' : ''
        }`.trim()}
      >
        {children}
      </div>
    </dialog>
  );
}
