import { describe, expect, it } from 'vitest';
import { NavMesh, type Vec2 } from '../src/core';

const rect = (x0: number, y0: number, x1: number, y1: number, extra = {}) => ({ verts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Vec2[], ...extra });

describe('NavMesh', () => {
  it('walks straight inside a single polygon', () => {
    const mesh = new NavMesh([rect(0, 0, 10, 10)]);
    expect(mesh.find([1, 1], [9, 9])).toEqual([[1, 1], [9, 9]]);
  });

  it('pulls the path tight around a corner (funnel), not through polygon centres', () => {
    // An L-shaped corridor: east then north.
    const mesh = new NavMesh([rect(0, 0, 10, 2), rect(8, 2, 10, 10)]);
    const path = mesh.find([0.5, 1], [9, 9.5])!;
    expect(path[0]).toEqual([0.5, 1]);
    expect(path[path.length - 1]).toEqual([9, 9.5]);
    // The only bend is at the inner corner (8, 2).
    expect(path).toHaveLength(3);
    expect(path[1][0]).toBeCloseTo(8);
    expect(path[1][1]).toBeCloseTo(2);
  });

  it('returns null when regions are disconnected, and routes through links when present', () => {
    const polys = [rect(0, 0, 4, 4), rect(10, 0, 14, 4)];
    expect(new NavMesh(polys).find([1, 1], [12, 1])).toBeNull();
    const linked = new NavMesh(polys, [{ from: [3, 2], to: [11, 2] }]);
    const path = linked.find([1, 1], [12, 1])!;
    expect(path).toContainEqual([3, 2]);
    expect(path).toContainEqual([11, 2]);
  });

  it('honours one-way links', () => {
    const mesh = new NavMesh([rect(0, 0, 4, 4), rect(10, 0, 14, 4)], [{ from: [3, 2], to: [11, 2], bidirectional: false }]);
    expect(mesh.find([1, 1], [12, 1])).not.toBeNull();
    expect(mesh.find([12, 1], [1, 1])).toBeNull();
  });

  it('connects floors only through links (layers)', () => {
    const mesh = new NavMesh([rect(0, 0, 4, 4, { layer: 0 }), rect(0, 0, 4, 4, { layer: 1 })], [{ from: [2, 2], to: [2, 2], fromLayer: 0, toLayer: 1 }]);
    expect(mesh.find([1, 1], [3, 3], { startLayer: 0, goalLayer: 1 })).not.toBeNull();
    expect(new NavMesh([rect(0, 0, 4, 4, { layer: 0 }), rect(0, 0, 4, 4, { layer: 1 })]).find([1, 1], [3, 3], { startLayer: 0, goalLayer: 1 })).toBeNull();
  });

  it('prefers cheaper terrain when it is a reasonable detour', () => {
    // Two parallel lanes from west to east: a muddy short one (cost 10) and a clean one.
    const mesh = new NavMesh([
      rect(0, 0, 2, 4), // start hall
      rect(2, 0, 8, 1, { cost: 10 }), // mud lane
      rect(2, 3, 8, 4), // clean lane
      rect(8, 0, 10, 4), // end hall
    ]);
    const path = mesh.find([1, 2], [9, 2])!;
    expect(path.some((p) => p[1] > 2.5)).toBe(true);
  });

  it('snaps off-mesh start and goal onto the mesh', () => {
    const mesh = new NavMesh([rect(0, 0, 10, 10)]);
    const path = mesh.find([-5, 5], [15, 5])!;
    expect(path[0]).toEqual([0, 5]);
    expect(path[path.length - 1]).toEqual([10, 5]);
  });

  it('builds from a blocked grid, merges cells into few rectangles and routes around walls', () => {
    const cols = 10;
    const rows = 10;
    const blocked = new Uint8Array(cols * rows);
    for (let r = 0; r < 8; r++) blocked[r * cols + 5] = 1; // wall with a gap at the bottom rows 8..9
    const mesh = NavMesh.fromGrid(cols, rows, 1, [0, 0], blocked);
    expect(mesh.polygonCount).toBeLessThan(10);
    const path = mesh.find([1.5, 1.5], [8.5, 1.5])!;
    expect(path).not.toBeNull();
    expect(path.some((p) => p[1] >= 8)).toBe(true); // had to go through the gap
    expect(mesh.pathLength(path)).toBeGreaterThan(7);
    expect(mesh.isWalkable([5.5, 3])).toBe(false);
    expect(mesh.raycast([1.5, 1.5], [4.5, 1.5])).toBe(true);
    expect(mesh.raycast([1.5, 1.5], [8.5, 1.5])).toBe(false);
  });

  it('rejects degenerate polygons', () => {
    expect(() => new NavMesh([{ verts: [[0, 0], [1, 1]] }])).toThrow();
  });
});
