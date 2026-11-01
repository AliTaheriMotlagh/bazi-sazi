#!/usr/bin/env node
/**
 * Bundles the self-contained game player (engine + three.js + physics, one
 * classic script) so the studio can export games as a single HTML file or ZIP
 * that run offline, with no server. Output: apps/studio/public/standalone/player.js
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'apps/studio/public/standalone');
mkdirSync(outdir, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'apps/studio/src/standalone.ts')],
  outfile: path.join(outdir, 'player.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' },
  logLevel: 'info',
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`standalone player: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
