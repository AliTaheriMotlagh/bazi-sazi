import { useEffect, useMemo, useState } from 'react';
import { createFromPreset, PRESETS, type Preset } from '../store/commands';
import { useEditor } from '../store/editor';
import { Icon } from '../ui/Icon';
import { loadSamples, placeSampleById, type SampleItem } from './panels/ContentBrowser';
import { modelThumbnail } from './thumbnails';
import { DRAG_MIME, type DragPayload } from './viewport/SceneView';

const CATEGORY_ICON: Record<string, string> = {
  Basic: 'Square',
  '3D Shapes': 'Box',
  '2D': 'Image',
  Characters: 'Footprints',
  Gameplay: 'Coins',
  Strategy: 'Castle',
  'Camera & Light': 'Lightbulb',
  'Effects & UI': 'Sparkles',
  Models: 'Shapes',
};
const CATEGORY_COLOR: Record<string, string> = {
  Basic: '#64748b',
  '3D Shapes': '#3b82f6',
  '2D': '#a855f7',
  Characters: '#10b981',
  Gameplay: '#f59e0b',
  Strategy: '#ef4444',
  'Camera & Light': '#eab308',
  'Effects & UI': '#ec4899',
  Models: '#06b6d4',
};

function ModelTile({ s }: { s: SampleItem }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    modelThumbnail(s.url).then((d) => alive && setSrc(d)).catch(() => undefined);
    return () => void (alive = false);
  }, [s.url]);
  const drag: DragPayload = { kind: 'sample', id: s.url, type: 'model', name: s.name };
  return (
    <button className="place-tile" draggable onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, JSON.stringify(drag))} onClick={() => placeSampleById(s)} title={`${s.name} — click or drag into the scene`}>
      <span className="place-icon model">{src ? <img src={src} alt="" draggable={false} /> : <Icon name="Shapes" size={18} />}</span>
      <span className="truncate">{s.name}</span>
    </button>
  );
}

/** Unreal-style "Place Actors" panel: categories on the left, things to drop on the right. */
export function PlacePanel() {
  const mode = useEditor((s) => s.project?.settings.mode ?? '3d');
  const [category, setCategory] = useState(() => (mode === '3d' ? '3D Shapes' : '2D'));
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<SampleItem[]>([]);
  useEffect(() => void loadSamples().then((s) => setModels(s.filter((x) => x.type === 'model'))), []);
  const presets = useMemo(() => PRESETS.filter((p) => !p.modes || p.modes.includes(mode)), [mode]);
  const categories = useMemo(() => [...new Set(presets.map((p) => p.group)), ...(mode === '3d' ? ['Models'] : [])], [presets, mode]);
  const q = query.trim().toLowerCase();
  const list: Preset[] = q ? presets.filter((p) => p.label.toLowerCase().includes(q)) : presets.filter((p) => p.group === category);
  const modelList = mode === '3d' && (q ? models.filter((m) => m.name.toLowerCase().includes(q)) : category === 'Models' ? models : []);

  return (
    <div className="panel place">
      <div className="panel-head">
        <Icon name="Plus" size={13} />
        <span className="grow">Place</span>
      </div>
      <div className="place-search">
        <Icon name="Search" size={13} />
        <input placeholder="Search to place…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search things to place" />
      </div>
      <div className="place-body">
        {!q && (
          <nav className="place-cats" aria-label="Categories">
            {categories.map((c) => (
              <button key={c} className={`place-cat ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)} title={c} style={{ ['--cat' as string]: CATEGORY_COLOR[c] ?? '#64748b' }}>
                <Icon name={CATEGORY_ICON[c] ?? 'Square'} size={15} />
                <span>{c}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="place-list">
          {list.map((p) => (
            <button
              key={p.label}
              className="place-tile"
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'preset', id: p.label } satisfies DragPayload))}
              onClick={() => createFromPreset(p)}
              title={`${p.label} — click to add, or drag into the scene`}
            >
              <span className="place-icon" style={{ background: `color-mix(in srgb, ${CATEGORY_COLOR[p.group] ?? '#64748b'} 22%, transparent)`, color: CATEGORY_COLOR[p.group] }}>
                <Icon name={p.icon} size={16} />
              </span>
              <span className="truncate">{p.label}</span>
            </button>
          ))}
          {modelList && modelList.map((s) => <ModelTile key={s.id} s={s} />)}
          {list.length === 0 && (!modelList || modelList.length === 0) && <div className="empty">Nothing found</div>}
        </div>
      </div>
    </div>
  );
}
