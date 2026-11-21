/*
 * Unified Authenticated User Account Dropdown (`TopNavbar` & `StudioTopbar`).
 */

import { Link } from 'react-router-dom';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type { LocaleCode, UserProfileDto } from '../../lib/types';
import {
  IconExternalLink,
  IconLogOut,
  IconPen,
  IconSettings,
} from '../ui/Icons';
import { PopupMenu } from '../ui/PopupMenu';
import { StatusBadge } from '../ui/StatusBadge';
import { UserAvatar } from '../ui/UserAvatar';

export interface UserAccountMenuProps {
  locale: LocaleCode;
  user: UserProfileDto;
  context: 'public' | 'studio';
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function UserAccountMenu({
  locale,
  user,
  context,
  onOpenProfile,
  onLogout,
}: UserAccountMenuProps) {
  const copy = UI_COPY[locale];
  const profCopy = EXT_COPY[locale].profile;
  const canAuthor = user.role === 'author' || user.role === 'admin';
  const isStudio = context === 'studio';

  return (
    <PopupMenu
      align="end"
      triggerAriaLabel={user.display_name}
      triggerClassName="min-h-8 ps-1.5 pe-2.5 py-1 rounded-full bg-surface-raised border border-border-subtle hover:border-border-ink text-xs"
      triggerLabel={
        <>
          <UserAvatar
            name={user.display_name}
            avatarUrl={user.avatar_url}
            sizeClass="w-5 h-5"
            textClass="text-xs"
          />
          <span
            className={`${
              isStudio ? 'hidden sm:inline-block max-w-20' : 'max-w-24'
            } font-semibold text-ink-primary studio-ellipsis`}
          >
            {user.display_name}
          </span>
        </>
      }
    >
      {({ close }) => (
        <>
          <div className="ink-menu-header">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink-primary studio-ellipsis">
                {user.display_name}
              </span>
              <StatusBadge tone="info" mono uppercase className="px-1.5">
                {user.role}
              </StatusBadge>
            </div>
            <div className="text-xs font-mono text-ink-muted studio-ellipsis mt-0.5">
              @{user.username}
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              close(e.detail !== 0);
              onOpenProfile();
            }}
          >
            <IconSettings className="w-3.5 h-3.5 text-ink-muted" />
            <span>{profCopy.menuItem}</span>
          </button>

          {isStudio ? (
            <Link to={`/${locale}`} onClick={() => close(true)}>
              <IconExternalLink className="w-3.5 h-3.5 text-ink-muted" />
              <span>{copy.studio.frontpageLink.replace(/\s*↗$/, '')}</span>
            </Link>
          ) : (
            canAuthor && (
              <Link to={`/${locale}/studio`} onClick={() => close(true)}>
                <IconPen className="w-3.5 h-3.5 text-ink-muted" />
                <span>{copy.navStudio}</span>
              </Link>
            )
          )}

          <hr />

          <button
            type="button"
            data-tone="danger"
            onClick={(e) => {
              close(e.detail !== 0);
              onLogout();
            }}
          >
            <IconLogOut className="w-3.5 h-3.5" />
            <span>{copy.logoutBtn}</span>
          </button>
        </>
      )}
    </PopupMenu>
  );
}
