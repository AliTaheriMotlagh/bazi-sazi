import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import type { AppContext } from '../context.ts';

/** Whitelisted upload types → file extension. Anything else is rejected. */
const TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.weba',
  'model/gltf-binary': '.glb',
  'model/gltf+json': '.gltf',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
};

const BY_EXT: Record<string, string> = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

export function assetRoutes(app: FastifyInstance, { db, config }: AppContext): void {
  const dir = path.join(config.dataDir, 'files');
  mkdirSync(dir, { recursive: true });

  app.addContentTypeParser(/^(image|audio|model|font)\/.+$|^application\/octet-stream$/, { parseAs: 'buffer', bodyLimit: config.limits.assetBytes }, (_req, body, done) => done(null, body));

  /** Content-addressed upload: identical files are stored once. */
  app.post<{ Querystring: { name?: string } }>('/api/assets', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'Empty upload.' });
    let mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (mime === 'application/octet-stream') mime = BY_EXT[path.extname(String(req.query.name ?? '')).toLowerCase()] ?? mime;
    const ext = TYPES[mime];
    if (!ext) return reply.code(415).send({ error: `Unsupported file type (${mime}). Use PNG/JPG/WebP/GIF/SVG, MP3/OGG/WAV or GLB/glTF.` });
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 40);
    const file = `${hash}${ext}`;
    const full = path.join(dir, file);
    if (!existsSync(full)) writeFileSync(full, body);
    db.prepare('INSERT OR IGNORE INTO assets (hash, owner_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)').run(hash, me.sub, mime, body.length, Date.now());
    return { url: `/files/${file}`, size: body.length, mime };
  });
}

export const FILES_HEADERS = {
  'cache-control': 'public, max-age=31536000, immutable',
  // Uploaded files can never run scripts in our origin, even SVG/HTML-ish content.
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'cross-origin',
  'access-control-allow-origin': '*',
};
