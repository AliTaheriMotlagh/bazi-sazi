import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { RateLimiter } from '../util.ts';

interface GameRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  thumbnail: string | null;
  mode: string;
  multiplayer: number;
  max_players: number;
  plays: number;
  likes: number;
  created_at: number;
  updated_at: number;
  author: string;
}

const LIST_COLUMNS = 'g.id, g.slug, g.title, g.description, g.thumbnail, g.mode, g.multiplayer, g.max_players, g.plays, g.likes, g.created_at, g.updated_at, u.username AS author';

function toDto(r: GameRow) {
  return {
    slug: r.slug,
    title: r.title,
    description: r.description,
    thumbnail: r.thumbnail,
    mode: r.mode,
    multiplayer: !!r.multiplayer,
    maxPlayers: r.max_players,
    plays: r.plays,
    likes: r.likes,
    author: r.author,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SORTS: Record<string, string> = {
  popular: 'g.plays DESC, g.likes DESC',
  new: 'g.updated_at DESC',
  liked: 'g.likes DESC, g.plays DESC',
};

export function gameRoutes(app: FastifyInstance, { db }: AppContext): void {
  const playLimiter = new RateLimiter(1, 1 / 600); // one counted play per IP per game per 10 min

  app.get<{ Querystring: { q?: string; sort?: string; mode?: string; multiplayer?: string; limit?: string; offset?: string } }>('/api/games', async (req) => {
    const { q, sort = 'popular', mode, multiplayer } = req.query;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q?.trim()) {
      where.push('(g.title LIKE ? OR g.description LIKE ? OR u.username LIKE ?)');
      const like = `%${q.trim().replace(/[%_]/g, '')}%`;
      args.push(like, like, like);
    }
    if (mode === '2d' || mode === '3d') {
      where.push('g.mode = ?');
      args.push(mode);
    }
    if (multiplayer === '1') where.push('g.multiplayer = 1');
    const sql = `SELECT ${LIST_COLUMNS} FROM games g JOIN users u ON u.id = g.owner_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${SORTS[sort] ?? SORTS.popular} LIMIT ? OFFSET ?`;
    const rows = await db.prepare(sql).all(...args, limit, offset) as unknown as GameRow[];
    return { games: rows.map(toDto) };
  });

  app.get('/api/games/mine', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const rows = await db.prepare(`SELECT ${LIST_COLUMNS} FROM games g JOIN users u ON u.id = g.owner_id WHERE g.owner_id = ? ORDER BY g.updated_at DESC`).all(me.sub) as unknown as GameRow[];
    return { games: rows.map(toDto) };
  });

  app.get<{ Params: { slug: string } }>('/api/games/:slug', async (req, reply) => {
    const row = await db.prepare(`SELECT ${LIST_COLUMNS} FROM games g JOIN users u ON u.id = g.owner_id WHERE g.slug = ?`).get(req.params.slug) as GameRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Game not found.' });
    const liked = req.user ? !!await db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND game_id = ?').get(req.user.sub, row.id) : false;
    return { game: { ...toDto(row), liked } };
  });

  /** The published project snapshot the player runs. */
  app.get<{ Params: { slug: string } }>('/api/games/:slug/data', async (req, reply) => {
    const row = await db.prepare('SELECT data, updated_at FROM games WHERE slug = ?').get(req.params.slug) as { data: string; updated_at: number } | undefined;
    if (!row) return reply.code(404).send({ error: 'Game not found.' });
    const etag = `"${row.updated_at}"`;
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    // Public data; CORS lets the sandboxed (opaque-origin) player iframe read it.
    return reply
      .header('etag', etag)
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=0, must-revalidate')
      .type('application/json')
      .send(row.data);
  });

  app.post<{ Params: { slug: string } }>('/api/games/:slug/play', async (req) => {
    if (playLimiter.take(`${req.ip}:${req.params.slug}`)) await db.prepare('UPDATE games SET plays = plays + 1 WHERE slug = ?').run(req.params.slug);
    return { ok: true };
  });

  app.post<{ Params: { slug: string } }>('/api/games/:slug/like', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const game = await db.prepare('SELECT id FROM games WHERE slug = ?').get(req.params.slug) as { id: string } | undefined;
    if (!game) return reply.code(404).send({ error: 'Game not found.' });
    const had = (await db.prepare('DELETE FROM likes WHERE user_id = ? AND game_id = ?').run(me.sub, game.id)).changes > 0;
    if (!had) await db.prepare('INSERT INTO likes (user_id, game_id) VALUES (?, ?)').run(me.sub, game.id);
    await db.prepare('UPDATE games SET likes = (SELECT COUNT(*) FROM likes WHERE game_id = ?) WHERE id = ?').run(game.id, game.id);
    const { likes } = await db.prepare('SELECT likes FROM games WHERE id = ?').get(game.id) as { likes: number };
    return { liked: !had, likes };
  });
}
