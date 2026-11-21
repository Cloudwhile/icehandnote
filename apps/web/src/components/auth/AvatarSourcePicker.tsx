/*
 * Shared Avatar Preview & Source Picker (`UserProfileModal` & `OAuthOnboardingPanel`).
 */

import { EXT_COPY } from '../../lib/i18n';
import type { AvatarSource, LocaleCode } from '../../lib/types';
import { FileUploadButton } from '../ui/FileUploadButton';
import { UserAvatar } from '../ui/UserAvatar';

export interface AvatarSourcePickerProps {
  locale: LocaleCode;
  name: string;
  avatarSource: AvatarSource;
  onChangeSource: (next: AvatarSource) => void;
  sources: readonly AvatarSource[];
  previewUrl: string;
  uploading: boolean;
  onSelectUploadFile: (file: File) => void;
  title?: string;
  compact?: boolean;
}

const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

export function AvatarSourcePicker({
  locale,
  name,
  avatarSource,
  onChangeSource,
  sources,
  previewUrl,
  uploading,
  onSelectUploadFile,
  title,
  compact = false,
}: AvatarSourcePickerProps) {
  const p = EXT_COPY[locale].profile;

  const sourceLabels: Record<AvatarSource, string> = {
    default: p.avatarDefault,
    gravatar: p.avatarGravatar,
    oauth: p.avatarOAuth,
    upload: p.avatarUpload,
  };

  return (
    <div
      className={`flex items-center gap-3.5 ${
        compact ? 'p-3' : 'p-3.5'
      } rounded-xl bg-surface-raised border border-border-subtle`}
    >
      <UserAvatar
        name={name || 'U'}
        avatarUrl={previewUrl}
        sizeClass={compact ? 'w-11 h-11' : 'w-12 h-12'}
        textClass={compact ? 'text-sm' : 'text-base'}
      />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-xs font-semibold text-ink-secondary">
          {title ?? p.avatarSourceLabel}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((srcKey) => {
            const selected = avatarSource === srcKey;
            return (
              <button
                key={srcKey}
                type="button"
                aria-pressed={selected}
                onClick={() => onChangeSource(srcKey)}
                className={`min-h-7 px-2.5 py-0.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                  selected
                    ? 'bg-action-subtle border-action-bg text-ink-primary font-semibold'
                    : 'bg-surface-sheet border-border-subtle text-ink-muted hover:text-ink-primary'
                }`}
              >
                {sourceLabels[srcKey]}
              </button>
            );
          })}
        </div>

        {avatarSource === 'upload' && (
          <div className="pt-0.5">
            <FileUploadButton
              accept={AVATAR_ACCEPT}
              uploading={uploading}
              label={p.uploadAvatarBtn}
              uploadingLabel={p.uploadingAvatarBtn}
              onSelectFile={onSelectUploadFile}
              buttonClassName="min-h-7 px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-primary inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
            />
          </div>
        )}
      </div>
    </div>
  );
}
