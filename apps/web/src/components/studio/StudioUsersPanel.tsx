/*
 * Decoupled Studio Admin User & Role Governance Panel (`StudioPage` Section D).
 * Reuses `<StatusBadge>`, `<PasswordInput showStrengthMeter>`, and `<ConfirmDialog>`.
 */

import {
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useId,
  useRef,
  useState,
} from 'react';
import { api } from '../../lib/api';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '../../lib/email';
import { EXT_COPY, UI_COPY } from '../../lib/i18n';
import type {
  LocaleCode,
  UserProfileDto,
  UserRole,
} from '../../lib/types';
import { NotebookEmptyState } from '../notebook/NotebookEmptyState';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { InkSelect } from '../ui/InkSelect';
import { PasswordInput } from '../ui/PasswordInput';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/ToastProvider';
import { UserAvatar } from '../ui/UserAvatar';

export interface StudioUsersPanelProps {
  locale: LocaleCode;
  currentUser: UserProfileDto;
  usersList: UserProfileDto[];
  onUsersListChange: Dispatch<SetStateAction<UserProfileDto[]>>;
}

export function StudioUsersPanel({
  locale,
  currentUser,
  usersList,
  onUsersListChange,
}: StudioUsersPanelProps) {
  const s = UI_COPY[locale].studio;
  const extCopy = EXT_COPY[locale];
  const toast = useToast();
  const usersTableCaptionId = useId();

  // Create User modal state
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('author');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  // Suspend / Ban User modal state
  const [banTarget, setBanTarget] = useState<UserProfileDto | null>(null);
  const [banReasonInput, setBanReasonInput] = useState('');
  const [submittingBan, setSubmittingBan] = useState(false);
  const submittingBanRef = useRef(false);

  // Reset User Password modal state
  const [resetPwTarget, setResetPwTarget] = useState<UserProfileDto | null>(null);
  const [resetPwInput, setResetPwInput] = useState('');
  const [submittingResetPw, setSubmittingResetPw] = useState(false);

  // Delete User modal state
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfileDto | null>(
    null,
  );
  const [deletingUser, setDeletingUser] = useState(false);

  const adminCount = usersList.filter((u) => u.role === 'admin').length;
  const authorCount = usersList.filter((u) => u.role === 'author').length;
  const readerCount = usersList.filter((u) => u.role === 'reader').length;

  const responsiveTableVars = {
    '--col-2': JSON.stringify(s.colAuthSource),
    '--col-3': JSON.stringify(extCopy.users.colStatus),
    '--col-4': JSON.stringify(s.colRole),
    '--col-5': JSON.stringify(extCopy.users.colActions),
  } as CSSProperties;

  const handleRoleChange = async (targetUserId: string, nextRole: UserRole) => {
    try {
      const updated = await api.adminUpdateUserRole(targetUserId, nextRole);
      onUsersListChange((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      toast.success(
        s.roleUpdatedFeedback(updated.username, updated.role.toUpperCase()),
      );
    } catch (err) {
      toast.error(err);
    }
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newUserPassword || creatingUser) return;
    let normalizedEmail = '';
    if (newEmail.trim()) {
      const parsed = normalizeEmail(newEmail);
      if (!parsed) {
        toast.error('INVALID_EMAIL');
        return;
      }
      normalizedEmail = parsed;
    }
    setCreatingUser(true);
    try {
      const created = await api.adminCreateUser({
        username: newUsername.trim(),
        display_name: newDisplayName.trim() || newUsername.trim(),
        email: normalizedEmail,
        role: newUserRole,
        password: newUserPassword,
      });
      onUsersListChange((prev) => [created, ...prev]);
      setCreateUserOpen(false);
      setNewUsername('');
      setNewDisplayName('');
      setNewEmail('');
      setNewUserRole('author');
      setNewUserPassword('');
      toast.success(extCopy.users.userCreatedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setCreatingUser(false);
    }
  };

  const handleConfirmBanUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!banTarget || submittingBanRef.current) return;
    submittingBanRef.current = true;
    setSubmittingBan(true);
    try {
      const updated = await api.adminSetUserBan(
        banTarget.id,
        true,
        banReasonInput.trim(),
      );
      onUsersListChange((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setBanTarget(null);
      setBanReasonInput('');
      toast.success(extCopy.users.userBannedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      submittingBanRef.current = false;
      setSubmittingBan(false);
    }
  };

  const handleUnbanUser = async (target: UserProfileDto) => {
    try {
      const updated = await api.adminSetUserBan(target.id, false, '');
      onUsersListChange((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      toast.success(extCopy.users.userUnbannedMsg);
    } catch (err) {
      toast.error(err);
    }
  };

  const handleConfirmResetUserPw = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetPwTarget || !resetPwInput || submittingResetPw) return;
    setSubmittingResetPw(true);
    try {
      const updated = await api.adminResetUserPassword(
        resetPwTarget.id,
        resetPwInput,
      );
      onUsersListChange((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setResetPwTarget(null);
      setResetPwInput('');
      toast.success(extCopy.users.userPwResetMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmittingResetPw(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteUserTarget || deletingUser) return;
    setDeletingUser(true);
    try {
      await api.adminDeleteUser(deleteUserTarget.id);
      onUsersListChange((prev) =>
        prev.filter((u) => u.id !== deleteUserTarget.id),
      );
      setDeleteUserTarget(null);
      toast.success(extCopy.users.userDeletedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeletingUser(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1
            id={usersTableCaptionId}
            className="text-xl font-semibold text-ink-primary m-0"
          >
            {s.usersTitle}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
            <span className="px-2.5 py-1 rounded-lg bg-surface-sheet border border-border-subtle text-ink-primary">
              {s.roleCountAdmin(adminCount)}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface-sheet border border-border-subtle text-ink-secondary">
              {s.roleCountAuthor(authorCount)}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface-sheet border border-border-subtle text-ink-muted">
              {s.roleCountReader(readerCount)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCreateUserOpen(true)}
          className="min-h-9 px-4 py-2 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer"
        >
          {extCopy.users.createUserBtn}
        </button>
      </div>

      {usersList.length === 0 ? (
        <div className="studio-panel p-6">
          <NotebookEmptyState
            title={s.usersEmptyTitle}
            description={s.usersEmptyDesc}
          />
        </div>
      ) : (
        <div className="studio-panel overflow-hidden">
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={usersTableCaptionId}
            className="responsive-table-region border-0 rounded-none"
          >
            <table
              className="responsive-table text-start text-sm"
              style={responsiveTableVars}
            >
              <thead>
                <tr className="border-b border-border-subtle text-xs uppercase tracking-wider text-ink-muted">
                  <th className="py-3 px-4 text-start font-semibold">
                    {s.colIdentity}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {s.colAuthSource}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {extCopy.users.colStatus}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {s.colRole}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {extCopy.users.colActions}
                  </th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-raised/50"
                    >
                      <th
                        scope="row"
                        className="py-3.5 px-4 text-start font-normal"
                      >
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            name={u.display_name}
                            avatarUrl={u.avatar_url}
                            sizeClass="w-8 h-8"
                            textClass="text-xs"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-ink-primary flex flex-wrap items-baseline gap-1.5">
                              <span>{u.display_name}</span>
                              <span className="font-mono text-xs text-ink-muted">
                                @{u.username}
                              </span>
                              {u.oauth_provider && (
                                <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-surface-raised border border-border-subtle text-ink-secondary">
                                  {u.oauth_provider}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-ink-muted truncate">
                              {u.email || '—'}
                            </div>
                          </div>
                        </div>
                      </th>
                      <td className="py-3.5 px-4 text-xs font-mono text-ink-secondary">
                        {u.auth_source}
                      </td>
                      <td className="py-3.5 px-4">
                        {u.is_banned ? (
                          <StatusBadge
                            tone="danger"
                            mono
                            title={u.ban_reason || undefined}
                          >
                            {extCopy.users.statusBanned}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="success" mono>
                            {extCopy.users.statusActive}
                          </StatusBadge>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <InkSelect
                          ariaLabel={s.changeRoleAria(u.display_name)}
                          value={u.role}
                          disabled={isSelf}
                          onChange={(nextRole) =>
                            void handleRoleChange(u.id, nextRole as UserRole)
                          }
                          options={[
                            { value: 'reader', label: s.roleOptReader },
                            { value: 'author', label: s.roleOptAuthor },
                            { value: 'admin', label: s.roleOptAdmin },
                          ]}
                          wrapperClassName="w-auto min-w-28"
                          minWidthClass="min-w-[8.5rem]"
                          triggerClassName="w-auto min-w-28 min-h-8 px-2.5 py-1 rounded-lg bg-surface-raised text-ink-primary border-border-subtle text-xs font-mono"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-start">
                        {isSelf ? (
                          <span className="text-xs font-mono text-ink-muted">
                            {extCopy.users.selfAccountBadge}
                          </span>
                        ) : (
                          <div className="inline-flex flex-wrap items-center justify-start gap-1.5">
                            {u.is_banned ? (
                              <button
                                type="button"
                                onClick={() => void handleUnbanUser(u)}
                                className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-link-ink hover:bg-action-subtle cursor-pointer"
                              >
                                {extCopy.users.unbanBtn}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setBanReasonInput('');
                                  setBanTarget(u);
                                }}
                                className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-ink-secondary hover:bg-surface-raised cursor-pointer"
                              >
                                {extCopy.users.banBtn}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setResetPwInput('');
                                setResetPwTarget(u);
                              }}
                              className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-ink-secondary hover:bg-surface-raised cursor-pointer"
                            >
                              {extCopy.users.resetPwBtn}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteUserTarget(u)}
                              className="min-h-7 px-2 py-0.5 rounded-lg text-xs font-semibold text-accent-danger hover:bg-surface-raised cursor-pointer"
                            >
                              {extCopy.users.deleteUserBtn}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Admin Create User Modal */}
      <ConfirmDialog
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        title={extCopy.users.createUserTitle}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={extCopy.users.createSubmitBtn}
        busy={creatingUser}
        maxWidthClass="max-w-md"
        onSubmit={(e) => void handleCreateUser(e)}
      >
        <div className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="admin-new-username" className="ink-field-label">
                {extCopy.users.usernameLabel}
              </label>
              <input
                id="admin-new-username"
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="ink-field-input font-mono"
              />
            </div>
            <div>
              <label htmlFor="admin-new-displayname" className="ink-field-label">
                {extCopy.users.displayNameLabel}
              </label>
              <input
                id="admin-new-displayname"
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="ink-field-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="admin-new-email" className="ink-field-label">
                {extCopy.users.emailLabel}
              </label>
              <input
                id="admin-new-email"
                type="email"
                maxLength={MAX_EMAIL_LENGTH}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="ink-field-input"
              />
            </div>
            <div>
              <label htmlFor="admin-new-role" className="ink-field-label">
                {extCopy.users.roleLabel}
              </label>
              <InkSelect
                id="admin-new-role"
                value={newUserRole}
                onChange={(nextRole) => setNewUserRole(nextRole as UserRole)}
                options={[
                  { value: 'reader', label: s.roleOptReader },
                  { value: 'author', label: s.roleOptAuthor },
                  { value: 'admin', label: s.roleOptAdmin },
                ]}
                triggerClassName="w-full min-h-9 px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border-border-subtle text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="admin-new-pw" className="ink-field-label">
              {extCopy.users.passwordLabel}
            </label>
            <PasswordInput
              id="admin-new-pw"
              locale={locale}
              required
              minLength={8}
              autoComplete="new-password"
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              showStrengthMeter
              strengthId="admin-new-pw-strength"
            />
          </div>
        </div>
      </ConfirmDialog>

      {/* Admin Suspend User Modal */}
      <ConfirmDialog
        open={Boolean(banTarget)}
        onClose={() => setBanTarget(null)}
        tone="danger"
        busy={submittingBan}
        title={extCopy.users.banDialogTitle(banTarget?.display_name ?? '')}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={extCopy.users.banConfirmBtn}
        onSubmit={(e) => void handleConfirmBanUser(e)}
      >
        <div>
          <label
            htmlFor="admin-ban-reason"
            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
          >
            {extCopy.users.banReasonLabel}
          </label>
          <input
            id="admin-ban-reason"
            type="text"
            value={banReasonInput}
            onChange={(e) => setBanReasonInput(e.target.value)}
            placeholder={extCopy.users.banReasonPlaceholder}
            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-sm ink-input-inset"
          />
        </div>
      </ConfirmDialog>

      {/* Admin Reset User Password Modal */}
      <ConfirmDialog
        open={Boolean(resetPwTarget)}
        onClose={() => setResetPwTarget(null)}
        busy={submittingResetPw}
        title={extCopy.users.resetPwDialogTitle(resetPwTarget?.display_name ?? '')}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={extCopy.users.resetPwConfirmBtn}
        onSubmit={(e) => void handleConfirmResetUserPw(e)}
      >
        <div>
          <label
            htmlFor="admin-reset-pw"
            className="block mb-1.5 text-xs font-semibold text-ink-secondary"
          >
            {extCopy.users.resetPwInputLabel}
          </label>
          <PasswordInput
            id="admin-reset-pw"
            locale={locale}
            required
            minLength={8}
            autoComplete="new-password"
            value={resetPwInput}
            onChange={(e) => setResetPwInput(e.target.value)}
            showStrengthMeter
            strengthId="admin-reset-pw-strength"
          />
        </div>
      </ConfirmDialog>

      {/* Admin Delete User Confirmation Modal */}
      <ConfirmDialog
        open={Boolean(deleteUserTarget)}
        onClose={() => setDeleteUserTarget(null)}
        tone="danger"
        busy={deletingUser}
        title={extCopy.users.deleteUserDialogTitle(
          deleteUserTarget?.display_name ?? '',
        )}
        description={extCopy.users.deleteUserDialogDesc}
        cancelLabel={s.deleteCancelBtn}
        confirmLabel={s.deleteConfirmBtn}
        onConfirm={() => void handleConfirmDeleteUser()}
      />
    </div>
  );
}
