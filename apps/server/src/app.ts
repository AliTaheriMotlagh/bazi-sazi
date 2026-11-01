import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { authHook } from './auth.ts';
import { config as defaultConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { openDb } from './db.ts';
import { multiplayer } from './multiplayer.ts';
import { aiRoutes } from './routes/ai.ts';
import { assetRoutes, FILES_HEADERS } from './routes/assets.ts';
import { authRoutes } from './routes/auth.ts';
import { gameRoutes } from './routes/games.ts';
import { projectRoutes } from './routes/projects.ts';

/** Paths that are never rewritten to the game player on a game subdomain. */
const PASSTHROUGH = /^\/(api|files|assets|ws)\//;

export function subdomainSlug(host: string | undefined, baseDomain: string): string | null {
  if (!host) return null;
  const h = host.toLowerCase();
  const base = baseDomain.toLowerCase();
  if (!h.endsWith(`.${base}`)) return null;
  const sub = h.slice(0, -(base.length + 1));
  return /^[a-z0-9-]{3,40}$/.test(sub) ? sub : null;
}

export async function buildApp(overrides: Partial<AppContext> = {}): Promise<FastifyInstance> {
  const config = overrides.config ?? defaultConfig;
  const db = overrides.db ?? openDb(config.dataDir);
  const ctx: AppContext = { db, config };

  const app = Fastify({
    logger: config.isProd ? { level: 'info' } : { level: 'warn' },
    bodyLimit: config.limits.projectBytes,
    trustProxy: true,
  });
  app.decorateRequest('user', null);
  app.addHook('onRequest', authHook(config.jwtSecret));
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    if (!reply.hasHeader('cross-origin-opener-policy')) reply.header('cross-origin-opener-policy', 'same-origin-allow-popups');
  });
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    void reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
  });

  await app.register(fastifyWebsocket, { options: { maxPayload: config.limits.wsMessageBytes } });

  app.get('/api/health', async () => ({ ok: true }));
  // Used by the HTTPS proxy (Caddy on-demand TLS): only issue certificates for real games.
  app.get<{ Querystring: { domain?: string } }>('/api/tls-check', async (req, reply) => {
    const domain = String(req.query.domain ?? '').toLowerCase();
    const baseHost = config.baseDomain.split(':')[0];
    if (domain === baseHost || domain === `www.${baseHost}`) return { ok: true };
    const slug = subdomainSlug(domain, baseHost);
    const exists = slug && db.prepare('SELECT 1 FROM games WHERE slug = ?').get(slug);
    return exists ? { ok: true } : reply.code(404).send({ ok: false });
  });
  authRoutes(app, ctx);
  projectRoutes(app, ctx);
  gameRoutes(app, ctx);
  assetRoutes(app, ctx);
  aiRoutes(app, ctx);
  multiplayer(app, ctx);

  // Uploaded asset files.
  await app.register(fastifyStatic, {
    root: path.join(config.dataDir, 'files'),
    prefix: '/files/',
    decorateReply: false,
    setHeaders: (res) => {
      for (const [k, v] of Object.entries(FILES_HEADERS)) res.header(k, v);
    },
  });

  // The built studio + player (production). In dev, Vite serves these.
  const dist = config.studioDist;
  if (existsSync(path.join(dist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      wildcard: false,
      index: false,
      setHeaders: (res, file) => {
        if (!file.includes(`${path.sep}assets${path.sep}`)) return;
        res.header('cache-control', 'public, max-age=31536000, immutable');
        // Module scripts are CORS-fetched; the sandboxed game iframe has an opaque ("null") origin.
        res.header('access-control-allow-origin', '*');
      },
    });
    const playerPage = (reply: import('fastify').FastifyReply) =>
      reply
        .header('content-security-policy', "frame-ancestors *")
        .header('cache-control', 'no-cache')
        .sendFile('player.html', dist);

    // Every published game lives at https://<slug>.<BASE_DOMAIN>/
    app.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'GET' || PASSTHROUGH.test(req.url)) return;
      if (subdomainSlug(req.headers.host, config.baseDomain)) return playerPage(reply);
    });
    app.get('/embed/*', async (_req, reply) => playerPage(reply));
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method !== 'GET' || PASSTHROUGH.test(req.url)) return reply.code(404).send({ error: 'Not found' });
      return reply.header('cache-control', 'no-cache').header('content-security-policy', "frame-ancestors 'self'").sendFile('index.html', dist);
    });
  } else {
    app.setNotFoundHandler(async (_req, reply) => reply.code(404).send({ error: 'Not found (studio not built — use `npm run dev` or `npm run build`).' }));
  }

  app.addHook('onClose', async () => db.close());
  return app;
}
