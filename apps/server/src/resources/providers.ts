import { isFreeForGames, licenseGroup, PAGE_SIZE, type Provider, type ResourceItem, type ResourceKind, type ResourceQuery } from './types.ts';

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

// ───────────────────────── Poly Haven (CC0 textures, models, HDRIs)
const POLY_TYPE: Record<string, string> = { texture: 'textures', model: 'models' };

export const polyhaven: Provider = {
  id: 'polyhaven',
  label: 'Poly Haven',
  kinds: ['texture', 'model'],
  async search(query, fetchJson) {
    const kinds = query.kind === 'all' ? (['texture', 'model'] as const) : query.kind === 'texture' || query.kind === 'model' ? ([query.kind] as const) : [];
    const items: ResourceItem[] = [];
    for (const kind of kinds) {
      const data = asRecord(await fetchJson(`https://api.polyhaven.com/assets?t=${POLY_TYPE[kind]}`));
      const words = query.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (const [slug, raw] of Object.entries(data)) {
        const a = asRecord(raw);
        const haystack = [text(a.name), ...asArray(a.tags).map(text), ...asArray(a.categories).map(text)].join(' ').toLowerCase();
        if (!words.every((w) => haystack.includes(w))) continue;
        items.push({
          id: `polyhaven:${slug}`,
          provider: 'polyhaven',
          title: text(a.name) || slug,
          kind,
          thumb: text(a.thumbnail_url) || null,
          license: 'CC0',
          licenseGroup: 'cc0',
          licenseUrl: 'https://polyhaven.com/license',
          author: Object.keys(asRecord(a.authors)).join(', ') || undefined,
          sourceUrl: `https://polyhaven.com/a/${slug}`,
          // Textures import as the 1k diffuse JPG; models are multi-file glTF bundles, so they stay link-only.
          downloadUrl: kind === 'texture' ? `polyhaven-texture:${slug}` : undefined,
          tags: asArray(a.tags).map(text).slice(0, 8),
          size: undefined,
        });
      }
    }
    items.sort((a, b) => a.title.localeCompare(b.title));
    const start = (query.page - 1) * PAGE_SIZE;
    return { items: items.slice(start, start + PAGE_SIZE), hasMore: items.length > start + PAGE_SIZE };
  },
};

/** Resolves the placeholder `polyhaven-texture:<slug>` produced above to a real file URL. */
export async function resolvePolyhavenTexture(slug: string, fetchJson: (url: string) => Promise<unknown>): Promise<string | null> {
  if (!/^[a-z0-9_]{1,80}$/i.test(slug)) return null;
  const files = asRecord(await fetchJson(`https://api.polyhaven.com/files/${slug}`));
  const url = text(asRecord(asRecord(asRecord(files.Diffuse)['1k']).jpg).url);
  return url.startsWith('https://dl.polyhaven.org/') ? url : null;
}

// ───────────────────────── Sketchfab (downloadable CC models; download needs the author's account → link-only)
export const sketchfab: Provider = {
  id: 'sketchfab',
  label: 'Sketchfab',
  kinds: ['model'],
  async search(query, fetchJson) {
    if (query.kind !== 'all' && query.kind !== 'model') return { items: [], hasMore: false };
    const cursor = (query.page - 1) * PAGE_SIZE;
    const lic = query.license === 'cc0' ? '&license=7c23a1ba438d4306920229c12afcb5f9' : '';
    const data = asRecord(await fetchJson(`https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=${PAGE_SIZE}&cursor=${cursor}&q=${encodeURIComponent(query.q)}${lic}`));
    const items: ResourceItem[] = [];
    for (const raw of asArray(data.results)) {
      const m = asRecord(raw);
      const license = text(asRecord(m.license).label) || 'Unknown';
      if (!isFreeForGames(license)) continue;
      const thumbs = asArray(asRecord(m.thumbnails).images).map(asRecord).sort((a, b) => Number(a.width) - Number(b.width));
      const thumb = text((thumbs.find((t) => Number(t.width) >= 200) ?? thumbs[0])?.url);
      items.push({
        id: `sketchfab:${text(m.uid)}`,
        provider: 'sketchfab',
        title: text(m.name),
        kind: 'model',
        thumb: thumb || null,
        license,
        licenseGroup: licenseGroup(license),
        author: text(asRecord(m.user).displayName) || undefined,
        sourceUrl: text(m.viewerUrl),
      });
    }
    return { items, hasMore: !!asRecord(data.cursors).next };
  },
};

// ───────────────────────── Wikimedia Commons (images, audio, video — direct files)
const COMMONS_FILETYPE: Record<string, string> = { image: 'bitmap', texture: 'bitmap', audio: 'audio', video: 'video' };
const MAX_IMPORT = 24 * 1024 * 1024;

export const commons: Provider = {
  id: 'commons',
  label: 'Wikimedia Commons',
  kinds: ['image', 'texture', 'audio', 'video'],
  async search(query, fetchJson) {
    const kinds: ResourceKind[] = query.kind === 'all' ? ['image', 'audio', 'video'] : [query.kind];
    const items: ResourceItem[] = [];
    let hasMore = false;
    for (const kind of kinds) {
      const filetype = COMMONS_FILETYPE[kind];
      if (!filetype) continue;
      const offset = (query.page - 1) * PAGE_SIZE;
      const search = encodeURIComponent(`filetype:${filetype} ${query.q}${kind === 'texture' ? ' texture seamless' : ''}`);
      const data = asRecord(await fetchJson(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=${PAGE_SIZE}&gsroffset=${offset}&gsrsearch=${search}&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1024`,
      ));
      hasMore ||= !!data.continue;
      for (const raw of Object.values(asRecord(asRecord(data.query).pages))) {
        const page = asRecord(raw);
        const info = asRecord(asArray(page.imageinfo)[0]);
        const meta = asRecord(info.extmetadata);
        const license = text(asRecord(meta.LicenseShortName).value) || 'Unknown';
        if (!isFreeForGames(license) || (query.license === 'cc0' && licenseGroup(license) !== 'cc0')) continue;
        const mime = text(info.mime);
        if (!/^(image\/(png|jpeg|webp|gif)|audio\/(ogg|mpeg|wav|webm)|video\/(webm|mp4))/.test(mime)) continue;
        const isImage = mime.startsWith('image/');
        const size = Number(info.size) || 0;
        // Big photos are imported as the 1024px rendition (fast, and plenty for a game texture).
        const downloadUrl = isImage ? text(info.thumburl) || text(info.url) : text(info.url);
        if (!isImage && size > MAX_IMPORT) continue;
        const title = text(page.title).replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
        items.push({
          id: `commons:${text(page.pageid) || title}`,
          provider: 'commons',
          title,
          kind: isImage ? (kind === 'texture' ? 'texture' : 'image') : mime.startsWith('audio/') ? 'audio' : 'video',
          thumb: isImage ? text(info.thumburl) || null : null,
          preview: isImage ? undefined : text(info.url),
          license,
          licenseGroup: licenseGroup(license),
          licenseUrl: text(asRecord(meta.LicenseUrl).value) || undefined,
          author: stripHtml(text(asRecord(meta.Artist).value)).slice(0, 80) || undefined,
          sourceUrl: text(info.descriptionurl),
          downloadUrl: downloadUrl.replace(/\?utm_.*$/, ''),
          size,
        });
      }
    }
    return { items, hasMore };
  },
};

// ───────────────────────── Openverse (CC images & audio; some networks block it, so failures are non-fatal)
export const openverse: Provider = {
  id: 'openverse',
  label: 'Openverse',
  kinds: ['image', 'texture', 'audio'],
  async search(query, fetchJson) {
    const kinds: ('images' | 'audio')[] = query.kind === 'audio' ? ['audio'] : query.kind === 'image' || query.kind === 'texture' ? ['images'] : query.kind === 'all' ? ['images', 'audio'] : [];
    const items: ResourceItem[] = [];
    let hasMore = false;
    for (const type of kinds) {
      const licenseType = query.license === 'cc0' ? 'license=cc0,pdm' : 'license_type=commercial,modification';
      const data = asRecord(await fetchJson(`https://api.openverse.org/v1/${type}/?q=${encodeURIComponent(query.q)}&${licenseType}&page=${query.page}&page_size=${PAGE_SIZE / kinds.length}`));
      hasMore ||= Number(data.page_count) > query.page;
      for (const raw of asArray(data.results)) {
        const r = asRecord(raw);
        const code = text(r.license).toLowerCase();
        const license = !code ? 'Unknown' : code === 'cc0' ? 'CC0' : code === 'pdm' ? 'Public Domain Mark' : `CC ${code.toUpperCase()}${text(r.license_version) ? ` ${text(r.license_version)}` : ''}`;
        const isAudio = type === 'audio';
        items.push({
          id: `openverse:${text(r.id)}`,
          provider: 'openverse',
          title: text(r.title) || 'Untitled',
          kind: isAudio ? 'audio' : query.kind === 'texture' ? 'texture' : 'image',
          thumb: text(r.thumbnail) || null,
          preview: isAudio ? text(r.url) : undefined,
          license,
          licenseGroup: licenseGroup(license),
          licenseUrl: text(r.license_url) || undefined,
          author: text(r.creator) || undefined,
          sourceUrl: text(r.foreign_landing_url) || text(r.url),
          downloadUrl: text(r.url) || undefined,
          tags: asArray(r.tags).map((t) => text(asRecord(t).name)).filter(Boolean).slice(0, 8),
        });
      }
    }
    return { items, hasMore };
  },
};

export const PROVIDERS: Provider[] = [polyhaven, commons, sketchfab, openverse];

export function matchesQuery(item: ResourceItem, query: ResourceQuery): boolean {
  return query.kind === 'all' || item.kind === query.kind || (query.kind === 'image' && item.kind === 'texture');
}
