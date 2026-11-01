import { describe, expect, it } from 'vitest';
import {
  AnimatorInstance,
  applyTerrainBrush,
  createAnimator,
  decodeHeights,
  encodeHeights,
  floodCells,
  flatHeights,
  originShift,
  paintCells,
  sampleTrack,
  trimGrid,
  parseGrid,
  worldToCell,
  type AnimatorData,
} from '../src/core';

describe('tilemap painting', () => {
  it('paints inside the grid', () => {
    expect(paintCells('...\n...', [[1, 1]], '#').map).toBe('...\n.#.');
  });
  it('grows right and down', () => {
    const r = paintCells('.', [[2, 1]], '#');
    expect(r.map).toBe('...\n..#');
    expect(r.shiftCols).toBe(0);
  });
  it('grows left/top and reports the shift so tiles stay put', () => {
    const r = paintCells('#', [[-2, -1]], 'G');
    expect(r.shiftCols).toBe(2);
    expect(r.shiftRows).toBe(1);
    expect(r.map).toBe('G..\n..#');
    expect(originShift([0, 0, 0], 2, 1, 1, true)).toEqual([-2, 1, 0]);
    expect(originShift([0, 0, 0], 2, 1, 1, false)).toEqual([-2, 0, -1]);
  });
  it('erasing outside does not grow the grid', () => {
    expect(paintCells('#', [[5, 5]], '.').map).toBe('#');
  });
  it('flood fills a connected region only', () => {
    const cells = floodCells('..#..\n..#..', 0, 0);
    expect(cells).toHaveLength(4);
  });
  it('trims empty borders', () => {
    const { grid } = trimGrid(parseGrid('....\n.##.\n....'));
    expect(grid.map((r) => r.join(''))).toEqual(['##']);
  });
  it('maps world to cells for 2D and 3D', () => {
    expect(worldToCell([3.2, -1.9, 0], [0, 0, 0], 1, true)).toEqual([3, 2]);
    expect(worldToCell([3.2, 0, 1.9], [0, 0, 0], 1, false)).toEqual([3, 2]);
  });
});

describe('terrain', () => {
  it('round-trips heights', () => {
    const levels = decodeHeights(flatHeights(8), 8);
    expect(levels).toHaveLength(81);
    expect(decodeHeights(encodeHeights(levels), 8)).toEqual(levels);
  });
  it('raise lifts the centre more than the edge and smooth levels it', () => {
    const levels = decodeHeights('', 16);
    applyTerrainBrush(levels, 16, 'raise', 0.5, 0.5, 0.25, 40);
    const centre = levels[8 * 17 + 8];
    expect(centre).toBeGreaterThan(64);
    expect(levels[8 * 17 + 11]).toBeLessThan(centre);
    applyTerrainBrush(levels, 16, 'smooth', 0.5, 0.5, 0.25, 40);
    expect(levels[8 * 17 + 8]).toBeLessThan(centre);
  });
});

describe('animator', () => {
  const make = (): AnimatorData => {
    const a = createAnimator('Hero');
    const idle = a.clips[0];
    idle.duration = 1;
    idle.tracks.push({ id: 't1', target: 'position.x', keys: [{ t: 0, v: 0, ease: 'linear' }, { t: 1, v: 10, ease: 'linear' }] });
    const run = { id: 'run', name: 'Run', loop: true, duration: 1, tracks: [{ id: 't2', target: 'position.x', keys: [{ t: 0, v: 100 }] }] };
    a.clips.push(run);
    a.states.push({ id: 'st_run', name: 'Run', clip: 'run', modelClip: 'Run', speed: 1, x: 0, y: 0 });
    a.params.push({ name: 'speed', type: 'float' }, { name: 'jump', type: 'trigger' });
    a.transitions.push({ id: 'tr', from: a.entry, to: 'st_run', duration: 0.5, exitTime: false, conditions: [{ param: 'speed', op: '>', value: 0.1 }] });
    return a;
  };
  it('samples linear keys', () => {
    const a = make();
    expect(sampleTrack(a.clips[0].tracks[0], 0.5)).toBeCloseTo(5);
  });
  it('plays, transitions on a parameter, and cross-fades', () => {
    const inst = new AnimatorInstance(make());
    const vars: Record<string, unknown> = { speed: 0 };
    expect(inst.update(0.5, vars).pose['position.x']).toBeCloseTo(5);
    vars.speed = 1;
    const f1 = inst.update(0.25, vars);
    expect(f1.entered).toBe('st_run');
    expect(f1.modelClip).toEqual({ name: 'Run', fade: 0.5 });
    const mid = inst.update(0.25, vars).pose['position.x'] as number;
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(100);
    const end = inst.update(1, vars).pose['position.x'];
    expect(end).toBe(100);
  });
  it('consumes triggers', () => {
    const a = make();
    a.transitions.push({ id: 'j', from: 'st_run', to: a.entry, duration: 0, exitTime: false, conditions: [{ param: 'jump', op: '==', value: 1 }] });
    const inst = new AnimatorInstance(a);
    const vars: Record<string, unknown> = { speed: 1, jump: false };
    inst.update(0.1, vars);
    expect(inst.state).toBe('st_run');
    vars.jump = true;
    inst.update(0.1, vars);
    expect(inst.state).toBe(a.entry);
    expect(vars.jump).toBe(false);
  });
});
