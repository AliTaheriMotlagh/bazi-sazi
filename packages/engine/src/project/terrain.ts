/**
 * Terrain heights are stored as a compact hex string (2 chars per vertex,
 * 0..255, row-major, (res+1)² vertices) inside the Terrain component, so a
 * terrain is plain project data like everything else.
 */

export const TERRAIN_LEVELS = 255;
/** Height value that means "ground level" so brushes can dig as well as raise. */
export const TERRAIN_BASE = 64;

export function terrainVertexCount(resolution: number): number {
  return (resolution + 1) * (resolution + 1);
}

export function flatHeights(resolution: number): string {
  return TERRAIN_BASE.toString(16).padStart(2, '0').repeat(terrainVertexCount(resolution));
}

/** Decode to normalized-ish levels (0..255). Missing/short data reads as flat. */
export function decodeHeights(hex: string, resolution: number): Uint8Array {
  const n = terrainVertexCount(resolution);
  const out = new Uint8Array(n).fill(TERRAIN_BASE);
  const len = Math.min(n, Math.floor(hex.length / 2));
  for (let i = 0; i < len; i++) {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isNaN(v)) out[i] = v;
  }
  return out;
}

export function encodeHeights(levels: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < levels.length; i++) s += Math.max(0, Math.min(TERRAIN_LEVELS, Math.round(levels[i]))).toString(16).padStart(2, '0');
  return s;
}

/** World height of a level, given the component's `height` (world units for 255-BASE levels above ground). */
export function levelToHeight(level: number, height: number): number {
  return ((level - TERRAIN_BASE) / (TERRAIN_LEVELS - TERRAIN_BASE)) * height;
}

export type TerrainBrush = 'raise' | 'lower' | 'smooth' | 'flatten';

/**
 * Apply a round brush at local terrain coordinates (u,v in 0..1 across the terrain).
 * Mutates and returns `levels`.
 */
export function applyTerrainBrush(levels: Uint8Array, resolution: number, brush: TerrainBrush, u: number, v: number, radius: number, strength: number, flattenTo = TERRAIN_BASE): Uint8Array {
  const n = resolution + 1;
  const cx = u * resolution;
  const cy = v * resolution;
  const r = Math.max(0.5, radius * resolution);
  const src = brush === 'smooth' ? Uint8Array.from(levels) : levels;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(resolution, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(resolution, Math.ceil(cx + r)); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const falloff = 0.5 + 0.5 * Math.cos((d / r) * Math.PI);
      const i = y * n + x;
      const cur = levels[i];
      let next: number;
      if (brush === 'raise') next = cur + strength * falloff;
      else if (brush === 'lower') next = cur - strength * falloff;
      else if (brush === 'flatten') next = cur + (flattenTo - cur) * Math.min(1, 0.4 * falloff * (strength / 8));
      else {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx > resolution || yy > resolution) continue;
          sum += src[yy * n + xx];
          count++;
        }
        next = cur + (sum / count - cur) * Math.min(1, 0.5 * falloff);
      }
      levels[i] = Math.max(0, Math.min(TERRAIN_LEVELS, Math.round(next)));
    }
  }
  return levels;
}

/** Vertex positions (x,y,z, local space, centered on the origin) and triangle indices. */
export function terrainMesh(levels: Uint8Array, resolution: number, size: number, height: number): { positions: Float32Array; indices: Uint32Array } {
  const n = resolution + 1;
  const positions = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      positions[i * 3] = (x / resolution - 0.5) * size;
      positions[i * 3 + 1] = levelToHeight(levels[i], height);
      positions[i * 3 + 2] = (y / resolution - 0.5) * size;
    }
  }
  const indices = new Uint32Array(resolution * resolution * 6);
  let k = 0;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const a = y * n + x;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  return { positions, indices };
}
