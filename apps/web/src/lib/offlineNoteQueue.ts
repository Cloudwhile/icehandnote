import { buildNoteEtag } from './annotationAnchor';
import { getActiveStorageScopeKey, type api } from './api';
import { ApiError } from './apiError';
import type { AnnotationTarget, LocaleCode, UserMarginNoteDto } from './types';

const DB_NAME = 'icehandnote_offline_v1';
const DB_VERSION = 2;
const STORE_NAME = 'note_ops';

export type OfflineNoteCreatePayload = {
  step_id: string;
  locale_code: LocaleCode;
  block_anchor_id: string;
  note_color: string;
  tone?: string;
  style?: string;
  tag?: string;
  motivation?: string;
  target?: AnnotationTarget;
  content: string;
};

export type OfflineNoteUpdatePatch = {
  content?: string;
  note_color?: string;
  tone?: string;
  style?: string;
  tag?: string;
  motivation?: string;
  block_anchor_id?: string;
  target?: AnnotationTarget;
};

export type OfflineNoteOp =
  | {
      id: string;
      scopeKey?: string;
      kind: 'create';
      tempNoteId: string;
      idempotencyKey: string;
      payload: OfflineNoteCreatePayload;
      createdAt: number;
      updatedAt?: number;
    }
  | {
      id: string;
      scopeKey?: string;
      kind: 'update';
      noteId: string;
      expectedEtag?: string;
      patch: OfflineNoteUpdatePatch;
      createdAt: number;
      updatedAt?: number;
    }
  | {
      id: string;
      scopeKey?: string;
      kind: 'delete';
      noteId: string;
      expectedEtag?: string;
      createdAt: number;
      updatedAt?: number;
    };

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildOptimisticHtmlFromMarkdown(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\r?\n/g, '<br>')}</p>`;
}

export function isOfflineTempNoteId(noteId: string): boolean {
  return noteId.startsWith('offline_');
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      } else {
        store = req.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains('scopeKey')) {
        store.createIndex('scopeKey', 'scopeKey', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function readAllOps(): Promise<OfflineNoteOp[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise<OfflineNoteOp[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      let settled = false;
      req.onsuccess = () => {
        if (settled) return;
        settled = true;
        const rows = (req.result as OfflineNoteOp[] | undefined) ?? [];
        rows.sort((a, b) => a.createdAt - b.createdAt);
        resolve(rows);
      };
      req.onerror = () => {
        db.close();
        if (!settled) {
          settled = true;
          reject(req.error ?? new Error('IndexedDB read failed'));
        }
      };
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error('IndexedDB read aborted'));
        }
      };
      tx.onerror = () => {
        db.close();
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error('IndexedDB read failed'));
        }
      };
    });
  } catch {
    return [];
  }
}

async function readScopedOps(scopeKey: string): Promise<OfflineNoteOp[]> {
  const all = await readAllOps();
  return all.filter((op) => op.scopeKey === scopeKey);
}

async function putOp(op: OfflineNoteOp): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(op);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB write aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB write failed'));
    };
  });
}

async function deleteOp(opId: string): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(opId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB delete aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB delete failed'));
    };
  });
}

/** Removes authenticated (`user:*`) and legacy unscoped offline note ops when logging out or expiring sessions. */
export async function clearUserOfflineNoteOps(): Promise<void> {
  try {
    const all = await readAllOps();
    for (const op of all) {
      if (!op.scopeKey || op.scopeKey.startsWith('user:')) {
        await deleteOp(op.id);
      }
    }
  } catch {
    // ignore storage restriction
  }
}

export async function enqueueOfflineCreateNote(
  payload: OfflineNoteCreatePayload,
  scopeKey: string = getActiveStorageScopeKey(),
): Promise<UserMarginNoteDto> {
  const nowMs = Date.now();
  const tempNoteId = `offline_${makeUuid()}`;
  const op: OfflineNoteOp = {
    id: makeUuid(),
    scopeKey,
    kind: 'create',
    tempNoteId,
    idempotencyKey: makeUuid(),
    payload,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  await putOp(op);
  const nowIso = new Date(nowMs).toISOString();
  return {
    id: tempNoteId,
    learner_id: scopeKey,
    step_id: payload.step_id,
    locale_code: payload.locale_code,
    block_anchor_id: payload.block_anchor_id,
    note_color: payload.note_color,
    tone: payload.tone,
    style: payload.style,
    tag: payload.tag,
    motivation: payload.motivation,
    target: payload.target ?? null,
    body_format: 'text/markdown',
    content_html: buildOptimisticHtmlFromMarkdown(payload.content),
    raw_content: payload.content,
    version: 1,
    created_at: nowIso,
    updated_at: nowIso,
    pendingSync: true,
  };
}

export async function enqueueOfflineUpdateNote(
  noteId: string,
  patch: OfflineNoteUpdatePatch,
  expectedEtag?: string,
  scopeKey: string = getActiveStorageScopeKey(),
): Promise<void> {
  const nowMs = Date.now();
  const ops = await readScopedOps(scopeKey);
  if (isOfflineTempNoteId(noteId)) {
    const existingCreate = ops.find(
      (o): o is Extract<OfflineNoteOp, { kind: 'create' }> =>
        o.kind === 'create' && o.tempNoteId === noteId,
    );
    if (existingCreate) {
      await putOp({
        ...existingCreate,
        updatedAt: nowMs,
        payload: {
          ...existingCreate.payload,
          ...(patch.content !== undefined ? { content: patch.content } : {}),
          ...(patch.note_color !== undefined ? { note_color: patch.note_color } : {}),
          ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
          ...(patch.style !== undefined ? { style: patch.style } : {}),
          ...(patch.tag !== undefined ? { tag: patch.tag } : {}),
          ...(patch.motivation !== undefined ? { motivation: patch.motivation } : {}),
          ...(patch.block_anchor_id !== undefined
            ? { block_anchor_id: patch.block_anchor_id }
            : {}),
          ...(patch.target !== undefined ? { target: patch.target } : {}),
        },
      });
    }
    return;
  }

  const existingUpdate = ops.find(
    (o): o is Extract<OfflineNoteOp, { kind: 'update' }> =>
      o.kind === 'update' && o.noteId === noteId,
  );
  if (existingUpdate) {
    await putOp({
      ...existingUpdate,
      updatedAt: nowMs,
      patch: { ...existingUpdate.patch, ...patch },
    });
    return;
  }

  await putOp({
    id: makeUuid(),
    scopeKey,
    kind: 'update',
    noteId,
    expectedEtag,
    patch,
    createdAt: nowMs,
    updatedAt: nowMs,
  });
}

export async function enqueueOfflineDeleteNote(
  noteId: string,
  expectedEtag?: string,
  scopeKey: string = getActiveStorageScopeKey(),
): Promise<void> {
  const ops = await readScopedOps(scopeKey);
  if (isOfflineTempNoteId(noteId)) {
    for (const o of ops) {
      if (o.kind === 'create' && o.tempNoteId === noteId) {
        await deleteOp(o.id);
      }
    }
    return;
  }

  for (const o of ops) {
    if (o.kind === 'update' && o.noteId === noteId) {
      await deleteOp(o.id);
    }
  }
  const alreadyDeleted = ops.some(
    (o) => o.kind === 'delete' && o.noteId === noteId,
  );
  if (!alreadyDeleted) {
    const nowMs = Date.now();
    await putOp({
      id: makeUuid(),
      scopeKey,
      kind: 'delete',
      noteId,
      expectedEtag,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
  }
}

export async function mergeOfflineQueueIntoNotes(
  stepId: string,
  locale: LocaleCode,
  baseNotes: UserMarginNoteDto[],
  scopeKey: string = getActiveStorageScopeKey(),
): Promise<UserMarginNoteDto[]> {
  const ops = await readScopedOps(scopeKey);
  if (ops.length === 0) return baseNotes;

  const deletedIds = new Set<string>();
  const updatePatches = new Map<string, OfflineNoteUpdatePatch>();
  const pendingCreates: UserMarginNoteDto[] = [];

  for (const op of ops) {
    if (op.kind === 'delete') {
      deletedIds.add(op.noteId);
    } else if (op.kind === 'update') {
      updatePatches.set(op.noteId, {
        ...(updatePatches.get(op.noteId) ?? {}),
        ...op.patch,
      });
    } else if (
      op.kind === 'create' &&
      op.payload.step_id === stepId &&
      op.payload.locale_code === locale
    ) {
      const iso = new Date(op.createdAt).toISOString();
      pendingCreates.push({
        id: op.tempNoteId,
        learner_id: scopeKey,
        step_id: op.payload.step_id,
        locale_code: op.payload.locale_code,
        block_anchor_id: op.payload.block_anchor_id,
        note_color: op.payload.note_color,
        tone: op.payload.tone,
        style: op.payload.style,
        tag: op.payload.tag,
        motivation: op.payload.motivation,
        target: op.payload.target ?? null,
        body_format: 'text/markdown',
        content_html: buildOptimisticHtmlFromMarkdown(op.payload.content),
        raw_content: op.payload.content,
        version: 1,
        created_at: iso,
        updated_at: iso,
        pendingSync: true,
      });
    }
  }

  const merged = baseNotes
    .filter((n) => !deletedIds.has(n.id))
    .map((n) => {
      const patch = updatePatches.get(n.id);
      if (!patch) return n;
      return {
        ...n,
        ...(patch.content !== undefined
          ? {
              raw_content: patch.content,
              content_html: buildOptimisticHtmlFromMarkdown(patch.content),
            }
          : {}),
        ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
        ...(patch.style !== undefined ? { style: patch.style } : {}),
        ...(patch.tag !== undefined ? { tag: patch.tag } : {}),
        ...(patch.motivation !== undefined ? { motivation: patch.motivation } : {}),
        ...(patch.note_color !== undefined ? { note_color: patch.note_color } : {}),
        ...(patch.block_anchor_id !== undefined
          ? { block_anchor_id: patch.block_anchor_id }
          : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        pendingSync: true,
      };
    });

  return [...merged, ...pendingCreates];
}

export interface OfflineFlushResult {
  synced: number;
  dropped: number;
  conflicts: number;
  remaining: number;
}

const inFlightFlushes = new Map<string, Promise<OfflineFlushResult>>();

export function flushOfflineNoteQueue(
  clientApi: Pick<
    typeof api,
    'createMarginNote' | 'updateMarginNote' | 'deleteMarginNote'
  >,
  scopeKey: string = getActiveStorageScopeKey(),
): Promise<OfflineFlushResult> {
  const existing = inFlightFlushes.get(scopeKey);
  if (existing) return existing;

  const task = (async () => {
    const ops = await readScopedOps(scopeKey);
    if (ops.length === 0) {
      return { synced: 0, dropped: 0, conflicts: 0, remaining: 0 };
    }

    let synced = 0;
    let dropped = 0;
    let conflicts = 0;
    let idx = 0;

    for (; idx < ops.length; idx++) {
      const op = ops[idx];
      try {
        if (op.kind === 'create') {
          const created = await clientApi.createMarginNote({
            ...op.payload,
            idempotencyKey: op.idempotencyKey,
          });
          // Re-check IDB in case the user edited or deleted this offline note while `create` was in flight
          const latestScoped = await readScopedOps(scopeKey);
          const latestOp = latestScoped.find((row) => row.id === op.id);
          if (!latestOp) {
            // User deleted the local draft while create was in flight -> delete remote note cleanly
            const createdEtag = buildNoteEtag(created);
            try {
              await clientApi.deleteMarginNote(created.id, createdEtag);
            } catch {
              await putOp({
                id: makeUuid(),
                scopeKey,
                kind: 'delete',
                noteId: created.id,
                expectedEtag: createdEtag,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
          } else if (
            latestOp.kind === 'create' &&
            (latestOp.updatedAt ?? latestOp.createdAt) > (op.updatedAt ?? op.createdAt)
          ) {
            const diffPatch: OfflineNoteUpdatePatch = {};
            if (latestOp.payload.content !== op.payload.content) {
              diffPatch.content = latestOp.payload.content;
            }
            if (latestOp.payload.note_color !== op.payload.note_color) {
              diffPatch.note_color = latestOp.payload.note_color;
            }
            if (latestOp.payload.tone !== op.payload.tone) {
              diffPatch.tone = latestOp.payload.tone;
            }
            if (latestOp.payload.style !== op.payload.style) {
              diffPatch.style = latestOp.payload.style;
            }
            if (latestOp.payload.tag !== op.payload.tag) {
              diffPatch.tag = latestOp.payload.tag;
            }
            if (latestOp.payload.motivation !== op.payload.motivation) {
              diffPatch.motivation = latestOp.payload.motivation;
            }
            if (latestOp.payload.block_anchor_id !== op.payload.block_anchor_id) {
              diffPatch.block_anchor_id = latestOp.payload.block_anchor_id;
            }
            if (JSON.stringify(latestOp.payload.target) !== JSON.stringify(op.payload.target)) {
              diffPatch.target = latestOp.payload.target;
            }
            if (Object.keys(diffPatch).length > 0) {
              await putOp({
                id: makeUuid(),
                scopeKey,
                kind: 'update',
                noteId: created.id,
                expectedEtag: buildNoteEtag(created),
                patch: diffPatch,
                createdAt: latestOp.updatedAt ?? Date.now(),
                updatedAt: latestOp.updatedAt ?? Date.now(),
              });
            }
          }
          await deleteOp(op.id);
        } else if (op.kind === 'update') {
          await clientApi.updateMarginNote(op.noteId, op.patch, op.expectedEtag);
          const latestScoped = await readScopedOps(scopeKey);
          const latestOp = latestScoped.find((row) => row.id === op.id);
          if (
            !latestOp ||
            (latestOp.updatedAt ?? latestOp.createdAt) <= (op.updatedAt ?? op.createdAt)
          ) {
            await deleteOp(op.id);
          }
        } else {
          await clientApi.deleteMarginNote(op.noteId, op.expectedEtag);
          await deleteOp(op.id);
        }
        synced++;
      } catch (err) {
        if (err instanceof ApiError) {
          // Pause without data loss on auth/rate-limit/transient server failures
          if (
            err.status === 401 ||
            err.status === 403 ||
            err.status === 429 ||
            err.status >= 500
          ) {
            break;
          }
          if (err.status === 409 || err.status === 412) {
            await deleteOp(op.id);
            conflicts++;
            dropped++;
            continue;
          }
          if (err.status >= 400 && err.status < 500) {
            await deleteOp(op.id);
            dropped++;
            continue;
          }
        }
        break;
      }
    }

    const leftover = await readScopedOps(scopeKey);
    return {
      synced,
      dropped,
      conflicts,
      remaining: Math.max(0, ops.length - idx, leftover.length),
    };
  })().finally(() => {
    inFlightFlushes.delete(scopeKey);
  });

  inFlightFlushes.set(scopeKey, task);
  return task;
}
