import {
  TRACK_TARGETS,
  createClip,
  defaultKeyValue,
  sampleClip,
  sampleTrack,
  setKey,
  uid,
  type AnimClip,
  type AnimCondition,
  type AnimKey,
  type AnimParamType,
  type AnimTrack,
  type AnimTransition,
  type AnimatorData,
} from '@bazi/engine';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { newAnimator, updateAnimator } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { useUi } from '../../store/ui';
import { Icon } from '../../ui/Icon';
import { useSession } from '../session';

type Selection = { kind: 'state'; id: string } | { kind: 'transition'; id: string } | null;

interface StateNodeData extends Record<string, unknown> {
  name: string;
  clip: string;
  entry: boolean;
  any?: boolean;
  active?: boolean;
}

const StateNode = memo(function StateNode({ data, selected }: NodeProps<Node<StateNodeData>>) {
  return (
    <div className={`anim-state ${selected ? 'selected' : ''} ${data.entry ? 'entry' : ''} ${data.any ? 'any' : ''}`}>
      {!data.any && <Handle type="target" position={Position.Left} />}
      <div className="anim-state-name">{data.entry && <Icon name="Play" size={11} />} {data.name}</div>
      {!data.any && <div className="anim-state-clip faint">{data.clip || 'no clip'}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const nodeTypes = { state: StateNode };

const ANY = 'any';

const conditionText = (t: AnimTransition) => (t.conditions.map((c) => `${c.param} ${c.op} ${c.value}`).join(' & ') || (t.exitTime ? 'when finished' : 'always')) + (t.exitTime && t.conditions.length ? ' (after finish)' : '');

function StateMachine({ data, selection, onSelect }: { data: AnimatorData; selection: Selection; onSelect(s: Selection): void }) {
  const theme = useUi((s) => s.theme);
  const toNodes = (): Node<StateNodeData>[] => [
    { id: ANY, type: 'state', position: { x: -180, y: 20 }, draggable: false, deletable: false, data: { name: 'Any State', clip: '', entry: false, any: true } },
    ...data.states.map((s) => ({
      id: s.id,
      type: 'state',
      position: { x: s.x, y: s.y },
      selected: selection?.kind === 'state' && selection.id === s.id,
      data: { name: s.name, clip: data.clips.find((c) => c.id === s.clip)?.name ?? s.modelClip, entry: data.entry === s.id },
    })),
  ];
  const [nodes, setNodes] = useState(toNodes);
  useEffect(() => setNodes(toNodes()), [data, selection]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges: Edge[] = useMemo(
    () =>
      data.transitions.map((t) => ({
        id: t.id,
        source: t.from,
        target: t.to,
        label: conditionText(t),
        selected: selection?.kind === 'transition' && selection.id === t.id,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2 },
        labelStyle: { fontSize: 10.5 },
      })),
    [data, selection],
  );
  const onNodesChange = (changes: NodeChange<Node<StateNodeData>>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    if (removed.length)
      updateAnimator(data.id, (a) => {
        a.states = a.states.filter((s) => !removed.includes(s.id));
        a.transitions = a.transitions.filter((t) => !removed.includes(t.from) && !removed.includes(t.to));
        if (!a.states.some((s) => s.id === a.entry)) a.entry = a.states[0]?.id ?? '';
      }, 'Delete state');
  };
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.target === ANY) return;
    const t: AnimTransition = { id: uid('tr_'), from: c.source, to: c.target, duration: 0.2, exitTime: false, conditions: [] };
    updateAnimator(data.id, (a) => void a.transitions.push(t), 'Add transition');
    onSelect({ kind: 'transition', id: t.id });
  };
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onNodeClick={(_e, n) => n.id !== ANY && onSelect({ kind: 'state', id: n.id })}
      onEdgeClick={(_e, ed) => onSelect({ kind: 'transition', id: ed.id })}
      onPaneClick={() => onSelect(null)}
      onEdgesDelete={(deleted) => updateAnimator(data.id, (a) => void (a.transitions = a.transitions.filter((t) => !deleted.some((d) => d.id === t.id))), 'Delete transition')}
      onNodeDragStop={(_e, _n, dragged) =>
        updateAnimator(data.id, (a) => {
          for (const d of dragged) {
            const s = a.states.find((x) => x.id === d.id);
            if (s) {
              s.x = Math.round(d.position.x);
              s.y = Math.round(d.position.y);
            }
          }
        }, 'Move states')
      }
      colorMode={theme}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      deleteKeyCode={['Delete', 'Backspace']}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

// ───────────────────────── timeline
const PX = 120; // pixels per second at zoom 1

function Timeline({ data, clip }: { data: AnimatorData; clip: AnimClip }) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pick, setPick] = useState<{ track: string; index: number } | null>(null);
  const [preview, setPreview] = useState(false);
  const px = PX * zoom;
  const width = Math.max(300, clip.duration * px + 60);
  const edit = (recipe: (c: AnimClip) => void, label = 'Edit clip', key?: string) =>
    updateAnimator(data.id, (a) => {
      const c = a.clips.find((x) => x.id === clip.id);
      if (c) recipe(c);
    }, label, key);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const n = t + dt;
        if (n < clip.duration) return n;
        if (clip.loop) return n % Math.max(0.01, clip.duration);
        setPlaying(false);
        return clip.duration;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clip.duration, clip.loop]);

  // Optional live preview: scrub the selected entity in the scene view (editor only, never saved).
  const selection = useEditor((s) => s.selection);
  useEffect(() => {
    if (!preview) return;
    const rt = useSession.getState().editRuntime;
    const go = rt && selection.length === 1 ? rt.getObject(selection[0]) : undefined;
    if (!go) return;
    const pose = sampleClip(clip, time);
    for (const [target, value] of Object.entries(pose)) {
      const [group, axis] = target.split('.');
      const key = axis as 'x' | 'y' | 'z';
      const n = Number(value);
      if (group === 'position') go.object3d.position[key] = n;
      else if (group === 'rotation') go.object3d.rotation[key] = (n * Math.PI) / 180;
      else if (group === 'scale') go.object3d.scale[key] = n;
    }
  }, [preview, time, clip, selection]);
  useEffect(
    () => () => {
      // Leaving preview restores the saved transform.
      const rt = useSession.getState().editRuntime;
      const id = editor().selection[0];
      if (preview && rt && id) rt.getObject(id)?.applyTransform();
    },
    [preview],
  );

  const x = (t: number) => 8 + t * px;
  const timeAt = (clientX: number, el: HTMLElement) => Math.max(0, Math.min(clip.duration, (clientX - el.getBoundingClientRect().left - 8) / px));
  const snap = (t: number) => Math.round(t * 20) / 20;
  const used = new Set(clip.tracks.map((t) => t.target));
  const selTrack = pick && clip.tracks.find((t) => t.id === pick.track);
  const selKey = selTrack && selTrack.keys[pick!.index];
  const ticks = Array.from({ length: Math.floor(clip.duration) + 1 }, (_, i) => i);

  const addKey = (track: AnimTrack, t: number) => {
    const current = sampleTrack(track, t);
    edit((c) => {
      const tr = c.tracks.find((x) => x.id === track.id);
      if (tr) setKey(tr, { t: snap(t), v: current ?? defaultKeyValue(tr.target), ease: 'smooth' });
    }, 'Add keyframe');
  };

  return (
    <div className="anim-timeline">
      <div className="row anim-tl-bar">
        <button className="btn sm icon" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'Pause' : 'Play'} size={13} />
        </button>
        <button className="btn sm icon" onClick={() => (setPlaying(false), setTime(0))} aria-label="Back to start"><Icon name="RotateCcw" size={13} /></button>
        <span className="mono faint" style={{ minWidth: 70 }}>{time.toFixed(2)} / {clip.duration.toFixed(2)}s</span>
        <select
          className="select"
          style={{ width: 150 }}
          value=""
          aria-label="Add track"
          onChange={(e) => {
            let target = e.target.value;
            if (target === '__vars') {
              const name = window.prompt('Script variable to animate (self.vars.<name>)', 'speed')?.trim();
              if (!name) return;
              target = `vars.${name}`;
            }
            if (!target || used.has(target)) return;
            edit((c) => void c.tracks.push({ id: uid('tk_'), target, keys: [{ t: 0, v: defaultKeyValue(target), ease: 'smooth' }] }), 'Add track');
          }}
        >
          <option value="">+ Add track…</option>
          {TRACK_TARGETS.filter((t) => !used.has(t)).map((t) => <option key={t} value={t}>{t}</option>)}
          <option value="__vars">vars.&lt;name&gt;…</option>
        </select>
        <label className="row" style={{ gap: 4, fontSize: 12 }}>
          Length
          <input className="input" type="number" min={0.1} step={0.1} style={{ width: 62 }} value={clip.duration} onChange={(e) => edit((c) => void (c.duration = Math.max(0.1, Number(e.target.value) || 1)), 'Clip length', `dur:${clip.id}`)} />
        </label>
        <label className="row" style={{ gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={clip.loop} onChange={(e) => edit((c) => void (c.loop = e.target.checked), 'Clip loop')} /> Loop
        </label>
        <label className="row hide-phone" style={{ gap: 4, fontSize: 12 }} title="Move the selected object in the scene view while scrubbing (editor only)">
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview on selection
        </label>
        <span className="grow" />
        <input type="range" min={0.4} max={4} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Timeline zoom" style={{ width: 80 }} />
      </div>
      <div className="anim-tl-body">
        <div className="anim-tl-names">
          <div className="anim-tl-ruler-spacer" />
          {clip.tracks.map((t) => (
            <div key={t.id} className="anim-tl-name">
              <span className="truncate grow mono">{t.target}</span>
              <button className="btn sm ghost icon" aria-label={`Remove track ${t.target}`} onClick={() => edit((c) => void (c.tracks = c.tracks.filter((x) => x.id !== t.id)), 'Remove track')}>
                <Icon name="X" size={11} />
              </button>
            </div>
          ))}
          {!clip.tracks.length && <div className="faint" style={{ padding: 8, fontSize: 12 }}>No tracks yet. Add one above, then double-click the lane to add keyframes.</div>}
        </div>
        <div className="anim-tl-lanes">
          <div style={{ width, position: 'relative' }}>
            <div
              className="anim-tl-ruler"
              onPointerDown={(e) => {
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                setPlaying(false);
                setTime(snap(timeAt(e.clientX, el)));
              }}
              onPointerMove={(e) => e.buttons & 1 && setTime(snap(timeAt(e.clientX, e.currentTarget)))}
            >
              {ticks.map((s) => <span key={s} style={{ left: x(s) }}>{s}s</span>)}
            </div>
            {clip.tracks.map((t) => (
              <div
                key={t.id}
                className="anim-tl-lane"
                onDoubleClick={(e) => addKey(t, snap(timeAt(e.clientX, e.currentTarget)))}
              >
                {t.keys.map((k, i) => {
                  const active = pick?.track === t.id && pick.index === i;
                  return (
                    <button
                      key={i}
                      className={`anim-key ${active ? 'active' : ''}`}
                      style={{ left: x(k.t) }}
                      aria-label={`Keyframe at ${k.t}s`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setPick({ track: t.id, index: i });
                        const lane = e.currentTarget.parentElement!;
                        const el = e.currentTarget;
                        el.setPointerCapture(e.pointerId);
                        const move = (ev: PointerEvent) => {
                          const nt = snap(timeAt(ev.clientX, lane));
                          edit((c) => {
                            const tr = c.tracks.find((q) => q.id === t.id);
                            if (!tr || !tr.keys[i]) return;
                            tr.keys[i].t = nt;
                          }, 'Move keyframe', `mv:${t.id}:${i}`);
                        };
                        const up = () => {
                          el.removeEventListener('pointermove', move);
                          el.removeEventListener('pointerup', up);
                          // Keep keys sorted and unique after a drag.
                          edit((c) => {
                            const tr = c.tracks.find((q) => q.id === t.id);
                            if (!tr) return;
                            const moved = tr.keys[i];
                            tr.keys.sort((a, b) => a.t - b.t);
                            tr.keys = tr.keys.filter((q, n, arr) => q === moved || n === 0 || Math.abs(q.t - arr[n - 1].t) > 1e-4);
                            setPick({ track: t.id, index: Math.max(0, tr.keys.indexOf(moved)) });
                          }, 'Move keyframe', `mv:${t.id}:${i}`);
                        };
                        el.addEventListener('pointermove', move);
                        el.addEventListener('pointerup', up);
                      }}
                    >
                      <Icon name="Diamond" size={12} />
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="anim-playhead" style={{ left: x(time) }} />
          </div>
        </div>
      </div>
      {selTrack && selKey && (
        <div className="row anim-key-edit">
          <span className="mono faint">{selTrack.target}</span>
          <label className="row" style={{ gap: 4 }}>Time
            <input className="input" type="number" step={0.05} min={0} max={clip.duration} style={{ width: 70 }} value={selKey.t} onChange={(e) => edit((c) => {
              const k = c.tracks.find((q) => q.id === selTrack.id)?.keys[pick!.index];
              if (k) k.t = Math.max(0, Math.min(clip.duration, Number(e.target.value) || 0));
            }, 'Edit keyframe', `kt:${selTrack.id}:${pick!.index}`)} />
          </label>
          <label className="row" style={{ gap: 4 }}>Value
            {selTrack.target === 'color' ? (
              <input type="color" value={String(selKey.v)} onChange={(e) => edit((c) => {
                const k = c.tracks.find((q) => q.id === selTrack.id)?.keys[pick!.index];
                if (k) k.v = e.target.value;
              }, 'Edit keyframe', `kv:${selTrack.id}:${pick!.index}`)} />
            ) : (
              <input className="input" type="number" step={0.1} style={{ width: 80 }} value={Number(selKey.v)} onChange={(e) => edit((c) => {
                const k = c.tracks.find((q) => q.id === selTrack.id)?.keys[pick!.index];
                if (k) k.v = Number(e.target.value) || 0;
              }, 'Edit keyframe', `kv:${selTrack.id}:${pick!.index}`)} />
            )}
          </label>
          <label className="row" style={{ gap: 4 }}>Easing
            <select className="select" value={selKey.ease ?? 'smooth'} onChange={(e) => edit((c) => {
              const k = c.tracks.find((q) => q.id === selTrack.id)?.keys[pick!.index];
              if (k) k.ease = e.target.value as AnimKey['ease'];
            }, 'Edit keyframe')}>
              <option value="smooth">smooth</option>
              <option value="linear">linear</option>
              <option value="step">step</option>
            </select>
          </label>
          <button className="btn sm danger" onClick={() => (edit((c) => {
            const tr = c.tracks.find((q) => q.id === selTrack.id);
            if (tr && tr.keys.length > 1) tr.keys.splice(pick!.index, 1);
          }, 'Delete keyframe'), setPick(null))} disabled={selTrack.keys.length <= 1}>
            <Icon name="Trash" size={12} /> Delete key
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── side panels
function Sidebar({ data, clipId, setClipId, selection }: { data: AnimatorData; clipId: string; setClipId(id: string): void; selection: Selection }) {
  const set = (recipe: (a: AnimatorData) => void, label: string, key?: string) => updateAnimator(data.id, recipe, label, key);
  const state = selection?.kind === 'state' ? data.states.find((s) => s.id === selection.id) : undefined;
  const transition = selection?.kind === 'transition' ? data.transitions.find((t) => t.id === selection.id) : undefined;
  const setT = (recipe: (t: AnimTransition) => void, label = 'Edit transition', key?: string) =>
    set((a) => {
      const t = a.transitions.find((x) => x.id === transition?.id);
      if (t) recipe(t);
    }, label, key);
  return (
    <div className="anim-side">
      <div className="section-title" style={{ cursor: 'default' }}>Parameters</div>
      <div className="section-content">
        {data.params.map((p, i) => (
          <div className="row" key={i} style={{ gap: 4 }}>
            <input className="input grow" value={p.name} aria-label="Parameter name" onChange={(e) => set((a) => void (a.params[i].name = e.target.value.replace(/\s/g, '_')), 'Rename parameter', `pn:${data.id}:${i}`)} />
            <select className="select" value={p.type} onChange={(e) => set((a) => void (a.params[i].type = e.target.value as AnimParamType), 'Parameter type')}>
              <option value="float">float</option>
              <option value="bool">bool</option>
              <option value="trigger">trigger</option>
            </select>
            <button className="btn sm ghost icon" aria-label="Remove parameter" onClick={() => set((a) => void a.params.splice(i, 1), 'Remove parameter')}><Icon name="X" size={11} /></button>
          </div>
        ))}
        <button className="btn sm" onClick={() => set((a) => void a.params.push({ name: `param${a.params.length + 1}`, type: 'float' }), 'Add parameter')}><Icon name="Plus" size={12} /> Parameter</button>
        <div className="faint" style={{ fontSize: 11.5 }}>Set from code: <span className="mono">self.vars.speed = 3</span></div>
      </div>

      <div className="section-title" style={{ cursor: 'default' }}>Clips</div>
      <div className="section-content">
        {data.clips.map((c) => (
          <div className="row" key={c.id} style={{ gap: 4 }}>
            <button className={`btn sm grow ${clipId === c.id ? 'primary' : ''}`} style={{ justifyContent: 'flex-start' }} onClick={() => setClipId(c.id)}>{c.name}</button>
            <button className="btn sm ghost icon" aria-label={`Delete clip ${c.name}`} disabled={data.clips.length <= 1} onClick={() => set((a) => {
              a.clips = a.clips.filter((x) => x.id !== c.id);
              for (const s of a.states) if (s.clip === c.id) s.clip = '';
              if (clipId === c.id) setClipId(a.clips[0].id);
            }, 'Delete clip')}><Icon name="X" size={11} /></button>
          </div>
        ))}
        <div className="row" style={{ gap: 4 }}>
          <input className="input grow" aria-label="Clip name" value={data.clips.find((c) => c.id === clipId)?.name ?? ''} onChange={(e) => set((a) => {
            const c = a.clips.find((x) => x.id === clipId);
            if (c) c.name = e.target.value;
          }, 'Rename clip', `cn:${clipId}`)} />
          <button className="btn sm" onClick={() => {
            const c = createClip(`Clip ${data.clips.length + 1}`);
            set((a) => void a.clips.push(c), 'Add clip');
            setClipId(c.id);
          }}><Icon name="Plus" size={12} /> Clip</button>
        </div>
      </div>

      {state && (
        <>
          <div className="section-title" style={{ cursor: 'default' }}>State “{state.name}”</div>
          <div className="section-content">
            <input className="input" value={state.name} aria-label="State name" onChange={(e) => set((a) => void (a.states.find((s) => s.id === state.id)!.name = e.target.value), 'Rename state', `sn:${state.id}`)} />
            <label className="prop"><span className="prop-label">Clip</span>
              <select className="select" value={state.clip} onChange={(e) => {
                set((a) => void (a.states.find((s) => s.id === state.id)!.clip = e.target.value), 'Set state clip');
                if (e.target.value) setClipId(e.target.value);
              }}>
                <option value="">(none)</option>
                {data.clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="prop"><span className="prop-label">3D clip</span>
              <input className="input" placeholder="glTF clip name, e.g. Run" value={state.modelClip} onChange={(e) => set((a) => void (a.states.find((s) => s.id === state.id)!.modelClip = e.target.value), 'Set model clip', `mc:${state.id}`)} />
            </label>
            <label className="prop"><span className="prop-label">Speed</span>
              <input className="input" type="number" step={0.1} value={state.speed} onChange={(e) => set((a) => void (a.states.find((s) => s.id === state.id)!.speed = Number(e.target.value) || 0), 'State speed', `ss:${state.id}`)} />
            </label>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" disabled={data.entry === state.id} onClick={() => set((a) => void (a.entry = state.id), 'Set entry state')}><Icon name="Play" size={12} /> Make entry</button>
              <button className="btn sm danger" disabled={data.states.length <= 1} onClick={() => set((a) => {
                a.states = a.states.filter((s) => s.id !== state.id);
                a.transitions = a.transitions.filter((t) => t.from !== state.id && t.to !== state.id);
                if (a.entry === state.id) a.entry = a.states[0].id;
              }, 'Delete state')}><Icon name="Trash" size={12} /> Delete</button>
            </div>
          </div>
        </>
      )}

      {transition && (
        <>
          <div className="section-title" style={{ cursor: 'default' }}>Transition</div>
          <div className="section-content">
            <div className="faint" style={{ fontSize: 12 }}>
              {transition.from === ANY ? 'Any State' : data.states.find((s) => s.id === transition.from)?.name} → {data.states.find((s) => s.id === transition.to)?.name}
            </div>
            <label className="prop"><span className="prop-label">Blend (s)</span>
              <input className="input" type="number" min={0} step={0.05} value={transition.duration} onChange={(e) => setT((t) => void (t.duration = Math.max(0, Number(e.target.value) || 0)), 'Transition blend', `td:${transition.id}`)} />
            </label>
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={transition.exitTime} onChange={(e) => setT((t) => void (t.exitTime = e.target.checked))} /> Wait for the clip to finish
            </label>
            {transition.conditions.map((c, i) => (
              <div className="row" key={i} style={{ gap: 3 }}>
                <select className="select grow" value={c.param} aria-label="Condition parameter" onChange={(e) => setT((t) => void (t.conditions[i].param = e.target.value))}>
                  {!data.params.some((p) => p.name === c.param) && <option value={c.param}>{c.param || '(pick)'}</option>}
                  {data.params.map((p) => <option key={p.name}>{p.name}</option>)}
                </select>
                <select className="select" value={c.op} aria-label="Condition operator" onChange={(e) => setT((t) => void (t.conditions[i].op = e.target.value as AnimCondition['op']))}>
                  {['>', '<', '==', '!='].map((o) => <option key={o}>{o}</option>)}
                </select>
                <input className="input" type="number" step={0.1} style={{ width: 54 }} aria-label="Condition value" value={c.value} onChange={(e) => setT((t) => void (t.conditions[i].value = Number(e.target.value) || 0), 'Edit condition', `cv:${transition.id}:${i}`)} />
                <button className="btn sm ghost icon" aria-label="Remove condition" onClick={() => setT((t) => void t.conditions.splice(i, 1))}><Icon name="X" size={11} /></button>
              </div>
            ))}
            <button className="btn sm" disabled={!data.params.length} title={data.params.length ? '' : 'Add a parameter first'} onClick={() => setT((t) => void t.conditions.push({ param: data.params[0].name, op: data.params[0].type === 'float' ? '>' : '==', value: data.params[0].type === 'float' ? 0.1 : 1 }), 'Add condition')}>
              <Icon name="Plus" size={12} /> Condition
            </button>
            <button className="btn sm danger" onClick={() => set((a) => void (a.transitions = a.transitions.filter((t) => t.id !== transition.id)), 'Delete transition')}><Icon name="Trash" size={12} /> Delete</button>
          </div>
        </>
      )}
      {!state && !transition && <div className="faint" style={{ padding: 10, fontSize: 12 }}>Click a state or an arrow to edit it. Drag from a state’s right dot to another to make a transition.</div>}
    </div>
  );
}

/** Animation controller editor: state machine on top, keyframe timeline below. Opened as a document tab. */
export default function AnimationEditor({ id }: { id: string }) {
  const data = useEditor((s) => s.project?.animators?.find((a) => a.id === id));
  const [selection, setSelection] = useState<Selection>(null);
  const [clipId, setClipId] = useState('');
  const first = useRef(false);
  useEffect(() => {
    if (data && (!clipId || !data.clips.some((c) => c.id === clipId))) setClipId(data.clips[0]?.id ?? '');
    first.current = true;
  }, [data, clipId]);
  if (!data)
    return (
      <div className="empty">
        <p>Animation controllers blend keyframe clips and 3D animations with a state machine.</p>
        <button className="btn primary" onClick={() => newAnimator('Animator', editor().selection[0])}><Icon name="Plus" size={14} /> Create animator</button>
      </div>
    );
  const clip = data.clips.find((c) => c.id === clipId) ?? data.clips[0];
  return (
    <div className="col" style={{ height: '100%', gap: 0 }}>
      <div className="row" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', gap: 6 }}>
        <span className="doc-title"><Icon name="Clapperboard" size={14} /> {data.name}</span>
        <button className="btn sm" onClick={() => {
          const n = data.states.length;
          const st = { id: uid('st_'), name: `State ${n + 1}`, clip: clip?.id ?? '', modelClip: '', speed: 1, x: 80 + (n % 3) * 190, y: 80 + Math.floor(n / 3) * 90 };
          updateAnimator(data.id, (a) => void a.states.push(st), 'Add state');
          setSelection({ kind: 'state', id: st.id });
        }}><Icon name="Plus" size={12} /> State</button>
        <span className="faint hide-phone" style={{ fontSize: 12 }}>Attach it with an Animator component. Parameters are read from <span className="mono">self.vars</span>.</span>
      </div>
      <div className="anim-wrap">
        <div className="anim-main">
          <div className="anim-graph">
            <ReactFlowProvider>
              <StateMachine key={data.id} data={data} selection={selection} onSelect={setSelection} />
            </ReactFlowProvider>
          </div>
          {clip ? <Timeline key={clip.id} data={data} clip={clip} /> : <div className="empty">Add a clip to start keyframing.</div>}
        </div>
        <Sidebar data={data} clipId={clip?.id ?? ''} setClipId={setClipId} selection={selection} />
      </div>
    </div>
  );
}
