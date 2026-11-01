/**
 * Multiplayer client. Speaks a small JSON protocol with the room server:
 *
 *   server → client: welcome | join | leave | host | msg | set | pong | error
 *   client → server: msg | set | ping
 *
 * Gameplay code uses `net.send/on` for events and `net.setState` for shared
 * key/value state. Transform replication is built on top (NetworkSync).
 */

export interface NetPlayer {
  id: string;
  name: string;
}

type Handler = (data: unknown, from: string) => void;

export interface NetOptions {
  /** WebSocket room URL (ws transport). */
  url?: string;
  name: string;
  /** 'ws' = room server, 'p2p' = WebRTC peers (serverless hosting). Default ws. */
  transport?: 'ws' | 'p2p';
  /** Room id for p2p (e.g. "<game>/<room>"). */
  room?: string;
  WebSocketImpl?: typeof WebSocket;
}

/** The multiplayer API games use, independent of the transport. */
export interface Net {
  id: string | null;
  hostId: string | null;
  readonly players: Map<string, NetPlayer>;
  readonly state: Record<string, unknown>;
  connected: boolean;
  ping: number;
  readonly isHost: boolean;
  connect(): Promise<void>;
  send(type: string, data?: unknown, to?: string): void;
  setState(key: string, value: unknown): void;
  on(type: string, fn: Handler): () => void;
  disconnect(): void;
}

export function createNet(opts: NetOptions): Net {
  return opts.transport === 'p2p' ? new P2PNetClient(opts) : new NetClient(opts);
}

class Handlers {
  private map = new Map<string, Set<Handler>>();
  on(type: string, fn: Handler): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit(type: string, data: unknown, from: string): void {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) fn(data, from);
  }
  clear(): void {
    this.map.clear();
  }
}

export class NetClient implements Net {
  id: string | null = null;
  hostId: string | null = null;
  readonly players = new Map<string, NetPlayer>();
  readonly state: Record<string, unknown> = {};
  connected = false;
  /** Round-trip latency in ms. */
  ping = 0;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;

  constructor(private opts: NetOptions) {}

  get isHost(): boolean {
    return this.id !== null && this.id === this.hostId;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const WS = this.opts.WebSocketImpl ?? WebSocket;
      const url = new URL(this.opts.url ?? '');
      url.searchParams.set('name', this.opts.name);
      const ws = new WS(url.toString());
      this.ws = ws;
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.t === 'welcome') resolve();
        if (msg.t === 'error') reject(new Error(String(msg.message)));
        this.handle(msg);
      };
      ws.onopen = () => {
        this.connected = true;
        this.pingTimer = setInterval(() => this.raw({ t: 'ping', ts: performance.now() }), 2000);
      };
      ws.onerror = () => reject(new Error('Could not connect to the multiplayer server'));
      ws.onclose = () => {
        this.connected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.emit('disconnect', null, '');
        if (!this.closedByUser) reject(new Error('Disconnected'));
      };
    });
  }

  private handle(msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'welcome': {
        this.id = msg.id as string;
        this.hostId = msg.host as string;
        for (const p of msg.players as NetPlayer[]) this.players.set(p.id, p);
        Object.assign(this.state, msg.state);
        this.emit('connect', { id: this.id }, '');
        break;
      }
      case 'join': {
        const p = msg.player as NetPlayer;
        this.players.set(p.id, p);
        this.emit('join', p, p.id);
        break;
      }
      case 'leave': {
        const id = msg.id as string;
        const p = this.players.get(id);
        this.players.delete(id);
        this.emit('leave', p ?? { id, name: '' }, id);
        break;
      }
      case 'host':
        this.hostId = msg.id as string;
        this.emit('host', { id: this.hostId }, '');
        break;
      case 'set':
        this.state[msg.key as string] = msg.value;
        this.emit('state', { key: msg.key, value: msg.value }, msg.from as string);
        break;
      case 'msg':
        this.emit(msg.type as string, msg.data, msg.from as string);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - (msg.ts as number));
        break;
    }
  }

  private raw(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  /** Send an event to everyone else in the room (or one player with `to`). */
  send(type: string, data?: unknown, to?: string): void {
    this.raw({ t: 'msg', type, data, to });
  }

  /** Shared room state; last write wins, late joiners receive it. */
  setState(key: string, value: unknown): void {
    this.state[key] = value;
    this.raw({ t: 'set', key, value });
  }

  on(type: string, fn: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(type: string, data: unknown, from: string): void {
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) fn(data, from);
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }
}

type Room = import('trystero/nostr').Room;
type Action = { send(data: unknown, opts?: { target?: string | string[] | null }): Promise<void>; onMessage: ((data: never, ctx: { peerId: string }) => void) | null };

/**
 * Serverless multiplayer: WebRTC data channels between players, with
 * signaling over public Nostr relays (no game server needed — works on
 * static/serverless hosting like Vercel). Host = earliest joiner.
 */
export class P2PNetClient implements Net {
  id: string | null = null;
  hostId: string | null = null;
  readonly players = new Map<string, NetPlayer>();
  readonly state: Record<string, unknown> = {};
  connected = false;
  ping = 0;
  private room: Room | null = null;
  private handlers = new Handlers();
  private joinedAt = Date.now();
  private joinTimes = new Map<string, number>();
  private msg: Action | null = null;
  private stateAction: Action | null = null;
  private hello: Action | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: NetOptions) {}

  get isHost(): boolean {
    return this.id !== null && this.id === this.hostId;
  }

  private electHost(): void {
    const all: [string, number][] = [[this.id!, this.joinedAt], ...this.joinTimes];
    all.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const next = all[0][0];
    if (next !== this.hostId) {
      this.hostId = next;
      this.handlers.emit('host', { id: next }, '');
    }
  }

  async connect(): Promise<void> {
    const { joinRoom, selfId } = await import('trystero/nostr');
    this.id = selfId;
    this.hostId = selfId;
    const room = joinRoom({ appId: 'bazi-sazi-games-v1' }, this.opts.room ?? 'lobby');
    this.room = room;
    this.msg = room.makeAction('m') as unknown as Action;
    this.stateAction = room.makeAction('s') as unknown as Action;
    this.hello = room.makeAction('h') as unknown as Action;
    this.msg.onMessage = ((data: { type: string; data: unknown }, ctx: { peerId: string }) => {
      if (data && typeof data.type === 'string') this.handlers.emit(data.type, data.data, ctx.peerId);
    }) as never;
    this.stateAction.onMessage = ((data: { key?: string; value?: unknown; all?: Record<string, unknown> }, ctx: { peerId: string }) => {
      if (data.all) Object.assign(this.state, data.all);
      else if (typeof data.key === 'string') {
        this.state[data.key] = data.value;
        this.handlers.emit('state', { key: data.key, value: data.value }, ctx.peerId);
      }
    }) as never;
    this.hello.onMessage = ((data: { name: string; joinedAt: number }, ctx: { peerId: string }) => {
      const known = this.players.has(ctx.peerId);
      const player = { id: ctx.peerId, name: String(data.name ?? 'Player').slice(0, 24) };
      this.players.set(ctx.peerId, player);
      this.joinTimes.set(ctx.peerId, Number(data.joinedAt) || Date.now());
      this.electHost();
      if (!known) this.handlers.emit('join', player, ctx.peerId);
    }) as never;
    room.onPeerJoin = (peerId) => {
      void this.hello!.send({ name: this.opts.name, joinedAt: this.joinedAt }, { target: peerId });
      if (this.isHost) void this.stateAction!.send({ all: this.state }, { target: peerId });
    };
    room.onPeerLeave = (peerId) => {
      const p = this.players.get(peerId) ?? { id: peerId, name: '' };
      this.players.delete(peerId);
      this.joinTimes.delete(peerId);
      this.electHost();
      this.handlers.emit('leave', p, peerId);
    };
    this.connected = true;
    this.pingTimer = setInterval(() => {
      const target = this.hostId && this.hostId !== this.id ? this.hostId : [...this.players.keys()][0];
      if (target) void room.ping(target).then((ms) => (this.ping = Math.round(ms))).catch(() => undefined);
    }, 2000);
    this.handlers.emit('connect', { id: this.id }, '');
  }

  send(type: string, data?: unknown, to?: string): void {
    void this.msg?.send({ type, data }, to ? { target: to } : undefined).catch(() => undefined);
  }

  setState(key: string, value: unknown): void {
    this.state[key] = value;
    void this.stateAction?.send({ key, value }).catch(() => undefined);
  }

  on(type: string, fn: Handler): () => void {
    return this.handlers.on(type, fn);
  }

  disconnect(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    void this.room?.leave();
    this.room = null;
    this.connected = false;
    this.handlers.clear();
  }
}
