import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';

/**
 * Vercel serverless entry. The Fastify app is created once per warm instance
 * and every request is handed to its HTTP server.
 */
let app: Promise<FastifyInstance> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  app ??= buildApp().then(async (instance) => {
    await instance.ready();
    return instance;
  });
  // The router passes the original path as ?__p= so we can restore it whatever URL the platform forwards.
  const url = new URL(req.url ?? '/', 'http://local');
  const original = url.searchParams.get('__p');
  if (original) {
    url.searchParams.delete('__p');
    req.url = original + (url.search && url.search !== '?' ? url.search : '');
  }
  (await app).server.emit('request', req, res);
}
