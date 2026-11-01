import { createHash } from 'node:crypto';
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
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'model/gltf-binary': '.glb',
  'model/gltf+json': '.gltf',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
};

export const BY_EXT: Record<string, string> = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' };

export function assetRoutes(app: FastifyInstance, { db, config, files }: AppContext): void {
  app.addContentTypeParser(/^(image|audio|video|model|font)\/.+$|^application\/octet-stream$/, { parseAs: 'buffer', bodyLimit: config.limits.assetBytes }, (_req, body, done) => done(null, body));

  /** Content-addressed upload: identical files are stored once. */
  app.post<{ Querystring: { name?: string } }>('/api/assets', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'Empty upload.' });
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const stored = await storeAsset({ db, config, files }, me.sub, body, mime, String(req.query.name ?? ''));
    if ('error' in stored) return reply.code(415).send({ error: stored.error });
    return stored;
  });
}

/** Validates the type, stores the bytes content-addressed and records ownership. Shared by uploads and resource imports. */
export async function storeAsset({ db, files }: AppContext, ownerId: string, body: Buffer, declaredMime: string, name: string): Promise<{ url: string; size: number; mime: string } | { error: string }> {
  let mime = declaredMime;
  if (mime === 'application/octet-stream' || !mime) mime = BY_EXT[path.extname(name).toLowerCase()] ?? mime;
  const ext = TYPES[mime];
  if (!ext) return { error: `Unsupported file type (${mime}). Use PNG/JPG/WebP/GIF/SVG, MP3/OGG/WAV, MP4/WebM or GLB/glTF.` };
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 40);
  const url = await files.put(`${hash}${ext}`, body, mime);
  await db.prepare('INSERT OR IGNORE INTO assets (hash, owner_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)').run(hash, ownerId, mime, body.length, Date.now());
  return { url, size: body.length, mime };
}

export const FILES_HEADERS = {
  'cache-control': 'public, max-age=31536000, immutable',
  // Uploaded files can never run scripts in our origin, even SVG/HTML-ish content.
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'cross-origin',
  'access-control-allow-origin': '*',
};
