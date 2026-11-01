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
  url: string;
  name: string;
  WebSocketImpl?: typeof WebSocket;
}

export class NetClient {
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
      const url = new URL(this.opts.url);
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
