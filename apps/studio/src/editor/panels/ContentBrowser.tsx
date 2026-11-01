import type { AssetType } from '@bazi/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import {
  addAsset,
  addSampleAsset,
  addScene,
  deleteAsset,
  deleteGraph,
  deletePrefab,
  deleteScene,
  deleteScript,
  duplicateScene,
  instantiatePrefab,
  newGraph,
  newScript,
  renameScene,
  updateGraph,
  updateScript,
  updateSettings,
} from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { toast } from '../../store/ui';
import { Icon } from '../../ui/Icon';
import { Spinner, useMenu, type MenuItem } from '../../ui/primitives';
import { editorHost, viewportBridge } from '../session';
import { modelThumbnail } from '../thumbnails';
import { DRAG_MIME, placeAsset, type DragPayload } from '../viewport/SceneView';

export interface SampleItem {
  id: string;
  name: string;
  type: AssetType;
  url: string;
  tags: string[];
  size: number;
  clips?: string[];
  columns?: number;
  rows?: number;
}

let manifest: Promise<SampleItem[]> | null = null;
export function loadSamples(): Promise<SampleItem[]> {
  manifest ??= fetch('/samples/manifest.json')
    .then((r) => r.json())
    .then((m: { items: SampleItem[] }) => m.items)
    .catch(() => []);
  return manifest;
}

function kindOf(file: File): AssetType | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (/\.(glb|gltf)$/i.test(file.name)) return 'model';
  if (/\.(woff2|ttf)$/i.test(file.name)) return 'font';
  return null;
}

export async function uploadFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      toast(`${file.name}: unsupported type`, 'error');
      continue;
    }
    try {
      const res = await api.upload(file);
      addAsset({ name: file.name.replace(/\.\w+$/, ''), type: kind, url: res.url, size: res.size });
      toast(`Imported ${file.name}`, 'success');
    } catch (err) {
      toast(`${file.name}: ${(err as Error).message}`, 'error');
    }
  }
}

type Folder = 'starter' | 'starter:model' | 'starter:image' | 'starter:audio' | 'starter:video' | 'files' | 'scripts' | 'graphs' | 'prefabs' | 'scenes';

const FOLDERS: { id: Folder; label: string; icon: string; depth: number }[] = [
  { id: 'starter', label: 'Starter Content', icon: 'Library', depth: 0 },
  { id: 'starter:model', label: '3D Models', icon: 'Shapes', depth: 1 },
  { id: 'starter:image', label: 'Sprites & Tiles', icon: 'FileImage', depth: 1 },
  { id: 'starter:audio', label: 'Music & Sounds', icon: 'FileAudio', depth: 1 },
  { id: 'starter:video', label: 'Videos', icon: 'FileVideo', depth: 1 },
  { id: 'files', label: 'Project Files', icon: 'FolderOpen', depth: 0 },
  { id: 'scripts', label: 'Scripts', icon: 'FileCode', depth: 0 },
  { id: 'graphs', label: 'Visual Scripts', icon: 'Workflow', depth: 0 },
  { id: 'prefabs', label: 'Prefabs', icon: 'Package', depth: 0 },
  { id: 'scenes', label: 'Scenes', icon: 'Clapperboard', depth: 0 },
];

interface Tile {
  key: string;
  name: string;
  type: string;
  icon: string;
  url?: string;
  badge?: string;
  drag?: DragPayload;
  sample?: SampleItem;
  active?: boolean;
  open?(): void;
  menu?: MenuItem[];
}

const TYPE_ICON: Record<string, string> = { model: 'Shapes', image: 'Image', audio: 'Music', video: 'Film', font: 'Type', other: 'FileCode' };

function Thumb({ tile }: { tile: Tile }) {
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (tile.type === 'model' && tile.url) {
      let alive = true;
      modelThumbnail(tile.url).then((d) => alive && setSrc(d)).catch(() => undefined);
      return () => void (alive = false);
    }
  }, [tile.type, tile.url]);
  useEffect(() => () => audio.current?.pause(), []);
  if (tile.type === 'image' && tile.url) return <div className="cb-thumb checker" style={{ backgroundImage: `url("${tile.url}")` }} />;
  if (tile.type === 'model') return <div className="cb-thumb model">{src ? <img src={src} alt="" draggable={false} /> : <Spinner size={18} />}</div>;
  if (tile.type === 'video' && tile.url) return <div className="cb-thumb"><video src={`${tile.url}#t=1`} muted preload="metadata" playsInline /></div>;
  if (tile.type === 'audio' && tile.url)
    return (
      <div className="cb-thumb audio">
        <button
          className="btn icon cb-play"
          aria-label={playing ? 'Stop preview' : 'Play preview'}
          onClick={(e) => {
            e.stopPropagation();
            if (playing) {
              audio.current?.pause();
              setPlaying(false);
              return;
            }
            audio.current ??= new Audio(tile.url);
            audio.current.currentTime = 0;
            audio.current.onended = () => setPlaying(false);
            void audio.current.play();
            setPlaying(true);
          }}
        >
          <Icon name={playing ? 'Square' : 'Play'} size={16} />
        </button>
      </div>
    );
  return <div className="cb-thumb"><Icon name={tile.icon} size={28} /></div>;
}

const promptName = (label: string, initial = '') => window.prompt(label, initial)?.trim() || null;

/** Add a Starter Content item to the project and drop it in the middle of the view. */
export function placeSampleById(s: Pick<SampleItem, 'url' | 'type' | 'name'>): void {
  const project = editor().project!;
  const id = addSampleAsset({ url: s.url, type: s.type, name: s.name });
  const r = document.querySelector<HTMLCanvasElement>('.scene-canvas')?.getBoundingClientRect();
  const pos = r && r.width ? viewportBridge.dropPosition(r.left + r.width / 2, r.top + r.height / 2) : ([0, 0, 0] as [number, number, number]);
  placeAsset(id, s.type, pos, project.settings.mode === '2d');
  toast(`Added ${s.name}`, 'success');
}

/** Unreal-style content browser: folders on the left, a tile grid of everything usable. */
export function ContentBrowser() {
  const project = useEditor((s) => s.project)!;
  const sceneId = useEditor((s) => s.sceneId);
  const docs = useEditor((s) => s.activeDoc);
  const selectedAsset = useEditor((s) => s.selectedAsset);
  const [folder, setFolder] = useState<Folder>(() => (project.assets.length ? 'files' : 'starter'));
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(96);
  const [samples, setSamples] = useState<SampleItem[]>([]);
  const [picked, setPicked] = useState<Tile | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const menu = useMenu();

  useEffect(() => {
    void loadSamples().then(setSamples);
    editorHost.uploadFiles = () => input.current?.click();
  }, []);

  const tiles = useMemo<Tile[]>(() => {
    const dragOf = (d: DragPayload) => d;
    if (folder.startsWith('starter')) {
      const type = folder.split(':')[1];
      return samples
        .filter((s) => !type || s.type === type)
        .map((s) => ({ key: s.id, name: s.name, type: s.type, icon: TYPE_ICON[s.type], url: s.url, sample: s, badge: s.clips?.length ? `${s.clips.length} anim` : undefined, drag: dragOf({ kind: 'sample', id: s.url, type: s.type, name: s.name }) }));
    }
    switch (folder) {
      case 'files':
        return project.assets.map((a) => ({
          key: a.id,
          name: a.name,
          type: a.type,
          icon: TYPE_ICON[a.type] ?? 'FileCode',
          url: a.url,
          active: selectedAsset?.id === a.id,
          drag: dragOf({ kind: 'asset', id: a.id }),
          open: () => editor().set({ selectedAsset: { kind: 'asset', id: a.id }, selection: [], rightTab: 'inspector' }),
          menu: [{ label: 'Delete', icon: 'Trash', danger: true, onSelect: () => confirm(`Delete "${a.name}"?`) && deleteAsset(a.id) }],
        }));
      case 'scripts':
        return project.scripts.map((s) => ({
          key: s.id,
          name: s.name,
          type: 'script',
          icon: 'FileCode',
          badge: s.language === 'typescript' ? 'TS' : 'JS',
          active: docs === `script:${s.id}`,
          drag: dragOf({ kind: 'script', id: s.id }),
          open: () => editor().openScript(s.id),
          menu: [
            { label: 'Rename', icon: 'Pencil', onSelect: () => { const n = promptName('Script name', s.name); if (n) updateScript(s.id, { name: n }); } },
            { label: s.language === 'typescript' ? 'Switch to JavaScript' : 'Switch to TypeScript', icon: 'Code', onSelect: () => updateScript(s.id, { language: s.language === 'typescript' ? 'javascript' : 'typescript' }) },
            { separator: true },
            { label: 'Delete', icon: 'Trash', danger: true, onSelect: () => confirm(`Delete script "${s.name}"?`) && (editor().closeDoc(`script:${s.id}`), deleteScript(s.id)) },
          ],
        }));
      case 'graphs':
        return project.graphs.map((g) => ({
          key: g.id,
          name: g.name,
          type: 'graph',
          icon: 'Workflow',
          badge: `${g.nodes.length} nodes`,
          active: docs === `graph:${g.id}`,
          drag: dragOf({ kind: 'graph', id: g.id }),
          open: () => editor().openGraph(g.id),
          menu: [
            { label: 'Rename', icon: 'Pencil', onSelect: () => { const n = promptName('Graph name', g.name); if (n) updateGraph(g.id, (x) => void (x.name = n), 'Rename graph'); } },
            { label: 'Delete', icon: 'Trash', danger: true, onSelect: () => confirm(`Delete "${g.name}"?`) && (editor().closeDoc(`graph:${g.id}`), deleteGraph(g.id)) },
          ],
        }));
      case 'prefabs':
        return project.prefabs.map((p) => {
          const model = p.entities[0]?.components.find((c) => c.type === 'Model');
          const url = model ? project.assets.find((a) => a.id === model.model)?.url : undefined;
          return {
            key: p.id,
            name: p.name,
            type: url ? 'model' : 'prefab',
            icon: 'Package',
            url,
            active: selectedAsset?.id === p.id,
            drag: dragOf({ kind: 'prefab', id: p.id }),
            open: () => editor().set({ selectedAsset: { kind: 'prefab', id: p.id }, selection: [], rightTab: 'inspector' }),
            menu: [
              { label: 'Place in scene', icon: 'Plus', onSelect: () => instantiatePrefab(p.id) },
              { label: 'Delete', icon: 'Trash', danger: true, onSelect: () => confirm(`Delete prefab "${p.name}"?`) && deletePrefab(p.id) },
            ],
          };
        });
      case 'scenes':
        return project.scenes.map((s) => ({
          key: s.id,
          name: s.name,
          type: 'scene',
          icon: 'Clapperboard',
          badge: project.settings.startScene === s.id ? 'start' : `${s.entities.length}`,
          active: sceneId === s.id,
          open: () => editor().setScene(s.id),
          menu: [
            { label: 'Set as start scene', icon: 'Flag', onSelect: () => updateSettings((st) => void (st.startScene = s.id), 'Set start scene') },
            { label: 'Rename', icon: 'Pencil', onSelect: () => { const n = promptName('Scene name', s.name); if (n) renameScene(s.id, n); } },
            { label: 'Duplicate', icon: 'Copy', onSelect: () => duplicateScene(s.id) },
            { separator: true },
            { label: 'Delete', icon: 'Trash', danger: true, disabled: project.scenes.length <= 1, onSelect: () => confirm(`Delete scene "${s.name}"?`) && deleteScene(s.id) },
          ],
        }));
    }
    return [];
  }, [folder, samples, project, selectedAsset, docs, sceneId]);

  const q = query.trim().toLowerCase();
  const shown = q ? tiles.filter((t) => t.name.toLowerCase().includes(q) || t.sample?.tags.some((tag) => tag.includes(q))) : tiles;
  const count = (f: Folder) =>
    f.startsWith('starter') ? samples.filter((s) => !f.includes(':') || s.type === f.split(':')[1]).length : { files: project.assets.length, scripts: project.scripts.length, graphs: project.graphs.length, prefabs: project.prefabs.length, scenes: project.scenes.length }[f as 'files'];

  const placeSample = placeSampleById;

  const createNew = () => {
    if (folder === 'scripts') newScript('New Script', { attachTo: editor().selection[0] });
    else if (folder === 'graphs') newGraph('New Logic', editor().selection[0]);
    else if (folder === 'scenes') {
      const n = promptName('Scene name', 'Level 2');
      if (n) addScene(n);
    } else input.current?.click();
  };

  const upload = async (files: File[]) => {
    setBusy(true);
    await uploadFiles(files);
    setBusy(false);
    setFolder('files');
  };

  return (
    <div
      className="cb"
      style={{ ['--tile' as string]: `${size}px` }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <aside className="cb-tree" aria-label="Folders">
        {FOLDERS.map((f) => (
          <button key={f.id} className={`cb-folder ${folder === f.id ? 'active' : ''}`} style={{ paddingLeft: 8 + f.depth * 14 }} onClick={() => setFolder(f.id)}>
            <Icon name={f.icon} size={14} />
            <span className="grow truncate">{f.label}</span>
            <span className="faint">{count(f.id)}</span>
          </button>
        ))}
      </aside>
      <section className="cb-main">
        <div className="cb-bar">
          <button className="btn sm primary" onClick={createNew} disabled={busy || folder.startsWith('starter') || folder === 'prefabs'}>
            {busy ? <Spinner size={13} /> : <Icon name={folder === 'files' ? 'Upload' : 'Plus'} size={13} />} {folder === 'files' ? 'Import' : 'New'}
          </button>
          <button className="btn sm" onClick={() => input.current?.click()} title="Import images, sounds, videos or GLB models">
            <Icon name="Upload" size={13} /> Import
          </button>
          <div className="cb-search">
            <Icon name="Search" size={13} />
            <input placeholder="Search content…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search content" />
          </div>
          <span className="spacer" />
          <input type="range" min={64} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Tile size" style={{ width: 90 }} />
          <input ref={input} type="file" multiple hidden accept="image/*,audio/*,video/mp4,video/webm,.glb,.gltf,.woff2,.ttf" onChange={(e) => e.target.files && void upload([...e.target.files])} />
        </div>
        <div className="cb-grid" role="list">
          {shown.map((t) => (
            <div
              key={t.key}
              role="listitem"
              className={`cb-tile ${t.active || picked?.key === t.key ? 'active' : ''}`}
              draggable={!!t.drag}
              onDragStart={(e) => {
                if (!t.drag) return;
                e.dataTransfer.setData(DRAG_MIME, JSON.stringify(t.drag));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => (t.sample ? setPicked(t) : t.open?.())}
              onDoubleClick={() => (t.sample ? placeSample(t.sample) : t.open?.())}
              onContextMenu={(e) => {
                e.preventDefault();
                const items = t.sample ? [{ label: 'Add to scene', icon: 'Plus', onSelect: () => placeSample(t.sample!) }, { label: 'Add to project files only', icon: 'FolderOpen', onSelect: () => void addSampleAsset(t.sample!) }] : t.menu;
                if (items) menu.open(e, items);
              }}
              title={`${t.name} — ${t.sample ? 'double-click or drag into the scene' : 'drag into the scene'}`}
            >
              <Thumb tile={t} />
              <div className="cb-name truncate">{t.name}</div>
              {t.badge && <span className="cb-badge">{t.badge}</span>}
              <span className={`cb-type t-${t.type}`} />
            </div>
          ))}
          {shown.length === 0 && (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              {folder === 'files' ? 'No files yet — import your own, or use Starter Content.' : q ? 'Nothing matches your search.' : 'Nothing here yet.'}
            </div>
          )}
        </div>
        {picked?.sample && (
          <div className="cb-details">
            <Icon name={TYPE_ICON[picked.sample.type]} size={16} />
            <b className="truncate">{picked.sample.name}</b>
            <span className="faint">{(picked.sample.size / 1024).toFixed(0)} KB</span>
            {picked.sample.clips?.length ? <span className="faint truncate">Animations: {picked.sample.clips.join(', ')}</span> : null}
            {picked.sample.columns ? <span className="faint">{picked.sample.columns}-frame sheet</span> : null}
            <span className="spacer" />
            <button className="btn sm primary" onClick={() => placeSample(picked.sample!)}><Icon name="Plus" size={13} /> Add to scene</button>
            <button className="btn sm ghost icon" onClick={() => setPicked(null)} aria-label="Close details"><Icon name="X" size={13} /></button>
          </div>
        )}
      </section>
      {over && <div className="drop-hint">Drop files to import</div>}
      {menu.element}
    </div>
  );
}
