import type { GraphData, GraphNodeData } from '../types';
import type { Behaviour, GameObject } from '../runtime/GameObject';
import type { GameApi } from '../runtime/Runtime';
import { errorMessage } from '../util';
import { getNodeDef, isEntity, type NodeCtx, type NodeDef, type PinDef } from './nodes';

const MAX_STEPS = 5000;
const MAX_DEPTH = 64;

interface Link {
  node: GraphNodeData;
  pin: string;
}

function coerce(pin: PinDef | undefined, value: unknown): unknown {
  if (!pin) return value;
  switch (pin.kind) {
    case 'number':
      return typeof value === 'number' ? value : Number(value) || 0;
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' || (typeof value === 'number' && value !== 0);
    case 'string':
      return value == null ? '' : String(value);
    default:
      return value;
  }
}

/**
 * Executes a visual graph for one entity. Exec pins are pushed (event →
 * action → action), data pins are pulled lazily from their source node.
 */
export class GraphInstance implements Behaviour {
  private nodes = new Map<string, GraphNodeData>();
  /** "target:pin" -> source link (data inputs) */
  private inbound = new Map<string, Link>();
  /** "source:pin" -> targets (exec outputs) */
  private outbound = new Map<string, Link[]>();
  private outputs = new Map<string, Record<string, unknown>>();
  private state = new Map<string, Record<string, unknown>>();
  private events = new Map<string, GraphNodeData[]>();
  private steps = 0;
  private depth = 0;
  private timers = new Map<string, number>();
  private unsubscribers: (() => void)[] = [];
  private broken = false;

  constructor(
    private graph: GraphData,
    private self: GameObject,
    private api: GameApi,
  ) {
    for (const n of graph.nodes) {
      this.nodes.set(n.id, n);
      const def = getNodeDef(n.type);
      if (def?.event) {
        const list = this.events.get(def.event) ?? [];
        list.push(n);
        this.events.set(def.event, list);
      }
    }
    for (const e of graph.edges) {
      const source = this.nodes.get(e.source);
      const target = this.nodes.get(e.target);
      if (!source || !target) continue;
      const sourcePin = getNodeDef(source.type)?.outputs.find((p) => p.id === e.sourceHandle);
      if (sourcePin?.kind === 'exec') {
        const key = `${e.source}:${e.sourceHandle}`;
        const list = this.outbound.get(key) ?? [];
        list.push({ node: target, pin: e.targetHandle });
        this.outbound.set(key, list);
      } else {
        this.inbound.set(`${e.target}:${e.targetHandle}`, { node: source, pin: e.sourceHandle });
      }
    }
  }

  // ───────────── hooks
  start(): void {
    for (const n of this.events.get('netMessage') ?? []) {
      const off = this.api.net?.on(String(n.data.type ?? 'chat'), (data, from) => this.trigger(n, { data, from }));
      if (off) this.unsubscribers.push(off);
    }
    this.dispatch('start');
  }

  update(dt: number): void {
    this.dispatch('update', { dt });
    const input = this.api.input;
    for (const n of this.events.get('actionPressed') ?? []) if (input.pressed(String(n.data.action ?? 'jump'))) this.trigger(n);
    for (const n of this.events.get('actionReleased') ?? []) if (input.released(String(n.data.action ?? 'jump'))) this.trigger(n);
    for (const n of this.events.get('actionHeld') ?? []) if (input.isDown(String(n.data.action ?? 'jump'))) this.trigger(n, { dt });
    for (const n of this.events.get('timer') ?? []) {
      const t = (this.timers.get(n.id) ?? 0) + dt;
      const every = Math.max(0.01, Number(n.data.seconds ?? 1));
      if (t >= every) {
        this.timers.set(n.id, t - every);
        this.trigger(n);
      } else this.timers.set(n.id, t);
    }
  }

  onCollision(other: GameObject): void {
    this.dispatchFiltered('collision', other);
  }

  onTrigger(other: GameObject): void {
    this.dispatchFiltered('trigger', other);
  }

  onMessage(name: string, data: unknown, from: GameObject | null): void {
    for (const n of this.events.get('message') ?? []) if (String(n.data.name ?? 'hello') === name) this.trigger(n, { data, from });
  }

  onClick(): void {
    this.dispatch('click');
  }

  onDestroy(): void {
    this.dispatch('destroy');
    for (const off of this.unsubscribers) off();
  }

  private dispatchFiltered(event: string, other: GameObject): void {
    for (const n of this.events.get(event) ?? []) {
      const tag = String(n.data.tag ?? '');
      if (!tag || other.hasTag(tag)) this.trigger(n, { other });
    }
  }

  private dispatch(event: string, payload: Record<string, unknown> = {}): void {
    for (const n of this.events.get(event) ?? []) this.trigger(n, payload);
  }

  // ───────────── execution
  private trigger(node: GraphNodeData, payload: Record<string, unknown> = {}): void {
    if (this.broken) return;
    this.steps = 0;
    this.outputs.set(node.id, payload);
    this.guard(() => this.run(node.id, 'out'));
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.broken = true;
      this.api.log('error', [`Visual script "${this.graph.name}" stopped: ${errorMessage(err)}`], this.graph.name, this.self.id);
    }
  }

  private run(nodeId: string, pin: string): void {
    for (const link of this.outbound.get(`${nodeId}:${pin}`) ?? []) {
      if (!this.self.alive) return;
      this.execNode(link.node);
    }
  }

  private execNode(node: GraphNodeData): void {
    if (++this.steps > MAX_STEPS) throw new Error('too many steps in one frame (infinite loop?)');
    const def = getNodeDef(node.type);
    if (!def?.exec) return;
    const result = def.exec(this.ctx(node, def));
    if (result === null) return;
    if (result === undefined) return this.run(node.id, 'out');
    if (typeof result === 'string') return this.run(node.id, result);
    this.api.after(result.delay, () => {
      if (!this.self.alive || this.broken) return;
      this.steps = 0;
      this.guard(() => this.run(node.id, result.pin));
    });
  }

  private evaluate(node: GraphNodeData, pinId: string, def: NodeDef): unknown {
    const pin = def.inputs.find((p) => p.id === pinId);
    const link = this.inbound.get(`${node.id}:${pinId}`);
    if (!link) return coerce(pin, node.data[pinId] ?? pin?.default);
    const srcDef = getNodeDef(link.node.type);
    if (!srcDef) return coerce(pin, pin?.default);
    let value: unknown;
    if (srcDef.compute) {
      if (++this.depth > MAX_DEPTH) throw new Error('data connections are too deep (cycle?)');
      try {
        value = srcDef.compute(this.ctx(link.node, srcDef))[link.pin];
      } finally {
        this.depth--;
      }
    } else value = this.outputs.get(link.node.id)?.[link.pin];
    // Entities stay entities regardless of pin coercion.
    return isEntity(value) ? value : coerce(pin, value);
  }

  private ctx(node: GraphNodeData, def: NodeDef): NodeCtx {
    let state = this.state.get(node.id);
    if (!state) this.state.set(node.id, (state = {}));
    const field = <T,>(key: string): T => {
      if (node.data[key] !== undefined) return node.data[key] as T;
      return def.fields?.find((f) => f.id === key)?.default as T;
    };
    return {
      node,
      self: this.self,
      api: this.api,
      state,
      field,
      in: <T,>(pin: string) => this.evaluate(node, pin, def) as T,
      entity: (pin: string) => {
        const v = this.evaluate(node, pin, def);
        if (isEntity(v)) return v.alive ? v : undefined;
        if (typeof v === 'string' && v.trim()) return this.api.find(v.trim());
        return this.inbound.has(`${node.id}:${pin}`) ? undefined : this.self;
      },
      out: (pin, value) => {
        const o = this.outputs.get(node.id) ?? {};
        o[pin] = value;
        this.outputs.set(node.id, o);
      },
      fire: (pin) => this.run(node.id, pin),
    };
  }
}

export function createGraphBehaviour(graph: GraphData, self: GameObject, api: GameApi): Behaviour {
  return new GraphInstance(graph, self, api);
}
