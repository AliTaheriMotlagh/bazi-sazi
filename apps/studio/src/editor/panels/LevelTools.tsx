import { EMPTY_TILE, gridSize, parseGrid, parseLegend, rectCells, serializeLegend, type ComponentData, type EntityData } from '@bazi/engine';
import { useRef } from 'react';
import { beginStroke, fillTileMap, paintTileMap, resetTerrain, setComponentProp } from '../../store/commands';
import { editor, useEditor, type PaintState, type SculptState } from '../../store/editor';
import { Icon } from '../../ui/Icon';

const hue = (ch: string) => (ch.charCodeAt(0) * 47) % 360;
const TILE_CHARS = '#GDWSRB=^~*+%@&CF$';

const TOOLS: { id: PaintState['tool']; label: string; icon: string }[] = [
  { id: 'brush', label: 'Brush', icon: 'Brush' },
  { id: 'erase', label: 'Eraser', icon: 'Eraser' },
  { id: 'fill', label: 'Bucket fill', icon: 'PaintBucket' },
  { id: 'rect', label: 'Rectangle', icon: 'Square' },
];

/** The character a stroke writes: the eraser always writes the empty tile. */
const strokeChar = (p: PaintState) => (p.tool === 'erase' ? EMPTY_TILE : p.char);

/**
 * Visual tile-map painter: a legend editor, a palette, paint tools and a
 * clickable grid. The map is still the plain text grid, so scripts, the AI and
 * hand-editing keep working. Painting in the viewport shares the same state.
 */
export function TilePainter({ entity, component, index }: { entity: EntityData; component: ComponentData; index: number }) {
  const paint = useEditor((s) => s.paint);
  const prefabs = useEditor((s) => s.project?.prefabs ?? []);
  const rectStart = useRef<[number, number] | null>(null);
  const legend = parseLegend(String(component.legend ?? ''));
  const map = String(component.map ?? '');
  const grid = parseGrid(map);
  const { cols, rows } = gridSize(grid);
  const state: PaintState = paint ?? { tool: 'brush', char: legend[0]?.char ?? '#', viewport: false };
  const setPaint = (patch: Partial<PaintState>) => editor().set({ paint: { ...state, ...patch } });
  const setLegend = (entries: typeof legend) => setComponentProp(entity.id, index, 'legend', serializeLegend(entries));

  const apply = (col: number, row: number) => {
    const ch = strokeChar(state);
    if (state.tool === 'fill') fillTileMap(entity.id, col, row, ch);
    else if (state.tool !== 'rect') paintTileMap(entity.id, [[col, row]], ch);
  };

  // The grid shows a one-cell border so the map can grow in any direction.
  const view = { cols: cols + 2, rows: rows + 2 };
  const cellStyle = (ch: string): React.CSSProperties => {
    if (ch === EMPTY_TILE || ch === ' ') return {};
    const known = legend.some((l) => l.char === ch);
    return { background: known ? `hsl(${hue(ch)} 60% 42%)` : 'hsl(0 0% 35%)', color: '#fff' };
  };

  return (
    <div className="tile-painter">
      <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Tile palette</div>
      {legend.map((l, i) => (
        <div className="row" key={i} style={{ gap: 4 }}>
          <button className={`tile-swatch ${state.char === l.char && state.tool !== 'erase' ? 'active' : ''}`} style={{ background: `hsl(${hue(l.char)} 60% 42%)` }} onClick={() => setPaint({ char: l.char, tool: state.tool === 'erase' ? 'brush' : state.tool })} aria-label={`Paint with ${l.prefab}`}>
            {l.char}
          </button>
          <input
            className="input"
            style={{ width: 34, textAlign: 'center' }}
            maxLength={1}
            value={l.char}
            aria-label="Tile character"
            onChange={(e) => e.target.value && e.target.value !== EMPTY_TILE && setLegend(legend.map((x, j) => (j === i ? { ...x, char: e.target.value } : x)))}
          />
          <select className="select grow" value={l.prefab} onChange={(e) => setLegend(legend.map((x, j) => (j === i ? { ...x, prefab: e.target.value } : x)))} aria-label="Tile prefab">
            {!prefabs.some((p) => p.name === l.prefab) && <option value={l.prefab}>{l.prefab} (missing)</option>}
            {prefabs.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
          <button className="btn sm ghost icon" aria-label="Remove tile" onClick={() => setLegend(legend.filter((_, j) => j !== i))}>
            <Icon name="X" size={12} />
          </button>
        </div>
      ))}
      <button
        className="btn sm"
        disabled={!prefabs.length}
        title={prefabs.length ? 'Add a tile type' : 'Make a prefab first (right-click an object → Save as prefab)'}
        onClick={() => {
          const used = new Set(legend.map((l) => l.char));
          const ch = [...TILE_CHARS].find((c) => !used.has(c)) ?? '?';
          setLegend([...legend, { char: ch, prefab: prefabs[0].name }]);
          setPaint({ char: ch, tool: 'brush' });
        }}
      >
        <Icon name="Plus" size={13} /> Add tile
      </button>

      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }} role="toolbar" aria-label="Paint tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`btn sm ${paint && state.tool === t.id ? 'primary' : ''}`} onClick={() => setPaint({ tool: t.id })} aria-pressed={!!paint && state.tool === t.id} title={t.label}>
            <Icon name={t.icon} size={13} /> {t.label}
          </button>
        ))}
      </div>
      <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
        <input type="checkbox" checked={!!paint?.viewport} onChange={(e) => setPaint({ viewport: e.target.checked })} />
        Paint directly in the scene view
      </label>

      <div
        className="tile-grid"
        style={{ gridTemplateColumns: `repeat(${view.cols}, 22px)` }}
        role="grid"
        aria-label={`Tile map ${cols} by ${rows}`}
        onPointerLeave={() => (rectStart.current = null)}
      >
        {Array.from({ length: view.rows * view.cols }, (_, n) => {
          const col = (n % view.cols) - 1;
          const row = Math.floor(n / view.cols) - 1;
          const ch = grid[row]?.[col] ?? EMPTY_TILE;
          const border = col < 0 || row < 0 || col >= cols || row >= rows;
          return (
            <div
              key={n}
              role="gridcell"
              className={`tile-cell ${border ? 'edge' : ''}`}
              style={cellStyle(ch)}
              title={`${col}, ${row}`}
              onPointerDown={(e) => {
                (e.target as Element).releasePointerCapture?.(e.pointerId);
                beginStroke();
                if (state.tool === 'rect') rectStart.current = [col, row];
                else apply(col, row);
              }}
              onPointerEnter={(e) => {
                if (e.buttons & 1 && (state.tool === 'brush' || state.tool === 'erase')) apply(col, row);
              }}
              onPointerUp={() => {
                if (state.tool === 'rect' && rectStart.current) {
                  paintTileMap(entity.id, rectCells(rectStart.current, [col, row]), strokeChar(state), 'Paint rectangle');
                  rectStart.current = null;
                }
              }}
            >
              {ch !== EMPTY_TILE ? ch : ''}
            </div>
          );
        })}
      </div>
      <div className="faint" style={{ fontSize: 11.5 }}>
        {cols}×{rows} tiles. Click or drag to paint; paint outside the edge to grow the map. Hover shows the cell.
      </div>
    </div>
  );
}

const BRUSHES: { id: SculptState['brush']; label: string }[] = [
  { id: 'raise', label: 'Raise' },
  { id: 'lower', label: 'Lower' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'flatten', label: 'Flatten' },
];

/** Sculpt controls for a Terrain; the actual brushing happens in the scene view. */
export function TerrainTools({ entity }: { entity: EntityData }) {
  const sculpt = useEditor((s) => s.sculpt);
  const on = !!sculpt;
  const state: SculptState = sculpt ?? { brush: 'raise', radius: 0.08, strength: 10 };
  const set = (patch: Partial<SculptState>) => editor().set({ sculpt: { ...state, ...patch } });
  return (
    <div className="tile-painter">
      <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Sculpt</div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }} role="toolbar" aria-label="Sculpt brushes">
        {BRUSHES.map((b) => (
          <button key={b.id} className={`btn sm ${on && state.brush === b.id ? 'primary' : ''}`} aria-pressed={on && state.brush === b.id} onClick={() => set({ brush: b.id })}>
            {b.label}
          </button>
        ))}
        <button className="btn sm" disabled={!on} onClick={() => editor().set({ sculpt: null })}>
          <Icon name="X" size={12} /> Stop
        </button>
      </div>
      <div className="prop"><span className="prop-label">Brush size</span><input type="range" min={0.02} max={0.3} step={0.01} value={state.radius} onChange={(e) => set({ radius: Number(e.target.value) })} aria-label="Brush size" /></div>
      <div className="prop"><span className="prop-label">Strength</span><input type="range" min={1} max={30} step={1} value={state.strength} onChange={(e) => set({ strength: Number(e.target.value) })} aria-label="Brush strength" /></div>
      <button className="btn sm danger" onClick={() => confirm('Flatten the whole terrain?') && resetTerrain(entity.id)}>
        <Icon name="RotateCcw" size={13} /> Flatten everything
      </button>
      <div className="faint" style={{ fontSize: 11.5 }}>{on ? 'Drag on the terrain in the scene view to sculpt. Hold Shift to invert Raise/Lower.' : 'Pick a brush to start sculpting.'}</div>
    </div>
  );
}
