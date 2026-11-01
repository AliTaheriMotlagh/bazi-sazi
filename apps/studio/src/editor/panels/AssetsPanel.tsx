import type { AssetType } from '@bazi/engine';
import { useRef, useState } from 'react';
import { api } from '../../api/client';
import {
  addAsset,
  addScene,
  deleteGraph,
  deletePrefab,
  deleteScene,
  deleteScript,
  duplicateScene,
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
import { Spinner, useMenu } from '../../ui/primitives';
import { DRAG_MIME, type DragPayload } from '../viewport/SceneView';

type Tab = 'assets' | 'scripts' | 'logic' | 'prefabs' | 'scenes';

const drag = (payload: DragPayload) => (e: React.DragEvent) => {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
};

function kindOf(file: File): AssetType | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
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
    } catch (err) {
      toast(`${file.name}: ${(err as Error).message}`, 'error');
    }
  }
}

const promptName = (label: string, initial = '') => window.prompt(label, initial)?.trim() || null;

export function AssetsPanel() {
  const [tab, setTab] = useState<Tab>('assets');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const project = useEditor((s) => s.project)!;
  const selectedAsset = useEditor((s) => s.selectedAsset);
  const sceneId = useEditor((s) => s.sceneId);
  const activeScriptId = useEditor((s) => s.activeScriptId);
  const activeGraphId = useEditor((s) => s.activeGraphId);
  const input = useRef<HTMLInputElement>(null);
  const menu = useMenu();

  const upload = async (files: File[]) => {
    setBusy(true);
    await uploadFiles(files);
    setBusy(false);
  };

  const counts: Record<Tab, number> = { assets: project.assets.length, scripts: project.scripts.length, logic: project.graphs.length, prefabs: project.prefabs.length, scenes: project.scenes.length };
  const TABS: [Tab, string, string][] = [
    ['assets', 'Files', 'Image'],
    ['scripts', 'Code', 'Code'],
    ['logic', 'Logic', 'Workflow'],
    ['prefabs', 'Prefabs', 'Package'],
    ['scenes', 'Scenes', 'Clapperboard'],
  ];

  return (
    <div
      className="panel"
      style={{ height: '100%', position: 'relative' }}
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
        setTab('assets');
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="tabs" role="tablist">
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} role="tab" aria-selected={tab === id}>
            <Icon name={icon} size={13} /> {label} {counts[id] > 0 && <span className="count">{counts[id]}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'assets' && (
          <>
            <div className="row" style={{ padding: '8px 10px 0' }}>
              <button className="btn sm primary" onClick={() => input.current?.click()} disabled={busy}>
                {busy ? <Spinner size={13} /> : <Icon name="Upload" size={13} />} Upload
              </button>
              <span className="faint" style={{ fontSize: 11.5 }}>Images, sounds, GLB models — or drop files here</span>
              <input ref={input} type="file" multiple hidden accept="image/*,audio/*,.glb,.gltf,.woff2,.ttf" onChange={(e) => e.target.files && void upload([...e.target.files])} />
            </div>
            {project.assets.length === 0 ? (
              <div className="empty">No files yet. Upload sprites, textures, sounds or 3D models.</div>
            ) : (
              <div className="asset-grid">
                {project.assets.map((a) => (
                  <button
                    key={a.id}
                    className={`asset ${selectedAsset?.id === a.id ? 'selected' : ''}`}
                    draggable
                    onDragStart={drag({ kind: 'asset', id: a.id })}
                    onClick={() => editor().set({ selectedAsset: { kind: 'asset', id: a.id }, selection: [], rightTab: 'inspector' })}
                    title={`${a.name} — drag into the scene`}
                  >
                    <div className="asset-thumb" style={a.type === 'image' ? { backgroundImage: `url(${a.url})` } : undefined}>
                      {a.type !== 'image' && <Icon name={a.type === 'audio' ? 'Music' : a.type === 'model' ? 'Shapes' : 'FileCode'} size={22} />}
                    </div>
                    <span className="truncate">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'scripts' && (
          <div className="list">
            <div className="row" style={{ padding: '2px 2px 6px' }}>
              <button className="btn sm primary" onClick={() => newScript('New Script', { attachTo: editor().selection[0] })}>
                <Icon name="Plus" size={13} /> New script
              </button>
              <span className="faint" style={{ fontSize: 11.5 }}>Drag a script onto an object to attach it</span>
            </div>
            {project.scripts.map((s) => (
              <div key={s.id} className={`list-item ${activeScriptId === s.id ? 'active' : ''}`} draggable onDragStart={drag({ kind: 'script', id: s.id })} onClick={() => editor().openScript(s.id)}>
                <Icon name="FileCode" size={14} />
                <span className="truncate">{s.name}</span>
                <span className="badge" style={{ fontSize: 10 }}>{s.language === 'typescript' ? 'TS' : 'JS'}</span>
                <span className="actions">
                  <button className="btn sm ghost icon" aria-label="Script actions" onClick={(e) => {
                    e.stopPropagation();
                    menu.open(e.currentTarget.getBoundingClientRect(), [
                      { label: 'Rename', icon: 'Pencil', onSelect: () => { const n = promptName('Script name', s.name); if (n) updateScript(s.id, { name: n }); } },
                      { label: s.language === 'typescript' ? 'Switch to JavaScript' : 'Switch to TypeScript', icon: 'Code', onSelect: () => updateScript(s.id, { language: s.language === 'typescript' ? 'javascript' : 'typescript' }) },
                      { separator: true },
                      { label: 'Delete', icon: 'Trash', danger: true, onSelect: () => confirm(`Delete script "${s.name}"?`) && deleteScript(s.id) },
                    ]);
                  }}><Icon name="EllipsisVertical" size={13} /></button>
                </span>
              </div>
            ))}
            {project.scripts.length === 0 && <div className="empty">Scripts let you write game logic in JavaScript or TypeScript (with autocomplete).</div>}
          </div>
        )}

        {tab === 'logic' && (
          <div className="list">
            <div className="row" style={{ padding: '2px 2px 6px' }}>
              <button className="btn sm primary" onClick={() => newGraph('New Logic', editor().selection[0])}>
                <Icon name="Plus" size={13} /> New visual script
              </button>
            </div>
            {project.graphs.map((g) => (
              <div key={g.id} className={`list-item ${activeGraphId === g.id ? 'active' : ''}`} draggable onDragStart={drag({ kind: 'graph', id: g.id })} onClick={() => editor().openGraph(g.id)}>
                <Icon name="Workflow" size={14} />
                <span className="truncate">{g.name}</span>
                <span className="faint" style={{ fontSize: 11 }}>{g.nodes.length} nodes</span>
                <span className="actions">
                  <button className="btn sm ghost icon" aria-label="Rename" onClick={(e) => { e.stopPropagation(); const n = promptName('Graph name', g.name); if (n) updateGraph(g.id, (x) => void (x.name = n), 'Rename graph'); }}><Icon name="Pencil" size={13} /></button>
                  <button className="btn sm ghost icon" aria-label="Delete" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${g.name}"?`)) deleteGraph(g.id); }}><Icon name="Trash" size={13} /></button>
                </span>
              </div>
            ))}
            {project.graphs.length === 0 && <div className="empty">Visual scripts are no-code logic: connect events (“On Collision”) to actions (“Destroy”, “Add Score”).</div>}
          </div>
        )}

        {tab === 'prefabs' && (
          <div className="list">
            {project.prefabs.map((p) => (
              <div key={p.id} className={`list-item ${selectedAsset?.id === p.id ? 'active' : ''}`} draggable onDragStart={drag({ kind: 'prefab', id: p.id })} onClick={() => editor().set({ selectedAsset: { kind: 'prefab', id: p.id }, selection: [], rightTab: 'inspector' })}>
                <Icon name="Package" size={14} />
                <span className="truncate">{p.name}</span>
                <span className="actions">
                  <button className="btn sm ghost icon" aria-label="Delete" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete prefab "${p.name}"?`)) deletePrefab(p.id); }}><Icon name="Trash" size={13} /></button>
                </span>
              </div>
            ))}
            {project.prefabs.length === 0 && <div className="empty">Prefabs are reusable objects (enemies, bullets, tiles). Right-click an object → “Save as prefab”, then drag it into the scene or spawn it.</div>}
          </div>
        )}

        {tab === 'scenes' && (
          <div className="list">
            <div className="row" style={{ padding: '2px 2px 6px' }}>
              <button className="btn sm primary" onClick={() => { const n = promptName('Scene name', 'Level 2'); if (n) addScene(n); }}>
                <Icon name="Plus" size={13} /> New scene
              </button>
            </div>
            {project.scenes.map((s) => (
              <div key={s.id} className={`list-item ${sceneId === s.id ? 'active' : ''}`} onClick={() => editor().setScene(s.id)}>
                <Icon name="Clapperboard" size={14} />
                <span className="truncate">{s.name}</span>
                {project.settings.startScene === s.id && <span className="badge accent" style={{ fontSize: 10 }}>start</span>}
                <span className="actions">
                  <button className="btn sm ghost icon" aria-label="Scene actions" onClick={(e) => {
                    e.stopPropagation();
                    menu.open(e.currentTarget.getBoundingClientRect(), [
                      { label: 'Set as start scene', icon: 'Flag', onSelect: () => updateSettings((st) => void (st.startScene = s.id), 'Set start scene') },
                      { label: 'Rename', icon: 'Pencil', onSelect: () => { const n = promptName('Scene name', s.name); if (n) renameScene(s.id, n); } },
                      { label: 'Duplicate', icon: 'Copy', onSelect: () => duplicateScene(s.id) },
                      { separator: true },
                      { label: 'Delete', icon: 'Trash', danger: true, disabled: project.scenes.length <= 1, onSelect: () => confirm(`Delete scene "${s.name}"?`) && deleteScene(s.id) },
                    ]);
                  }}><Icon name="EllipsisVertical" size={13} /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {over && <div className="drop-hint">Drop files to upload</div>}
      {menu.element}
    </div>
  );
}
