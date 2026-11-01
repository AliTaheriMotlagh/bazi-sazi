import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { config } from '../src/config.ts';
import { openLibsql } from '../src/db.ts';
import type { FileStore } from '../src/storage.ts';

/** The Vercel setup: libSQL database + blob-style file store + no WebSockets. */
describe('serverless deployment (libSQL + blob store)', () => {
  it('runs the full create → publish → play flow', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bazi-libsql-'));
    const client = createClient({ url: `file:${path.join(dir, 'turso.db')}` });
    const db = await openLibsql('unused', undefined, client as never);
    const uploads = new Map<string, Buffer>();
    const files: FileStore = { put: async (key, data) => (uploads.set(key, data), `https://blob.example/files/${key}`) };
    const app = await buildApp({ config: { ...config, serverless: true, subdomains: false, dataDir: dir, studioDist: path.join(dir, 'none') }, db, files });

    const cfg = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(cfg).toMatchObject({ realtime: 'p2p', gameHost: 'path' });

    const { token } = (await app.inject({ method: 'POST', url: '/api/auth/guest' })).json();
    const auth = { authorization: `Bearer ${token}` };
    const data = { format: 'bazi-sazi', version: 1, id: 'x', name: 'Cloud Game', settings: { mode: '3d', multiplayer: { enabled: true, maxPlayers: 4 } }, scenes: [{ id: 's', entities: [] }] };
    const { id } = (await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { data } })).json();
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: auth })).json().projects).toHaveLength(1);

    const up = await app.inject({ method: 'POST', url: '/api/assets?name=a.png', headers: { ...auth, 'content-type': 'image/png' }, payload: Buffer.from('89504e47', 'hex') });
    expect(up.json().url).toMatch(/^https:\/\/blob\.example\/files\/[a-f0-9]{40}\.png$/);
    expect(uploads.size).toBe(1);

    expect((await app.inject({ method: 'POST', url: `/api/projects/${id}/publish`, headers: auth, payload: { slug: 'cloud-game', title: 'Cloud Game' } })).json().ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/games/cloud-game/data' })).json().name).toBe('Cloud Game');
    expect((await app.inject({ method: 'POST', url: '/api/games/cloud-game/like', headers: auth })).json()).toEqual({ liked: true, likes: 1 });
    // No WebSocket route when serverless.
    expect((await app.inject({ method: 'GET', url: '/ws/play?game=cloud-game' })).statusCode).toBe(404);
    await app.close();
  });

  it('upgrades an existing v1 database without losing data', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bazi-legacy-'));
    const client = createClient({ url: `file:${path.join(dir, 'old.db')}` });
    await client.executeMultiple(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_guest INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      INSERT INTO users VALUES ('u1', 'old-timer', 'x', 0, 1);`);
    const db = await openLibsql('unused', undefined, client as never);
    expect(await db.prepare('SELECT username FROM users WHERE id = ?').get('u1')).toEqual({ username: 'old-timer' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 0 });
  });
});
