import { normalizeProject, type ProjectData } from '@bazi/engine/core';
import { createZip, type ZipEntry } from './zip';

/**
 * Export a project as a standalone game:
 *  - single HTML file: everything inlined (assets as data URIs), opens by double-click, works offline
 *  - ZIP: index.html + player.js + project.js + assets/ for any static host (itch.io, GitHub Pages…)
 * Multiplayer needs a server, so it is switched off in exports.
 */

const PLAYER_CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#000;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body.player{overflow:hidden;touch-action:none}
#game{position:fixed;inset:0}#game canvas{width:100%;height:100%;display:block}
#veil{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#1f2240,#05060b);transition:opacity .3s;padding:16px}
#veil.hidden{opacity:0;pointer-events:none}
.veil-card{text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:520px}
.veil-card h1{margin:0;font-size:clamp(24px,5vw,40px);font-weight:800}.veil-card p{color:#aab;margin:0}
#start{font:700 18px system-ui;padding:12px 28px;border-radius:12px;border:0;background:#2f7bf5;color:#fff;cursor:pointer}
.spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:#fff;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.player-buttons{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:30;display:flex;gap:6px}
.player-buttons button{width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.45);color:#fff;font-size:16px;cursor:pointer}
.bz-hud,.bz-video{font-family:inherit}
`;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface ExportProgress {
  (message: string, done: number, total: number): void;
}

async function fetchPlayer(): Promise<string> {
  const res = await fetch('/standalone/player.js');
  const type = res.headers.get('content-type') ?? '';
  // Dev servers answer unknown paths with index.html.
  if (!res.ok || type.includes('text/html')) throw new Error('The standalone player has not been built. Run "npm run build:standalone" (or "npm run build") and try again.');
  return res.text();
}

const mimeOf = (blob: Blob, url: string): string => {
  if (blob.type && blob.type !== 'application/octet-stream') return blob.type;
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  return ({ glb: 'model/gltf-binary', gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
};

function toDataUri(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;,]*/, `data:${mime}`));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'game';

interface Bundle {
  project: ProjectData;
  /** Downloaded asset bytes keyed by asset id (null if it could not be fetched). */
  files: Map<string, { blob: Blob; mime: string; ext: string } | null>;
}

async function collect(source: ProjectData, progress: ExportProgress): Promise<Bundle> {
  const project = normalizeProject(structuredClone(source));
  project.settings.multiplayer.enabled = false;
  const files: Bundle['files'] = new Map();
  let done = 0;
  for (const a of project.assets) {
    progress(`Packing ${a.name}`, done++, project.assets.length);
    try {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const mime = mimeOf(blob, a.url);
      const ext = a.url.split('?')[0].split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      files.set(a.id, { blob, mime, ext });
    } catch {
      files.set(a.id, null);
    }
  }
  const missing = project.assets.filter((a) => !files.get(a.id)).map((a) => a.name);
  if (missing.length) console.warn('Export: could not include', missing);
  return { project, files };
}

const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');
const inlineScript = (js: string) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

function page(project: ProjectData, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><title>${escapeHtml(project.name)}</title><style>${PLAYER_CSS}</style></head>
<body class="player"><div id="game"><canvas id="canvas"></canvas></div>
<div id="veil"><div class="veil-card"><div class="spinner" id="spinner"></div><h1 id="title">Loading…</h1><p id="subtitle"></p><button id="start" hidden>▶ Play</button></div></div>
${body}</body></html>`;
}

export async function exportHtml(source: ProjectData, progress: ExportProgress): Promise<{ blob: Blob; name: string; skipped: string[] }> {
  progress('Loading player', 0, 1);
  const player = await fetchPlayer();
  const { project, files } = await collect(source, progress);
  const skipped: string[] = [];
  for (const a of project.assets) {
    const f = files.get(a.id);
    if (f) a.url = await toDataUri(f.blob, f.mime);
    else skipped.push(a.name);
  }
  progress('Writing file', 1, 1);
  const html = page(project, `<script id="bazi-project" type="application/json">${jsonForScript(project)}</script>\n<script>${inlineScript(player)}</script>\n`);
  return { blob: new Blob([html], { type: 'text/html' }), name: `${safeName(project.name)}.html`, skipped };
}

export async function exportZip(source: ProjectData, progress: ExportProgress): Promise<{ blob: Blob; name: string; skipped: string[] }> {
  progress('Loading player', 0, 1);
  const player = await fetchPlayer();
  const { project, files } = await collect(source, progress);
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const a of project.assets) {
    const f = files.get(a.id);
    if (!f) {
      skipped.push(a.name);
      continue;
    }
    let name = `${safeName(a.name)}.${f.ext}`;
    for (let i = 2; used.has(name); i++) name = `${safeName(a.name)}_${i}.${f.ext}`;
    used.add(name);
    a.url = `assets/${name}`;
    entries.push({ path: `assets/${name}`, data: new Uint8Array(await f.blob.arrayBuffer()) });
  }
  const html = page(project, `<script src="project.js"></script>\n<script src="player.js"></script>\n`);
  entries.unshift(
    { path: 'index.html', data: enc.encode(html) },
    { path: 'player.js', data: enc.encode(player) },
    { path: 'project.js', data: enc.encode(`window.__BAZI_PROJECT__=${jsonForScript(project)};`) },
    {
      path: 'README.txt',
      data: enc.encode(`${project.name}\n\nUpload this folder to any static host (itch.io HTML5, GitHub Pages, Netlify...) or run:\n  npx serve .\nand open index.html. Browsers block loading 3D models from file:// URLs,\nso use a local server for local testing (or export the single-file HTML instead).\n`),
    },
  );
  progress('Zipping', 1, 1);
  return { blob: createZip(entries), name: `${safeName(project.name)}.zip`, skipped };
}
