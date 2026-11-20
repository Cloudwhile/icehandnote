/*
 * Mobile Studio Navigation Drawer — powered by unified `<SwipeDrawerDialog>`.
 */

import type { ReactNode } from 'react';
import { UI_COPY } from '../../lib/i18n';
import type { LocaleCode } from '../../lib/types';
import { SwipeDrawerDialog } from '../ui/SwipeDrawerDialog';

interface StudioMobileDrawerProps {
  locale: LocaleCode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function StudioMobileDrawer({
  locale,
  open,
  onClose,
  children,
}: StudioMobileDrawerProps) {
  const s = UI_COPY[locale].studio;

  return (
    <SwipeDrawerDialog
      id="studio-sidebar-drawer"
      open={open}
      onClose={onClose}
      ariaLabel={s.mobileDrawerAriaLabel}
      title={s.mobileDrawerTitle}
      closeAriaLabel={s.closeDrawerAria}
      surface="sunken"
      className="lg:hidden"
    >
      {children}
    </SwipeDrawerDialog>
  );
}
