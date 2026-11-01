#!/usr/bin/env node
/**
 * Builds a Vercel deployment using the Build Output API (v3):
 *   .vercel/output/static/        studio + player + starter content (CDN)
 *   .vercel/output/functions/api.func/  the API as one bundled Node function
 *   .vercel/output/config.json    routing (API, SPA fallback, game subdomains)
 *
 * Env used at build time: BASE_DOMAIN (optional, enables <slug>.BASE_DOMAIN game URLs).
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel/output');
const fn = path.join(out, 'functions/api.func');

console.log('▸ building studio');
if (!process.argv.includes('--skip-studio')) execSync('npm run build', { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
cpSync(path.join(root, 'apps/studio/dist'), path.join(out, 'static'), { recursive: true });

console.log('▸ bundling API function');
await build({
  entryPoints: [path.join(root, 'apps/server/src/vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // CJS dependencies call require() for Node built-ins; give ESM a require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['bufferutil', 'utf-8-validate', 'libsql', '@libsql/darwin-*', '@libsql/linux-*', '@libsql/win32-*'],
  plugins: [
    {
      // Only the HTTP libSQL client ships to serverless; the native one is local-only.
      name: 'libsql-web-only',
      setup(b) {
        b.onResolve({ filter: /^@libsql\/client$/ }, () => ({ path: '@libsql/client', external: true }));
      },
    },
  ],
  logLevel: 'warning',
});
writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

const baseDomain = (process.env.BASE_DOMAIN ?? '').replace(/:\d+$/, '');
const escaped = baseDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAGE = '^/(?!api/|assets/|samples/|templates/|icons/|favicon\\.svg$|manifest\\.webmanifest$|sw\\.js$).*$';
const routes = [
  { src: '^/(assets|samples|templates)/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' }, continue: true },
  { src: '^/sw\\.js$', headers: { 'cache-control': 'no-cache' }, continue: true },
  { src: '^/api/(.*)$', dest: '/api?__p=/api/$1' },
  // Every published game on its own subdomain (needs a wildcard domain on the project).
  ...(baseDomain ? [{ src: PAGE, has: [{ type: 'host', value: `^(?!www\\.)[a-z0-9-]{3,40}\\.${escaped}$` }], dest: '/player.html' }] : []),
  { handle: 'filesystem' },
  { src: '^/embed/.*$', dest: '/player.html' },
  { src: '^/(?!api/).*$', dest: '/index.html' },
];
writeFileSync(path.join(out, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2));
console.log(`✓ .vercel/output ready${baseDomain ? ` (game subdomains on *.${baseDomain})` : ' (games at /embed/<slug>; set BASE_DOMAIN for subdomains)'}`);
