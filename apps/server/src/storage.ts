import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Where uploaded files live: the local disk (self-hosted) or Vercel Blob (serverless). */
export interface FileStore {
  /** Store `data` under a content-addressed key and return its public URL. */
  put(key: string, data: Buffer, mime: string): Promise<string>;
}

export function diskStore(dir: string): FileStore {
  mkdirSync(dir, { recursive: true });
  return {
    async put(key, data) {
      const full = path.join(dir, key);
      if (!existsSync(full)) writeFileSync(full, data);
      return `/files/${key}`;
    },
  };
}

export function blobStore(token: string): FileStore {
  return {
    async put(key, data, mime) {
      const { put } = await import('@vercel/blob');
      // Content-addressed keys never change, so overwriting is safe and caching can be forever.
      const blob = await put(`files/${key}`, data, { access: 'public', contentType: mime, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000, token });
      return blob.url;
    },
  };
}

/** Serverless without Blob storage: uploads are impossible (no persistent disk). */
export function unavailableStore(): FileStore {
  return {
    async put() {
      throw Object.assign(new Error('Uploads need Vercel Blob storage: add a Blob store to the project (sets BLOB_READ_WRITE_TOKEN). Starter Content still works.'), { statusCode: 501, expose: true });
    },
  };
}
