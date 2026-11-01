import * as THREE from 'three';
import { prop } from '../components/registry';
import { decodeHeights, levelToHeight, flatHeights } from '../project/terrain';
import { NavMesh, type OffMeshLink } from '../systems/navmesh';
import type { GameObject } from './GameObject';

const MAX_CELLS = 256 * 256;
const SQRT2 = Math.SQRT2;
const WALKABLE_TAGS = ['ground', 'floor', 'walkable', 'road'];

export interface NavBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Binary min-heap keyed by f-score. */
class Heap {
  private items: number[] = [];
  constructor(private score: Float32Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[n]]) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top;
  }
}

/**
 * Pure grid pathfinder (no three.js scene knowledge) — 8-directional A* with
 * octile heuristic, no corner cutting, and line-of-sight path smoothing.
 * Coordinates are on the ground plane: (x, y) = XZ in 3D, XY in 2D.
 */
export class GridPathfinder {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  readonly cellSize: number;

  constructor(
    readonly bounds: NavBounds,
    cellSize: number,
  ) {
    let size = cellSize;
    let cols = Math.ceil((bounds.maxX - bounds.minX) / size);
    let rows = Math.ceil((bounds.maxY - bounds.minY) / size);
    while (cols * rows > MAX_CELLS) {
      size *= 1.5;
      cols = Math.ceil((bounds.maxX - bounds.minX) / size);
      rows = Math.ceil((bounds.maxY - bounds.minY) / size);
    }
    this.cellSize = size;
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  /** The same walkable area as a merged-rectangle navigation mesh (any-angle paths, links, layers). */
  toNavMesh(links: OffMeshLink[] = []): NavMesh {
    return NavMesh.fromGrid(this.cols, this.rows, this.cellSize, [this.bounds.minX, this.bounds.minY], this.blocked, links);
  }

  cellOf(x: number, y: number): [number, number] {
    return [Math.floor((x - this.bounds.minX) / this.cellSize), Math.floor((y - this.bounds.minY) / this.cellSize)];
  }

  center(c: number, r: number): [number, number] {
    return [this.bounds.minX + (c + 0.5) * this.cellSize, this.bounds.minY + (r + 0.5) * this.cellSize];
  }

  inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  isBlocked(c: number, r: number): boolean {
    return !this.inside(c, r) || this.blocked[r * this.cols + c] === 1;
  }

  /** Mark an axis-aligned rectangle (world units), grown by `pad`. */
  blockRect(minX: number, minY: number, maxX: number, maxY: number, pad = 0): void {
    const [c0, r0] = this.cellOf(minX - pad, minY - pad);
    const [c1, r1] = this.cellOf(maxX + pad - 1e-6, maxY + pad - 1e-6);
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) this.blocked[r * this.cols + c] = 1;
  }

  /** Nearest walkable cell (spiral search). */
  private nearestOpen(c: number, r: number): [number, number] | null {
    if (!this.isBlocked(c, r)) return [c, r];
    for (let radius = 1; radius < 24; radius++)
      for (let dr = -radius; dr <= radius; dr++)
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          if (!this.isBlocked(c + dc, r + dr)) return [c + dc, r + dr];
        }
    return null;
  }

  private lineOfSight(a: [number, number], b: [number, number]): boolean {
    let [x0, y0] = a;
    const [x1, y1] = b;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (this.isBlocked(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      // Don't squeeze diagonally between two blocked cells.
      if (e2 > -dy && e2 < dx && this.isBlocked(x0 - sx, y0) && this.isBlocked(x0, y0 - sy)) return false;
    }
  }

  /** Returns waypoints (world ground coords) from start to goal, or null. */
  find(sx: number, sy: number, gx: number, gy: number): [number, number][] | null {
    const s0 = this.cellOf(sx, sy);
    const start = this.nearestOpen(...s0);
    const goal = this.nearestOpen(...this.cellOf(gx, gy));
    if (!start || !goal) return null;
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const f = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const idx = (c: number, r: number) => r * this.cols + c;
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - goal[0]);
      const dy = Math.abs(r - goal[1]);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    const heap = new Heap(f);
    const si = idx(...start);
    g[si] = 0;
    f[si] = h(...start);
    heap.push(si);
    const goalIndex = idx(...goal);
    let found = false;
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      if (cur === goalIndex) {
        found = true;
        break;
      }
      closed[cur] = 1;
      if (++expanded > n) break;
      const c = cur % this.cols;
      const r = (cur / this.cols) | 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (this.isBlocked(nc, nr)) continue;
          if (dc && dr && (this.isBlocked(c + dc, r) || this.isBlocked(c, r + dr))) continue;
          const ni = idx(nc, nr);
          if (closed[ni]) continue;
          const cost = g[cur] + (dc && dr ? SQRT2 : 1);
          if (cost < g[ni]) {
            g[ni] = cost;
            f[ni] = cost + h(nc, nr);
            came[ni] = cur;
            heap.push(ni);
          }
        }
    }
    if (!found) return null;
    const cells: [number, number][] = [];
    for (let i = goalIndex; i !== -1; i = came[i]) cells.push([i % this.cols, (i / this.cols) | 0]);
    cells.reverse();
    // String-pull: keep only the corners we can't see past.
    const smooth: [number, number][] = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.lineOfSight(cells[anchor], cells[i])) {
        smooth.push(cells[i - 1]);
        anchor = i - 1;
      }
    }
    if (cells.length > 1) smooth.push(cells[cells.length - 1]);
    const points = smooth.map(([c, r]) => this.center(c, r));
    points[points.length - 1] = [gx, gy];
    if (start[0] === s0[0] && start[1] === s0[1]) points[0] = [sx, sy];
    return points;
  }
}

const _box = new THREE.Box3();
/** Steepest slope (degrees) agents can walk on terrain. */
const MAX_SLOPE_DEG = 40;

/** Height sampler for a Terrain entity (world space; ignores rotation). */
function terrainSampler(go: GameObject): { bounds: [number, number, number, number]; height(x: number, z: number): number } | null {
  const c = go.getComponent('Terrain');
  if (!c) return null;
  const res = Math.max(8, Math.min(128, Math.round(prop<number>(c, 'resolution'))));
  const size = prop<number>(c, 'size');
  const h = prop<number>(c, 'height');
  const levels = decodeHeights(prop<string>(c, 'heights') || flatHeights(res), res);
  const p = go.object3d.getWorldPosition(new THREE.Vector3());
  const sc = go.object3d.getWorldScale(new THREE.Vector3());
  const half = (size * sc.x) / 2;
  const halfZ = (size * sc.z) / 2;
  return {
    bounds: [p.x - half, p.z - halfZ, p.x + half, p.z + halfZ],
    height(x, z) {
      const u = Math.max(0, Math.min(1, (x - p.x) / (size * sc.x) + 0.5)) * res;
      const v = Math.max(0, Math.min(1, (z - p.z) / (size * sc.z) + 0.5)) * res;
      const i0 = Math.min(res - 1, Math.floor(u));
      const j0 = Math.min(res - 1, Math.floor(v));
      const fu = u - i0;
      const fv = v - j0;
      const n = res + 1;
      const a = levels[j0 * n + i0] * (1 - fu) + levels[j0 * n + i0 + 1] * fu;
      const b = levels[(j0 + 1) * n + i0] * (1 - fu) + levels[(j0 + 1) * n + i0 + 1] * fu;
      return p.y + levelToHeight(a * (1 - fv) + b * fv, h) * sc.y;
    },
  };
}

/**
 * Builds a pathfinding grid from the live scene: static, solid colliders
 * become obstacles (except walkable floors). Rebuilt lazily when the world
 * changes (e.g. a building is placed).
 */
export class NavGrid {
  private grid: GridPathfinder | null = null;
  private dirty = true;

  constructor(
    private entities: () => Iterable<GameObject>,
    private mode2d: boolean,
    private cellSize: number,
  ) {}

  markDirty(): void {
    this.dirty = true;
  }

  private isObstacle(go: GameObject): boolean {
    const c = go.getComponent('Collider');
    if (!c || prop<boolean>(c, 'isTrigger')) return false;
    const rb = go.getComponent('RigidBody');
    if (rb && prop<string>(rb, 'bodyType') === 'dynamic') return false;
    const unit = go.getComponent('UnitAI');
    if (go.getComponent('NavAgent') || (unit && prop<number>(unit, 'speed') > 0)) return false;
    if (WALKABLE_TAGS.some((t) => go.hasTag(t))) return false;
    return true;
  }

  private obstacleRect(go: GameObject): [number, number, number, number] | null {
    _box.setFromObject(go.object3d, true);
    if (_box.isEmpty()) return null;
    if (this.mode2d) return [_box.min.x, _box.min.y, _box.max.x, _box.max.y];
    // 3D: ignore flat floors (anything whose top is at ground level).
    if (_box.max.y < 0.15) return null;
    return [_box.min.x, _box.min.z, _box.max.x, _box.max.z];
  }

  private rebuild(): GridPathfinder {
    const rects: [number, number, number, number][] = [];
    const terrains: NonNullable<ReturnType<typeof terrainSampler>>[] = [];
    const bounds: NavBounds = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
    for (const go of this.entities()) {
      if (!go.alive) continue;
      _box.setFromObject(go.object3d, true);
      if (!_box.isEmpty() && go.getComponent('Collider')) {
        const [x0, y0, x1, y1] = this.mode2d ? [_box.min.x, _box.min.y, _box.max.x, _box.max.y] : [_box.min.x, _box.min.z, _box.max.x, _box.max.z];
        bounds.minX = Math.min(bounds.minX, x0 - 2);
        bounds.minY = Math.min(bounds.minY, y0 - 2);
        bounds.maxX = Math.max(bounds.maxX, x1 + 2);
        bounds.maxY = Math.max(bounds.maxY, y1 + 2);
      }
      const t = this.mode2d ? null : terrainSampler(go);
      if (t) {
        terrains.push(t);
        bounds.minX = Math.min(bounds.minX, t.bounds[0]);
        bounds.minY = Math.min(bounds.minY, t.bounds[1]);
        bounds.maxX = Math.max(bounds.maxX, t.bounds[2]);
        bounds.maxY = Math.max(bounds.maxY, t.bounds[3]);
      }
      if (!this.isObstacle(go)) continue;
      const rect = this.obstacleRect(go);
      if (rect) rects.push(rect);
    }
    // Clamp absurd worlds so the grid stays fast.
    for (const k of ['minX', 'minY'] as const) bounds[k] = Math.max(bounds[k], -200);
    for (const k of ['maxX', 'maxY'] as const) bounds[k] = Math.min(bounds[k], 200);
    const grid = new GridPathfinder(bounds, this.cellSize);
    // Large footprints are floors/arenas, never obstacles.
    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    for (const r of rects) if ((r[2] - r[0]) * (r[3] - r[1]) < area * 0.25) grid.blockRect(...r, this.cellSize * 0.3);
    // Terrain: cells steeper than MAX_SLOPE_DEG are not walkable.
    const maxRise = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);
    for (const t of terrains) {
      for (let r = 0; r < grid.rows; r++)
        for (let c = 0; c < grid.cols; c++) {
          const [x, z] = grid.center(c, r);
          if (x < t.bounds[0] || x > t.bounds[2] || z < t.bounds[1] || z > t.bounds[3]) continue;
          const d = grid.cellSize / 2;
          const slope = Math.max(Math.abs(t.height(x + d, z) - t.height(x - d, z)), Math.abs(t.height(x, z + d) - t.height(x, z - d))) / grid.cellSize;
          if (slope > maxRise) grid.blocked[r * grid.cols + c] = 1;
        }
    }
    this.dirty = false;
    return grid;
  }

  get pathfinder(): GridPathfinder {
    if (this.dirty || !this.grid) this.grid = this.rebuild();
    return this.grid;
  }

  /** World-space path between two points (y/z of the plane preserved from `from`). */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const g = this.pathfinder;
    const pts = this.mode2d ? g.find(from.x, from.y, to.x, to.y) : g.find(from.x, from.z, to.x, to.z);
    if (!pts) return null;
    return pts.map(([a, b]) => (this.mode2d ? new THREE.Vector3(a, b, from.z) : new THREE.Vector3(a, from.y, b)));
  }

  isWalkable(p: THREE.Vector3): boolean {
    const g = this.pathfinder;
    const [c, r] = this.mode2d ? g.cellOf(p.x, p.y) : g.cellOf(p.x, p.z);
    return !g.isBlocked(c, r);
  }
}
