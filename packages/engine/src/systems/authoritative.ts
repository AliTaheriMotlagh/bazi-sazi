/**
 * Server-authoritative simulation. Clients send *inputs* (never state); the server applies them with the same
 * deterministic `step` function at a fixed tick rate and broadcasts snapshots. Clients predict locally with the
 * identical `step`, then reconcile: adopt the server snapshot and replay inputs the server hasn't acknowledged.
 * Cheating is bounded by validating inputs and capping how many a player may submit per tick.
 */

export interface SimInput {
  /** Monotonic per-player sequence number (client assigned). */
  seq: number;
}

export interface SimDefinition<S, I extends SimInput> {
  initial(): S;
  addPlayer(state: S, playerId: string): void;
  removePlayer(state: S, playerId: string): void;
  /** Advance one fixed step. Must be deterministic and must not mutate `input`. */
  step(state: S, inputs: ReadonlyMap<string, I>, dt: number): void;
  /** Return a cleaned input, or null to reject it (wrong shape, out-of-range values…). */
  sanitize(input: unknown): I | null;
}

export interface Snapshot<S> {
  tick: number;
  state: S;
  /** Highest input seq the server has applied, per player. */
  acks: Record<string, number>;
}

export interface AuthoritativeOptions {
  tickRate?: number;
  /** Inputs buffered per player between ticks (absorbs jitter); extra ones are dropped (speed-hack guard). */
  maxQueued?: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class AuthoritativeServer<S, I extends SimInput> {
  private state: S;
  private queues = new Map<string, I[]>();
  private acks = new Map<string, number>();
  tick = 0;
  readonly tickRate: number;
  private readonly maxInputs: number;
  private readonly sim: SimDefinition<S, I>;

  constructor(sim: SimDefinition<S, I>, options: AuthoritativeOptions = {}) {
    this.sim = sim;
    this.tickRate = options.tickRate ?? 30;
    this.maxInputs = options.maxQueued ?? 3;
    this.state = sim.initial();
  }

  join(playerId: string): void {
    if (this.queues.has(playerId)) return;
    this.queues.set(playerId, []);
    this.acks.set(playerId, 0);
    this.sim.addPlayer(this.state, playerId);
  }

  leave(playerId: string): void {
    if (!this.queues.delete(playerId)) return;
    this.acks.delete(playerId);
    this.sim.removePlayer(this.state, playerId);
  }

  get players(): string[] {
    return [...this.queues.keys()];
  }

  /** Queue an input from a player. Returns false if it was rejected (unknown player, bad shape, stale or over the cap). */
  receive(playerId: string, raw: unknown): boolean {
    const queue = this.queues.get(playerId);
    if (!queue) return false;
    const input = this.sim.sanitize(raw);
    if (!input || !Number.isInteger(input.seq)) return false;
    const newest = queue.length ? queue[queue.length - 1].seq : (this.acks.get(playerId) ?? 0);
    if (input.seq <= newest) return false; // replayed / out of order
    if (queue.length >= this.maxInputs) return false;
    queue.push(input);
    return true;
  }

  /** Run one tick: each player's oldest queued input is applied (at most one per tick, so input rate can't exceed tick rate). */
  update(): Snapshot<S> {
    const inputs = new Map<string, I>();
    for (const [id, queue] of this.queues) {
      const next = queue.shift();
      if (!next) continue;
      inputs.set(id, next);
      this.acks.set(id, next.seq);
    }
    this.sim.step(this.state, inputs, 1 / this.tickRate);
    this.tick++;
    return this.snapshot();
  }

  snapshot(): Snapshot<S> {
    return { tick: this.tick, state: clone(this.state), acks: Object.fromEntries(this.acks) };
  }
}

/** Client-side prediction and server reconciliation. */
export class PredictedClient<S, I extends SimInput> {
  state: S;
  readonly playerId: string;
  private pending: I[] = [];
  private seq = 0;
  private readonly sim: SimDefinition<S, I>;
  private readonly dt: number;

  /** `dt` is seconds per input and must equal 1 / the server's tick rate. */
  constructor(sim: SimDefinition<S, I>, playerId: string, dt: number, initial: S) {
    this.sim = sim;
    this.playerId = playerId;
    this.dt = dt;
    this.state = clone(initial);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Make an input from the player's controls, apply it locally right away, and return it for sending. */
  input(make: (seq: number) => I): I {
    const input = make(++this.seq);
    this.pending.push(input);
    this.sim.step(this.state, new Map([[this.playerId, input]]), this.dt);
    return input;
  }

  /** Adopt the server's state, then re-apply inputs it has not seen yet. */
  reconcile(snapshot: Snapshot<S>): void {
    const ack = snapshot.acks[this.playerId] ?? 0;
    this.pending = this.pending.filter((i) => i.seq > ack);
    this.state = clone(snapshot.state);
    for (const input of this.pending) this.sim.step(this.state, new Map([[this.playerId, input]]), this.dt);
  }
}

/** Smooths other players' positions by rendering slightly in the past between two snapshots. */
export class SnapshotInterpolator<S> {
  private buffer: { time: number; state: S }[] = [];
  private readonly lerp: (a: S, b: S, t: number) => S;
  private readonly delay: number;
  private readonly capacity: number;

  constructor(lerp: (a: S, b: S, t: number) => S, delay = 0.1, capacity = 32) {
    this.lerp = lerp;
    this.delay = delay;
    this.capacity = capacity;
  }

  push(time: number, state: S): void {
    this.buffer.push({ time, state });
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  sample(now: number): S | null {
    const t = now - this.delay;
    const b = this.buffer;
    if (!b.length) return null;
    if (t <= b[0].time) return b[0].state;
    for (let i = 1; i < b.length; i++) {
      if (t <= b[i].time) {
        const span = b[i].time - b[i - 1].time || 1;
        return this.lerp(b[i - 1].state, b[i].state, (t - b[i - 1].time) / span);
      }
    }
    return b[b.length - 1].state;
  }
}

// ---- A ready-made simulation: top-down arena movement (used by the server's /ws/sim rooms) ----

export interface ArenaInput extends SimInput {
  /** Desired direction, each axis -1..1. */
  x: number;
  y: number;
}

export interface ArenaState {
  size: number;
  speed: number;
  players: Record<string, { x: number; y: number }>;
}

export const arenaSim: SimDefinition<ArenaState, ArenaInput> = {
  initial: () => ({ size: 100, speed: 8, players: {} }),
  addPlayer(state, id) {
    const n = Object.keys(state.players).length;
    state.players[id] = { x: ((n * 17) % state.size) - state.size / 2 + 5, y: 0 };
  },
  removePlayer(state, id) {
    delete state.players[id];
  },
  sanitize(raw) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { seq, x, y } = raw as Record<string, unknown>;
    if (typeof seq !== 'number' || typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1; // diagonal can't be faster than straight
    return { seq, x: x * k, y: y * k };
  },
  step(state, inputs, dt) {
    const half = state.size / 2;
    for (const [id, input] of inputs) {
      const p = state.players[id];
      if (!p) continue;
      p.x = Math.max(-half, Math.min(half, p.x + input.x * state.speed * dt));
      p.y = Math.max(-half, Math.min(half, p.y + input.y * state.speed * dt));
    }
  },
};
