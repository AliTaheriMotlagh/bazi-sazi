import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { verifyToken } from './auth.ts';
import type { AppContext } from './context.ts';
import { CollabHub, type CollabOp } from '../../../packages/engine/src/systems/collab.ts';
import { id, RateLimiter } from './util.ts';

interface Peer {
  id: string;
  name: string;
  socket: WebSocket;
}

interface CollabRoom {
  projectId: string;
  hub: CollabHub;
  peers: Map<string, Peer>;
  saveTimer: NodeJS.Timeout | null;
  /** Resolves when the last save finished (so closing a room never loses edits). */
  saving: Promise<void>;
}

const MAX_OPS_PER_BATCH = 500;
const SAVE_DELAY_MS = 2000;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Real-time collaborative editing: every connected editor of a project talks to one in-memory CollabHub,
 * which orders edits and periodically writes the document back to the projects table.
 * Only the owner and listed collaborators may connect.
 */
export function collab(app: FastifyInstance, { db, config }: AppContext): { rooms: Map<string, CollabRoom> } {
  const rooms = new Map<string, CollabRoom>();
  const limiter = new RateLimiter(60, 30);

  const canEdit = async (projectId: string, userId: string): Promise<boolean> => {
    const row = await db
      .prepare(
        `SELECT 1 FROM projects p WHERE p.id = ? AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_collaborators c WHERE c.project_id = p.id AND c.user_id = ?))`,
      )
      .get(projectId, userId, userId);
    return !!row;
  };

  const save = (room: CollabRoom): Promise<void> => {
    room.saveTimer = null;
    const data = room.hub.document as { name?: string; settings?: { mode?: string } };
    const json = JSON.stringify(data);
    room.saving = room.saving.then(async () => {
      try {
        await db
          .prepare('UPDATE projects SET name = ?, mode = COALESCE(?, mode), data = ?, updated_at = ? WHERE id = ?')
          .run(
            String(data.name ?? 'Untitled').slice(0, 120),
            data.settings?.mode === '2d' || data.settings?.mode === '3d' ? data.settings.mode : null,
            json,
            Date.now(),
            room.projectId,
          );
      } catch (err) {
        app.log.error(err, 'collab save failed');
      }
    });
    return room.saving;
  };

  const scheduleSave = (room: CollabRoom) => {
    room.saveTimer ??= setTimeout(() => void save(room), SAVE_DELAY_MS);
  };

  const broadcast = (room: CollabRoom, msg: unknown, except?: string) => {
    const raw = JSON.stringify(msg);
    for (const p of room.peers.values()) if (p.id !== except && p.socket.readyState === 1) p.socket.send(raw);
  };

  // ───────── collaborators (owner manages the list)
  app.get<{ Params: { id: string } }>('/api/projects/:id/collaborators', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Please sign in first.' });
    const owner = await db.prepare('SELECT 1 FROM projects WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.sub);
    if (!owner) return reply.code(404).send({ error: 'Project not found.' });
    const rows = (await db
      .prepare(
        'SELECT u.id, u.username FROM project_collaborators c JOIN users u ON u.id = c.user_id WHERE c.project_id = ? ORDER BY c.created_at',
      )
      .all(req.params.id)) as { id: string; username: string }[];
    return { collaborators: rows };
  });

  app.post<{ Params: { id: string }; Body: { username?: string } }>('/api/projects/:id/collaborators', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Please sign in first.' });
    const owner = await db.prepare('SELECT 1 FROM projects WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.sub);
    if (!owner) return reply.code(404).send({ error: 'Project not found.' });
    const username = String(req.body?.username ?? '').trim();
    const user = (await db.prepare('SELECT id, username, is_guest FROM users WHERE username = ?').get(username)) as
      { id: string; username: string; is_guest: number } | undefined;
    if (!user || user.is_guest) return reply.code(404).send({ error: 'No registered user has that name.' });
    if (user.id === req.user.sub) return reply.code(400).send({ error: 'You already own this project.' });
    await db
      .prepare('INSERT INTO project_collaborators (project_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(req.params.id, user.id, Date.now());
    return { collaborator: { id: user.id, username: user.username } };
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/projects/:id/collaborators/:userId', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Please sign in first.' });
    const owner = await db.prepare('SELECT 1 FROM projects WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.sub);
    if (!owner) return reply.code(404).send({ error: 'Project not found.' });
    await db.prepare('DELETE FROM project_collaborators WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
    return { ok: true };
  });

  // ───────── the editing socket
  app.get<{ Querystring: { project?: string; token?: string } }>('/ws/collab', { websocket: true }, async (socket, req) => {
    const fail = (message: string) => {
      socket.send(JSON.stringify({ t: 'error', message }));
      socket.close(1008);
    };
    // Browsers can't set headers on WebSockets, so the token travels in the query string.
    const user = verifyToken(String(req.query.token ?? ''), config.jwtSecret);
    const projectId = String(req.query.project ?? '');
    if (!user || !ID_RE.test(projectId)) return fail('Please sign in to collaborate.');
    if (!(await canEdit(projectId, user.sub))) return fail('You do not have access to this project.');
    if (socket.readyState !== 1) return;

    let room = rooms.get(projectId);
    if (!room) {
      const row = (await db.prepare('SELECT data FROM projects WHERE id = ?').get(projectId)) as { data: string } | undefined;
      if (!row) return fail('Project not found.');
      if (socket.readyState !== 1) return;
      room = rooms.get(projectId); // someone else may have created it while we awaited
      if (!room)
        rooms.set(
          projectId,
          (room = { projectId, hub: new CollabHub(JSON.parse(row.data)), peers: new Map(), saveTimer: null, saving: Promise.resolve() }),
        );
    }
    const joined = room;
    const peer: Peer = { id: id('cl_'), name: user.name, socket };
    joined.peers.set(peer.id, peer);
    socket.send(
      JSON.stringify({
        t: 'welcome',
        clientId: peer.id,
        snapshot: joined.hub.snapshot(),
        peers: [...joined.peers.values()].filter((p) => p.id !== peer.id).map((p) => ({ id: p.id, name: p.name })),
      }),
    );
    broadcast(joined, { t: 'join', peer: { id: peer.id, name: peer.name } }, peer.id);

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary || !limiter.take(peer.id)) return;
      let msg: { t?: string; batch?: unknown; ops?: unknown; rev?: unknown; data?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.t) {
        case 'ops': {
          if (typeof msg.batch !== 'string' || msg.batch.length > 80 || !Array.isArray(msg.ops) || msg.ops.length > MAX_OPS_PER_BATCH)
            return;
          const entry = joined.hub.submit(peer.id, msg.batch, msg.ops as CollabOp[]);
          broadcast(joined, { t: 'ops', entry });
          scheduleSave(joined);
          break;
        }
        case 'sync': {
          // The client noticed a revision gap or reconnected.
          const missed = typeof msg.rev === 'number' ? joined.hub.since(msg.rev) : null;
          socket.send(JSON.stringify(missed ? { t: 'catchup', entries: missed } : { t: 'snapshot', snapshot: joined.hub.snapshot() }));
          break;
        }
        case 'presence':
          // Cursor / selection awareness, relayed as-is (size-limited by the socket payload cap).
          broadcast(joined, { t: 'presence', id: peer.id, name: peer.name, data: msg.data }, peer.id);
          break;
      }
    });

    socket.on('close', () => {
      joined.peers.delete(peer.id);
      broadcast(joined, { t: 'leave', id: peer.id });
      if (joined.peers.size > 0) return;
      if (joined.saveTimer) clearTimeout(joined.saveTimer);
      // Persist, then free memory — unless someone rejoined while saving.
      void save(joined).then(() => {
        if (joined.peers.size === 0 && rooms.get(projectId) === joined) rooms.delete(projectId);
      });
    });
  });

  app.addHook('onClose', async () => {
    for (const room of rooms.values()) {
      if (room.saveTimer) clearTimeout(room.saveTimer);
      await save(room);
    }
  });

  return { rooms };
}
