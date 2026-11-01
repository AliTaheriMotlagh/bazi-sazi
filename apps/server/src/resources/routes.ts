import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { storeAsset } from '../routes/assets.ts';
import { parse, RateLimiter } from '../util.ts';
import { searchCatalog } from './catalog.ts';
import { Library, toResourceItem } from './library.ts';
import { PROVIDERS, matchesQuery, resolvePolyhavenTexture } from './providers.ts';
import { safeDownload, type SafeFetchOptions } from './safeFetch.ts';
import { isFreeForGames, PAGE_SIZE, type FetchJson, type ProviderResult, type ResourceItem, type ResourceKind, type ResourceQuery } from './types.ts';

const KINDS = ['all', 'model', 'texture', 'image', 'audio', 'video', 'font', 'tool'] as const;

const SearchQuery = z.object({
  q: z.string().trim().max(80).default(''),
  kind: z.enum(KINDS).default('all'),
  license: z.enum(['free', 'cc0']).default('free'),
  provider: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

/** What the user saw when they chose the resource; stored with the file so everyone sees the same credit. */
const SourceMeta = z.object({
  provider: z.string().regex(/^[a-z]{2,20}$/),
  id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(160),
  author: z.string().trim().max(160).optional(),
  license: z.string().trim().min(1).max(80),
  licenseUrl: z.string().url().max(500).optional(),
  sourceUrl: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'must be https'),
}).refine((m) => m.id.startsWith(`${m.provider}:`), { message: 'id must start with the provider', path: ['id'] });

const ImportBody = z
  .object({
    url: z.string().max(2000).optional(),
    libraryId: z.string().regex(/^lib_[\w-]{1,30}$/).optional(),
    name: z.string().trim().max(120).default(''),
    kind: z.enum(KINDS).default('all'),
    meta: SourceMeta.optional(),
  })
  .refine((b) => b.url || b.libraryId, 'url or libraryId is required');

const LibraryQuery = z.object({
  q: z.string().trim().max(80).default(''),
  kind: z.enum(KINDS).default('all'),
  license: z.enum(['free', 'cc0']).default('free'),
  sort: z.enum(['popular', 'new']).default('popular'),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

export interface ResourceDeps {
  /** JSON fetcher for provider APIs (injected in tests). */
  fetchJson?: FetchJson;
  download?: Partial<SafeFetchOptions>;
}

const ASSET_TYPE: Record<ResourceKind, 'image' | 'audio' | 'model' | 'video' | 'font' | 'other'> = { model: 'model', texture: 'image', image: 'image', audio: 'audio', video: 'video', font: 'font', tool: 'other', other: 'other' };

/** A tiny TTL cache so repeated searches (typing, paging back) don't hammer the free APIs. */
class TtlCache<T> {
  private map = new Map<string, { at: number; value: T }>();
  private ttlMs: number;
  private max: number;
  constructor(ttlMs: number, max = 200) {
    this.ttlMs = ttlMs;
    this.max = max;
  }
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: Date.now(), value });
  }
}

/** Interleaves lists so the first page mixes sources instead of showing one provider's results first. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

export function resourceRoutes(app: FastifyInstance, ctx: AppContext, deps: ResourceDeps = {}): void {
  const fetchJson: FetchJson =
    deps.fetchJson ??
    (async (url) => {
      const res = await fetch(url, { headers: { 'user-agent': 'BaziSazi/1.0 (free asset browser)', accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  const library = new Library(ctx.db);
  const cache = new TtlCache<{ items: ResourceItem[]; providers: { id: string; label: string; ok: boolean; error?: string }[]; hasMore: boolean }>(5 * 60_000);
  const limiter = new RateLimiter(20, 0.5);

  app.get('/api/resources/providers', async () => ({
    providers: [...PROVIDERS.map((p) => ({ id: p.id, label: p.label, kinds: p.kinds })), { id: 'catalog', label: 'Curated sites', kinds: KINDS.filter((k) => k !== 'all') }],
  }));

  app.get('/api/resources/search', async (req, reply) => {
    const parsed = parse(SearchQuery, req.query, reply);
    if (!parsed) return;
    if (!limiter.take(req.ip)) return reply.code(429).send({ error: 'Slow down a little — too many searches.' });
    const query: ResourceQuery = { q: parsed.q, kind: parsed.kind, license: parsed.license, page: parsed.page };
    // The library changes as people download things, so its version is part of the cache key.
    const key = JSON.stringify([query, parsed.provider, library.version]);
    // Browsers and CDNs may reuse an identical search for a minute.
    reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    const cached = cache.get(key);
    if (cached) return cached;

    const libraryOnly = parsed.provider === 'library';
    const wanted = libraryOnly ? [] : PROVIDERS.filter((p) => (!parsed.provider || parsed.provider === p.id) && (query.kind === 'all' || p.kinds.includes(query.kind) || (query.kind === 'image' && p.kinds.includes('texture'))));
    const settled = await Promise.allSettled(wanted.map((p) => p.search(query, fetchJson)));
    const providers: { id: string; label: string; ok: boolean; error?: string }[] = [];
    const lists: ResourceItem[][] = [];
    let hasMore = false;
    settled.forEach((r, i) => {
      const p = wanted[i];
      if (r.status === 'fulfilled') {
        const value: ProviderResult = r.value;
        lists.push(value.items.filter((it) => matchesQuery(it, query)));
        hasMore ||= value.hasMore;
        providers.push({ id: p.id, label: p.label, ok: true });
      } else providers.push({ id: p.id, label: p.label, ok: false, error: 'This source did not answer — try again later.' });
    });
    // Things people already downloaded come first and replace their web duplicates: adding them is instant.
    if (!parsed.provider || libraryOnly) {
      const found = await library.search({ q: query.q, kind: query.kind, license: query.license, limit: libraryOnly ? PAGE_SIZE : 12, offset: libraryOnly ? (query.page - 1) * PAGE_SIZE : 0 });
      const known = await library.knownKeys(lists.flat().map((i) => i.id));
      for (let i = 0; i < lists.length; i++) lists[i] = lists[i].filter((it) => !known.has(it.id));
      lists.unshift(found.rows.map(toResourceItem));
      hasMore ||= libraryOnly && found.total > query.page * PAGE_SIZE;
      providers.unshift({ id: 'library', label: 'Community library', ok: true });
    }
    if (!parsed.provider || parsed.provider === 'catalog') {
      const cat = searchCatalog(query);
      lists.push(cat.items);
      hasMore ||= cat.hasMore;
      providers.push({ id: 'catalog', label: 'Curated sites', ok: true });
    }
    const result = { items: interleave(lists), providers, hasMore };
    // Don't cache when everything failed (e.g. the network was down for a moment).
    if (providers.some((p) => p.ok && p.id !== 'catalog')) cache.set(key, result);
    return result;
  });

  /** Browse everything users have downloaded so far (public: it only lists files that are already public). */
  app.get('/api/library', async (req, reply) => {
    const q = parse(LibraryQuery, req.query, reply);
    if (!q) return;
    const etag = `W/"lib-${library.version}-${Buffer.from(JSON.stringify(q)).toString('base64url').slice(0, 40)}"`;
    reply.header('etag', etag).header('cache-control', 'public, max-age=30, stale-while-revalidate=120');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    const { rows, total } = await library.search({ ...q, limit: PAGE_SIZE, offset: (q.page - 1) * PAGE_SIZE });
    return { items: rows.map(toResourceItem), total, hasMore: total > q.page * PAGE_SIZE };
  });

  /**
   * Gets a resource into the user's hands. Library items are instant; a new web resource is downloaded once,
   * stored, and added to the shared library so nobody has to download it again.
   */
  app.post('/api/resources/import', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(ImportBody, req.body, reply);
    if (!body) return;
    const respond = (row: import('./library.ts').LibraryRow, created: boolean) => ({
      url: row.url,
      size: row.size,
      mime: row.mime,
      name: body.name || row.name,
      type: row.asset_type,
      libraryId: row.id,
      created,
      credit: { title: row.name, author: row.author ?? undefined, license: row.license, sourceUrl: row.source_url },
    });

    if (body.libraryId) {
      const row = await library.byId(body.libraryId);
      if (!row) return reply.code(404).send({ error: 'That item is no longer in the library.' });
      await library.recordUse(row.id);
      return respond(row, false);
    }
    const sourceKey = body.meta?.id ?? null;
    if (sourceKey) {
      const known = await library.bySourceKey(sourceKey);
      if (known) {
        await library.recordUse(known.id);
        return respond(known, false);
      }
    }
    if (!limiter.take(`import:${me.sub}`, 2)) return reply.code(429).send({ error: 'Slow down a little — too many imports.' });
    if (body.meta && !isFreeForGames(body.meta.license)) return reply.code(422).send({ error: 'That licence does not allow use in published games.' });
    let url = body.url!;
    const texture = url.match(/^polyhaven-texture:(.+)$/);
    if (texture) {
      if (!/^[a-z0-9_]{1,80}$/i.test(texture[1])) return reply.code(400).send({ error: 'Unknown resource.' });
      const real = await resolvePolyhavenTexture(texture[1], fetchJson).catch(() => null);
      if (!real) return reply.code(502).send({ error: 'Poly Haven did not answer. Try again.' });
      url = real;
    }
    const file = await safeDownload(url, { maxBytes: ctx.config.limits.assetBytes, ...deps.download });
    const fileName = path.basename(new URL(file.finalUrl).pathname);
    const stored = await storeAsset(ctx, me.sub, file.body, file.contentType, fileName);
    if ('error' in stored) return reply.code(415).send({ error: stored.error });
    const kind: ResourceKind = body.kind === 'all' ? (stored.mime.split('/')[0] as ResourceKind) : body.kind;
    const assetType = ASSET_TYPE[kind] ?? 'other';
    const name = body.name || body.meta?.title || fileName || 'resource';
    if (!body.meta) return { url: stored.url, size: stored.size, mime: stored.mime, name, type: assetType, created: false };
    const { row, created } = await library.add({
      sourceKey: sourceKey!,
      url: stored.url,
      name: body.meta.title,
      kind,
      assetType,
      mime: stored.mime,
      size: stored.size,
      provider: body.meta.provider,
      sourceUrl: body.meta.sourceUrl,
      license: body.meta.license,
      licenseUrl: body.meta.licenseUrl,
      author: body.meta.author,
      addedBy: me.sub,
    });
    if (!created) await library.recordUse(row.id);
    return respond(row, created);
  });
}
