import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { config } from '../src/config.ts';
import { openSqlite } from '../src/db.ts';
import { searchCatalog } from '../src/resources/catalog.ts';
import { commons, openverse, polyhaven, sketchfab } from '../src/resources/providers.ts';
import { interleave } from '../src/resources/routes.ts';
import { DownloadError, isPrivateAddress, safeDownload } from '../src/resources/safeFetch.ts';
import { isFreeForGames, licenseGroup, type FetchJson, type ResourceQuery } from '../src/resources/types.ts';

const q = (over: Partial<ResourceQuery> = {}): ResourceQuery => ({ q: '', kind: 'all', license: 'free', page: 1, ...over });

// ───────── fixtures shaped like the real API responses
const POLY_TEXTURES = {
  aerial_grass_rock: { name: 'Aerial Grass Rock', tags: ['grass', 'rock'], categories: ['ground'], authors: { 'Rob Tuytel': 'All' }, thumbnail_url: 'https://cdn.polyhaven.com/t.png' },
  wood_planks: { name: 'Wood Planks', tags: ['wood'], categories: ['floor'], authors: { A: 'All' }, thumbnail_url: 'https://cdn.polyhaven.com/w.png' },
};
const COMMONS = {
  query: {
    pages: {
      '1': { pageid: 1, title: 'File:Explosion_sound.ogg', imageinfo: [{ size: 5000, mime: 'audio/ogg', url: 'https://upload.wikimedia.org/x/Explosion_sound.ogg?utm_source=commons', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Explosion_sound.ogg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Jane &amp; Co</a>' } } }] },
      '2': { pageid: 2, title: 'File:Noncommercial.ogg', imageinfo: [{ size: 5000, mime: 'audio/ogg', url: 'https://upload.wikimedia.org/x/n.ogg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:N', extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } }] },
      '3': { pageid: 3, title: 'File:Huge.ogg', imageinfo: [{ size: 99_000_000, mime: 'audio/ogg', url: 'https://upload.wikimedia.org/x/h.ogg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:H', extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
      '4': { pageid: 4, title: 'File:Doc.pdf', imageinfo: [{ size: 10, mime: 'application/pdf', url: 'https://upload.wikimedia.org/x/d.pdf', descriptionurl: 'x', extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
      '5': { pageid: 5, title: 'File:Brick_wall.jpg', imageinfo: [{ size: 30_000_000, mime: 'image/jpeg', url: 'https://upload.wikimedia.org/x/b.jpg', thumburl: 'https://upload.wikimedia.org/thumb/b/1024px-b.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Brick_wall.jpg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
    },
  },
  continue: { gsroffset: 24 },
};
const SKETCHFAB = {
  results: [
    { uid: 'abc', name: 'Maple tree', viewerUrl: 'https://sketchfab.com/3d-models/abc', license: { label: 'CC Attribution' }, user: { displayName: 'atrodler' }, thumbnails: { images: [{ url: 'https://m/small.jpeg', width: 100 }, { url: 'https://m/mid.jpeg', width: 448 }] } },
    { uid: 'nc', name: 'No commercial', viewerUrl: 'https://sketchfab.com/3d-models/nc', license: { label: 'CC Attribution-NonCommercial' }, user: {}, thumbnails: { images: [] } },
  ],
  cursors: { next: 'x' },
};
const OPENVERSE = { page_count: 3, results: [{ id: 'u1', title: 'Grass', url: 'https://live.staticflickr.com/g.jpg', thumbnail: 'https://t/g.jpg', license: 'by', license_version: '4.0', license_url: 'https://cc/by/4.0', creator: 'Bob', foreign_landing_url: 'https://flickr/g', tags: [{ name: 'grass' }] }] };

const fetchFixture: FetchJson = async (url) => {
  if (url.includes('api.polyhaven.com/assets?t=textures')) return POLY_TEXTURES;
  if (url.includes('api.polyhaven.com/assets?t=models')) return {};
  if (url.includes('api.polyhaven.com/files/aerial_grass_rock')) return { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/d.jpg' } } } };
  if (url.includes('commons.wikimedia.org')) return COMMONS;
  if (url.includes('api.sketchfab.com')) return SKETCHFAB;
  if (url.includes('api.openverse.org')) return OPENVERSE;
  throw new Error(`unexpected ${url}`);
};

describe('licences', () => {
  it('groups common licence names and rejects non-commercial/no-derivs', () => {
    expect(licenseGroup('CC0 1.0')).toBe('cc0');
    expect(licenseGroup('Public domain')).toBe('cc0');
    expect(licenseGroup('CC BY-SA 4.0')).toBe('attribution');
    expect(licenseGroup('Unsplash License')).toBe('other');
    for (const bad of ['CC BY-NC 4.0', 'CC BY-ND', 'Non-commercial', 'All rights reserved', 'Unknown']) expect(isFreeForGames(bad), bad).toBe(false);
    for (const good of ['CC0', 'CC BY 4.0', 'CC BY-SA 3.0', 'Public domain']) expect(isFreeForGames(good), good).toBe(true);
  });
});

describe('providers', () => {
  it('Poly Haven: filters by words, marks textures importable and models link-only', async () => {
    const r = await polyhaven.search(q({ q: 'grass', kind: 'texture' }), fetchFixture);
    expect(r.items.map((i) => i.title)).toEqual(['Aerial Grass Rock']);
    expect(r.items[0]).toMatchObject({ license: 'CC0', licenseGroup: 'cc0', downloadUrl: 'polyhaven-texture:aerial_grass_rock', author: 'Rob Tuytel' });
    expect((await polyhaven.search(q({ kind: 'audio' }), fetchFixture)).items).toEqual([]);
  });

  it('Commons: drops non-commercial, huge and unsupported files; imports big photos as the 1024px thumbnail', async () => {
    const r = await commons.search(q({ q: 'explosion' }), fetchFixture);
    const titles = r.items.map((i) => i.title);
    expect(titles).toContain('Explosion sound');
    expect(titles).toContain('Brick wall');
    expect(titles).not.toContain('Noncommercial');
    expect(titles).not.toContain('Huge');
    expect(titles).not.toContain('Doc');
    const sound = r.items.find((i) => i.title === 'Explosion sound')!;
    expect(sound).toMatchObject({ kind: 'audio', author: 'Jane & Co', licenseGroup: 'attribution' });
    expect(sound.downloadUrl).toBe('https://upload.wikimedia.org/x/Explosion_sound.ogg');
    expect(r.items.find((i) => i.title === 'Brick wall')!.downloadUrl).toContain('1024px');
    expect(r.hasMore).toBe(true);
  });

  it('Commons cc0 filter keeps only public-domain items', async () => {
    const r = await commons.search(q({ license: 'cc0', kind: 'image' }), fetchFixture);
    expect(r.items.every((i) => i.licenseGroup === 'cc0')).toBe(true);
  });

  it('Sketchfab: picks a mid-size thumbnail, hides NC models, never offers a download', async () => {
    const r = await sketchfab.search(q({ q: 'tree', kind: 'model' }), fetchFixture);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ title: 'Maple tree', thumb: 'https://m/mid.jpeg' });
    expect(r.items[0]).not.toHaveProperty('downloadUrl');
    expect(r.hasMore).toBe(true);
    expect((await sketchfab.search(q({ kind: 'audio' }), fetchFixture)).items).toEqual([]);
  });

  it('Openverse: formats licences and previews audio', async () => {
    const r = await openverse.search(q({ q: 'grass', kind: 'image' }), fetchFixture);
    expect(r.items[0]).toMatchObject({ license: 'CC BY 4.0', licenseGroup: 'attribution', tags: ['grass'] });
    expect(r.hasMore).toBe(true);
  });

  it('catalog search matches words, kind and licence', () => {
    expect(searchCatalog(q({ q: 'kenney' })).items[0].title).toMatch(/Kenney/);
    expect(searchCatalog(q({ kind: 'font' })).items.every((i) => i.kind === 'font' || i.kind === 'other')).toBe(true);
    expect(searchCatalog(q({ license: 'cc0' })).items.every((i) => i.licenseGroup === 'cc0')).toBe(true);
    expect(searchCatalog(q({ q: 'zzzzzz' })).items).toEqual([]);
  });

  it('interleave mixes sources fairly', () => {
    expect(interleave<number | string>([[1, 2, 3], ['a'], ['x', 'y']])).toEqual([1, 'a', 'x', 2, 'y', 3]);
  });
});

describe('SSRF guard', () => {
  it('classifies private and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  /** A fake https.request: replies per URL from a table. */
  const fakeRequest = (table: Record<string, { status?: number; headers?: Record<string, string>; body?: Buffer }>, seen: { lookup?: string }[] = []) =>
    ((url: URL, opts: { lookup?: (...a: unknown[]) => void }, cb: (res: Readable & { statusCode: number; headers: Record<string, string> }) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void; destroy(e?: Error): void };
      req.destroy = (e) => void (e && req.emit('error', e));
      req.end = () => {
        opts.lookup?.('h', {}, (_e: unknown, addr: string) => seen.push({ lookup: addr }));
        const hit = table[url.toString()];
        if (!hit) return void req.emit('error', new Error('no route'));
        const res = Readable.from(hit.body ? [hit.body] : []) as Readable & { statusCode: number; headers: Record<string, string> };
        res.statusCode = hit.status ?? 200;
        res.headers = hit.headers ?? {};
        cb(res);
      };
      return req;
    }) as never;
  const publicDns = async () => ['93.184.216.34'];

  it('downloads, pins the validated address and reports the content type', async () => {
    const seen: { lookup?: string }[] = [];
    const out = await safeDownload('https://cdn.example.com/a.png', { maxBytes: 100, resolve: publicDns, request: fakeRequest({ 'https://cdn.example.com/a.png': { body: Buffer.from('png'), headers: { 'content-type': 'image/png; charset=x' } } }, seen) });
    expect(out.body.toString()).toBe('png');
    expect(out.contentType).toBe('image/png');
    expect(seen[0].lookup).toBe('93.184.216.34');
  });

  it.each([
    ['http://example.com/a.png', /https/],
    ['https://user:pw@example.com/a.png', /https/],
    ['https://example.com:8443/a.png', /https/],
    ['https://127.0.0.1/a.png', /not allowed/],
    ['https://[::1]/a.png', /not allowed/],
    ['not a url', /valid link/],
  ])('rejects %s', async (url, message) => {
    await expect(safeDownload(url, { maxBytes: 100, resolve: publicDns, request: fakeRequest({}) })).rejects.toThrow(message);
  });

  it('rejects hostnames that resolve to private addresses (even if only one answer is private)', async () => {
    await expect(safeDownload('https://evil.example/a.png', { maxBytes: 10, resolve: async () => ['93.184.216.34', '10.0.0.5'], request: fakeRequest({}) })).rejects.toBeInstanceOf(DownloadError);
  });

  it('re-validates every redirect hop and stops redirect loops', async () => {
    const table = {
      'https://a.example/x': { status: 302, headers: { location: 'https://b.example/y' } },
      'https://b.example/y': { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } },
    };
    await expect(safeDownload('https://a.example/x', { maxBytes: 10, resolve: publicDns, request: fakeRequest(table) })).rejects.toThrow(/not allowed/);
    const loop = { 'https://a.example/x': { status: 302, headers: { location: 'https://a.example/x' } } };
    await expect(safeDownload('https://a.example/x', { maxBytes: 10, resolve: publicDns, request: fakeRequest(loop), maxRedirects: 2 })).rejects.toThrow(/redirects/);
  });

  it('enforces the size cap from the header and while streaming; surfaces HTTP errors', async () => {
    const big = Buffer.alloc(50);
    await expect(safeDownload('https://a.example/x', { maxBytes: 10, resolve: publicDns, request: fakeRequest({ 'https://a.example/x': { body: big, headers: { 'content-length': '50' } } }) })).rejects.toThrow(/too large/);
    await expect(safeDownload('https://a.example/x', { maxBytes: 10, resolve: publicDns, request: fakeRequest({ 'https://a.example/x': { body: big } }) })).rejects.toThrow(/too large/);
    await expect(safeDownload('https://a.example/x', { maxBytes: 10, resolve: publicDns, request: fakeRequest({ 'https://a.example/x': { status: 404 } }) })).rejects.toThrow(/HTTP 404/);
  });
});

describe('resource routes', () => {
  let app: FastifyInstance;
  let token = '';
  let calls = 0;

  beforeAll(async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'bazi-res-'));
    const request = ((url: URL, _o: unknown, cb: (res: Readable & { statusCode: number; headers: Record<string, string> }) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
      req.destroy = () => undefined;
      req.end = () => {
        const png = Buffer.from('89504e470d0a1a0a', 'hex');
        const known: Record<string, [Buffer, string]> = { 'https://upload.wikimedia.org/x/a.png': [png, 'image/png'], 'https://dl.polyhaven.org/file/ph-assets/d.jpg': [Buffer.from('jpg'), 'image/jpeg'], 'https://upload.wikimedia.org/x/doc.pdf': [png, 'application/pdf'] };
        const hit = known[url.toString()];
        if (!hit) return void req.emit('error', new Error('x'));
        const res = Readable.from([hit[0]]) as Readable & { statusCode: number; headers: Record<string, string> };
        res.statusCode = 200;
        res.headers = { 'content-type': hit[1] };
        cb(res);
      };
      return req;
    }) as never;
    app = await buildApp(
      { config: { ...config, dataDir, studioDist: path.join(dataDir, 'none') }, db: await openSqlite(dataDir, ':memory:') },
      { fetchJson: async (u) => (calls++, fetchFixture(u)), download: { request, resolve: async () => ['93.184.216.34'] } },
    );
    await app.ready();
    token = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'res-user', password: 'supersecret' } })).json().token;
  });
  afterAll(() => app.close());

  it('lists providers', async () => {
    const r = (await app.inject({ method: 'GET', url: '/api/resources/providers' })).json();
    expect(r.providers.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['polyhaven', 'commons', 'sketchfab', 'catalog']));
  });

  it('searches all sources at once, validates input and caches repeats', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/resources/search?kind=banana' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/resources/search?page=0' })).statusCode).toBe(400);
    const res = (await app.inject({ method: 'GET', url: '/api/resources/search?q=grass&kind=all' })).json();
    expect(res.providers.every((p: { ok: boolean }) => p.ok)).toBe(true);
    const providers = new Set(res.items.map((i: { provider: string }) => i.provider));
    expect(providers.has('polyhaven')).toBe(true);
    const before = calls;
    await app.inject({ method: 'GET', url: '/api/resources/search?q=grass&kind=all' });
    expect(calls).toBe(before); // served from cache
  });

  it('one failing source does not break the others', async () => {
    const res = (await app.inject({ method: 'GET', url: '/api/resources/search?q=explosion&kind=audio&license=cc0' })).json();
    expect(res.providers.find((p: { id: string }) => p.id === 'commons').ok).toBe(true);
    const failing = (await app.inject({ method: 'GET', url: '/api/resources/search?q=tree&kind=model&provider=sketchfab' })).json();
    expect(failing.items.every((i: { provider: string }) => i.provider === 'sketchfab')).toBe(true);
  });

  it('imports a file into asset storage; requires sign-in; refuses wrong types and bad hosts', async () => {
    const auth = { authorization: `Bearer ${token}` };
    const body = { url: 'https://upload.wikimedia.org/x/a.png', name: 'Brick', kind: 'texture' };
    expect((await app.inject({ method: 'POST', url: '/api/resources/import', payload: body })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: body });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'Brick', type: 'image', mime: 'image/png' });
    expect(ok.json().url).toMatch(/^\/files\/[0-9a-f]{40}\.png$/);

    const tex = await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: { url: 'polyhaven-texture:aerial_grass_rock', kind: 'texture' } });
    expect(tex.statusCode).toBe(200);
    expect(tex.json().mime).toBe('image/jpeg');

    expect((await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: { url: 'https://upload.wikimedia.org/x/doc.pdf' } })).statusCode).toBe(415);
    expect((await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: { url: 'polyhaven-texture:../../etc' } })).statusCode).toBe(400);
  });

  describe('shared library', () => {
    let second = '';
    const meta = { provider: 'commons', id: 'commons:1', title: 'Brick wall', author: 'Ann', license: 'CC BY 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Brick' };
    const importBody = { url: 'https://upload.wikimedia.org/x/a.png', kind: 'texture', meta };

    it('the first import downloads and saves to the library; the next user gets it instantly without a download', async () => {
      const first = await app.inject({ method: 'POST', url: '/api/resources/import', headers: { authorization: `Bearer ${token}` }, payload: importBody });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ created: true, credit: { license: 'CC BY 4.0', author: 'Ann' } });
      const libraryId = first.json().libraryId as string;
      expect(libraryId).toMatch(/^lib_/);

      second = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'second-user', password: 'supersecret' } })).json().token;
      // Same source, different user, and a URL that would fail if it were fetched again: it is served from the library.
      const again = await app.inject({ method: 'POST', url: '/api/resources/import', headers: { authorization: `Bearer ${second}` }, payload: { ...importBody, url: 'https://upload.wikimedia.org/x/gone.png' } });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ created: false, libraryId, url: first.json().url });
    });

    it('is listed publicly, searchable, cacheable (ETag) and counts uses', async () => {
      const list = await app.inject({ method: 'GET', url: '/api/library?q=brick' });
      expect(list.statusCode).toBe(200);
      const item = list.json().items[0];
      expect(item).toMatchObject({ provider: 'library', title: 'Brick wall', inLibrary: true, license: 'CC BY 4.0' });
      expect(item.uses).toBeGreaterThanOrEqual(2);
      const etag = list.headers.etag as string;
      expect((await app.inject({ method: 'GET', url: '/api/library?q=brick', headers: { 'if-none-match': etag } })).statusCode).toBe(304);
      expect((await app.inject({ method: 'GET', url: '/api/library?q=nothing-like-this' })).json().items).toEqual([]);
      expect((await app.inject({ method: 'GET', url: '/api/library?kind=audio' })).json().items).toEqual([]);
      expect((await app.inject({ method: 'GET', url: '/api/library?license=cc0' })).json().items).toEqual([]);

      const viaId = await app.inject({ method: 'POST', url: '/api/resources/import', headers: { authorization: `Bearer ${second}` }, payload: { libraryId: item.libraryId } });
      expect(viaId.json().created).toBe(false);
      const after = (await app.inject({ method: 'GET', url: '/api/library?q=brick' })).json().items[0];
      expect(after.uses).toBe(item.uses + 1);
      expect((await app.inject({ method: 'POST', url: '/api/resources/import', headers: { authorization: `Bearer ${second}` }, payload: { libraryId: 'lib_missing' } })).statusCode).toBe(404);
    });

    it('library items lead the search results and replace their web duplicates', async () => {
      const res = (await app.inject({ method: 'GET', url: '/api/resources/search?q=explosion&kind=all' })).json();
      expect(res.providers[0].id).toBe('library');
      const withLib = (await app.inject({ method: 'GET', url: '/api/resources/search?q=brick&kind=texture' })).json();
      expect(withLib.items[0]).toMatchObject({ provider: 'library', title: 'Brick wall' });
      const only = (await app.inject({ method: 'GET', url: '/api/resources/search?provider=library&q=brick' })).json();
      expect(only.items.every((i: { provider: string }) => i.provider === 'library')).toBe(true);
    });

    it('refuses to store resources whose licence forbids game use, and rejects forged metadata', async () => {
      const auth = { authorization: `Bearer ${token}` };
      expect((await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: { url: 'https://upload.wikimedia.org/x/a.png', meta: { ...meta, id: 'commons:2', license: 'CC BY-NC 4.0' } } })).statusCode).toBe(422);
      expect((await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: { url: 'https://upload.wikimedia.org/x/a.png', meta: { ...meta, id: 'commons:3', sourceUrl: 'javascript:alert(1)' } } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: { url: 'https://upload.wikimedia.org/x/a.png', meta: { ...meta, provider: 'Evil Provider' } } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/resources/import', headers: auth, payload: {} })).statusCode).toBe(400);
    });
  });
});
