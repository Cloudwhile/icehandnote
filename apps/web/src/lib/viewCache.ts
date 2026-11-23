const CACHE_PREFIX = 'ihn_swr:v1:';
const USER_SCOPE_PREFIX = `${CACHE_PREFIX}user:`;

export const DEFAULT_VIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRY_CHARS = 240 * 1024;

interface ViewCacheEnvelope<T> {
  ts: number;
  data: T;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function evictOldestViewCaches(storage: Storage): void {
  const entries: Array<{ key: string; ts: number }> = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    let ts = 0;
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ViewCacheEnvelope<unknown>>;
        if (typeof parsed.ts === 'number') ts = parsed.ts;
      }
    } catch {
      ts = 0;
    }
    entries.push({ key, ts });
  }
  entries.sort((a, b) => a.ts - b.ts);
  const removeCount = Math.max(1, Math.ceil(entries.length / 2));
  for (let i = 0; i < removeCount; i += 1) {
    try {
      storage.removeItem(entries[i].key);
    } catch {
      // ignore storage errors
    }
  }
}

export function scopedViewCacheKey(scopeKey: string, suffix: string): string {
  const normalized =
    scopeKey.startsWith('user:') || scopeKey.startsWith('anon:')
      ? scopeKey
      : `user:${scopeKey}`;
  return `${normalized}:${suffix}`;
}

export function readViewCache<T>(
  key: string,
  maxAgeMs: number = DEFAULT_VIEW_CACHE_TTL_MS,
): T | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  const fullKey = `${CACHE_PREFIX}${key}`;
  try {
    const raw = storage.getItem(fullKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ViewCacheEnvelope<T>>;
    if (
      !parsed ||
      typeof parsed.ts !== 'number' ||
      !('data' in parsed) ||
      Date.now() - parsed.ts > maxAgeMs
    ) {
      storage.removeItem(fullKey);
      return null;
    }
    return parsed.data as T;
  } catch {
    try {
      storage.removeItem(fullKey);
    } catch {
      // ignore storage errors
    }
    return null;
  }
}

export function writeViewCache<T>(key: string, data: T): void {
  const storage = getSessionStorage();
  if (!storage) return;
  let serialized: string;
  try {
    serialized = JSON.stringify({
      ts: Date.now(),
      data,
    } satisfies ViewCacheEnvelope<T>);
  } catch {
    return;
  }
  if (serialized.length > MAX_ENTRY_CHARS) {
    return;
  }
  const fullKey = `${CACHE_PREFIX}${key}`;
  try {
    storage.setItem(fullKey, serialized);
  } catch {
    evictOldestViewCaches(storage);
    try {
      storage.setItem(fullKey, serialized);
    } catch {
      // ignore quota or private-mode restrictions
    }
  }
}

export function clearUserViewCaches(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(USER_SCOPE_PREFIX)) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore storage errors
    }
  }
}
