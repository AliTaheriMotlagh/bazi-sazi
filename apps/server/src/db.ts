import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Ordered, append-only migrations. */
const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     is_guest INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     mode TEXT NOT NULL DEFAULT '3d',
     data TEXT NOT NULL,
     thumbnail TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX projects_owner ON projects(owner_id, updated_at DESC);
   CREATE TABLE games (
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
   CREATE INDEX games_popular ON games(plays DESC);
   CREATE INDEX games_recent ON games(updated_at DESC);
   CREATE TABLE likes (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
     PRIMARY KEY (user_id, game_id)
   );
   CREATE TABLE assets (
     hash TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );`,
];

export type Db = DatabaseSync;

export function openDb(dataDir: string, filename = 'bazi.db'): Db {
  const file = filename === ':memory:' ? ':memory:' : path.join(dataDir, filename);
  if (file !== ':memory:') mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
