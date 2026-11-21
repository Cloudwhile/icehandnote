import { useEffect, useState } from 'react';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  sizeClass?: string;
  textClass?: string;
}

export function UserAvatar({
  name,
  avatarUrl,
  sizeClass = 'w-6 h-6',
  textClass = 'text-xs',
}: UserAvatarProps) {
  const cleanUrl = (avatarUrl ?? '').trim();
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [cleanUrl]);

  if (cleanUrl && !imgFailed) {
    return (
      <img
        src={cleanUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={`${sizeClass} rounded-full object-cover border border-border-subtle bg-surface-raised shrink-0`}
      />
    );
  }

  const initial = (name.trim().slice(0, 1) || '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} ${textClass} bg-action-bg text-action-fg font-mono font-semibold inline-flex items-center justify-center shrink-0`}
      style={{
        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
      }}
    >
      {initial}
    </span>
  );
}
