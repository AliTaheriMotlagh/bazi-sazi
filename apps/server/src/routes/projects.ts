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
  const own = async (projectId: string, userId: string) =>
    (await db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(projectId, userId)) as ProjectRow | undefined;

  const MAX_VERSIONS = 40;
  const AUTO_EVERY_MS = 10 * 60_000;
  /** Keep a restore point of what is about to be overwritten (auto: at most every 10 minutes). */
  const snapshot = async (row: ProjectRow, manual: boolean, label: string) => {
    if (!manual) {
      const last = await db.prepare('SELECT created_at, data FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(row.id) as { created_at: number; data: string } | undefined;
      if (last && Date.now() - last.created_at < AUTO_EVERY_MS) return;
      if (last?.data === row.data) return;
    }
    await db.prepare('INSERT INTO project_versions (id, project_id, label, name, data, auto, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('v_'), row.id, label, row.name, row.data, manual ? 0 : 1, Date.now());
    await db.prepare(
      'DELETE FROM project_versions WHERE project_id = ? AND id NOT IN (SELECT id FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?)',
    ).run(row.id, row.id, MAX_VERSIONS);
  };

  app.get<{ Params: { id: string } }>('/api/projects/:id/versions', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    if (!(await own(req.params.id, me.sub))) return reply.code(404).send({ error: 'Project not found.' });
    const rows = await db.prepare('SELECT id, label, name, auto, created_at, LENGTH(data) AS size FROM project_versions WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id) as unknown as { id: string; label: string; name: string; auto: number; created_at: number; size: number }[];
    return { versions: rows.map((r) => ({ id: r.id, label: r.label, name: r.name, auto: !!r.auto, createdAt: r.created_at, size: r.size })) };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/versions', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const row = await own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const label = String((req.body as { label?: string } | null)?.label ?? '').slice(0, 80) || 'Saved version';
    await snapshot(row, true, label);
    return { ok: true };
  });

  /** Restore a version. The current state is kept as a new version first, so restoring is undoable. */
  app.post<{ Params: { id: string; vid: string } }>('/api/projects/:id/versions/:vid/restore', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const row = await own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const v = await db.prepare('SELECT data FROM project_versions WHERE id = ? AND project_id = ?').get(req.params.vid, row.id) as { data: string } | undefined;
    if (!v) return reply.code(404).send({ error: 'Version not found.' });
    await snapshot(row, true, 'Before restore');
    const data = { ...JSON.parse(v.data), id: row.id };
    const now = Date.now();
    await db.prepare('UPDATE projects SET name = ?, mode = ?, data = ?, updated_at = ? WHERE id = ?').run(data.name, data.settings.mode, JSON.stringify(data), now, row.id);
    return { ok: true, updatedAt: now, data };
  });

  // ───────── shared prefab library
  const PrefabBody = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).default(''),
    mode: z.enum(['2d', '3d']),
    /** { prefab, assets }: the prefab plus the assets it references (so it works in any project). */
    data: z.object({ prefab: z.object({ entities: z.array(z.unknown()).min(1).max(500) }).passthrough(), assets: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), url: z.string() }).passthrough()).max(60) }),
  });

  app.get<{ Querystring: { q?: string; mode?: string } }>('/api/prefabs', async (req) => {
    const q = `%${String(req.query.q ?? '').replace(/[%_]/g, '')}%`;
    const mode = req.query.mode === '2d' || req.query.mode === '3d' ? req.query.mode : null;
    const rows = await db.prepare(
      `SELECT p.id, p.name, p.description, p.mode, p.downloads, p.created_at, u.username AS author FROM shared_prefabs p JOIN users u ON u.id = p.owner_id
       WHERE (p.name LIKE ? OR p.description LIKE ?) AND (? IS NULL OR p.mode = ?) ORDER BY p.downloads DESC, p.created_at DESC LIMIT 60`,
    ).all(q, q, mode, mode) as unknown as { id: string; name: string; description: string; mode: string; downloads: number; created_at: number; author: string }[];
    return { prefabs: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, mode: r.mode, downloads: r.downloads, createdAt: r.created_at, author: r.author })) };
  });

  app.post('/api/prefabs', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(PrefabBody, req.body, reply);
    if (!body) return;
    const json = JSON.stringify(body.data);
    if (json.length > 2_000_000) return reply.code(413).send({ error: 'This prefab is too large to share.' });
    const prefabId = id('sp_');
    await db.prepare('INSERT INTO shared_prefabs (id, owner_id, name, description, mode, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(prefabId, me.sub, body.name, body.description, body.mode, json, Date.now());
    return { id: prefabId };
  });

  app.get<{ Params: { id: string } }>('/api/prefabs/:id', async (req, reply) => {
    const row = await db.prepare('SELECT name, mode, data FROM shared_prefabs WHERE id = ?').get(req.params.id) as { name: string; mode: string; data: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'Prefab not found.' });
    await db.prepare('UPDATE shared_prefabs SET downloads = downloads + 1 WHERE id = ?').run(req.params.id);
    return { name: row.name, mode: row.mode, ...JSON.parse(row.data) };
  });

  app.delete<{ Params: { id: string } }>('/api/prefabs/:id', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const r = await db.prepare('DELETE FROM shared_prefabs WHERE id = ? AND owner_id = ?').run(req.params.id, me.sub);
    if (!r.changes) return reply.code(404).send({ error: 'Prefab not found.' });
    return { ok: true };
  });

  app.get('/api/projects', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const rows = await db.prepare(
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
    await db.prepare('INSERT INTO projects (id, owner_id, name, mode, data, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
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
    const row = await own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const game = await db.prepare('SELECT slug, title, description, updated_at FROM games WHERE project_id = ?').get(row.id) as
      | { slug: string; title: string; description: string; updated_at: number }
      | undefined;
    return { id: row.id, data: JSON.parse(row.data), updatedAt: row.updated_at, game: game ?? null };
  });

  app.put<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(SaveBody, req.body, reply);
    if (!body) return;
    const row = await own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const data = { ...body.data, id: row.id };
    const now = Date.now();
    await snapshot(row, false, '');
    await db.prepare('UPDATE projects SET name = ?, mode = ?, data = ?, thumbnail = COALESCE(?, thumbnail), updated_at = ? WHERE id = ?').run(
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
    const result = await db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(req.params.id, me.sub);
    if (!result.changes) return reply.code(404).send({ error: 'Project not found.' });
    return { ok: true };
  });

  app.get<{ Querystring: { slug?: string; project?: string } }>('/api/slug-available', async (req) => {
    const slug = String(req.query.slug ?? '').toLowerCase();
    if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return { available: false, reason: 'Use 3-40 lowercase letters, numbers and dashes.' };
    const row = await db.prepare('SELECT project_id FROM games WHERE slug = ?').get(slug) as { project_id: string } | undefined;
    return { available: !row || row.project_id === req.query.project };
  });

  /** Publish (or update) the snapshot players see. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/publish', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(PublishBody, req.body, reply);
    if (!body) return;
    if (RESERVED_SLUGS.has(body.slug)) return reply.code(400).send({ error: 'That address is reserved.' });
    const row = await own(req.params.id, me.sub);
    if (!row) return reply.code(404).send({ error: 'Project not found.' });
    const taken = await db.prepare('SELECT project_id FROM games WHERE slug = ?').get(body.slug) as { project_id: string } | undefined;
    if (taken && taken.project_id !== row.id) return reply.code(409).send({ error: 'That address is already used by another game.' });
    const data = JSON.parse(row.data) as { settings: { mode: string; multiplayer: { enabled: boolean; maxPlayers: number } } };
    const now = Date.now();
    const existing = await db.prepare('SELECT id FROM games WHERE project_id = ?').get(row.id) as { id: string } | undefined;
    const mp = data.settings.multiplayer;
    const maxPlayers = Math.max(1, Math.min(64, Math.floor(mp.maxPlayers || 8)));
    if (existing) {
      await db.prepare(
        'UPDATE games SET slug = ?, title = ?, description = ?, thumbnail = COALESCE(?, thumbnail), mode = ?, multiplayer = ?, max_players = ?, data = ?, updated_at = ? WHERE id = ?',
      ).run(body.slug, body.title, body.description, body.thumbnail ?? row.thumbnail, data.settings.mode, mp.enabled ? 1 : 0, maxPlayers, row.data, now, existing.id);
    } else {
      await db.prepare(
        'INSERT INTO games (id, slug, owner_id, project_id, title, description, thumbnail, mode, multiplayer, max_players, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id('g_'), body.slug, me.sub, row.id, body.title, body.description, body.thumbnail ?? row.thumbnail, data.settings.mode, mp.enabled ? 1 : 0, maxPlayers, row.data, now, now);
    }
    return { ok: true, slug: body.slug };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id/publish', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const result = await db.prepare('DELETE FROM games WHERE project_id = ? AND owner_id = ?').run(req.params.id, me.sub);
    if (!result.changes) return reply.code(404).send({ error: 'This project is not published.' });
    return { ok: true };
  });
}
