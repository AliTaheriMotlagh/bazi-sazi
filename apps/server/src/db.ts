import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** Ordered, append-only migrations. */
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     is_guest INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     mode TEXT NOT NULL DEFAULT '3d',
     data TEXT NOT NULL,
     thumbnail TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id, updated_at DESC);
   CREATE TABLE IF NOT EXISTS games (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     thumbnail TEXT,
     mode TEXT NOT NULL,
     multiplayer INTEGER NOT NULL DEFAULT 0,
     max_players INTEGER NOT NULL DEFAULT 8,
     data TEXT NOT NULL,
     plays INTEGER NOT NULL DEFAULT 0,
     likes INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS games_popular ON games(plays DESC);
   CREATE INDEX IF NOT EXISTS games_recent ON games(updated_at DESC);
   CREATE TABLE IF NOT EXISTS likes (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
     PRIMARY KEY (user_id, game_id)
   );
   CREATE TABLE IF NOT EXISTS assets (
     hash TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );`,
];

type Value = string | number | null;
// Rows are typed at the call site (`as UserRow`), like most SQL drivers.
type Row = any;

export interface Statement {
  get(...args: Value[]): Promise<Row | undefined>;
  all(...args: Value[]): Promise<Row[]>;
  run(...args: Value[]): Promise<{ changes: number }>;
}

/**
 * Async database facade with two adapters: local SQLite (node:sqlite) for
 * self-hosting/dev, and libSQL (Turso) for serverless deployments (Vercel).
 * Both speak the same SQLite dialect, so queries are shared.
 */
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Local file (or :memory:) database using Node's built-in SQLite. */
export async function openSqlite(dataDir: string, filename = 'bazi.db'): Promise<Db> {
  const { DatabaseSync } = await import('node:sqlite');
  const file = filename === ':memory:' ? ':memory:' : path.join(dataDir, filename);
  if (file !== ':memory:') mkdirSync(dataDir, { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const db: Db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        get: async (...args) => stmt.get(...args),
        all: async (...args) => stmt.all(...args),
        run: async (...args) => ({ changes: Number(stmt.run(...args).changes) }),
      };
    },
    exec: async (sql) => void sqlite.exec(sql),
    close: async () => sqlite.close(),
  };
  await migrate(db);
  return db;
}

interface LibsqlLike {
  execute(stmt: { sql: string; args: Value[] }): Promise<{ rows: unknown[]; columns: string[]; rowsAffected: number }>;
  executeMultiple(sql: string): Promise<void>;
  close(): void;
}

/** Remote libSQL/Turso database (works on serverless — HTTP only). */
export async function openLibsql(url: string, authToken?: string, client?: LibsqlLike): Promise<Db> {
  const c: LibsqlLike = client ?? (await import('@libsql/client/web')).createClient({ url, authToken });
  const toObjects = (res: { rows: unknown[]; columns: string[] }) =>
    res.rows.map((r) => Object.fromEntries(res.columns.map((col, i) => [col, (r as Value[])[i]])));
  const db: Db = {
    prepare(sql) {
      return {
        get: async (...args) => toObjects(await c.execute({ sql, args }))[0],
        all: async (...args) => toObjects(await c.execute({ sql, args })),
        run: async (...args) => ({ changes: (await c.execute({ sql, args })).rowsAffected }),
      };
    },
    exec: (sql) => c.executeMultiple(sql),
    close: async () => c.close(),
  };
  await db.exec('PRAGMA foreign_keys = ON');
  await migrate(db);
  return db;
}

/** Version tracking in a table (portable across SQLite and libSQL). */
async function migrate(db: Db): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = (await db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get()) as { value: string } | undefined;
  // Databases created before _meta existed start at 0: migration 1 is idempotent
  // (IF NOT EXISTS), so it safely completes any older schema.
  const version = row ? Number(row.value) : 0;
  for (let i = version; i < MIGRATIONS.length; i++) await db.exec(MIGRATIONS[i]);
  await db.prepare("INSERT INTO _meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(MIGRATIONS.length));
}

/** Pick the database from configuration. */
export function openDb(config: { dataDir: string; databaseUrl: string; databaseAuthToken: string }): Promise<Db> {
  if (config.databaseUrl) return openLibsql(config.databaseUrl, config.databaseAuthToken || undefined);
  return openSqlite(config.dataDir);
}
