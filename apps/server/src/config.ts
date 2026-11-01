import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const serverless = !!process.env.VERCEL || process.env.SERVERLESS === '1';
// Serverless file systems are read-only except /tmp.
const dataDir = path.resolve(process.env.DATA_DIR ?? (serverless ? '/tmp/bazi-sazi' : path.join(here, '../../../data')));

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s !== 'change-me-to-a-long-random-string') return s;
  if (isProd) throw new Error('JWT_SECRET must be set to a long random string in production (Vercel: Project → Settings → Environment Variables).');
  // Dev only: generate once and keep it, so sessions survive `--watch` restarts.
  const file = path.join(dataDir, '.dev-jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dataDir, { recursive: true });
  const generated = randomBytes(32).toString('hex');
  writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: secret(),
  tokenTtlSeconds: 60 * 60 * 24 * 30,
  /** e.g. "localhost:8787" or "games.example.com" — games live at <slug>.<baseDomain> */
  baseDomain: (process.env.BASE_DOMAIN ?? 'localhost:8787').toLowerCase(),
  dataDir,
  studioDist: path.resolve(process.env.STUDIO_DIST ?? path.join(here, '../../studio/dist')),
  openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
  /** Any OpenAI-compatible endpoint works (OpenRouter by default, or a proxy/self-hosted gateway). */
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:8787',
  /** Running as a serverless function (Vercel): no WebSockets, no local disk. */
  serverless,
  /** libSQL / Turso database URL (libsql://…). Empty = local SQLite file in DATA_DIR. */
  databaseUrl: process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  databaseAuthToken: process.env.TURSO_AUTH_TOKEN ?? '',
  /** Vercel Blob token for uploads. Empty = files on local disk. */
  blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? '',
  /** Optional external multiplayer server (wss://…) when the API itself can't hold WebSockets. */
  realtimeUrl: process.env.REALTIME_URL ?? '',
  /** Games get their own subdomain only when a base domain is configured. */
  subdomains: process.env.GAME_SUBDOMAINS !== '0' && !(process.env.VERCEL && !process.env.BASE_DOMAIN),
  limits: {
    projectBytes: 15 * 1024 * 1024,
    assetBytes: 25 * 1024 * 1024,
    wsMessageBytes: 32 * 1024,
    wsMessagesPerSecond: 60,
    aiRequestsPerMinute: 20,
  },
};

export const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'admin', 'studio', 'play', 'static', 'assets', 'files', 'ws', 'embed', 'mail', 'docs']);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
