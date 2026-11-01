import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@bazi/engine/core';
import { exportHtml, exportZip } from '../src/export/exportGame';
import { NATIVE_TARGETS, WEB_ROOT, appIdFor, nativeWrapperFiles, packageNameFor, type NativeTarget } from '../src/export/native';
import { crc32, createZip } from '../src/export/zip';

/** Reads the central directory of a stored ZIP and verifies every entry's CRC. */
async function readZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const eocd = buf.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

/** Node has no FileReader; exportGame only needs readAsDataURL. */
class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onload?.();
    });
  }
}

beforeEach(() => vi.stubGlobal('FileReader', FakeFileReader));
afterEach(() => vi.unstubAllGlobals());

describe('zip writer', () => {
  it('matches the known CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips files, including UTF-8 names and empty files', async () => {
    const zip = await readZip(createZip([
      { path: 'a.txt', data: new TextEncoder().encode('hello') },
      { path: 'پوشه/بازی.txt', data: new TextEncoder().encode('سلام') },
      { path: 'empty.bin', data: new Uint8Array() },
    ]));
    expect([...zip.keys()]).toEqual(['a.txt', 'پوشه/بازی.txt', 'empty.bin']);
    expect(text(zip.get('پوشه/بازی.txt'))).toBe('سلام');
    expect(zip.get('empty.bin')).toHaveLength(0);
  });
});

describe('native wrappers', () => {
  const targets = Object.keys(NATIVE_TARGETS) as NativeTarget[];

  it('derives safe package names and reverse-DNS ids', () => {
    expect(packageNameFor('My Cool Game!!')).toBe('my-cool-game');
    expect(packageNameFor('🎮')).toBe('game');
    expect(appIdFor('My Cool Game')).toBe('app.bazisazi.mycoolgame');
    expect(appIdFor('123 Racing')).toMatch(/^app\.bazisazi\.g123racing$/);
    expect(appIdFor('')).toBe('app.bazisazi.game');
  });

  it.each(targets)('%s: emits valid JSON config pointing at the web folder', (target) => {
    const files = nativeWrapperFiles(target, 'Space "Quest"');
    expect(files.length).toBeGreaterThan(1);
    for (const f of files.filter((f) => f.path.endsWith('.json'))) expect(() => JSON.parse(f.content)).not.toThrow();
    expect(files.map((f) => f.content).join('\n')).toContain(WEB_ROOT);
    expect(files.some((f) => f.path === 'README.md')).toBe(true);
  });

  it('electron: serves from a custom protocol and refuses paths outside the game folder', () => {
    const main = nativeWrapperFiles('electron', 'Game').find((f) => f.path === 'main.js')!.content;
    expect(main).toContain('contextIsolation: true');
    expect(main).toContain('nodeIntegration: false');
    expect(main).toContain('startsWith(root + path.sep)');
    expect(() => new Function('require', main.replace(/^.*$/m, ''))).not.toThrow(); // parses as JavaScript
  });

  it('escapes hostile game names inside generated code', () => {
    const main = nativeWrapperFiles('electron', `x"); process.exit(1); ("`).find((f) => f.path === 'main.js')!.content;
    expect(main).toContain('title: "x\\"); process.exit(1); (\\""');
  });

  it('capacitor and tauri use the same app id', () => {
    const cap = JSON.parse(nativeWrapperFiles('capacitor', 'Neon Run').find((f) => f.path === 'capacitor.config.json')!.content);
    const tauri = JSON.parse(nativeWrapperFiles('tauri', 'Neon Run').find((f) => f.path === 'src-tauri/tauri.conf.json')!.content);
    expect(cap.appId).toBe(tauri.identifier);
    expect(cap.webDir).toBe(WEB_ROOT);
    expect(tauri.build.frontendDist).toBe(`../${WEB_ROOT}`);
  });
});

describe('game export', () => {
  const stubFetch = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/standalone/player.js') return new Response('window.__player=1;', { headers: { 'content-type': 'text/javascript' } });
        if (url.endsWith('missing.png')) return new Response('no', { status: 404 });
        return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/png' } });
      }),
    );
  const project = () => {
    const p = createProject('Export Me', '2d');
    p.settings.multiplayer.enabled = true;
    p.assets.push({ id: 'a1', name: 'Hero', type: 'texture', url: '/files/hero.png' }, { id: 'a2', name: 'Gone', type: 'texture', url: '/files/missing.png' });
    return p;
  };

  it('single HTML inlines the player, project and assets, turns multiplayer off and reports skipped assets', async () => {
    stubFetch();
    const src = project();
    const { blob, name, skipped } = await exportHtml(src, () => undefined);
    const html = await blob.text();
    expect(name).toBe('Export_Me.html');
    expect(skipped).toEqual(['Gone']);
    expect(html).toContain('window.__player=1;');
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toMatch(/<\/script>\s*<\/script>/);
    expect(html).toContain('"enabled":false');
    expect(src.settings.multiplayer.enabled).toBe(true); // source project is untouched
  });

  it('ZIP packs assets as files and rewrites their urls', async () => {
    stubFetch();
    const { blob, name } = await exportZip(project(), () => undefined);
    const zip = await readZip(blob);
    expect(name).toBe('Export_Me.zip');
    expect([...zip.keys()].sort()).toEqual(['README.txt', 'assets/Hero.png', 'index.html', 'player.js', 'project.js']);
    expect(text(zip.get('project.js'))).toContain('"url":"assets/Hero.png"');
    expect([...zip.get('assets/Hero.png')!]).toEqual([1, 2, 3, 4]);
  });

  it('a native target nests the web game under www/ beside the wrapper', async () => {
    stubFetch();
    const { blob, name } = await exportZip(project(), () => undefined, 'capacitor');
    const zip = await readZip(blob);
    expect(name).toBe('Export_Me-capacitor.zip');
    expect(zip.has('www/index.html')).toBe(true);
    expect(zip.has('www/assets/Hero.png')).toBe(true);
    expect(zip.has('capacitor.config.json')).toBe(true);
  });

  it('explains how to fix a missing standalone player', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })));
    await expect(exportHtml(project(), () => undefined)).rejects.toThrow(/build:standalone/);
  });
});
