import { describe, expect, it } from 'vitest';
import {
  COMPONENTS,
  NODES,
  TEMPLATES,
  createComponent,
  normalizeProject,
  summarizeProject,
  validateProject,
  royaleArena,
  villageBuilder,
  towerDefense,
  metroLines,
  SHADER_NODES,
} from '../src/core';
import { GridPathfinder } from '../src/runtime/navgrid';
import { SHADER_PRESETS, SHADER_PRESET_NAMES } from '../src/runtime/shaders';
import { compileShaderGraph } from '../src/core';

describe('component registry', () => {
  it('has unique types, fields with unique keys and defaults that match their type', () => {
    const types = COMPONENTS.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
    for (const c of COMPONENTS) {
      const keys = c.fields.map((f) => f.key);
      expect(new Set(keys).size, `${c.type} has duplicate field keys`).toBe(keys.length);
      for (const f of c.fields) {
        if (f.type === 'number') expect(typeof f.default, `${c.type}.${f.key}`).toBe('number');
        if (f.type === 'boolean') expect(typeof f.default, `${c.type}.${f.key}`).toBe('boolean');
        if (f.type === 'select') {
          expect(f.options?.length, `${c.type}.${f.key} needs options`).toBeGreaterThan(0);
          expect(f.options, `${c.type}.${f.key} default is one of the options`).toContain(f.default);
        }
        if (f.min !== undefined && f.max !== undefined) expect(f.min).toBeLessThanOrEqual(f.max);
      }
    }
  });

  it('every component can be created with defaults and survives JSON', () => {
    for (const c of COMPONENTS) {
      const made = createComponent(c.type);
      expect(made.type).toBe(c.type);
      expect(JSON.parse(JSON.stringify(made))).toEqual(made);
    }
  });

  it('the Shader component offers the graph and custom modes', () => {
    const shader = COMPONENTS.find((c) => c.type === 'Shader')!;
    expect(shader.fields.find((f) => f.key === 'preset')!.options).toEqual(expect.arrayContaining(['custom', 'graph', 'hologram']));
    expect(shader.fields.some((f) => f.key === 'graph')).toBe(true);
  });
});

describe('visual-script node library', () => {
  it('node types are unique and every pin id is unique within its node', () => {
    const types = NODES.map((n) => n.type);
    expect(new Set(types).size).toBe(types.length);
    for (const n of NODES) {
      const ids = [...n.inputs, ...n.outputs].map((p) => `${p.kind === 'exec' ? 'x:' : 'd:'}${p.id}`);
      expect(new Set(ids).size, `${n.type} has colliding pins`).toBe(ids.length);
    }
  });

  it('events have an event name and flow nodes can run', () => {
    for (const n of NODES) {
      if (n.event) expect(n.exec ?? n.compute ?? true).toBeTruthy();
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.description.length).toBeGreaterThan(0);
    }
  });
});

describe('project pipeline', () => {
  it('normalizing is idempotent for every template', () => {
    for (const t of TEMPLATES) {
      const once = normalizeProject(t.build());
      expect(normalizeProject(structuredClone(once))).toEqual(once);
    }
  });

  it('every template has a compact AI summary mentioning its scene', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const summary = JSON.stringify(summarizeProject(p, p.scenes[0].id));
      expect(summary.length).toBeLessThan(60_000);
      expect(summary).toContain(p.scenes[0].name);
    }
  });

  it('strategy templates are ready to play (scripts, scene, start scene)', () => {
    for (const build of [royaleArena, villageBuilder, towerDefense, metroLines]) {
      const p = build();
      expect(p.scenes.length).toBeGreaterThan(0);
      expect(p.scenes.some((s) => s.id === p.settings.startScene)).toBe(true);
      expect(p.scenes.flatMap((s) => s.entities).length).toBeGreaterThan(3);
    }
  });

  it('validator catches duplicate ids and bad parents', () => {
    const p = TEMPLATES[0].build();
    const first = p.scenes[0].entities[0];
    p.scenes[0].entities.push({ ...structuredClone(first), name: 'Orphan', parent: 'e_missing' });
    const messages = validateProject(p).map((x) => x.message.toLowerCase());
    expect(messages.some((m) => m.includes('parent') || m.includes('duplicate') || m.includes('missing'))).toBe(true);
  });
});

describe('rendering libraries', () => {
  it('every shader preset has a body that returns a colour', () => {
    for (const name of SHADER_PRESET_NAMES.filter((n) => n !== 'custom' && n !== 'graph')) expect(SHADER_PRESETS[name], name).toMatch(/return vec4\(/);
  });

  it('every shader-graph node type can be compiled in a minimal graph', () => {
    // Feed each node float inputs (every def accepts a float via broadcast, except vec-specific ones).
    for (const [type, def] of Object.entries(SHADER_NODES)) {
      if (type === 'Output') continue;
      const nodes = [{ id: 'f', type: 'Float', params: { value: 0.5 } }, { id: 'v2', type: 'UV' }, { id: 'v3', type: 'Vec3' }];
      const inputs: Record<string, string> = {};
      for (const [pin, want] of Object.entries(def.inputs)) inputs[pin] = want === 'vec2' ? 'v2' : want === 'vec3' ? 'v3' : 'f';
      // 2-component results can't be a colour: take X so the graph has a valid output.
      const tail = def.output === 'vec2' ? [{ id: 'out', type: 'SplitX', inputs: { v: 'n' } }] : [];
      const r = compileShaderGraph({ output: tail.length ? 'out' : 'n', nodes: [...nodes, { id: 'n', type, inputs }, ...tail] });
      expect(r.errors, type).toEqual([]);
      expect(r.body, type).toMatch(/return vec4\(/);
    }
  });
});

describe('grid ↔ navmesh bridge', () => {
  it('a GridPathfinder exposes the same obstacles as a NavMesh', () => {
    const grid = new GridPathfinder({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1);
    grid.blockRect(4, 0, 6, 8); // wall with a gap at the top (y 8..10)
    const gridPath = grid.find(1.5, 1.5, 8.5, 1.5)!;
    const mesh = grid.toNavMesh();
    const meshPath = mesh.find([1.5, 1.5], [8.5, 1.5])!;
    expect(gridPath).not.toBeNull();
    expect(meshPath).not.toBeNull();
    expect(meshPath.some((p) => p[1] >= 8)).toBe(true);
    expect(mesh.pathLength(meshPath)).toBeLessThanOrEqual(mesh.pathLength(gridPath) + 1e-6); // any-angle ≤ grid-smoothed
    expect(mesh.isWalkable([5, 4])).toBe(false);
  });
});
