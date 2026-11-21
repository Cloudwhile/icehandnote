/*
 * Shared Calm Settings Section Card (`StudioSettingsPanel` tabs).
 */

import type { ReactNode } from 'react';

export interface SettingsSectionCardProps {
  title?: ReactNode;
  trailing?: ReactNode;
  dividedBody?: boolean;
  children: ReactNode;
}

export function SettingsSectionCard({
  title,
  trailing,
  dividedBody = false,
  children,
}: SettingsSectionCardProps) {
  return (
    <section className="studio-panel overflow-hidden">
      {(title || trailing) && (
        <div className="px-5 py-3 border-b border-border-subtle bg-surface-raised/40 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
          ) : (
            <span />
          )}
          {trailing}
        </div>
      )}

      {dividedBody ? (
        <div className="divide-y divide-border-subtle">{children}</div>
      ) : (
        <div className="p-5 sm:p-6 space-y-5">{children}</div>
      )}
    </section>
  );
}
