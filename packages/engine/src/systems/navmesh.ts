/**
 * Navigation mesh: convex polygons joined by portals, A* over polygons, "simple stupid funnel"
 * string pulling for straight paths, off-mesh links (jumps, ladders, teleports) and layers
 * (floors). Pure data and maths — no three.js — so it runs in the editor, the player and on a server.
 * Coordinates are on the ground plane: (x, y) = XZ in 3D, XY in 2D.
 */

export type Vec2 = [number, number];

export interface NavPolygonInput {
  /** Convex polygon corners, in order (either winding). */
  verts: Vec2[];
  /** Floor index; polygons only connect to polygons on the same layer (links cross layers). */
  layer?: number;
  /** Travel cost multiplier (e.g. 2 for mud, 1 default). */
  cost?: number;
}

export interface OffMeshLink {
  from: Vec2;
  to: Vec2;
  fromLayer?: number;
  toLayer?: number;
  bidirectional?: boolean;
  /** Extra travel cost multiplier applied to the link length. */
  cost?: number;
}

interface Portal {
  to: number;
  a: Vec2;
  b: Vec2;
}

interface Link {
  to: number;
  from: Vec2;
  dest: Vec2;
  cost: number;
}

interface Poly {
  id: number;
  verts: Vec2[];
  layer: number;
  cost: number;
  centroid: Vec2;
  min: Vec2;
  max: Vec2;
  portals: Portal[];
  links: Link[];
}

export interface NavPathOptions {
  startLayer?: number;
  goalLayer?: number;
}

const EPS = 1e-6;

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

function pointInPolygon(p: Vec2, verts: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < verts.length; i++) {
    const c = cross(verts[i], verts[(i + 1) % verts.length], p);
    if (Math.abs(c) < EPS) continue;
    const s = c > 0 ? 1 : -1;
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + dx * t, a[1] + dy * t];
}

function closestOnPolygon(p: Vec2, verts: Vec2[]): Vec2 {
  if (pointInPolygon(p, verts)) return p;
  let best = verts[0];
  let bestD = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const c = closestOnSegment(p, verts[i], verts[(i + 1) % verts.length]);
    const d = dist(c, p);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Overlapping part of two edges if they are collinear, else null. */
function sharedEdge(p: Vec2, q: Vec2, r: Vec2, s: Vec2): [Vec2, Vec2] | null {
  const len = dist(p, q);
  if (len < EPS) return null;
  if (Math.abs(cross(p, q, r)) / len > 1e-5 || Math.abs(cross(p, q, s)) / len > 1e-5) return null;
  const ux = (q[0] - p[0]) / len;
  const uy = (q[1] - p[1]) / len;
  const along = (v: Vec2) => (v[0] - p[0]) * ux + (v[1] - p[1]) * uy;
  const lo = Math.max(0, Math.min(along(r), along(s)));
  const hi = Math.min(len, Math.max(along(r), along(s)));
  if (hi - lo < 1e-4) return null;
  return [
    [p[0] + ux * lo, p[1] + uy * lo],
    [p[0] + ux * hi, p[1] + uy * hi],
  ];
}

class MinHeap {
  private items: { id: number; f: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(id: number, f: number): void {
    const a = this.items;
    a.push({ id, f });
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (a[p].f <= a[n].f) break;
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
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top.id;
  }
}

/** Funnel algorithm over a list of portals (left/right already oriented along the travel direction). */
function funnel(start: Vec2, goal: Vec2, portals: { left: Vec2; right: Vec2 }[]): Vec2[] {
  const all = [{ left: start, right: start }, ...portals, { left: goal, right: goal }];
  // Positive when c is to the right of a→b (travelling a→b), matching how left/right were assigned.
  const area = (a: Vec2, b: Vec2, c: Vec2) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
  const path: Vec2[] = [start];
  let apex = start;
  let left = start;
  let right = start;
  let leftIdx = 0;
  let rightIdx = 0;
  for (let i = 1; i < all.length; i++) {
    const nl = all[i].left;
    const nr = all[i].right;
    if (area(apex, right, nr) <= 0) {
      if (same(apex, right) || area(apex, left, nr) > 0) {
        right = nr;
        rightIdx = i;
      } else {
        path.push(left);
        apex = left;
        const idx = leftIdx;
        left = right = apex;
        leftIdx = rightIdx = idx;
        i = idx;
        continue;
      }
    }
    if (area(apex, left, nl) >= 0) {
      if (same(apex, left) || area(apex, right, nl) < 0) {
        left = nl;
        leftIdx = i;
      } else {
        path.push(right);
        apex = right;
        const idx = rightIdx;
        left = right = apex;
        leftIdx = rightIdx = idx;
        i = idx;
        continue;
      }
    }
  }
  if (!same(path[path.length - 1], goal)) path.push(goal);
  return path;
}

export class NavMesh {
  private polys: Poly[] = [];

  constructor(polygons: NavPolygonInput[] = [], links: OffMeshLink[] = []) {
    polygons.forEach((p, id) => this.addPolygon(p, id));
    this.connect();
    for (const l of links) this.addLink(l);
  }

  get polygonCount(): number {
    return this.polys.length;
  }

  /**
   * Build a mesh from a blocked-cell grid by merging open cells into rectangles.
   * `blocked[row * cols + col] === 1` marks an obstacle.
   */
  static fromGrid(cols: number, rows: number, cellSize: number, origin: Vec2, blocked: ArrayLike<number>, links: OffMeshLink[] = []): NavMesh {
    const rects: NavPolygonInput[] = [];
    let active = new Map<string, { c0: number; c1: number; r0: number }>();
    const emit = (c0: number, c1: number, r0: number, r1: number) => {
      const x0 = origin[0] + c0 * cellSize;
      const x1 = origin[0] + (c1 + 1) * cellSize;
      const y0 = origin[1] + r0 * cellSize;
      const y1 = origin[1] + (r1 + 1) * cellSize;
      rects.push({ verts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
    };
    for (let r = 0; r < rows; r++) {
      const next = new Map<string, { c0: number; c1: number; r0: number }>();
      for (let c = 0; c < cols; ) {
        if (blocked[r * cols + c]) {
          c++;
          continue;
        }
        const c0 = c;
        while (c < cols && !blocked[r * cols + c]) c++;
        const key = `${c0}:${c - 1}`;
        const above = active.get(key);
        if (above) {
          next.set(key, above);
          active.delete(key);
        } else next.set(key, { c0, c1: c - 1, r0: r });
      }
      for (const a of active.values()) emit(a.c0, a.c1, a.r0, r - 1);
      active = next;
    }
    for (const a of active.values()) emit(a.c0, a.c1, a.r0, rows - 1);
    return new NavMesh(rects, links);
  }

  private addPolygon(input: NavPolygonInput, id: number): void {
    const verts = input.verts.map((v) => [v[0], v[1]] as Vec2);
    if (verts.length < 3) throw new Error('A navigation polygon needs at least 3 corners');
    const xs = verts.map((v) => v[0]);
    const ys = verts.map((v) => v[1]);
    this.polys.push({
      id,
      verts,
      layer: input.layer ?? 0,
      cost: input.cost ?? 1,
      centroid: [xs.reduce((a, b) => a + b, 0) / verts.length, ys.reduce((a, b) => a + b, 0) / verts.length],
      min: [Math.min(...xs), Math.min(...ys)],
      max: [Math.max(...xs), Math.max(...ys)],
      portals: [],
      links: [],
    });
  }

  /** Find shared edges between polygons on the same layer (sweep over x to avoid an all-pairs scan). */
  private connect(): void {
    const order = [...this.polys].sort((a, b) => a.min[0] - b.min[0]);
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      for (let j = i + 1; j < order.length; j++) {
        const b = order[j];
        if (b.min[0] > a.max[0] + 1e-4) break;
        if (a.layer !== b.layer || b.min[1] > a.max[1] + 1e-4 || b.max[1] < a.min[1] - 1e-4) continue;
        const edge = this.findPortal(a, b);
        if (!edge) continue;
        a.portals.push({ to: b.id, a: edge[0], b: edge[1] });
        b.portals.push({ to: a.id, a: edge[0], b: edge[1] });
      }
    }
  }

  private findPortal(a: Poly, b: Poly): [Vec2, Vec2] | null {
    for (let i = 0; i < a.verts.length; i++)
      for (let j = 0; j < b.verts.length; j++) {
        const e = sharedEdge(a.verts[i], a.verts[(i + 1) % a.verts.length], b.verts[j], b.verts[(j + 1) % b.verts.length]);
        if (e) return e;
      }
    return null;
  }

  /** Add a jump/ladder/teleport connection between two places. Ignored when an end is off the mesh. */
  addLink(link: OffMeshLink): boolean {
    const a = this.locate(link.from, link.fromLayer ?? 0, 0.5);
    const b = this.locate(link.to, link.toLayer ?? 0, 0.5);
    if (!a || !b) return false;
    const length = dist(link.from, link.to);
    const cost = length * (link.cost ?? 1);
    a.poly.links.push({ to: b.poly.id, from: link.from, dest: link.to, cost });
    if (link.bidirectional !== false) b.poly.links.push({ to: a.poly.id, from: link.to, dest: link.from, cost });
    return true;
  }

  /** Polygon containing the point (or the closest one within `snap` units), and the snapped point. */
  private locate(p: Vec2, layer: number, snap: number): { poly: Poly; point: Vec2 } | null {
    let best: { poly: Poly; point: Vec2 } | null = null;
    let bestD = Infinity;
    for (const poly of this.polys) {
      if (poly.layer !== layer) continue;
      if (p[0] < poly.min[0] - snap || p[0] > poly.max[0] + snap || p[1] < poly.min[1] - snap || p[1] > poly.max[1] + snap) continue;
      const point = closestOnPolygon(p, poly.verts);
      const d = dist(point, p);
      if (d < bestD) {
        bestD = d;
        best = { poly, point };
        if (d === 0) break;
      }
    }
    return bestD <= snap ? best : null;
  }

  /** Closest walkable point to `p` on a layer (anywhere on the mesh), or null for an empty layer. */
  nearestPoint(p: Vec2, layer = 0): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const poly of this.polys) {
      if (poly.layer !== layer) continue;
      const c = closestOnPolygon(p, poly.verts);
      const d = dist(c, p);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  isWalkable(p: Vec2, layer = 0): boolean {
    return this.polys.some((poly) => poly.layer === layer && pointInPolygon(p, poly.verts));
  }

  /**
   * Shortest path as waypoints, or null when the goal cannot be reached.
   * Start/goal outside the mesh are snapped to the nearest walkable point.
   */
  find(start: Vec2, goal: Vec2, options: NavPathOptions = {}): Vec2[] | null {
    const startLayer = options.startLayer ?? 0;
    const goalLayer = options.goalLayer ?? startLayer;
    const s = this.nearestPoint(start, startLayer);
    const g = this.nearestPoint(goal, goalLayer);
    if (!s || !g) return null;
    const sp = this.locate(s, startLayer, 1e-3);
    const gp = this.locate(g, goalLayer, 1e-3);
    if (!sp || !gp) return null;

    const n = this.polys.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const via = new Array<{ portal?: Portal; link?: Link } | undefined>(n);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    gScore[sp.poly.id] = 0;
    heap.push(sp.poly.id, 0);
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      if (cur === gp.poly.id) break;
      closed[cur] = 1;
      const poly = this.polys[cur];
      const relax = (to: number, step: number, how: { portal?: Portal; link?: Link }) => {
        if (closed[to]) return;
        const cost = gScore[cur] + step;
        if (cost >= gScore[to]) return;
        gScore[to] = cost;
        came[to] = cur;
        via[to] = how;
        heap.push(to, cost + dist(this.polys[to].centroid, gp.poly.centroid));
      };
      for (const portal of poly.portals) {
        const target = this.polys[portal.to];
        relax(portal.to, dist(poly.centroid, target.centroid) * ((poly.cost + target.cost) / 2), { portal });
      }
      for (const link of poly.links) relax(link.to, link.cost, { link });
    }
    if (!Number.isFinite(gScore[gp.poly.id])) return null;

    const chain: number[] = [];
    for (let p = gp.poly.id; p !== -1; p = came[p]) chain.push(p);
    chain.reverse();

    // Walk the chain, funnelling each run of portals and hopping across links.
    const out: Vec2[] = [];
    let runStart: Vec2 = s;
    let portals: { left: Vec2; right: Vec2 }[] = [];
    const flush = (end: Vec2) => {
      const pts = funnel(runStart, end, portals);
      out.push(...(out.length && same(out[out.length - 1], pts[0]) ? pts.slice(1) : pts));
      portals = [];
    };
    for (let i = 1; i < chain.length; i++) {
      const step = via[chain[i]]!;
      if (step.link) {
        flush(step.link.from);
        runStart = step.link.dest;
        continue;
      }
      const portal = step.portal!;
      const from = this.polys[chain[i - 1]].centroid;
      const mid: Vec2 = [(portal.a[0] + portal.b[0]) / 2, (portal.a[1] + portal.b[1]) / 2];
      // "right" is the end that lies clockwise of the travel direction from the polygon centre.
      const aIsRight = cross(from, mid, portal.a) < 0;
      portals.push(aIsRight ? { left: portal.b, right: portal.a } : { left: portal.a, right: portal.b });
    }
    flush(g);
    return out;
  }

  /** Straight-line check: true when the segment stays on the mesh (single layer). */
  raycast(a: Vec2, b: Vec2, layer = 0, step = 0.1): boolean {
    const len = dist(a, b);
    const count = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      if (!this.isWalkable([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], layer)) return false;
    }
    return true;
  }

  pathLength(path: Vec2[]): number {
    let total = 0;
    for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
    return total;
  }
}
