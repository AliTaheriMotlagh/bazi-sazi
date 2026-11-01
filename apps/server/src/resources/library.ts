import type { Db } from '../db.ts';
import { id as newId } from '../util.ts';
import type { ResourceItem, ResourceKind } from './types.ts';

export interface LibraryRow {
  id: string;
  source_key: string;
  url: string;
  name: string;
  kind: ResourceKind;
  asset_type: 'image' | 'audio' | 'model' | 'video' | 'font' | 'other';
  mime: string;
  size: number;
  provider: string;
  source_url: string;
  license: string;
  license_url: string | null;
  author: string | null;
  uses: number;
  created_at: number;
}

export interface NewLibraryAsset {
  sourceKey: string;
  url: string;
  name: string;
  kind: ResourceKind;
  assetType: LibraryRow['asset_type'];
  mime: string;
  size: number;
  provider: string;
  sourceUrl: string;
  license: string;
  licenseUrl?: string;
  author?: string;
  addedBy: string;
}

/**
 * Repository for the shared library (repository pattern: SQL stays here, routes talk in plain objects).
 * `version` changes on every write so callers can cache query results and invalidate them cheaply.
 */
export class Library {
  private db: Db;
  version = 0;

  constructor(db: Db) {
    this.db = db;
  }

  async bySourceKey(key: string): Promise<LibraryRow | undefined> {
    return (await this.db.prepare('SELECT * FROM library_assets WHERE source_key = ?').get(key)) as LibraryRow | undefined;
  }

  async byId(id: string): Promise<LibraryRow | undefined> {
    return (await this.db.prepare('SELECT * FROM library_assets WHERE id = ?').get(id)) as LibraryRow | undefined;
  }

  /** Which of these source keys are already in the library? */
  async knownKeys(keys: string[]): Promise<Map<string, LibraryRow>> {
    if (!keys.length) return new Map();
    const rows = (await this.db.prepare(`SELECT * FROM library_assets WHERE source_key IN (${keys.map(() => '?').join(',')})`).all(...keys)) as LibraryRow[];
    return new Map(rows.map((r) => [r.source_key, r]));
  }

  /** Insert; if another user added the same source a moment earlier, return theirs (unique source_key). */
  async add(a: NewLibraryAsset): Promise<{ row: LibraryRow; created: boolean }> {
    const existing = await this.bySourceKey(a.sourceKey);
    if (existing) return { row: existing, created: false };
    const id = newId('lib_');
    const r = await this.db
      .prepare(
        `INSERT OR IGNORE INTO library_assets (id, source_key, url, name, kind, asset_type, mime, size, provider, source_url, license, license_url, author, added_by, uses, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, a.sourceKey, a.url, a.name, a.kind, a.assetType, a.mime, a.size, a.provider, a.sourceUrl, a.license, a.licenseUrl ?? null, a.author ?? null, a.addedBy, Date.now());
    this.version++;
    const row = (await this.bySourceKey(a.sourceKey))!;
    return { row, created: r.changes > 0 };
  }

  async recordUse(id: string): Promise<void> {
    await this.db.prepare('UPDATE library_assets SET uses = uses + 1 WHERE id = ?').run(id);
    this.version++;
  }

  async search(opts: { q: string; kind: ResourceKind | 'all'; license: 'free' | 'cc0'; limit: number; offset: number; sort?: 'popular' | 'new' }): Promise<{ rows: LibraryRow[]; total: number }> {
    const where: string[] = [];
    const args: (string | number)[] = [];
    for (const word of opts.q.toLowerCase().split(/\s+/).filter(Boolean)) {
      where.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(author,'')) LIKE ? ESCAPE '\\')");
      const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      args.push(like, like);
    }
    if (opts.kind !== 'all') {
      where.push(opts.kind === 'image' ? "kind IN ('image','texture')" : 'kind = ?');
      if (opts.kind !== 'image') args.push(opts.kind);
    }
    if (opts.license === 'cc0') where.push("(LOWER(license) LIKE '%cc0%' OR LOWER(license) LIKE '%public domain%')");
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = opts.sort === 'new' ? 'created_at DESC' : 'uses DESC, created_at DESC';
    const rows = (await this.db.prepare(`SELECT * FROM library_assets ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, opts.limit, opts.offset)) as LibraryRow[];
    const count = (await this.db.prepare(`SELECT COUNT(*) AS n FROM library_assets ${clause}`).get(...args)) as { n: number };
    return { rows, total: Number(count.n) };
  }
}

export const licenseGroupOf = (license: string): ResourceItem['licenseGroup'] => (/cc0|public domain/i.test(license) ? 'cc0' : /cc by|attribution/i.test(license) ? 'attribution' : 'other');

export function toResourceItem(r: LibraryRow): ResourceItem {
  return {
    id: `library:${r.id}`,
    provider: 'library',
    title: r.name,
    kind: r.kind,
    thumb: r.asset_type === 'image' ? r.url : null,
    preview: r.asset_type === 'audio' || r.asset_type === 'video' ? r.url : undefined,
    license: r.license,
    licenseGroup: licenseGroupOf(r.license),
    licenseUrl: r.license_url ?? undefined,
    author: r.author ?? undefined,
    sourceUrl: r.source_url,
    downloadUrl: r.url,
    size: r.size,
    inLibrary: true,
    libraryId: r.id,
    uses: r.uses,
  };
}
