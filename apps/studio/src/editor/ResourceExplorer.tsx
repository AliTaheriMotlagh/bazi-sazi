import type { AssetCredit } from '@bazi/engine/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ResourceItem, type ResourceKind, type ResourceSearch } from '../api/client';
import { modelThumbnail } from './thumbnails';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/primitives';

export const KIND_FILTERS: { id: ResourceKind | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: 'Everything', icon: 'Library' },
  { id: 'model', label: '3D models', icon: 'Box' },
  { id: 'texture', label: 'Textures', icon: 'Grid2x2' },
  { id: 'image', label: 'Images & sprites', icon: 'Image' },
  { id: 'audio', label: 'Sounds & music', icon: 'Music' },
  { id: 'video', label: 'Video', icon: 'Film' },
  { id: 'font', label: 'Fonts', icon: 'Type' },
  { id: 'tool', label: 'Tools', icon: 'Wrench' },
];

const KIND_ICON: Record<ResourceKind, string> = { model: 'Box', texture: 'Grid2x2', image: 'Image', audio: 'Music', video: 'Film', font: 'Type', tool: 'Wrench', other: 'Package' };
const PROVIDER_LABEL: Record<string, string> = { library: 'Community library', polyhaven: 'Poly Haven', commons: 'Wikimedia Commons', sketchfab: 'Sketchfab', openverse: 'Openverse', catalog: 'Curated site' };

export interface ImportedResource {
  item: ResourceItem;
  url: string;
  name: string;
  type: 'image' | 'audio' | 'model' | 'video' | 'font' | 'other';
  size: number;
  credit: AssetCredit;
}

/** Debounce a value so searching waits for a pause in typing. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const formatSize = (bytes?: number): string => (!bytes ? '' : bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function ResourceCard({ item, busy, added, onAdd, onPlay, playing }: { item: ResourceItem; busy: boolean; added: boolean; onAdd?: () => void; onPlay: () => void; playing: boolean }) {
  const [broken, setBroken] = useState(false);
  // Models in the library have no picture of their own: render (and cache) one from the file.
  const [rendered, setRendered] = useState<string | null>(null);
  useEffect(() => {
    if (item.kind !== 'model' || !item.inLibrary || !item.downloadUrl || item.thumb) return;
    let live = true;
    modelThumbnail(item.downloadUrl).then((img) => live && setRendered(img), () => undefined);
    return () => {
      live = false;
    };
  }, [item]);
  const thumb = item.thumb ?? rendered;
  return (
    <article className="res-card" aria-label={item.title}>
      <div className="res-thumb">
        {thumb && !broken ? (
          <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <span className="res-fallback"><Icon name={KIND_ICON[item.kind]} size={30} /></span>
        )}
        {item.preview && (
          <button className="res-play" onClick={onPlay} aria-label={playing ? `Stop ${item.title}` : `Play ${item.title}`}>
            <Icon name={playing ? 'Square' : 'Play'} size={16} />
          </button>
        )}
        <span className={`res-license ${item.licenseGroup}`} title={item.licenseUrl ? 'Licence' : undefined}>{item.license}</span>
        {item.inLibrary && <span className="res-library" title="Someone already downloaded this: adding it is instant"><Icon name="Check" size={11} /> In library{item.uses && item.uses > 1 ? ` · ${item.uses}×` : ''}</span>}
      </div>
      <div className="res-body">
        <h3 className="res-title" title={item.title}>{item.title}</h3>
        <p className="res-meta">
          <span>{PROVIDER_LABEL[item.provider] ?? item.provider}</span>
          {item.author && item.provider !== 'catalog' && <span className="truncate"> · {item.author}</span>}
          {item.size ? <span> · {formatSize(item.size)}</span> : null}
        </p>
        {item.description && <p className="res-desc">{item.description}</p>}
        <div className="res-actions">
          {item.downloadUrl && onAdd && (
            <button className={`btn sm ${added ? '' : 'primary'}`} disabled={busy || added} onClick={onAdd}>
              {busy ? <Spinner /> : <Icon name={added ? 'Check' : 'Plus'} size={13} />} {added ? 'Added' : 'Add to project'}
            </button>
          )}
          <a className="btn sm" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="ExternalLink" size={13} /> {item.downloadUrl ? 'Source' : item.provider === 'catalog' ? 'Open site' : 'View & download'}
          </a>
        </div>
      </div>
    </article>
  );
}

/**
 * Search free resources from other websites (Poly Haven, Wikimedia Commons, Sketchfab, a curated list…).
 * With `onImport` the studio can download a result into the open project; without it (public page) results link out.
 */
export function ResourceExplorer({ onImport, autoFocus }: { onImport?: (r: ImportedResource) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ResourceKind | 'all'>('all');
  const [license, setLicense] = useState<'free' | 'cc0'>('free');
  const [provider, setProvider] = useState('');
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [meta, setMeta] = useState<Pick<ResourceSearch, 'providers' | 'hasMore'>>({ providers: [], hasMore: false });
  const [page, setPage] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const debounced = useDebounced(q, 350);

  // Run a new search whenever a filter changes; page > 1 appends.
  useEffect(() => {
    const ctrl = new AbortController();
    setState('loading');
    api.searchResources({ q: debounced, kind, license, provider: provider || undefined, page }, ctrl.signal).then(
      (res) => {
        setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items.filter((i) => !prev.some((p) => p.id === i.id))]));
        setMeta({ providers: res.providers, hasMore: res.hasMore });
        setState('ready');
      },
      (err: Error) => {
        if (ctrl.signal.aborted) return;
        setError(err.message);
        setState('error');
      },
    );
    return () => ctrl.abort();
  }, [debounced, kind, license, provider, page]);

  const reset = useCallback(<T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1)), []);
  const setQuery = reset(setQ);
  const setKindFilter = reset(setKind);
  const setLicenseFilter = reset(setLicense);
  const setProviderFilter = reset(setProvider);

  useEffect(() => () => audio.current?.pause(), []);
  const togglePlay = (item: ResourceItem) => {
    if (!item.preview) return;
    if (playing === item.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = (audio.current = new Audio(item.preview));
    a.volume = 0.7;
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    setPlaying(item.id);
  };

  const add = async (item: ResourceItem) => {
    if (!item.downloadUrl || !onImport) return;
    setBusyId(item.id);
    try {
      const meta = { provider: item.provider, id: item.id, title: item.title, author: item.author, license: item.license, licenseUrl: item.licenseUrl, sourceUrl: item.sourceUrl };
      const res = await api.importResource(item.libraryId ? { libraryId: item.libraryId, name: item.title, kind: item.kind } : { url: item.downloadUrl, name: item.title, kind: item.kind, meta });
      onImport({ item, url: res.url, name: res.name, type: res.type, size: res.size, credit: res.credit ?? { title: item.title, author: item.author, license: item.license, sourceUrl: item.sourceUrl } });
      // A fresh download is now in the library for everyone: mark it so, and let a refresh show it first.
      if (res.created) setItems((list) => list.map((i) => (i.id === item.id ? { ...i, inLibrary: true, libraryId: res.libraryId, downloadUrl: res.url } : i)));
      setAdded((s) => new Set(s).add(item.id));
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    } finally {
      setBusyId(null);
    }
  };

  const failed = useMemo(() => meta.providers.filter((p) => !p.ok), [meta.providers]);
  const sources = useMemo(() => meta.providers.map((p) => ({ id: p.id, label: p.label })), [meta.providers]);

  return (
    <div className="res">
      <div className="res-bar">
        <label className="res-search">
          <Icon name="Search" size={16} />
          <input className="input" type="search" autoFocus={autoFocus} placeholder="Search trees, explosion, grass, castle…" value={q} onChange={(e) => setQuery(e.target.value)} aria-label="Search free resources" />
        </label>
        <div className="res-chips" role="group" aria-label="Type">
          {KIND_FILTERS.map((k) => (
            <button key={k.id} className={`chip-btn ${kind === k.id ? 'active' : ''}`} aria-pressed={kind === k.id} onClick={() => setKindFilter(k.id)}>
              <Icon name={k.icon} size={13} /> {k.label}
            </button>
          ))}
        </div>
        <div className="res-row">
          <div className="seg" role="group" aria-label="Licence">
            <button className={license === 'free' ? 'active' : ''} aria-pressed={license === 'free'} onClick={() => setLicenseFilter('free')} title="Free to use in a published game (attribution may be needed)">Free to use</button>
            <button className={license === 'cc0' ? 'active' : ''} aria-pressed={license === 'cc0'} onClick={() => setLicenseFilter('cc0')} title="Public domain: no credit needed">CC0 only</button>
          </div>
          <select className="select" value={provider} onChange={(e) => setProviderFilter(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            {(sources.length ? sources : [{ id: 'library', label: 'Community library' }, { id: 'polyhaven', label: 'Poly Haven' }, { id: 'commons', label: 'Wikimedia Commons' }, { id: 'sketchfab', label: 'Sketchfab' }, { id: 'catalog', label: 'Curated sites' }]).map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {failed.length > 0 && state === 'ready' && (
        <div className="res-note" role="status">
          <Icon name="Info" size={14} /> {failed.map((f) => f.label).join(', ')} {failed.length > 1 ? 'are' : 'is'} not reachable right now — showing the rest.
        </div>
      )}

      <div className="res-grid" aria-busy={state === 'loading'}>
        {items.map((item) => (
          <ResourceCard key={item.id} item={item} busy={busyId === item.id} added={added.has(item.id)} onAdd={onImport ? () => void add(item) : undefined} onPlay={() => togglePlay(item)} playing={playing === item.id} />
        ))}
        {state === 'loading' && page === 1 && Array.from({ length: 8 }, (_, i) => <div key={i} className="res-card skeleton" aria-hidden />)}
      </div>

      {state === 'ready' && items.length === 0 && (
        <div className="empty">
          <Icon name="Search" size={28} />
          <p>Nothing found for “{debounced}”. Try a simpler word, a different type, or “Free to use”.</p>
        </div>
      )}
      {state === 'error' && (
        <div className="empty" role="alert">
          <Icon name="CircleAlert" size={28} />
          <p>{error || 'Could not load resources.'}</p>
          <button className="btn" onClick={() => setPage((p) => p)}>Try again</button>
        </div>
      )}
      {state === 'ready' && meta.hasMore && (
        <div className="res-more">
          <button className="btn" onClick={() => setPage((p) => p + 1)}>Load more</button>
        </div>
      )}
      {state === 'loading' && page > 1 && <div className="res-more"><Spinner /></div>}
      <p className="res-foot muted">
        Resources belong to their authors. Check each licence before publishing. Everything you add is saved to the community library for all users and remembers its source, so your exported game can list credits.
      </p>
    </div>
  );
}
