import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resolveLocalizedError } from '../../lib/apiError';
import type { LocaleCode } from '../../lib/types';
import { IconAlertCircle, IconCheck, IconClose } from './Icons';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  push: (tone: ToastTone, message: string, durationMs?: number) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  error: (errOrMessage: unknown, fallbackMessage?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({
  locale,
  children,
}: {
  locale: LocaleCode;
  children: ReactNode;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());
  const stackRef = useRef<HTMLDivElement | null>(null);
  const latestPushTickRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, durationMs = 4500) => {
      const clean = message.trim();
      if (!clean) return;
      const id = nextIdRef.current++;
      latestPushTickRef.current = id;
      setItems((prev) => [...prev.slice(-3), { id, tone, message: clean }]);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(id);
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, durationMs);
      timersRef.current.set(id, timer);
    },
    [],
  );

  // Promote toast stack into the browser Top Layer via `popover="manual"` so it renders
  // crisp and clickable ABOVE open `<dialog>.showModal()` backdrops (P0 #2).
  useEffect(() => {
    const el = stackRef.current as
      | (HTMLDivElement & {
          showPopover?: () => void;
          hidePopover?: () => void;
        })
      | null;
    if (!el || typeof el.showPopover !== 'function') return;

    try {
      if (items.length > 0) {
        // Re-promote to the very top of the Top Layer stack on every new toast
        if (el.matches(':popover-open')) {
          el.hidePopover?.();
        }
        el.showPopover();
      } else if (el.matches(':popover-open')) {
        el.hidePopover?.();
      }
    } catch {
      // ignore browsers with partial popover support
    }
  }, [items]);

  const apiValue = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (message) => push('success', message, 3600),
      info: (message) => push('info', message, 4200),
      warning: (message) => push('warning', message, 5200),
      error: (errOrMessage, fallbackMessage) => {
        const localized = resolveLocalizedError(errOrMessage, locale, fallbackMessage);
        push('error', localized, 5600);
        return localized;
      },
    }),
    [locale, push],
  );

  return (
    <ToastContext.Provider value={apiValue}>
      {children}
      <div
        ref={stackRef}
        popover="manual"
        aria-live="polite"
        aria-atomic="false"
        className="ink-toast-stack flex flex-col gap-2.5"
      >
        {items.map((item) => {
          const styles =
            item.tone === 'error'
              ? {
                  backgroundColor: 'var(--alert-danger-bg)',
                  borderColor: 'var(--alert-danger-border)',
                  color: 'var(--alert-danger-title)',
                }
              : item.tone === 'warning'
                ? {
                    backgroundColor: 'var(--alert-warn-bg)',
                    borderColor: 'var(--alert-warn-border)',
                    color: 'var(--alert-warn-title)',
                  }
                : item.tone === 'success'
                  ? {
                      backgroundColor: 'var(--alert-mint-bg)',
                      borderColor: 'var(--alert-mint-border)',
                      color: 'var(--alert-mint-title)',
                    }
                  : {
                      backgroundColor: 'var(--surface-sheet)',
                      borderColor: 'var(--border-ink)',
                      color: 'var(--ink-primary)',
                    };

          return (
            <div
              key={item.id}
              role={item.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto ui-popover-enter rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-xs font-semibold leading-relaxed"
              style={{
                backgroundColor: styles.backgroundColor,
                border: `2px solid ${styles.borderColor}`,
                color: styles.color,
                boxShadow: 'var(--shadow-floating)',
              }}
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0 opacity-85">
                {item.tone === 'success' ? (
                  <IconCheck className="w-4 h-4" />
                ) : (
                  <IconAlertCircle className="w-4 h-4" />
                )}
              </span>
              <span className="flex-1 min-w-0 break-words">{item.message}</span>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Close"
                className="w-6 h-6 -me-1 -mt-0.5 rounded-lg inline-flex items-center justify-center opacity-75 hover:opacity-100 cursor-pointer shrink-0"
              >
                <IconClose className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {},
      success: () => {},
      info: () => {},
      warning: () => {},
      error: (err, fallback) =>
        err instanceof Error ? err.message : fallback ?? String(err ?? ''),
    };
  }
  return ctx;
}
