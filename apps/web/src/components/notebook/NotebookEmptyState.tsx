interface NotebookEmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function NotebookEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: NotebookEmptyStateProps) {
  return (
    <div className="py-10 px-4 text-center max-w-md mx-auto">
      <div className="w-20 h-20 mx-auto rounded-2xl bg-action-subtle border border-border-subtle flex items-center justify-center">
        <svg
          aria-hidden="true"
          className="w-12 h-12 text-ink-secondary"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 38c0-10 7-16 16-16s16 6 16 16v8H16v-8Z" />
          <path d="M18 25l-3-11 10 6M46 25l3-11-10 6" />
          <path d="M24 36c1.5 1.5 3.5 1.5 5 0M35 36c1.5 1.5 3.5 1.5 5 0" />
          <path d="M30 41l2 1.5 2-1.5" />
          <path d="M48 46c5 0 8-3 8-7s-3-5-5-3" />
          <path d="M44 14h5l-5 5h5" stroke="var(--accent-ice-ink)" strokeWidth="2.2" />
        </svg>
      </div>

      <p
        className="mt-4 text-lg font-semibold text-ink-primary mb-1"
        style={{ fontFamily: 'var(--font-hand)' }}
      >
        {title}
      </p>
      {description && (
        <p className="text-sm text-ink-secondary m-0 leading-relaxed">
          {description}
        </p>
      )}

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 min-h-10 px-4 py-2 rounded-xl text-sm font-semibold ink-btn-primary cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
