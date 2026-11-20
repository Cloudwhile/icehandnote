import { type FormEvent, useEffect, useId, useState } from 'react';
import { api } from '../../lib/api';
import { UI_COPY } from '../../lib/i18n';
import type { LocaleCode, UserProfileDto } from '../../lib/types';
import { ModalDialog } from '../ui/ModalDialog';

interface PassportAuthModalProps {
  open: boolean;
  onClose: () => void;
  locale: LocaleCode;
  ssoEnabled: boolean;
  blogSsoEntryUrl: string;
  onAuthenticated: (user: UserProfileDto) => void;
}

export function PassportAuthModal({
  open,
  onClose,
  locale,
  ssoEnabled,
  blogSsoEntryUrl,
  onAuthenticated,
}: PassportAuthModalProps) {
  const titleId = useId();
  const copy = UI_COPY[locale].auth;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (open) {
      setErrorMsg('');
    }
  }, [open]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password || submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const session = await api.loginWithPassword(identifier.trim(), password);
      onAuthenticated(session.user);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : copy.loginFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidthClass="max-w-md"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-border-subtle">
          <h2
            id={titleId}
            className="text-lg font-semibold text-ink-primary m-0"
          >
            {copy.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink-primary border border-border-subtle cursor-pointer shrink-0"
          >
            {copy.close}
          </button>
        </div>

        <form onSubmit={(e) => void handlePasswordSubmit(e)} className="mt-5">
          {errorMsg && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-xl text-xs font-semibold"
              style={{
                backgroundColor: 'var(--alert-danger-bg)',
                border: '2px solid var(--alert-danger-border)',
                color: 'var(--alert-danger-title)',
              }}
            >
              {errorMsg}
            </div>
          )}

          <div className="mb-5">
            <label
              htmlFor="passport-identifier"
              className="block mb-1.5 text-sm font-semibold text-ink-primary"
            >
              {copy.identifierLabel}
            </label>
            <input
              id="passport-identifier"
              name="username"
              type="text"
              autoComplete="username"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              enterKeyHint="next"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={copy.identifierPlaceholder}
              className="w-full px-3.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-ink text-sm ink-input-inset"
            />
          </div>

          <div className="mb-5">
            <div className="flex items-baseline justify-between mb-1.5">
              <label
                htmlFor="passport-password"
                className="text-sm font-semibold text-ink-primary"
              >
                {copy.passwordLabel}
              </label>
              <button
                type="button"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                className="min-h-7 px-1 text-xs font-semibold text-link-ink hover:underline cursor-pointer"
              >
                {showPassword ? copy.hidePassword : copy.showPassword}
              </button>
            </div>
            <input
              id="passport-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              enterKeyHint="done"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={copy.passwordPlaceholder}
              className="w-full px-3.5 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-ink text-sm ink-input-inset"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-10 py-2.5 px-4 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer disabled:opacity-60"
          >
            {submitting ? copy.submitting : copy.submitBtn}
          </button>
        </form>

        {ssoEnabled && Boolean(blogSsoEntryUrl) && (
          <div className="mt-6 pt-5 border-t border-border-subtle">
            <a
              href={blogSsoEntryUrl}
              className="block w-full text-center min-h-9 py-2 px-3 rounded-xl text-xs font-semibold ink-btn-secondary no-underline"
            >
              {copy.blogSsoLink}
            </a>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
