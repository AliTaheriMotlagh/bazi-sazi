/**
 * Node-based shader graph → GLSL. Compiles to the body of
 *   vec4 shade(vec2 uv, vec3 normal, vec3 viewDir, vec3 worldPos)
 * (see runtime/shaders.ts), so a graph plugs into the same material path as presets and hand-written code.
 * Pure: type-checks the graph, rejects cycles, and only ever emits numbers from `params` (no string injection).
 */

export type GlslType = 'float' | 'vec2' | 'vec3' | 'vec4';

export interface ShaderGraphNode {
  id: string;
  type: string;
  params?: Record<string, number | number[]>;
  /** Input name → id of the node feeding it. */
  inputs?: Record<string, string>;
}

export interface ShaderGraph {
  nodes: ShaderGraphNode[];
  /** Id of the node whose value becomes the fragment colour (vec3 or vec4). */
  output: string;
}

export interface ShaderNodeDef {
  label: string;
  inputs: Record<string, GlslType | 'any'>;
  output: GlslType | 'same';
  params?: Record<string, number | number[]>;
  /** Builds the GLSL expression from already-typed input expressions and numeric params. */
  expr: (i: Record<string, string>, p: Record<string, number | number[]>) => string;
}

export interface ShaderCompileResult {
  ok: boolean;
  body: string;
  errors: string[];
}

const num = (n: number) => (Number.isFinite(n) ? (Number.isInteger(n) ? n.toFixed(1) : String(+n.toFixed(6))) : '0.0');
const vec = (type: GlslType, v: number | number[] | undefined, fallback: number[]) => {
  const arr = Array.isArray(v) ? v : fallback;
  return `${type}(${arr.map((x) => num(Number(x))).join(', ')})`;
};

const binary = (op: string): ShaderNodeDef => ({ label: op, inputs: { a: 'any', b: 'any' }, output: 'same', expr: (i) => `(${i.a} ${op} ${i.b})` });
const unary = (fn: string): ShaderNodeDef => ({ label: fn, inputs: { x: 'any' }, output: 'same', expr: (i) => `${fn}(${i.x})` });

export const SHADER_NODES: Record<string, ShaderNodeDef> = {
  Float: { label: 'Number', inputs: {}, output: 'float', params: { value: 0 }, expr: (_i, p) => num(Number(p.value)) },
  Vec2: { label: 'Vector 2', inputs: {}, output: 'vec2', params: { value: [0, 0] }, expr: (_i, p) => vec('vec2', p.value, [0, 0]) },
  Vec3: { label: 'Color / Vector 3', inputs: {}, output: 'vec3', params: { value: [1, 1, 1] }, expr: (_i, p) => vec('vec3', p.value, [1, 1, 1]) },
  UV: { label: 'UV', inputs: {}, output: 'vec2', expr: () => 'uv' },
  Normal: { label: 'Normal', inputs: {}, output: 'vec3', expr: () => 'normal' },
  ViewDir: { label: 'View direction', inputs: {}, output: 'vec3', expr: () => 'viewDir' },
  WorldPos: { label: 'World position', inputs: {}, output: 'vec3', expr: () => 'worldPos' },
  Time: { label: 'Time', inputs: {}, output: 'float', expr: () => 'uTime' },
  Speed: { label: 'Speed', inputs: {}, output: 'float', expr: () => 'uSpeed' },
  Intensity: { label: 'Intensity', inputs: {}, output: 'float', expr: () => 'uIntensity' },
  Color: { label: 'Color 1', inputs: {}, output: 'vec3', expr: () => 'uColor' },
  Color2: { label: 'Color 2', inputs: {}, output: 'vec3', expr: () => 'uColor2' },
  Add: binary('+'),
  Subtract: binary('-'),
  Multiply: binary('*'),
  Divide: { label: '/', inputs: { a: 'any', b: 'any' }, output: 'same', expr: (i) => `(${i.a} / max(${i.b}, 1e-5))` },
  Sin: unary('sin'),
  Cos: unary('cos'),
  Abs: unary('abs'),
  Fract: unary('fract'),
  Floor: unary('floor'),
  Sqrt: { label: 'sqrt', inputs: { x: 'any' }, output: 'same', expr: (i) => `sqrt(max(${i.x}, 0.0))` },
  Saturate: { label: 'Saturate', inputs: { x: 'any' }, output: 'same', expr: (i) => `clamp(${i.x}, 0.0, 1.0)` },
  Power: { label: 'Power', inputs: { x: 'any' }, output: 'same', params: { exponent: 2 }, expr: (i, p) => `pow(max(${i.x}, 0.0), ${num(Number(p.exponent))})` },
  Mix: { label: 'Mix', inputs: { a: 'any', b: 'any', t: 'float' }, output: 'same', expr: (i) => `mix(${i.a}, ${i.b}, ${i.t})` },
  Smoothstep: { label: 'Smoothstep', inputs: { x: 'float' }, output: 'float', params: { edge0: 0, edge1: 1 }, expr: (i, p) => `smoothstep(${num(Number(p.edge0))}, ${num(Number(p.edge1))}, ${i.x})` },
  Step: { label: 'Step', inputs: { x: 'float' }, output: 'float', params: { edge: 0.5 }, expr: (i, p) => `step(${num(Number(p.edge))}, ${i.x})` },
  Dot: { label: 'Dot', inputs: { a: 'vec3', b: 'vec3' }, output: 'float', expr: (i) => `dot(${i.a}, ${i.b})` },
  Fresnel: { label: 'Fresnel', inputs: {}, output: 'float', params: { power: 3 }, expr: (_i, p) => `pow(1.0 - max(dot(normal, viewDir), 0.0), ${num(Number(p.power))})` },
  Noise: { label: 'Noise', inputs: { p: 'vec2' }, output: 'float', params: { scale: 24 }, expr: (i, p) => `fract(sin(dot(floor(${i.p} * ${num(Number(p.scale))}), vec2(12.9898, 78.233))) * 43758.5453)` },
  SplitX: { label: 'X', inputs: { v: 'any' }, output: 'float', expr: (i) => `${i.v}.x` },
  SplitY: { label: 'Y', inputs: { v: 'any' }, output: 'float', expr: (i) => `${i.v}.y` },
  Combine3: { label: 'Combine (x,y,z)', inputs: { x: 'float', y: 'float', z: 'float' }, output: 'vec3', expr: (i) => `vec3(${i.x}, ${i.y}, ${i.z})` },
  Output: { label: 'Output', inputs: { color: 'vec3', alpha: 'float' }, output: 'vec4', expr: (i) => `vec4(${i.color}, ${i.alpha})` },
};

const RANK: Record<GlslType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

/** Defaults for an Output node's optional inputs. */
const OPTIONAL: Record<string, string> = { alpha: '1.0' };

export function compileShaderGraph(graph: ShaderGraph): ShaderCompileResult {
  const errors: string[] = [];
  const byId = new Map<string, ShaderGraphNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.id)) errors.push(`Duplicate node id "${n.id}".`);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(n.id)) errors.push(`Invalid node id "${n.id}".`);
    if (!SHADER_NODES[n.type]) errors.push(`Unknown node type "${n.type}" (node ${n.id}).`);
    byId.set(n.id, n);
  }
  if (!byId.has(graph.output)) errors.push(`Output node "${graph.output}" does not exist.`);
  if (errors.length) return { ok: false, body: '', errors };

  const names = new Map<string, string>();
  const types = new Map<string, GlslType>();
  const lines: string[] = [];
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (names.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Cycle detected at node "${id}".`);
      return;
    }
    visiting.add(id);
    const node = byId.get(id)!;
    const def = SHADER_NODES[node.type];
    const inputs: Record<string, string> = {};
    let widest: GlslType | null = null;
    for (const [pin, want] of Object.entries(def.inputs)) {
      const source = node.inputs?.[pin];
      if (!source) {
        if (OPTIONAL[pin]) inputs[pin] = OPTIONAL[pin];
        else errors.push(`${node.type} "${id}" is missing input "${pin}".`);
        continue;
      }
      if (!byId.has(source)) {
        errors.push(`${node.type} "${id}" input "${pin}" points at missing node "${source}".`);
        continue;
      }
      visit(source);
      const have = types.get(source);
      const expr = names.get(source);
      if (!have || !expr) continue;
      if (want === 'any') {
        widest = !widest || RANK[have] > RANK[widest] ? have : widest;
        inputs[pin] = expr;
      } else if (have === want) inputs[pin] = expr;
      else if (have === 'float' && want !== 'float') inputs[pin] = `${want}(${expr})`; // scalar broadcast
      else if (want === 'vec3' && have === 'vec4') inputs[pin] = `${expr}.xyz`;
      else errors.push(`${node.type} "${id}" input "${pin}" wants ${want} but got ${have}.`);
    }
    visiting.delete(id);
    if (errors.length) return;
    // "any" inputs combine as the widest type; floats broadcast, other mismatches are an error.
    if (widest) {
      for (const [pin, want] of Object.entries(def.inputs)) {
        if (want !== 'any' || !node.inputs?.[pin]) continue;
        const have = types.get(node.inputs[pin])!;
        if (have === widest) continue;
        if (have === 'float') inputs[pin] = `${widest}(${inputs[pin]})`;
        else errors.push(`${node.type} "${id}" mixes ${have} with ${widest}.`);
      }
    }
    if (errors.length) return;
    const params = { ...(def.params ?? {}), ...(node.params ?? {}) };
    const out: GlslType = def.output === 'same' ? (widest ?? 'float') : def.output;
    const name = `n_${names.size}`;
    // Leaf constants are inlined; computed values get a named temporary.
    const expr = def.expr(inputs, params);
    if (Object.keys(def.inputs).length === 0) names.set(id, expr);
    else {
      lines.push(`${out} ${name} = ${expr};`);
      names.set(id, name);
    }
    types.set(id, out);
  };

  visit(graph.output);
  if (errors.length) return { ok: false, body: '', errors };
  const type = types.get(graph.output)!;
  const result = names.get(graph.output)!;
  if (type === 'vec4') lines.push(`return ${result};`);
  else if (type === 'vec3') lines.push(`return vec4(${result}, 1.0);`);
  else if (type === 'float') lines.push(`return vec4(vec3(${result}), 1.0);`);
  else return { ok: false, body: '', errors: [`The output must be a color (vec3/vec4) or a number, not ${type}.`] };
  return { ok: true, body: lines.join('\n'), errors: [] };
}

/** Parse the JSON stored in a Shader component's `graph` field. Returns null for anything malformed. */
export function parseShaderGraph(json: string): ShaderGraph | null {
  try {
    const g = JSON.parse(json) as ShaderGraph;
    if (!g || !Array.isArray(g.nodes) || typeof g.output !== 'string') return null;
    return g;
  } catch {
    return null;
  }
}

/** A small starting graph: animated colour mix with a fresnel rim. */
export const DEFAULT_SHADER_GRAPH: ShaderGraph = {
  output: 'out',
  nodes: [
    { id: 'time', type: 'Time' },
    { id: 'speed', type: 'Speed' },
    { id: 'tspeed', type: 'Multiply', inputs: { a: 'time', b: 'speed' } },
    { id: 'wave', type: 'Sin', inputs: { x: 'tspeed' } },
    { id: 'half', type: 'Float', params: { value: 0.5 } },
    { id: 'wave01', type: 'Add', inputs: { a: 'half', b: 'wave2' } },
    { id: 'wave2', type: 'Multiply', inputs: { a: 'wave', b: 'half' } },
    { id: 'c1', type: 'Color' },
    { id: 'c2', type: 'Color2' },
    { id: 'mix', type: 'Mix', inputs: { a: 'c1', b: 'c2', t: 'wave01' } },
    { id: 'rim', type: 'Fresnel' },
    { id: 'rimMix', type: 'Mix', inputs: { a: 'mix', b: 'c2', t: 'rim' } },
    { id: 'out', type: 'Output', inputs: { color: 'rimMix' } },
  ],
};

export { RANK as SHADER_TYPE_RANK };
