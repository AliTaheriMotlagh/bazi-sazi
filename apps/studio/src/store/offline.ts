import type { ProjectData } from '@bazi/engine/core';
import { ApiError, api, type ProjectRecord, type ProjectSummary } from '../api/client';

/**
 * Local-first project storage (IndexedDB). Every save lands on this device
 * first, then syncs to the server. If the server is unreachable the editor
 * keeps working and the change is flushed when the connection returns.
 */

const DB_NAME = 'bazi-offline';
const STORE = 'projects';

interface LocalProject {
  id: string;
  data: ProjectData;
  thumbnail: string | null;
  /** Server `updatedAt` this copy was based on (detects edits made elsewhere). */
  baseUpdatedAt: number;
  /** True while there are changes the server has not seen. */
  dirty: boolean;
  /** Bumped on every local write so a slow sync can't mark newer edits clean. */
  seq: number;
  game: ProjectRecord['game'];
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = run(database.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

const getLocal = (id: string) => safe(() => tx<LocalProject | undefined>('readonly', (s) => s.get(id)), undefined);
const putLocal = (rec: LocalProject) => safe(() => tx('readwrite', (s) => s.put(rec)).then(() => true), false);
const allLocal = () => safe(() => tx<LocalProject[]>('readonly', (s) => s.getAll()), []);

/** A failed request that never reached the server (offline, DNS, server down). */
export const isNetworkError = (err: unknown): boolean => !(err instanceof ApiError) || err.status >= 502;

/** Keep a clean copy of what the server has. */
export async function cacheRecord(rec: ProjectRecord): Promise<void> {
  const existing = await getLocal(rec.id);
  if (existing?.dirty) return; // never overwrite unsynced work
  await putLocal({ id: rec.id, data: rec.data, thumbnail: existing?.thumbnail ?? null, baseUpdatedAt: rec.updatedAt, dirty: false, seq: (existing?.seq ?? 0) + 1, game: rec.game, savedAt: Date.now() });
}

export interface Loaded {
  record: ProjectRecord;
  /** The server could not be reached; this is the copy stored on this device. */
  offline: boolean;
  /** Unsynced local changes were kept over the server copy. */
  restored: boolean;
}

export async function loadProject(id: string, confirmKeepLocal: () => boolean): Promise<Loaded> {
  const local = await getLocal(id);
  let record: ProjectRecord;
  try {
    record = await api.project(id);
  } catch (err) {
    if (!local || !isNetworkError(err)) throw err;
    return { record: { id, data: local.data, updatedAt: local.baseUpdatedAt, game: local.game }, offline: true, restored: local.dirty };
  }
  if (local?.dirty) {
    const serverMoved = record.updatedAt > local.baseUpdatedAt;
    if (!serverMoved || confirmKeepLocal()) return { record: { ...record, data: local.data }, offline: false, restored: true };
  }
  await cacheRecord(record);
  return { record, offline: false, restored: false };
}

/** Write to this device first; returns the sequence number to pass to markSynced. */
export async function saveLocal(id: string, data: ProjectData, thumbnail: string | null): Promise<number> {
  const existing = await getLocal(id);
  const seq = (existing?.seq ?? 0) + 1;
  await putLocal({
    id,
    data,
    thumbnail: thumbnail ?? existing?.thumbnail ?? null,
    baseUpdatedAt: existing?.baseUpdatedAt ?? 0,
    dirty: true,
    seq,
    game: existing?.game ?? null,
    savedAt: Date.now(),
  });
  return seq;
}

export async function markSynced(id: string, seq: number, updatedAt: number): Promise<void> {
  const rec = await getLocal(id);
  if (!rec) return;
  await putLocal({ ...rec, baseUpdatedAt: updatedAt, dirty: rec.seq === seq ? false : rec.dirty });
}

export async function pendingCount(): Promise<number> {
  return (await allLocal()).filter((r) => r.dirty).length;
}

let syncing = false;
/** Push every project with unsynced changes. Returns the ids that reached the server. */
export async function syncDirty(): Promise<string[]> {
  if (syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return [];
  syncing = true;
  const done: string[] = [];
  try {
    for (const rec of (await allLocal()).filter((r) => r.dirty)) {
      try {
        const res = await api.saveProject(rec.id, rec.data, rec.thumbnail);
        await markSynced(rec.id, rec.seq, res.updatedAt);
        done.push(rec.id);
      } catch (err) {
        if (isNetworkError(err)) break; // still offline: try again later
      }
    }
  } finally {
    syncing = false;
  }
  return done;
}

/** Projects stored on this device, for the home screen when the server is unreachable. */
export async function localSummaries(): Promise<ProjectSummary[]> {
  return (await allLocal())
    .map((r) => ({ id: r.id, name: r.data.name, mode: r.data.settings.mode, thumbnail: r.thumbnail, updatedAt: r.savedAt, publishedSlug: r.game?.slug ?? null }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Flush when the connection returns and every minute while changes are waiting. */
export function startOfflineSync(onSynced: (ids: string[]) => void): () => void {
  const run = () => void syncDirty().then((ids) => ids.length && onSynced(ids));
  window.addEventListener('online', run);
  const timer = setInterval(run, 60_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    clearInterval(timer);
  };
}
