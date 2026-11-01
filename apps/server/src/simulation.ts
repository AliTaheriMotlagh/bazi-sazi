import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppContext } from './context.ts';
import { AuthoritativeServer, arenaSim, type ArenaInput, type ArenaState } from '../../../packages/engine/src/systems/authoritative.ts';
import { id } from './util.ts';

interface SimRoom {
  key: string;
  sim: AuthoritativeServer<ArenaState, ArenaInput>;
  sockets: Map<string, WebSocket>;
  timer: NodeJS.Timeout;
  maxPlayers: number;
}

const ROOM_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const GAME_RE = /^(test:[a-zA-Z0-9_-]{1,40}|[a-z0-9-]{3,40})$/;
const TICK_RATE = 30;

/**
 * Server-authoritative rooms. Clients send inputs only; the server steps the simulation at a fixed rate and
 * broadcasts snapshots (see engine/systems/authoritative.ts for prediction and reconciliation on the client).
 * The simulation is the built-in arena movement model; per-game server scripts are not supported yet.
 */
export function simulation(app: FastifyInstance, { db }: AppContext): { rooms: Map<string, SimRoom> } {
  const rooms = new Map<string, SimRoom>();

  app.get<{ Querystring: { game?: string; room?: string } }>('/ws/sim', { websocket: true }, async (socket, req) => {
    const fail = (message: string) => {
      socket.send(JSON.stringify({ t: 'error', message }));
      socket.close(1008);
    };
    const game = String(req.query.game ?? '');
    const roomName = String(req.query.room ?? 'public');
    if (!GAME_RE.test(game) || !ROOM_RE.test(roomName)) return fail('Invalid game or room.');
    let maxPlayers = 16;
    if (!game.startsWith('test:')) {
      const row = (await db.prepare('SELECT multiplayer, max_players FROM games WHERE slug = ?').get(game)) as { multiplayer: number; max_players: number } | undefined;
      if (!row || !row.multiplayer) return fail('This game is not multiplayer.');
      maxPlayers = row.max_players;
    }
    if (socket.readyState !== 1) return;

    const key = `${game}/${roomName}`;
    let room = rooms.get(key);
    if (!room) {
      const created: SimRoom = {
        key,
        sim: new AuthoritativeServer(arenaSim, { tickRate: TICK_RATE }),
        sockets: new Map(),
        maxPlayers,
        timer: setInterval(() => {
          const snapshot = created.sim.update();
          const raw = JSON.stringify({ t: 'snap', snapshot });
          for (const s of created.sockets.values()) if (s.readyState === 1) s.send(raw);
        }, 1000 / TICK_RATE),
      };
      created.timer.unref();
      rooms.set(key, (room = created));
    }
    if (room.sockets.size >= room.maxPlayers) return fail('This room is full.');

    const live = room;
    const playerId = id('pl_');
    live.sockets.set(playerId, socket);
    live.sim.join(playerId);
    socket.send(JSON.stringify({ t: 'welcome', id: playerId, tickRate: TICK_RATE, snapshot: live.sim.snapshot() }));

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(raw.toString()) as { t?: string; input?: unknown; ts?: unknown };
        if (msg.t === 'input') live.sim.receive(playerId, msg.input);
        else if (msg.t === 'ping') socket.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.on('close', () => {
      live.sockets.delete(playerId);
      live.sim.leave(playerId);
      if (live.sockets.size === 0) {
        clearInterval(live.timer);
        rooms.delete(key);
      }
    });
  });

  app.addHook('onClose', async () => {
    for (const room of rooms.values()) clearInterval(room.timer);
  });

  return { rooms };
}
