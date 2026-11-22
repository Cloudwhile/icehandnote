/*
 * Accessible Post-Interaction Form Validation Hook
 * Implements `modern-web-guidance` (`validate-input-after-interaction`,
 * `accessible-error-announcement`, `required-field-feedback`, `style-parent-with-has`):
 * - Starts every form control at `aria-invalid="false"` (prevents Firefox/Safari
 *   from announcing empty required fields as invalid on initial focus).
 * - Syncs `aria-invalid="true"` and links `data-error` into `aria-describedby` ONLY
 *   while `:user-invalid` (or `.user-invalid-fallback`) matches.
 * - Announces newly invalid fields after blur via ONE shared polite live region
 *   after a 500ms delay so it never interrupts the next focused control.
 */

import { type RefObject, useEffect } from 'react';
import { isValidEmail } from './email';

let sharedAnnouncer: HTMLDivElement | null = null;
let sharedAnnounceTimer: number | undefined;
let sharedAnnouncedField: Element | null = null;

function getPoliteAnnouncer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (sharedAnnouncer && document.body.contains(sharedAnnouncer)) {
    return sharedAnnouncer;
  }
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.className = 'visually-hidden';
  document.body.append(el);
  sharedAnnouncer = el;
  return el;
}

function spokenText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  clone.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
    const label = n.getAttribute('aria-label');
    if (label) n.replaceWith(`${label}: `);
  });
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function linkErrorToDescribedBy(el: HTMLElement, shown: boolean): void {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const ids = (el.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length > 0) {
    el.setAttribute('aria-describedby', ids.join(' '));
  } else {
    el.removeAttribute('aria-describedby');
  }
}

function announceFieldError(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): void {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const errorEl = document.getElementById(errorId);
  const announcer = getPoliteAnnouncer();
  if (!errorEl || !announcer) return;

  const labelEl = 'labels' in el ? el.labels?.[0] : null;
  const labelPrefix = labelEl ? `${spokenText(labelEl)}: ` : '';
  window.clearTimeout(sharedAnnounceTimer);
  announcer.textContent = '';
  sharedAnnouncedField = el;
  sharedAnnounceTimer = window.setTimeout(() => {
    announcer.textContent = `${labelPrefix}${spokenText(errorEl)}`;
  }, 500);
}

export function useAccessibleFormValidation(
  formRef: RefObject<HTMLFormElement | null>,
  deps: readonly unknown[] = [],
): void {
  useEffect(() => {
    const form = formRef.current;
    if (!form || typeof window === 'undefined') return;

    const supportsUserInvalid =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('selector(:user-invalid)');
    const supportsHas =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('selector(:has(a))');

    const flagged = new WeakSet<Element>();
    const announced = new WeakSet<Element>();
    const dirtyState = new WeakMap<
      Element,
      { hasInteracted: boolean; hasBlurred: boolean }
    >();

    const isFormControl = (
      target: EventTarget | null,
    ): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      target instanceof HTMLElement &&
      target.matches('input, select, textarea') &&
      !(target instanceof HTMLInputElement &&
        (target.type === 'hidden' || target.type === 'submit' || target.type === 'button'));

    const syncParentHasFallback = (el: HTMLElement) => {
      if (supportsHas) return;
      const container = el.closest('.auth-field');
      if (!container) return;
      const hasInvalid = Boolean(
        container.querySelector(':is(:user-invalid, .user-invalid-fallback)'),
      );
      container.classList.toggle('has-error-fallback', hasInvalid);
    };

    const syncAria = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      announce = false,
    ) => {
      const invalid = supportsUserInvalid
        ? el.matches(':user-invalid')
        : el.classList.contains('user-invalid-fallback');

      if (invalid) {
        if (announce && !announced.has(el)) {
          announceFieldError(el);
          announced.add(el);
        }
        el.setAttribute('aria-invalid', 'true');
        linkErrorToDescribedBy(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
        el.setAttribute('aria-invalid', 'false');
        linkErrorToDescribedBy(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (sharedAnnouncedField === el) {
          window.clearTimeout(sharedAnnounceTimer);
          const announcer = getPoliteAnnouncer();
          if (announcer) announcer.textContent = '';
        }
      }
      syncParentHasFallback(el);
    };

    const syncEmailCustomValidity = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    ) => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'email') return;
      const trimmed = el.value.trim();
      if (!trimmed || isValidEmail(trimmed)) {
        el.setCustomValidity('');
        return;
      }
      const errorId = el.dataset.error;
      const errorEl = errorId ? document.getElementById(errorId) : null;
      const msg =
        (errorEl ? spokenText(errorEl) : '') ||
        el.dataset.invalidMessage ||
        'Please enter a valid email address.';
      el.setCustomValidity(msg);
    };

    const updateFallbackValidity = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      announce = false,
    ) => {
      syncEmailCustomValidity(el);
      if (supportsUserInvalid) {
        syncAria(el, announce);
        return;
      }
      const isValid = el.validity.valid;
      el.classList.toggle('user-invalid-fallback', !isValid);
      el.classList.toggle('user-valid-fallback', isValid);
      syncAria(el, announce);
    };

    // Initialize every control in the form to aria-invalid="false"
    form.querySelectorAll('input, select, textarea').forEach((node) => {
      if (isFormControl(node)) {
        syncEmailCustomValidity(node);
        syncAria(node, false);
      }
    });

    const onBlur = (e: Event) => {
      if (!isFormControl(e.target)) return;
      syncEmailCustomValidity(e.target);
      if (!supportsUserInvalid) {
        const state = dirtyState.get(e.target) ?? {
          hasInteracted: false,
          hasBlurred: false,
        };
        state.hasBlurred = true;
        dirtyState.set(e.target, state);
        if (state.hasInteracted) {
          updateFallbackValidity(e.target, true);
        }
        return;
      }
      syncAria(e.target, true);
    };

    const onInput = (e: Event) => {
      if (!isFormControl(e.target)) return;
      syncEmailCustomValidity(e.target);
      if (!supportsUserInvalid) {
        const state = dirtyState.get(e.target) ?? {
          hasInteracted: false,
          hasBlurred: false,
        };
        state.hasInteracted = true;
        dirtyState.set(e.target, state);
        if (state.hasBlurred) {
          updateFallbackValidity(e.target, false);
        }
        return;
      }
      if (e.target.hasAttribute('aria-invalid')) {
        syncAria(e.target, false);
      }
    };

    const onChange = (e: Event) => {
      if (!isFormControl(e.target)) return;
      updateFallbackValidity(e.target, true);
    };

    const onInvalid = (e: Event) => {
      if (!isFormControl(e.target)) return;
      syncEmailCustomValidity(e.target);
      announced.add(e.target);
      if (!supportsUserInvalid) {
        dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
      }
      updateFallbackValidity(e.target, false);
    };

    const onReset = () => {
      window.setTimeout(() => {
        form.querySelectorAll('input, select, textarea').forEach((node) => {
          if (!isFormControl(node)) return;
          dirtyState.delete(node);
          node.classList.remove('user-invalid-fallback', 'user-valid-fallback');
          if (node instanceof HTMLInputElement && node.type === 'email') {
            node.setCustomValidity('');
          }
          syncAria(node, false);
        });
      });
    };

    form.addEventListener('blur', onBlur, true);
    form.addEventListener('input', onInput);
    form.addEventListener('change', onChange, true);
    form.addEventListener('invalid', onInvalid, true);
    form.addEventListener('reset', onReset, true);

    return () => {
      form.removeEventListener('blur', onBlur, true);
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange, true);
      form.removeEventListener('invalid', onInvalid, true);
      form.removeEventListener('reset', onReset, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formRef, ...deps]);
}
