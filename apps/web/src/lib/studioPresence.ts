import { useEffect, useRef, useState } from 'react';
import { api, getClientTabId, getSessionToken } from './api';
import type { CollabRevisionSavedEvent, PresenceMemberDto } from './types';

interface UseStudioCollabStreamOptions {
  enabled: boolean;
  track: string;
  chapter: string;
  step: string;
  editLocale: string;
  isDirty: boolean;
  onRemoteSaved?: (evt: CollabRevisionSavedEvent) => void;
  onAclChanged?: () => void;
}

export function useStudioCollabStream({
  enabled,
  track,
  chapter,
  step,
  editLocale,
  isDirty,
  onRemoteSaved,
  onAclChanged,
}: UseStudioCollabStreamOptions): {
  members: PresenceMemberDto[];
  connected: boolean;
} {
  const [members, setMembers] = useState<PresenceMemberDto[]>([]);
  const [connected, setConnected] = useState(false);

  const onRemoteSavedRef = useRef(onRemoteSaved);
  onRemoteSavedRef.current = onRemoteSaved;
  const onAclChangedRef = useRef(onAclChanged);
  onAclChangedRef.current = onAclChanged;
  const editLocaleRef = useRef(editLocale);
  editLocaleRef.current = editLocale;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Reset stale peer list immediately when switching step
  useEffect(() => {
    setMembers([]);
  }, [track, chapter, step]);

  // 1. Streaming SSE subscription (RFC 9700 §4.3.2 compliant: Bearer header, never URL query token)
  useEffect(() => {
    if (!enabled || !track || !chapter || !step) {
      setMembers([]);
      setConnected(false);
      return;
    }

    let cancelled = false;
    let lastEventId = '';
    let activeController: AbortController | null = null;
    let retryTimer: number | null = null;
    let backoffMs = 1500;

    const eventsUrl = `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/events`;

    const dispatchFrame = (
      eventName: string,
      dataStr: string,
      eventId: string,
    ) => {
      if (eventId) {
        lastEventId = eventId;
      }
      if (!dataStr) return;
      try {
        const parsed = JSON.parse(dataStr) as Record<string, unknown>;
        if (eventName === 'presence' && Array.isArray(parsed.members)) {
          setMembers(parsed.members as PresenceMemberDto[]);
        } else if (eventName === 'revision_saved') {
          onRemoteSavedRef.current?.(
            parsed as unknown as CollabRevisionSavedEvent,
          );
        } else if (eventName === 'acl_changed') {
          onAclChangedRef.current?.();
        }
      } catch {
        // ignore malformed or keepalive comment frames
      }
    };

    const connectLoop = async () => {
      while (!cancelled) {
        const token = getSessionToken();
        if (!token) {
          setConnected(false);
          return;
        }
        activeController = new AbortController();
        let shouldRetry = true;
        try {
          const headers: Record<string, string> = {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
            'X-Client-Tab-Id': getClientTabId(),
          };
          if (lastEventId) {
            headers['Last-Event-ID'] = lastEventId;
          }
          const res = await fetch(eventsUrl, {
            method: 'GET',
            credentials: 'same-origin',
            headers,
            signal: activeController.signal,
          });
          if (!res.ok || !res.body) {
            setConnected(false);
            if (res.status === 401 || res.status === 403 || res.status === 404) {
              shouldRetry = false;
              return;
            }
            throw new Error(`SSE HTTP ${res.status}`);
          }

          setConnected(true);
          backoffMs = 1500;

          const reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let curId = '';
          let curEvent = 'message';
          let curData: string[] = [];

          const flushFrame = () => {
            if (curData.length > 0 || curEvent !== 'message') {
              dispatchFrame(curEvent, curData.join('\n'), curId);
            }
            curId = '';
            curEvent = 'message';
            curData = [];
          };

          while (!cancelled) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const rawLine of lines) {
              const line = rawLine.endsWith('\r')
                ? rawLine.slice(0, -1)
                : rawLine;
              if (line === '') {
                flushFrame();
              } else if (line.startsWith(':')) {
                // SSE keepalive comment
              } else if (line.startsWith('id:')) {
                curId = line.slice(3).trim();
              } else if (line.startsWith('event:')) {
                curEvent = line.slice(6).trim() || 'message';
              } else if (line.startsWith('data:')) {
                curData.push(line.slice(5).trimStart());
              }
            }
          }
        } catch {
          setConnected(false);
        }

        if (cancelled || !shouldRetry) return;
        await new Promise<void>((resolve) => {
          retryTimer = window.setTimeout(resolve, backoffMs);
        });
        backoffMs = Math.min(15000, Math.round(backoffMs * 1.6));
      }
    };

    void connectLoop();

    return () => {
      cancelled = true;
      setConnected(false);
      activeController?.abort();
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [enabled, track, chapter, step]);

  // 2. Active Presence Heartbeat (PUT every 20s + immediate DELETE only on room leave/unload)
  useEffect(() => {
    if (!enabled || !track || !chapter || !step) return;
    let active = true;
    const tabId = getClientTabId();

    const sendHeartbeat = () => {
      if (!active) return;
      void api
        .putStepPresence(track, chapter, step, {
          locale: editLocaleRef.current,
          state: isDirtyRef.current ? 'editing' : 'viewing',
          tab_id: tabId,
        })
        .then((res) => {
          if (active && Array.isArray(res.members)) {
            setMembers(res.members);
          }
        })
        .catch(() => {});
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 20_000);

    const handleUnload = () => {
      const token = getSessionToken();
      if (!token) return;
      const url = `/api/v1/studio/steps/${encodeURIComponent(track)}/${encodeURIComponent(chapter)}/${encodeURIComponent(step)}/presence?tab_id=${encodeURIComponent(tabId)}`;
      void fetch(url, {
        method: 'DELETE',
        keepalive: true,
        credentials: 'same-origin',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Client-Tab-Id': tabId,
        },
      }).catch(() => {});
    };
    window.addEventListener('pagehide', handleUnload);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', handleUnload);
      void api.deleteStepPresence(track, chapter, step, tabId).catch(() => {});
    };
  }, [enabled, track, chapter, step]);

  // 3. Notify peers immediately on locale/dirty-state transitions without tearing down room presence
  useEffect(() => {
    if (!enabled || !track || !chapter || !step) return;
    let active = true;
    const tabId = getClientTabId();
    void api
      .putStepPresence(track, chapter, step, {
        locale: editLocale,
        state: isDirty ? 'editing' : 'viewing',
        tab_id: tabId,
      })
      .then((res) => {
        if (active && Array.isArray(res.members)) {
          setMembers(res.members);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, track, chapter, step, editLocale, isDirty]);

  return { members, connected };
}
