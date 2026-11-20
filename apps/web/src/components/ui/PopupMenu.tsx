/*
 * Accessible Popup Dropdown Menu Primitive (`modern-web-guidance/menu`):
 * - Uses native `popover="auto"`, `commandfor`/`command="toggle-popover"`, and `focusgroup="menu nomemory"`.
 * - Places popover immediately after its trigger (avoids implicit `aria-details`).
 * - Feature-detects invoker commands (`'commandForElement' in HTMLButtonElement.prototype`),
 *   native focusgroup (`'focusGroup' in HTMLElement.prototype`), and CSS Anchor Positioning
 *   (`CSS.supports('position-area: block-end')`) with clean cross-browser fallbacks.
 */

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconChevronDown } from './Icons';

interface PopupMenuProps {
  triggerLabel: ReactNode;
  triggerAriaLabel?: string;
  triggerTitle?: string;
  triggerClassName?: string;
  showChevron?: boolean;
  align?: 'start' | 'end';
  minWidthClass?: string;
  children: (helpers: { close: (fromPointer?: boolean) => void }) => ReactNode;
}

function supportsInvokers(): boolean {
  return (
    typeof window !== 'undefined' &&
    'commandForElement' in HTMLButtonElement.prototype
  );
}

function supportsFocusgroup(): boolean {
  return (
    typeof window !== 'undefined' && 'focusGroup' in HTMLElement.prototype
  );
}

function supportsAnchorArea(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.CSS?.supports?.('position-area: block-end'))
  );
}

export function PopupMenu({
  triggerLabel,
  triggerAriaLabel,
  triggerTitle,
  triggerClassName = '',
  showChevron = true,
  align = 'end',
  minWidthClass = '',
  children,
}: PopupMenuProps) {
  const triggerId = useId();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const enterOnOpenRef = useRef(false);
  const pointerPressedRef = useRef(false);
  const [open, setOpen] = useState(false);

  const getEnabledItems = useCallback((): HTMLElement[] => {
    const group = groupRef.current;
    if (!group) return [];
    return Array.from(
      group.querySelectorAll<HTMLElement>('button, a[href]'),
    ).filter(
      (el) =>
        !(el as HTMLButtonElement).disabled &&
        el.getAttribute('aria-disabled') !== 'true',
    );
  }, []);

  const positionFallback = useCallback(() => {
    if (supportsAnchorArea()) return;
    const trigger = triggerRef.current;
    const pop = popoverRef.current;
    if (!trigger || !pop) return;

    const tr = trigger.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = align === 'end' ? tr.right - pr.width : tr.left;
    left = Math.max(8, Math.min(left, vw - pr.width - 8));

    let top = tr.bottom + gap;
    if (top + pr.height > vh - 8 && tr.top - pr.height - gap >= 8) {
      top = tr.top - pr.height - gap;
    }

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }, [align]);

  const closeMenu = useCallback((fromPointer = false) => {
    const trigger = triggerRef.current;
    const pop = popoverRef.current;
    if (trigger) {
      try {
        (
          trigger as HTMLElement & {
            focus: (opts?: { focusVisible?: boolean; preventScroll?: boolean }) => void;
          }
        ).focus({
          preventScroll: true,
          ...(fromPointer ? { focusVisible: false } : {}),
        });
      } catch {
        trigger.focus();
      }
    }
    if (pop && pop.matches(':popover-open')) {
      pop.hidePopover();
    }
  }, []);

  // Sync open state, anchor fallback positioning, and keyboard entry on native `toggle` event
  useEffect(() => {
    const pop = popoverRef.current;
    if (!pop) return;

    const onToggle = (event: Event) => {
      const nextOpen = (event as ToggleEvent).newState === 'open';
      setOpen(nextOpen);

      if (nextOpen) {
        positionFallback();
        if (enterOnOpenRef.current) {
          enterOnOpenRef.current = false;
          requestAnimationFrame(() => {
            getEnabledItems()[0]?.focus({ preventScroll: true });
          });
        } else if (pointerPressedRef.current) {
          pointerPressedRef.current = false;
        }
      } else {
        enterOnOpenRef.current = false;
        pointerPressedRef.current = false;
      }
    };

    pop.addEventListener('toggle', onToggle);
    return () => pop.removeEventListener('toggle', onToggle);
  }, [getEnabledItems, positionFallback]);

  // Install ARIA roles + arrow/Home/End fallback ONLY when native focusgroup is unsupported
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const nativeFg = supportsFocusgroup();
    if (!nativeFg) {
      group.setAttribute('role', 'menu');
      group.querySelectorAll('button:not([role]), a:not([role])').forEach((el) => {
        el.setAttribute('role', 'menuitem');
      });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(false);
        return;
      }
      if (event.key === 'Tab') {
        popoverRef.current?.hidePopover();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      if (nativeFg && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        return;
      }

      const items = getEnabledItems();
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const nextIdx =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : current < 0
              ? 0
              : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) %
                items.length;

      event.preventDefault();
      event.stopPropagation();
      items[nextIdx]?.focus({ preventScroll: true });
    };

    group.addEventListener('keydown', onKeyDown, true);
    return () => group.removeEventListener('keydown', onKeyDown, true);
  }, [closeMenu, getEnabledItems, open]);

  // Close when focus leaves the menu system
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        popoverRef.current?.hidePopover();
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open]);

  const handleTriggerPointerDown = () => {
    pointerPressedRef.current = true;
    enterOnOpenRef.current = false;
  };

  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const isKeyboard = event.detail === 0;
    if (isKeyboard && !open) {
      enterOnOpenRef.current = true;
    }

    // Invoker command fallback for browsers without `commandfor`
    if (!supportsInvokers()) {
      event.preventDefault();
      const pop = popoverRef.current;
      const trigger = triggerRef.current;
      if (!pop || !trigger) return;
      if (pop.matches(':popover-open')) {
        closeMenu(!isKeyboard);
      } else {
        try {
          (
            pop as HTMLElement & {
              showPopover: (opts?: { source?: HTMLElement }) => void;
            }
          ).showPopover({ source: trigger });
        } catch {
          pop.showPopover();
        }
      }
    }
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (open) {
        getEnabledItems()[0]?.focus({ preventScroll: true });
      } else {
        enterOnOpenRef.current = true;
        triggerRef.current?.click();
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        title={triggerTitle}
        onPointerDown={handleTriggerPointerDown}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={`inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
          open ? 'border-border-ink bg-surface-raised text-ink-primary' : ''
        } ${triggerClassName}`}
        {...({
          commandfor: menuId,
          command: 'toggle-popover',
        } as Record<string, string>)}
      >
        {triggerLabel}
        {showChevron && (
          <IconChevronDown
            className={`w-3.5 h-3.5 text-ink-muted transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {/* Immediately after trigger so browsers add no implicit aria-details */}
      <div
        ref={popoverRef}
        id={menuId}
        popover="auto"
        data-align={align}
        className={`ink-menu-popover ${minWidthClass}`}
      >
        <div
          ref={groupRef}
          aria-labelledby={triggerId}
          className="ink-menu-list"
          {...({ focusgroup: 'menu nomemory' } as Record<string, string>)}
        >
          {children({ close: closeMenu })}
        </div>
      </div>
    </>
  );
}
