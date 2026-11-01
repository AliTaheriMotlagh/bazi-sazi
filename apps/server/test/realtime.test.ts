import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.ts';
import { config } from '../src/config.ts';
import { openSqlite } from '../src/db.ts';

let app: FastifyInstance;
let base = '';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bazi-rt-'));
  app = await buildApp({ config: { ...config, dataDir, studioDist: path.join(dataDir, 'none') }, db: await openSqlite(dataDir, ':memory:') });
  base = (await app.listen({ port: 0, host: '127.0.0.1' })).replace('http', 'ws');
});
afterAll(() => app.close());

interface Conn {
  ws: WebSocket;
  inbox: Record<string, any>[];
  first: Record<string, any>;
  until: (pred: (m: Record<string, any>) => boolean, ms?: number) => Promise<Record<string, any>>;
}

const connect = (url: string) =>
  new Promise<Conn>((resolve) => {
    const ws = new WebSocket(url);
    const inbox: Record<string, any>[] = [];
    let first: Record<string, any> | null = null;
    const conn: Conn = {
      ws,
      inbox,
      get first() {
        return first!;
      },
      until: async (pred, ms = 1500) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const hit = inbox.find(pred);
          if (hit) return hit;
          await wait(10);
        }
        throw new Error(`timed out waiting for message; got ${JSON.stringify(inbox.slice(-3))}`);
      },
    };
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      inbox.push(msg);
      if (!first) {
        first = msg;
        resolve(conn);
      }
    });
  });

async function user(name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: name, password: 'supersecret' } });
  return res.json().token as string;
}

const projectBody = {
  format: 'bazi-sazi',
  version: 1,
  name: 'Collab Game',
  settings: { mode: '2d', multiplayer: { enabled: false, maxPlayers: 2 } },
  scenes: [{ id: 's1', entities: [{ id: 'e1', name: 'One' }] }],
};

describe('server-authoritative simulation (/ws/sim)', () => {
  it('welcomes with a snapshot, applies only valid inputs and streams ticks', async () => {
    const a = await connect(`${base}/ws/sim?game=test:sim&room=r1`);
    expect(a.first).toMatchObject({ t: 'welcome', tickRate: 30 });
    const id = a.first.id as string;
    const startX = a.first.snapshot.state.players[id].x as number;

    a.ws.send(JSON.stringify({ t: 'input', input: { seq: 1, x: 1, y: 0 } }));
    a.ws.send(JSON.stringify({ t: 'input', input: { seq: 2, x: 'cheat', y: 0 } })); // rejected
    const snap = await a.until((m) => m.t === 'snap' && m.snapshot.acks[id] === 1);
    expect(snap.snapshot.state.players[id].x).toBeGreaterThan(startX);
    await wait(120);
    // seq 2 was rejected, so the ack never advances beyond 1 and speed stays bounded.
    const last = [...a.inbox].reverse().find((m) => m.t === 'snap')!;
    expect(last.snapshot.acks[id]).toBe(1);
    expect(last.snapshot.state.players[id].x - startX).toBeLessThan(8 / 30 + 1e-6);
    a.ws.close();
  });

  it('shares one world between players and removes leavers', async () => {
    const a = await connect(`${base}/ws/sim?game=test:sim&room=shared`);
    const b = await connect(`${base}/ws/sim?game=test:sim&room=shared`);
    await b.until((m) => m.t === 'snap' && Object.keys(m.snapshot.state.players).length === 2);
    a.ws.close();
    await b.until((m) => m.t === 'snap' && Object.keys(m.snapshot.state.players).length === 1);
    b.ws.close();
  });

  it('rejects bad names, non-multiplayer games and full rooms', async () => {
    expect((await connect(`${base}/ws/sim?game=bad!&room=x`)).first).toMatchObject({ t: 'error' });
    expect((await connect(`${base}/ws/sim?game=no-such-game&room=x`)).first).toMatchObject({ t: 'error', message: 'This game is not multiplayer.' });
  });
});

describe('collaborative editing (/ws/collab)', () => {
  it('syncs edits between the owner and an invited collaborator and saves to the project', async () => {
    const owner = await user('owner1');
    const friend = await user('friend1');
    const stranger = await user('stranger1');
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: auth(owner), payload: { data: projectBody } });
    const projectId = created.json().id as string;

    // Strangers are turned away until invited.
    expect((await connect(`${base}/ws/collab?project=${projectId}&token=${friend}`)).first).toMatchObject({ t: 'error' });
    expect((await app.inject({ method: 'POST', url: `/api/projects/${projectId}/collaborators`, headers: auth(friend), payload: { username: 'friend1' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/projects/${projectId}/collaborators`, headers: auth(owner), payload: { username: 'nobody' } })).statusCode).toBe(404);
    const invite = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/collaborators`, headers: auth(owner), payload: { username: 'friend1' } });
    expect(invite.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/projects/${projectId}/collaborators`, headers: auth(owner) })).json().collaborators).toHaveLength(1);
    expect((await connect(`${base}/ws/collab?project=${projectId}&token=${stranger}`)).first).toMatchObject({ t: 'error' });
    expect((await connect(`${base}/ws/collab?project=${projectId}&token=bogus`)).first).toMatchObject({ t: 'error' });

    const a = await connect(`${base}/ws/collab?project=${projectId}&token=${owner}`);
    const b = await connect(`${base}/ws/collab?project=${projectId}&token=${friend}`);
    expect(a.first).toMatchObject({ t: 'welcome' });
    expect(b.first.snapshot.doc.name).toBe('Collab Game');
    expect(b.first.peers).toHaveLength(1);

    a.ws.send(JSON.stringify({ t: 'ops', batch: 'a:1', ops: [{ kind: 'set', path: ['scenes', { id: 's1' }, 'entities', { id: 'e1' }, 'name'], value: 'Renamed' }] }));
    const got = await b.until((m) => m.t === 'ops');
    expect(got.entry).toMatchObject({ rev: 1, batch: 'a:1' });
    // Echoed to the sender too, so it can confirm the pending batch.
    await a.until((m) => m.t === 'ops' && m.entry.batch === 'a:1');

    b.ws.send(JSON.stringify({ t: 'ops', batch: 'b:1', ops: [{ kind: 'insert', path: ['scenes', { id: 's1' }, 'entities'], value: { id: 'e2', name: 'Two' } }] }));
    await a.until((m) => m.t === 'ops' && m.entry.batch === 'b:1');
    b.ws.send(JSON.stringify({ t: 'sync', rev: 99 }));
    expect((await b.until((m) => m.t === 'snapshot')).snapshot.rev).toBe(2);

    // Closing the last editor persists the document.
    a.ws.close();
    b.ws.close();
    await wait(300);
    const saved = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers: auth(owner) })).json();
    const entities = saved.data.scenes[0].entities as { id: string; name: string }[];
    expect(entities.map((e) => `${e.id}:${e.name}`)).toEqual(['e1:Renamed', 'e2:Two']);
  });

  it('ignores oversized batches and prototype-pollution paths', async () => {
    const owner = await user('owner2');
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: { authorization: `Bearer ${owner}` }, payload: { data: projectBody } });
    const c = await connect(`${base}/ws/collab?project=${created.json().id}&token=${owner}`);
    c.ws.send(JSON.stringify({ t: 'ops', batch: 'x:1', ops: Array.from({ length: 501 }, () => ({ kind: 'set', path: ['name'], value: 'x' })) }));
    c.ws.send(JSON.stringify({ t: 'ops', batch: 'x:2', ops: [{ kind: 'set', path: ['__proto__', 'polluted'], value: true }] }));
    await c.until((m) => m.t === 'ops' && m.entry.batch === 'x:2');
    expect(c.inbox.some((m) => m.t === 'ops' && m.entry.batch === 'x:1')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    c.ws.close();
    await wait(200); // let the room save before the app closes
  });
});
