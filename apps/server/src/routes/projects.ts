import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { RESERVED_SLUGS, SLUG_RE } from '../config.ts';
import type { AppContext } from '../context.ts';
import { id, parse } from '../util.ts';

/** Loose structural check — the editor owns the detailed schema. */
const ProjectData = z
  .object({
    format: z.literal('bazi-sazi'),
    version: z.number(),
    name: z.string().min(1).max(120),
    settings: z.object({ mode: z.enum(['2d', '3d']), multiplayer: z.object({ enabled: z.boolean(), maxPlayers: z.number() }).passthrough() }).passthrough(),
    scenes: z.array(z.object({ id: z.string(), entities: z.array(z.unknown()) }).passthrough()).min(1),
  })
  .passthrough();

const Thumbnail = z.string().max(400_000).regex(/^data:image\/(png|jpeg|webp);base64,/).optional();

const SaveBody = z.object({ data: ProjectData, thumbnail: Thumbnail });

const PublishBody = z.object({
  slug: z.string().toLowerCase().regex(SLUG_RE, 'use 3-40 lowercase letters, numbers and dashes'),
  title: z.string().trim().min(1).max(80),
  description: z.string().max(1000).default(''),
  thumbnail: Thumbnail,
});

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  mode: string;
  data: string;
  thumbnail: string | null;
  created_at: number;
  updated_at: number;
}

export function projectRoutes(app: FastifyInstance, { db }: AppContext): void {
  const own = (projectId: string, userId: string) =>
    db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(projectId, userId) as ProjectRow | undefined;

  app.get('/api/projects', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.mode, p.thumbnail, p.updated_at, g.slug
         FROM projects p LEFT JOIN games g ON g.project_id = p.id
         WHERE p.owner_id = ? ORDER BY p.updated_at DESC`,
      )
      .all(me.sub) as unknown as (ProjectRow & { slug: string | null })[];
    return { projects: rows.map((r) => ({ id: r.id, name: r.name, mode: r.mode, thumbnail: r.thumbnail, updatedAt: r.updated_at, publishedSlug: r.slug })) };
  });

  app.post('/api/projects', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(SaveBody, req.body, reply);
    if (!body) return;
    const projectId = id('pr_');
    const data = { ...body.data, id: projectId };
    const now = Date.now();
    db.prepare('INSERT INTO projects (id, owner_id, name, mode, data, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      projectId,
      me.sub,
      data.name,
      data.settings.mode,
      JSON.stringify(data),
      body.thumbnail ?? null,
      now,
      now,
    );
    return { id: projectId, data };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const row = own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const game = db.prepare('SELECT slug, title, description, updated_at FROM games WHERE project_id = ?').get(row.id) as
      | { slug: string; title: string; description: string; updated_at: number }
      | undefined;
    return { id: row.id, data: JSON.parse(row.data), updatedAt: row.updated_at, game: game ?? null };
  });

  app.put<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(SaveBody, req.body, reply);
    if (!body) return;
    const row = own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const data = { ...body.data, id: row.id };
    const now = Date.now();
    db.prepare('UPDATE projects SET name = ?, mode = ?, data = ?, thumbnail = COALESCE(?, thumbnail), updated_at = ? WHERE id = ?').run(
      data.name,
      data.settings.mode,
      JSON.stringify(data),
      body.thumbnail ?? null,
      now,
      row.id,
    );
    return { ok: true, updatedAt: now };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const result = db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(req.params.id, me.sub);
    if (!result.changes) return reply.code(404).send({ error: 'Project not found.' });
    return { ok: true };
  });

  app.get<{ Querystring: { slug?: string; project?: string } }>('/api/slug-available', async (req) => {
    const slug = String(req.query.slug ?? '').toLowerCase();
    if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return { available: false, reason: 'Use 3-40 lowercase letters, numbers and dashes.' };
    const row = db.prepare('SELECT project_id FROM games WHERE slug = ?').get(slug) as { project_id: string } | undefined;
    return { available: !row || row.project_id === req.query.project };
  });

  /** Publish (or update) the snapshot players see. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/publish', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(PublishBody, req.body, reply);
    if (!body) return;
    if (RESERVED_SLUGS.has(body.slug)) return reply.code(400).send({ error: 'That address is reserved.' });
    const row = own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const taken = db.prepare('SELECT project_id FROM games WHERE slug = ?').get(body.slug) as { project_id: string } | undefined;
    if (taken && taken.project_id !== row.id) return reply.code(409).send({ error: 'That address is already used by another game.' });
    const data = JSON.parse(row.data) as { settings: { mode: string; multiplayer: { enabled: boolean; maxPlayers: number } } };
    const now = Date.now();
    const existing = db.prepare('SELECT id FROM games WHERE project_id = ?').get(row.id) as { id: string } | undefined;
    const mp = data.settings.multiplayer;
    const maxPlayers = Math.max(1, Math.min(64, Math.floor(mp.maxPlayers || 8)));
    if (existing) {
      db.prepare(
        'UPDATE games SET slug = ?, title = ?, description = ?, thumbnail = COALESCE(?, thumbnail), mode = ?, multiplayer = ?, max_players = ?, data = ?, updated_at = ? WHERE id = ?',
      ).run(body.slug, body.title, body.description, body.thumbnail ?? row.thumbnail, data.settings.mode, mp.enabled ? 1 : 0, maxPlayers, row.data, now, existing.id);
    } else {
      db.prepare(
        'INSERT INTO games (id, slug, owner_id, project_id, title, description, thumbnail, mode, multiplayer, max_players, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id('g_'), body.slug, me.sub, row.id, body.title, body.description, body.thumbnail ?? row.thumbnail, data.settings.mode, mp.enabled ? 1 : 0, maxPlayers, row.data, now, now);
    }
    return { ok: true, slug: body.slug };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id/publish', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const result = db.prepare('DELETE FROM games WHERE project_id = ? AND owner_id = ?').run(req.params.id, me.sub);
    if (!result.changes) return reply.code(404).send({ error: 'This project is not published.' });
    return { ok: true };
  });
}
