import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

/**
 * Vercel serverless entry. The Fastify app is created once per warm instance
 * and every request is handed to its HTTP server.
 *
 * Startup is lazy and guarded: a configuration problem (missing JWT_SECRET,
 * unreachable database…) answers with a JSON error that names the cause,
 * instead of Vercel's opaque "A server error has occurred".
 */
let app: Promise<FastifyInstance> | null = null;

async function start(): Promise<FastifyInstance> {
  const { buildApp } = await import('./app.ts');
  const instance = await buildApp();
  await instance.ready();
  return instance;
}

function fail(res: ServerResponse, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Startup failed:', err);
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: `Server failed to start: ${message}` }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let instance: FastifyInstance;
  try {
    app ??= start();
    instance = await app;
  } catch (err) {
    app = null; // retry on the next request instead of caching the failure
    return fail(res, err);
  }
  // The router passes the original path as ?__p= so we can restore it whatever URL the platform forwards.
  const url = new URL(req.url ?? '/', 'http://local');
  const original = url.searchParams.get('__p');
  if (original) {
    url.searchParams.delete('__p');
    req.url = original + (url.search && url.search !== '?' ? url.search : '');
  }
  instance.server.emit('request', req, res);
}
