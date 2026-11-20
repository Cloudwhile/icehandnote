/*
 * Unified Modal Dialog Primitive (`light-dismiss-a-dialog`, `prevent-page-scroll-under-modal-dialog`,
 * & `animate-to-from-top-layer`):
 * - Opens via `showModal()` for native top-layer promotion, inert background, Esc dismiss, and focus restoration.
 * - Declarative `closedby="any"` with mandatory Safari bounding-rect backdrop click fallback.
 * - Cross-browser smooth exit transitions: native `overlay` + `allow-discrete` in Chromium,
 *   plus lazy `canTransitionDisplay()` + `data-closing` animation-await fallback for Firefox/Safari.
 */

import { type ReactNode, useCallback, useEffect, useRef } from 'react';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  maxWidthClass?: string;
  children: ReactNode;
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
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

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
      dialog.removeAttribute('data-closing');
      onClose();
    };
    const handleCancel = (event: Event) => {
      if (!supportsTopLayerExit()) {
        event.preventDefault();
        void closeAnimated(dialog);
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);

    // MANDATORY Safari fallback for `<dialog closedby="any">`
    let cleanupFallback: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isInside =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isInside) {
          void closeAnimated(dialog);
        }
      };
      dialog.addEventListener('click', handleBackdropClick);
      cleanupFallback = () =>
        dialog.removeEventListener('click', handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
      cleanupFallback?.();
    };
  }, [onClose, closeAnimated]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      className={`search-dialog ink-surface-modal w-[calc(100%-2rem)] ${maxWidthClass} m-auto rounded-2xl p-0 bg-surface-sheet text-ink-primary`}
      {...({ closedby: 'any' } as Record<string, unknown>)}
    >
      {children}
    </dialog>
  );
}
