import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp, subdomainSlug } from '../src/app.ts';
import { config } from '../src/config.ts';
import { openDb } from '../src/db.ts';

const project = (name = 'Test Game', multiplayer = false) => ({
  format: 'bazi-sazi',
  version: 1,
  id: 'x',
  name,
  settings: { mode: '2d', multiplayer: { enabled: multiplayer, maxPlayers: 2 } },
  scenes: [{ id: 's1', entities: [] }],
});

let app: FastifyInstance;
let token = '';
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bazi-test-'));
  app = await buildApp({ config: { ...config, dataDir, studioDist: path.join(dataDir, 'none') }, db: openDb(dataDir, ':memory:') });
  await app.ready();
});
afterAll(() => app.close());

describe('auth', () => {
  it('registers, rejects duplicates and bad passwords, logs in', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'maker', password: 'supersecret' } });
    expect(reg.statusCode).toBe(200);
    token = reg.json().token;
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'MAKER', password: 'supersecret' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'maker', password: 'wrongwrong' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'maker', password: 'supersecret' } });
    expect(login.json().user.username).toBe('maker');
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: 'Bearer forged.token.here' } })).statusCode).toBe(401);
  });

  it('creates and upgrades guests', async () => {
    const guest = (await app.inject({ method: 'POST', url: '/api/auth/guest' })).json();
    expect(guest.user.guest).toBe(true);
    const up = await app.inject({ method: 'POST', url: '/api/auth/upgrade', headers: { authorization: `Bearer ${guest.token}` }, payload: { username: 'former-guest', password: 'password123' } });
    expect(up.json().user).toMatchObject({ username: 'former-guest', guest: false });
  });
});

describe('projects and publishing', () => {
  let projectId = '';

  it('requires auth and validates data', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/projects', headers: auth(), payload: { data: { nope: 1 } } })).statusCode).toBe(400);
  });

  it('creates, lists, updates and reads a project', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: auth(), payload: { data: project() } });
    projectId = created.json().id;
    expect(created.json().data.id).toBe(projectId);
    await app.inject({ method: 'PUT', url: `/api/projects/${projectId}`, headers: auth(), payload: { data: project('Renamed', true) } });
    const list = (await app.inject({ method: 'GET', url: '/api/projects', headers: auth() })).json();
    expect(list.projects[0]).toMatchObject({ id: projectId, name: 'Renamed' });
  });

  it('publishes to a unique slug and serves the snapshot', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/projects/${projectId}/publish`, headers: auth(), payload: { slug: 'api', title: 'X' } })).statusCode).toBe(400);
    const pub = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/publish`, headers: auth(), payload: { slug: 'cool-game', title: 'Cool Game' } });
    expect(pub.json()).toEqual({ ok: true, slug: 'cool-game' });
    const meta = (await app.inject({ method: 'GET', url: '/api/games/cool-game' })).json();
    expect(meta.game).toMatchObject({ title: 'Cool Game', multiplayer: true, author: 'maker' });
    const data = await app.inject({ method: 'GET', url: '/api/games/cool-game/data' });
    expect(data.json().name).toBe('Renamed');
    const again = await app.inject({ method: 'GET', url: '/api/games/cool-game/data', headers: { 'if-none-match': data.headers.etag as string } });
    expect(again.statusCode).toBe(304);
    const games = (await app.inject({ method: 'GET', url: '/api/games?q=cool' })).json().games;
    expect(games).toHaveLength(1);
  });

  it('toggles likes and counts plays', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/games/cool-game/like', headers: auth() })).json()).toEqual({ liked: true, likes: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/games/cool-game/like', headers: auth() })).json()).toEqual({ liked: false, likes: 0 });
    await app.inject({ method: 'POST', url: '/api/games/cool-game/play' });
    await app.inject({ method: 'POST', url: '/api/games/cool-game/play' });
    expect((await app.inject({ method: 'GET', url: '/api/games/cool-game' })).json().game.plays).toBe(1);
  });

  it('rejects unsafe uploads and stores allowed ones by hash', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/assets?name=x.html', headers: { ...auth(), 'content-type': 'image/x-evil' }, payload: Buffer.from('<script>') });
    expect(bad.statusCode).toBe(415);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const ok = await app.inject({ method: 'POST', url: '/api/assets?name=a.png', headers: { ...auth(), 'content-type': 'image/png' }, payload: png });
    expect(ok.json().url).toMatch(/^\/files\/[a-f0-9]{40}\.png$/);
    const file = await app.inject({ method: 'GET', url: ok.json().url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-security-policy']).toContain('sandbox');
  });
});

describe('hosting', () => {
  it('only approves TLS certificates for real games', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tls-check?domain=cool-game.localhost' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/tls-check?domain=localhost' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/tls-check?domain=random-thing.localhost' })).statusCode).toBe(404);
  });

  it('extracts game slugs from subdomains', () => {
    expect(subdomainSlug('cool-game.localhost:8787', 'localhost:8787')).toBe('cool-game');
    expect(subdomainSlug('localhost:8787', 'localhost:8787')).toBeNull();
    expect(subdomainSlug('evil.com', 'localhost:8787')).toBeNull();
    expect(subdomainSlug('My-Game.games.example.com', 'games.example.com')).toBe('my-game');
  });
});

describe('multiplayer', () => {
  it('relays messages, shares state and enforces room size', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `${address.replace('http', 'ws')}/ws/play?game=cool-game&room=r1`;
    const connect = (name: string) =>
      new Promise<{ ws: WebSocket; welcome: Record<string, unknown>; inbox: Record<string, unknown>[] }>((resolve) => {
        const ws = new WebSocket(`${url}&name=${name}`);
        const inbox: Record<string, unknown>[] = [];
        ws.on('message', (raw) => {
          const msg = JSON.parse(String(raw));
          if (msg.t === 'welcome' || msg.t === 'error') resolve({ ws, welcome: msg, inbox });
          else inbox.push(msg);
        });
      });
    const a = await connect('Ann');
    a.ws.send(JSON.stringify({ t: 'set', key: 'round', value: 3 }));
    await new Promise((r) => setTimeout(r, 50));
    const b = await connect('Bob');
    expect(b.welcome.state).toEqual({ round: 3 });
    expect(b.welcome.host).toBe(a.welcome.id);
    const c = await connect('Cy');
    expect(c.welcome).toMatchObject({ t: 'error', message: 'This room is full.' });
    b.ws.send(JSON.stringify({ t: 'msg', type: 'chat', data: 'hi' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(a.inbox.find((m) => m.t === 'msg')).toMatchObject({ type: 'chat', data: 'hi', from: b.welcome.id });
    a.ws.close();
    await new Promise((r) => setTimeout(r, 80));
    expect(b.inbox.find((m) => m.t === 'host')).toMatchObject({ id: b.welcome.id });
    b.ws.close();
  });
});
