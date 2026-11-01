/**
 * Tiny persistent key-value cache on IndexedDB (survives reloads, unlike sessionStorage; no size cliff like
 * localStorage). Every call is best-effort: when storage is blocked it just behaves like an empty cache.
 */
const DB = 'bz-cache';
const STORE = 'kv';

interface Entry<T> {
  value: T;
  at: number;
}

let opened: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** Read a value; entries older than `maxAgeMs` count as missing. */
export async function kvGet<T>(key: string, maxAgeMs = Infinity): Promise<T | undefined> {
  const hit = (await tx<Entry<T>>('readonly', (s) => s.get(key) as IDBRequest<Entry<T>>)) as Entry<T> | undefined;
  return hit && Date.now() - hit.at <= maxAgeMs ? hit.value : undefined;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await tx('readwrite', (s) => s.put({ value, at: Date.now() } satisfies Entry<T>, key));
}

export async function kvDelete(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key));
}

/** A small in-memory memo with expiry, for responses that are cheap to keep and annoying to refetch. */
export class TtlMemo<T> {
  private map = new Map<string, { at: number; value: T }>();
  private ttl: number;
  private max: number;
  constructor(ttlMs: number, max = 100) {
    this.ttl = ttlMs;
    this.max = max;
  }
  clear(): void {
    this.map.clear();
  }
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttl) return void this.map.delete(key);
    return hit.value;
  }
  set(key: string, value: T): void {
    this.map.delete(key);
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: Date.now(), value });
  }
}

/** Forget everything cached on this device (thumbnails, downloaded-picture cache). Projects and settings are untouched. */
export async function clearCaches(): Promise<void> {
  const db = await open();
  db?.close();
  opened = null;
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    for (const key of await caches.keys()) if (key.startsWith('bz-remote-images')) await caches.delete(key);
  } catch {
    /* Cache Storage unavailable */
  }
}
