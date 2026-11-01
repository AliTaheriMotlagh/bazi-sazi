import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppContext } from './context.ts';
import { id } from './util.ts';

interface Player {
  id: string;
  name: string;
  socket: WebSocket;
  joinedAt: number;
  tokens: number;
  lastRefill: number;
}

interface Room {
  key: string;
  players: Map<string, Player>;
  state: Record<string, unknown>;
  hostId: string | null;
  maxPlayers: number;
}

const ROOM_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const GAME_RE = /^(test:[a-zA-Z0-9_-]{1,40}|[a-z0-9-]{3,40})$/;
const MAX_STATE_KEYS = 256;

/**
 * Relay-style room server: clients own their avatars, the oldest player is
 * the host (simulates shared objects), the server keeps shared state for late
 * joiners and enforces size/rate limits.
 */
export function multiplayer(app: FastifyInstance, { db, config }: AppContext): { rooms: Map<string, Room> } {
  const rooms = new Map<string, Room>();

  const send = (p: Player, msg: unknown) => {
    if (p.socket.readyState === 1) p.socket.send(JSON.stringify(msg));
  };
  const broadcast = (room: Room, msg: unknown, except?: string) => {
    const raw = JSON.stringify(msg);
    for (const p of room.players.values()) if (p.id !== except && p.socket.readyState === 1) p.socket.send(raw);
  };

  app.get<{ Querystring: { game?: string; room?: string; name?: string } }>('/ws/play', { websocket: true }, (socket, req) => {
    const game = String(req.query.game ?? '');
    const roomName = String(req.query.room ?? 'public');
    const name = String(req.query.name ?? 'Player').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 24) || 'Player';
    if (!GAME_RE.test(game) || !ROOM_RE.test(roomName)) {
      socket.send(JSON.stringify({ t: 'error', message: 'Invalid game or room.' }));
      return socket.close(1008);
    }
    let maxPlayers = 16;
    if (!game.startsWith('test:')) {
      const row = db.prepare('SELECT multiplayer, max_players FROM games WHERE slug = ?').get(game) as { multiplayer: number; max_players: number } | undefined;
      if (!row || !row.multiplayer) {
        socket.send(JSON.stringify({ t: 'error', message: 'This game is not multiplayer.' }));
        return socket.close(1008);
      }
      maxPlayers = row.max_players;
    }
    const key = `${game}/${roomName}`;
    let room = rooms.get(key);
    if (!room) rooms.set(key, (room = { key, players: new Map(), state: {}, hostId: null, maxPlayers }));
    if (room.players.size >= room.maxPlayers) {
      socket.send(JSON.stringify({ t: 'error', message: 'This room is full.' }));
      return socket.close(1008);
    }

    const player: Player = { id: id('pl_'), name, socket, joinedAt: Date.now(), tokens: config.limits.wsMessagesPerSecond, lastRefill: Date.now() };
    room.players.set(player.id, player);
    room.hostId ??= player.id;
    send(player, {
      t: 'welcome',
      id: player.id,
      host: room.hostId,
      players: [...room.players.values()].filter((p) => p.id !== player.id).map((p) => ({ id: p.id, name: p.name })),
      state: room.state,
    });
    broadcast(room, { t: 'join', player: { id: player.id, name } }, player.id);

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary || raw.length > config.limits.wsMessageBytes) return;
      const now = Date.now();
      const rate = config.limits.wsMessagesPerSecond;
      player.tokens = Math.min(rate * 2, player.tokens + ((now - player.lastRefill) / 1000) * rate);
      player.lastRefill = now;
      if (player.tokens < 1) return;
      player.tokens--;
      let msg: { t?: string; type?: unknown; data?: unknown; to?: unknown; key?: unknown; value?: unknown; ts?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const r = rooms.get(key);
      if (!r) return;
      switch (msg.t) {
        case 'msg': {
          if (typeof msg.type !== 'string' || msg.type.length > 64) return;
          const out = { t: 'msg', type: msg.type, data: msg.data, from: player.id };
          if (typeof msg.to === 'string') {
            const target = r.players.get(msg.to);
            if (target) send(target, out);
          } else broadcast(r, out, player.id);
          break;
        }
        case 'set': {
          if (typeof msg.key !== 'string' || msg.key.length > 64) return;
          if (!(msg.key in r.state) && Object.keys(r.state).length >= MAX_STATE_KEYS) return;
          r.state[msg.key] = msg.value;
          broadcast(r, { t: 'set', key: msg.key, value: msg.value, from: player.id }, player.id);
          break;
        }
        case 'ping':
          send(player, { t: 'pong', ts: msg.ts });
          break;
      }
    });

    socket.on('close', () => {
      const r = rooms.get(key);
      if (!r) return;
      r.players.delete(player.id);
      broadcast(r, { t: 'leave', id: player.id });
      if (r.players.size === 0) {
        rooms.delete(key);
        return;
      }
      if (r.hostId === player.id) {
        // Oldest remaining player becomes host.
        r.hostId = [...r.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
        broadcast(r, { t: 'host', id: r.hostId });
      }
    });
  });

  app.get('/api/rooms/:game', async (req) => {
    const game = (req.params as { game: string }).game;
    return {
      rooms: [...rooms.values()].filter((r) => r.key.startsWith(`${game}/`)).map((r) => ({ name: r.key.split('/')[1], players: r.players.size, max: r.maxPlayers })),
    };
  });

  return { rooms };
}
