import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  compileScript,
  createComponent,
  createEntity,
  createProject,
  createScript,
  validateProject,
  summarizeProject,
  GameObject,
  type GameApi,
  type GraphData,
} from '../src';
import { createGraphBehaviour } from '../src/visual/interpreter';

function fakeApi(): GameApi {
  const vars: Record<string, unknown> = {};
  const timers: (() => void)[] = [];
  return {
    vars,
    time: { elapsed: 0, dt: 1 / 60, frame: 0, scale: 1 },
    input: { pressed: () => false, released: () => false, isDown: () => false, axis: () => 0 },
    audio: { play: () => ({ stop() {}, setVolume() {} }), sfx() {} },
    net: null,
    hud: { set() {}, remove() {}, message() {} },
    mode: '2d',
    camera: null,
    find: () => undefined,
    findAll: () => [],
    after: (_s: number, fn: () => void) => {
      timers.push(fn);
      return () => {};
    },
    log() {},
    __flush: () => timers.splice(0).forEach((t) => t()),
  } as unknown as GameApi;
}

function fakeObject(): GameObject {
  const runtime = { physics: null, mode2d: true, log() {} } as never;
  return new GameObject(runtime, createEntity({ name: 'Hero' }));
}

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`${t.name} builds without errors`, () => {
      const project = t.build();
      const errors = validateProject(project).filter((p) => p.severity === 'error');
      expect(errors).toEqual([]);
      expect(project.settings.mode).toBe(t.mode);
      // Must be JSON round-trippable (it's stored and published as JSON).
      expect(JSON.parse(JSON.stringify(project))).toEqual(project);
    });
  }
});

describe('components', () => {
  it('fills defaults and keeps overrides', () => {
    const c = createComponent('Mesh', { color: '#ff0000' });
    expect(c.shape).toBe('box');
    expect(c.color).toBe('#ff0000');
  });
});

describe('scripting', () => {
  it('compiles hooks from JavaScript', () => {
    const { factory, error } = compileScript({ language: 'javascript', code: 'let n = 0; function update(dt) { n += dt; self.vars.n = n; }' });
    expect(error).toBeNull();
    const self = { vars: {} as Record<string, number> };
    const inst = factory!({ self });
    inst.update!(0.5);
    inst.update!(0.25);
    expect(self.vars.n).toBe(0.75);
  });

  it('strips TypeScript types', () => {
    const { error } = compileScript({ language: 'typescript', code: 'export function start(): void { const x: number = 1; }' });
    expect(error).toBeNull();
  });

  it('reports syntax errors and the validator surfaces them', () => {
    expect(compileScript({ language: 'javascript', code: 'function (' }).error).toBeTruthy();
    const p = createProject('Broken', '2d');
    p.scripts.push({ ...createScript('Bad'), code: 'function start( {' });
    expect(validateProject(p).some((x) => x.severity === 'error' && x.scriptId === p.scripts[0].id)).toBe(true);
  });
});

describe('validation', () => {
  it('flags missing references', () => {
    const p = createProject('Refs', '3d');
    p.scenes[0].entities.push(
      createEntity({ name: 'A', components: [createComponent('Script', { script: 'nope' }), createComponent('RigidBody')] }),
    );
    const msgs = validateProject(p).map((x) => x.message);
    expect(msgs.some((m) => m.includes('does not exist'))).toBe(true);
    expect(msgs.some((m) => m.includes('needs a Collider'))).toBe(true);
  });

  it('summarizes compactly for the AI', () => {
    const p = TEMPLATES.find((t) => t.id === 'platformer')!.build();
    const s = summarizeProject(p, p.settings.startScene) as { currentScene: { entities: { components: Record<string, unknown>[] }[] } };
    const player = s.currentScene.entities.find((e) => (e as unknown as { name: string }).name === 'Player')!;
    expect(player.components.find((c) => c.type === 'PlatformerController')).toEqual({ type: 'PlatformerController', airJumps: 1 });
  });
});

describe('visual scripting', () => {
  const graph = (nodes: GraphData['nodes'], edges: GraphData['edges']): GraphData => ({ id: 'g', name: 'Test', nodes, edges });

  it('runs exec chains and evaluates data pins', () => {
    const api = fakeApi();
    const g = graph(
      [
        { id: 'start', type: 'event.start', position: { x: 0, y: 0 }, data: {} },
        { id: 'num', type: 'math.op', position: { x: 0, y: 0 }, data: { op: '×', a: 4, b: 5 } },
        { id: 'add', type: 'var.add', position: { x: 0, y: 0 }, data: { name: 'score' } },
        { id: 'branch', type: 'flow.branch', position: { x: 0, y: 0 }, data: {} },
        { id: 'cmp', type: 'math.compare', position: { x: 0, y: 0 }, data: { op: '>' } },
        { id: 'get', type: 'var.get', position: { x: 0, y: 0 }, data: { name: 'score' } },
        { id: 'set', type: 'var.set', position: { x: 0, y: 0 }, data: { name: 'big', value: true } },
      ],
      [
        { id: 'e1', source: 'start', sourceHandle: 'out', target: 'add', targetHandle: 'in' },
        { id: 'e2', source: 'num', sourceHandle: 'result', target: 'add', targetHandle: 'amount' },
        { id: 'e3', source: 'add', sourceHandle: 'out', target: 'branch', targetHandle: 'in' },
        { id: 'e4', source: 'get', sourceHandle: 'value', target: 'cmp', targetHandle: 'a' },
        { id: 'e5', source: 'cmp', sourceHandle: 'result', target: 'branch', targetHandle: 'condition' },
        { id: 'e6', source: 'branch', sourceHandle: 'true', target: 'set', targetHandle: 'in' },
      ],
    );
    const b = createGraphBehaviour(g, fakeObject(), api);
    b.start!();
    expect(api.vars.score).toBe(20);
    expect(api.vars.big).toBe(true);
  });

  it('supports loops, delays and stops runaway graphs', () => {
    const api = fakeApi();
    const g = graph(
      [
        { id: 's', type: 'event.start', position: { x: 0, y: 0 }, data: {} },
        { id: 'loop', type: 'flow.forLoop', position: { x: 0, y: 0 }, data: { count: 3 } },
        { id: 'add', type: 'var.add', position: { x: 0, y: 0 }, data: { name: 'n', amount: 1 } },
        { id: 'wait', type: 'flow.delay', position: { x: 0, y: 0 }, data: { seconds: 1 } },
        { id: 'done', type: 'var.set', position: { x: 0, y: 0 }, data: { name: 'done', value: 'yes' } },
      ],
      [
        { id: 'a', source: 's', sourceHandle: 'out', target: 'loop', targetHandle: 'in' },
        { id: 'b', source: 'loop', sourceHandle: 'body', target: 'add', targetHandle: 'in' },
        { id: 'c', source: 'loop', sourceHandle: 'done', target: 'wait', targetHandle: 'in' },
        { id: 'd', source: 'wait', sourceHandle: 'out', target: 'done', targetHandle: 'in' },
      ],
    );
    const b = createGraphBehaviour(g, fakeObject(), api);
    b.start!();
    expect(api.vars.n).toBe(3);
    expect(api.vars.done).toBeUndefined();
    (api as unknown as { __flush(): void }).__flush();
    expect(api.vars.done).toBe('yes');
  });

  it('filters collision events by tag', () => {
    const api = fakeApi();
    const g = graph(
      [
        { id: 'hit', type: 'event.collision', position: { x: 0, y: 0 }, data: { tag: 'coin' } },
        { id: 'add', type: 'var.add', position: { x: 0, y: 0 }, data: { name: 'coins', amount: 1 } },
      ],
      [{ id: 'a', source: 'hit', sourceHandle: 'out', target: 'add', targetHandle: 'in' }],
    );
    const b = createGraphBehaviour(g, fakeObject(), api);
    const coin = fakeObject().addTag('coin');
    const rock = fakeObject();
    b.onCollision!(coin);
    b.onCollision!(rock);
    expect(api.vars.coins).toBe(1);
  });
});
