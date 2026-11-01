import { describe, expect, it } from 'vitest';
import { AuthoritativeServer, PredictedClient, SnapshotInterpolator, arenaSim, type ArenaInput, type ArenaState } from '../src/core';

const TICK = 30;
const server = () => new AuthoritativeServer(arenaSim, { tickRate: TICK, maxQueued: 3 });

describe('authoritative server', () => {
  it('moves players only through validated inputs and acknowledges them', () => {
    const s = server();
    s.join('p1');
    const before = s.snapshot().state.players.p1.x;
    expect(s.receive('p1', { seq: 1, x: 1, y: 0 })).toBe(true);
    const snap = s.update();
    expect(snap.acks.p1).toBe(1);
    expect(snap.state.players.p1.x).toBeCloseTo(before + 8 / TICK);
  });

  it('rejects malformed, unknown-player, stale and flooded inputs', () => {
    const s = server();
    s.join('p1');
    expect(s.receive('ghost', { seq: 1, x: 1, y: 0 })).toBe(false);
    expect(s.receive('p1', { seq: 1, x: 'fast', y: 0 })).toBe(false);
    expect(s.receive('p1', { seq: 1, x: NaN, y: 0 })).toBe(false);
    expect(s.receive('p1', null)).toBe(false);
    expect(s.receive('p1', { seq: 1, x: 1, y: 0 })).toBe(true);
    expect(s.receive('p1', { seq: 1, x: 1, y: 0 })).toBe(false); // replay
    expect(s.receive('p1', { seq: 2, x: 1, y: 0 })).toBe(true);
    expect(s.receive('p1', { seq: 3, x: 1, y: 0 })).toBe(true);
    expect(s.receive('p1', { seq: 4, x: 1, y: 0 })).toBe(false); // queue cap
  });

  it('cannot be sped up: oversized vectors are normalised and one input is applied per tick', () => {
    const s = server();
    s.join('p1');
    const start = { ...s.snapshot().state.players.p1 };
    s.receive('p1', { seq: 1, x: 1000, y: 1000 });
    s.receive('p1', { seq: 2, x: 1000, y: 1000 });
    const snap = s.update();
    const moved = Math.hypot(snap.state.players.p1.x - start.x, snap.state.players.p1.y - start.y);
    expect(moved).toBeCloseTo(8 / TICK);
  });

  it('keeps players inside the arena and cleans up on leave', () => {
    const s = server();
    s.join('p1');
    for (let i = 1; i <= 400; i++) {
      s.receive('p1', { seq: i, x: 1, y: 0 });
      s.update();
    }
    expect(s.snapshot().state.players.p1.x).toBe(50);
    s.leave('p1');
    expect(s.players).toEqual([]);
    expect(s.snapshot().state.players.p1).toBeUndefined();
  });
});

describe('client prediction', () => {
  it('predicts instantly and reconciles to exactly the server result (with lag)', () => {
    const s = server();
    s.join('me');
    const client = new PredictedClient(arenaSim, 'me', 1 / TICK, s.snapshot().state);
    const inFlight: ArenaInput[] = [];
    const send = (x: number, y: number) => inFlight.push(client.input((seq) => ({ seq, x, y })));
    send(1, 0);
    send(1, 0);
    send(0, 1);
    expect(client.pendingCount).toBe(3);
    const predicted = { ...client.state.players.me };
    expect(predicted.x).toBeGreaterThan(s.snapshot().state.players.me.x); // ahead of the server

    // Server sees only the first two inputs by the time it sends a snapshot back.
    for (const i of inFlight.slice(0, 2)) s.receive('me', i);
    s.update();
    s.update();
    client.reconcile(s.snapshot());
    expect(client.pendingCount).toBe(1);
    // After the rest arrives, client and server agree exactly.
    s.receive('me', inFlight[2]);
    client.reconcile(s.update());
    expect(client.pendingCount).toBe(0);
    expect(client.state.players.me).toEqual(s.snapshot().state.players.me);
    expect(client.state.players.me.x).toBeCloseTo(predicted.x);
    expect(client.state.players.me.y).toBeCloseTo(predicted.y);
  });

  it('corrects a wrong prediction (server wall) on reconcile', () => {
    const s = server();
    s.join('me');
    const start = s.snapshot().state;
    const client = new PredictedClient(arenaSim, 'me', 1 / TICK, start);
    // Server state was moved elsewhere (e.g. pushed by game rules).
    const authoritative: ArenaState = JSON.parse(JSON.stringify(start));
    authoritative.players.me.x = -40;
    client.input((seq) => ({ seq, x: 1, y: 0 }));
    client.reconcile({ tick: 1, state: authoritative, acks: { me: 0 } });
    expect(client.state.players.me.x).toBeCloseTo(-40 + 8 / TICK);
  });
});

describe('snapshot interpolation', () => {
  it('blends between snapshots slightly in the past and clamps at the ends', () => {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const buf = new SnapshotInterpolator<number>(lerp, 0.1);
    expect(buf.sample(1)).toBeNull();
    buf.push(0, 0);
    buf.push(1, 10);
    expect(buf.sample(0.6)).toBeCloseTo(5);
    expect(buf.sample(-5)).toBe(0);
    expect(buf.sample(50)).toBe(10);
  });
});
