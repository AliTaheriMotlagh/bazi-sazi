import { getNodeDef, NODE_CATEGORIES, NODES, uid, type GraphData, type NodeCategory, type PinDef } from '@bazi/engine';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useMemo, useState } from 'react';
import { newGraph, updateGraph } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { useUi } from '../../store/ui';
import { Icon } from '../../ui/Icon';

const CATEGORY_COLOR: Record<NodeCategory, string> = {
  Events: '#dc2626',
  Flow: '#6b7280',
  Actions: '#2563eb',
  Entity: '#0891b2',
  Variables: '#7c3aed',
  Math: '#059669',
  Logic: '#16a34a',
  Input: '#d97706',
  Scene: '#db2777',
  Network: '#0d9488',
};
const PIN_COLOR: Record<string, string> = { number: '#4ade80', string: '#f472b6', boolean: '#f87171', entity: '#38bdf8', any: '#a3a3a3', exec: '#ffffff' };

interface NodeData extends Record<string, unknown> {
  type: string;
  values: Record<string, unknown>;
  connected: string[];
  graphId: string;
}

function InlineValue({ pin, value, onChange }: { pin: PinDef; value: unknown; onChange(v: unknown): void }) {
  const v = value ?? pin.default;
  if (pin.options)
    return (
      <select className="select nodrag" value={String(v)} onChange={(e) => onChange(e.target.value)}>
        {pin.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  if (pin.kind === 'boolean') return <input className="nodrag" type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} />;
  if (pin.kind === 'number')
    return <input className="input nodrag" type="number" step="any" value={Number(v)} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} style={{ width: 70 }} />;
  if (pin.kind === 'entity') return <input className="input nodrag" placeholder="self" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />;
  return <input className="input nodrag" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />;
}

const GraphNode = memo(function GraphNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const def = getNodeDef(data.type);
  if (!def) return <div className="vs-node"><div className="vs-node-head" style={{ background: '#555' }}>Unknown: {data.type}</div></div>;
  const set = (key: string, value: unknown) =>
    updateGraph(data.graphId, (g) => {
      const n = g.nodes.find((x) => x.id === id);
      if (n) n.data[key] = value;
    }, 'Edit node', `${id}:${key}`);
  return (
    <div className={`vs-node ${selected ? 'selected' : ''}`} title={def.description}>
      <div className="vs-node-head" style={{ background: CATEGORY_COLOR[def.category] }}>
        {def.event && <Icon name="Zap" size={12} />}
        {def.title}
      </div>
      <div className="vs-node-body">
        {def.fields?.map((f) => (
          <div className="vs-field" key={f.id}>
            <span className="faint">{f.label}</span>
            <InlineValue pin={f} value={data.values[f.id]} onChange={(v) => set(f.id, v)} />
          </div>
        ))}
        {def.inputs.map((pin) => (
          <div className="vs-pin" key={pin.id}>
            <Handle type="target" position={Position.Left} id={pin.id} className={pin.kind === 'exec' ? 'exec' : 'data'} style={{ background: PIN_COLOR[pin.kind] }} />
            <span>{pin.label || (pin.kind === 'exec' ? '▶' : pin.id)}</span>
            {pin.kind !== 'exec' && !data.connected.includes(pin.id) && <InlineValue pin={pin} value={data.values[pin.id]} onChange={(v) => set(pin.id, v)} />}
          </div>
        ))}
        {def.outputs.map((pin) => (
          <div className="vs-pin out" key={pin.id}>
            <span>{pin.label || (pin.kind === 'exec' ? '▶' : pin.id)}</span>
            <Handle type="source" position={Position.Right} id={pin.id} className={pin.kind === 'exec' ? 'exec' : 'data'} style={{ background: PIN_COLOR[pin.kind] }} />
          </div>
        ))}
      </div>
    </div>
  );
});

const nodeTypes = { graph: GraphNode };

function pinOf(type: string, id: string, dir: 'in' | 'out'): PinDef | undefined {
  const def = getNodeDef(type);
  return (dir === 'in' ? def?.inputs : def?.outputs)?.find((p) => p.id === id);
}

function compatible(a?: PinDef, b?: PinDef): boolean {
  if (!a || !b) return false;
  if (a.kind === 'exec' || b.kind === 'exec') return a.kind === b.kind;
  if (a.kind === 'any' || b.kind === 'any' || a.kind === b.kind) return true;
  // A text output can name an entity; otherwise entities only connect to entities.
  if (a.kind === 'entity' || b.kind === 'entity') return a.kind === 'string' && b.kind === 'entity';
  return true; // number / text / boolean convert freely
}

function Canvas({ graph }: { graph: GraphData }) {
  const theme = useUi((s) => s.theme);
  const flow = useReactFlow();
  const toNodes = (g: GraphData): Node<NodeData>[] => {
    const connected = new Map<string, string[]>();
    for (const e of g.edges) connected.set(e.target, [...(connected.get(e.target) ?? []), e.targetHandle]);
    return g.nodes.map((n) => ({ id: n.id, type: 'graph', position: n.position, data: { type: n.type, values: n.data, connected: connected.get(n.id) ?? [], graphId: g.id } }));
  };
  const [nodes, setNodes] = useState(() => toNodes(graph));
  // Re-sync when the stored graph changes (undo, AI edits, inline values) — keep local selection.
  useEffect(() => {
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return toNodes(graph).map((n) => ({ ...n, selected: selected.has(n.id) }));
    });
  }, [graph]);
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const src = graph.nodes.find((n) => n.id === e.source);
        const pin = src && pinOf(src.type, e.sourceHandle, 'out');
        const exec = pin?.kind === 'exec';
        return { id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle, animated: exec, style: { stroke: PIN_COLOR[pin?.kind ?? 'any'], strokeWidth: exec ? 2.5 : 2 } };
      }),
    [graph],
  );

  const onNodesChange = (changes: NodeChange<Node<NodeData>>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    if (removed.length)
      updateGraph(graph.id, (g) => {
        g.nodes = g.nodes.filter((n) => !removed.includes(n.id));
        g.edges = g.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target));
      }, 'Delete nodes');
  };

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    updateGraph(graph.id, (g) => {
      const targetPin = pinOf(g.nodes.find((n) => n.id === c.target)!.type, c.targetHandle!, 'in');
      // Data inputs accept one connection; replace the old one.
      if (targetPin?.kind !== 'exec') g.edges = g.edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle));
      g.edges.push({ id: uid('ed_'), source: c.source!, sourceHandle: c.sourceHandle!, target: c.target!, targetHandle: c.targetHandle! });
    }, 'Connect');
  };

  const isValidConnection = (c: Connection | Edge) => {
    if (c.source === c.target) return false;
    const s = graph.nodes.find((n) => n.id === c.source);
    const t = graph.nodes.find((n) => n.id === c.target);
    return !!s && !!t && compatible(pinOf(s.type, c.sourceHandle ?? '', 'out'), pinOf(t.type, c.targetHandle ?? '', 'in'));
  };

  const addAt = (type: string, x: number, y: number) => {
    const pos = flow.screenToFlowPosition({ x, y });
    updateGraph(graph.id, (g) => void g.nodes.push({ id: uid('n_'), type, position: { x: pos.x, y: pos.y }, data: {} }), 'Add node');
  };

  return (
    <div
      className="vs-canvas"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const type = e.dataTransfer.getData('application/x-bazi-node');
        if (type) addAt(type, e.clientX, e.clientY);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesDelete={(deleted) => updateGraph(graph.id, (g) => void (g.edges = g.edges.filter((e) => !deleted.some((d) => d.id === e.id))), 'Disconnect')}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={(_e, _n, dragged) =>
          updateGraph(graph.id, (g) => {
            for (const d of dragged) {
              const n = g.nodes.find((x) => x.id === d.id);
              if (n) n.position = { x: Math.round(d.position.x), y: Math.round(d.position.y) };
            }
          }, 'Move nodes')
        }
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        deleteKeyCode={['Delete', 'Backspace']}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="hide-phone" style={{ width: 140, height: 90 }} nodeColor={(n) => CATEGORY_COLOR[getNodeDef((n.data as NodeData).type)?.category ?? 'Flow']} />
      </ReactFlow>
      <PaletteAdd onAdd={(type) => {
        const r = document.querySelector('.vs-canvas')!.getBoundingClientRect();
        addAt(type, r.left + r.width / 2 - 80, r.top + r.height / 2 - 40);
      }} />
    </div>
  );
}

let addFromPalette: ((type: string) => void) | null = null;
function PaletteAdd({ onAdd }: { onAdd(type: string): void }) {
  useEffect(() => {
    addFromPalette = onAdd;
    return () => void (addFromPalette = null);
  });
  return null;
}

function Palette() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  return (
    <div className="vs-palette">
      <input className="input" placeholder="Search nodes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 4 }} aria-label="Search nodes" />
      {NODE_CATEGORIES.map((cat) => {
        const list = NODES.filter((n) => n.category === cat && (!query || n.title.toLowerCase().includes(query) || n.description.toLowerCase().includes(query)));
        if (!list.length) return null;
        return (
          <div key={cat}>
            <div className="menu-label" style={{ color: CATEGORY_COLOR[cat] }}>{cat}</div>
            {list.map((n) => (
              <button
                key={n.type}
                className="menu-item"
                draggable
                title={n.description}
                onDragStart={(e) => e.dataTransfer.setData('application/x-bazi-node', n.type)}
                onClick={() => addFromPalette?.(n.type)}
              >
                {n.title}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Node-graph editor for one visual script (opened as a document tab). */
export default function LogicEditor({ id }: { id: string }) {
  const graph = useEditor((s) => s.project?.graphs.find((g) => g.id === id));
  if (!graph)
    return (
      <div className="empty">
        <p>Visual scripts let you build game logic by connecting blocks — no code needed.</p>
        <button className="btn primary" onClick={() => newGraph('Game Logic', editor().selection[0])}>
          <Icon name="Plus" size={14} /> Create visual script
        </button>
      </div>
    );
  return (
    <div className="col" style={{ height: '100%', gap: 0 }}>
      <div className="row" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
        <span className="doc-title"><Icon name="Workflow" size={14} /> {graph.name}</span>
        <span className="faint hide-phone" style={{ fontSize: 12 }}>Drag from a ▶ pin to chain actions. Click or drag nodes from the left. Delete with Backspace.</span>
      </div>
      <div className="vs-wrap" style={{ flex: 1, minHeight: 0 }}>
        <Palette />
        <ReactFlowProvider>
          <Canvas key={graph.id} graph={graph} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
