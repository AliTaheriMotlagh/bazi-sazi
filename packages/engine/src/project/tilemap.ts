/**
 * Pure helpers for editing a TileMap's text grid. The map is rows of
 * characters ('.' = empty); the painter, AI tools and tests all use these.
 */

export const EMPTY_TILE = '.';

export interface LegendEntry {
  char: string;
  prefab: string;
}

export function parseLegend(legend: string): LegendEntry[] {
  const out: LegendEntry[] = [];
  for (const line of legend.split('\n')) {
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    out.push({ char: line.slice(0, idx), prefab: line.slice(idx + 1).trim() });
  }
  return out;
}

export function serializeLegend(entries: LegendEntry[]): string {
  return entries.map((e) => `${e.char}=${e.prefab}`).join('\n');
}

export function parseGrid(map: string): string[][] {
  return map.split('\n').map((row) => [...row]);
}

export function serializeGrid(grid: string[][]): string {
  return grid.map((row) => row.join('')).join('\n');
}

export function gridSize(grid: string[][]): { cols: number; rows: number } {
  return { rows: grid.length, cols: grid.reduce((m, r) => Math.max(m, r.length), 0) };
}

export interface PaintResult {
  map: string;
  /** Columns/rows added on the left/top. The caller moves the entity so tiles stay put in the world. */
  shiftCols: number;
  shiftRows: number;
}

function padded(grid: string[][], cols: number, rows: number): string[][] {
  const out = grid.map((r) => r.slice());
  while (out.length < rows) out.push([]);
  for (const r of out) while (r.length < cols) r.push(EMPTY_TILE);
  return out;
}

/** Remove fully-empty outer rows/columns (always keeps at least 1x1). */
export function trimGrid(grid: string[][]): { grid: string[][]; left: number; top: number } {
  const { cols, rows } = gridSize(grid);
  const g = padded(grid, cols, rows);
  const filled = (c: string) => c !== EMPTY_TILE && c !== ' ';
  let top = 0;
  while (top < rows - 1 && !g[top].some(filled)) top++;
  let bottom = rows - 1;
  while (bottom > top && !g[bottom].some(filled)) bottom--;
  let left = 0;
  while (left < cols - 1 && !g.some((r) => filled(r[left]))) left++;
  let right = cols - 1;
  while (right > left && !g.some((r) => filled(r[right]))) right--;
  return { grid: g.slice(top, bottom + 1).map((r) => r.slice(left, right + 1)), left, top };
}

/**
 * Paint cells (col,row may be negative or beyond the edge: the grid grows).
 * Erasing never shrinks the grid, so the painter stays stable under the cursor.
 */
export function paintCells(map: string, cells: Array<[number, number]>, char: string): PaintResult {
  let grid = parseGrid(map);
  const { cols, rows } = gridSize(grid);
  let minC = 0;
  let minR = 0;
  let maxC = cols - 1;
  let maxR = rows - 1;
  const erase = char === EMPTY_TILE;
  for (const [c, r] of cells) {
    if (erase && (c < 0 || r < 0 || c >= cols || r >= rows)) continue;
    minC = Math.min(minC, c);
    minR = Math.min(minR, r);
    maxC = Math.max(maxC, c);
    maxR = Math.max(maxR, r);
  }
  const shiftCols = minC < 0 ? -minC : 0;
  const shiftRows = minR < 0 ? -minR : 0;
  grid = padded(grid, maxC - minC + 1, maxR - minR + 1);
  if (shiftCols || shiftRows) {
    const w = maxC - minC + 1;
    const next: string[][] = Array.from({ length: maxR - minR + 1 }, () => Array<string>(w).fill(EMPTY_TILE));
    const old = parseGrid(map);
    old.forEach((row, r) => row.forEach((ch, c) => (next[r + shiftRows][c + shiftCols] = ch)));
    grid = next;
  }
  for (const [c, r] of cells) {
    if (erase && (c + shiftCols < 0 || r + shiftRows < 0 || r + shiftRows >= grid.length || c + shiftCols >= (grid[0]?.length ?? 0))) continue;
    grid[r + shiftRows][c + shiftCols] = char;
  }
  return { map: serializeGrid(grid), shiftCols, shiftRows };
}

/** Cells of the connected region of identical tiles at (col,row), capped for safety. */
export function floodCells(map: string, col: number, row: number, limit = 20000): Array<[number, number]> {
  const grid = parseGrid(map);
  const { cols, rows } = gridSize(grid);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return [];
  const at = (c: number, r: number) => grid[r]?.[c] ?? EMPTY_TILE;
  const target = at(col, row);
  const seen = new Set<number>([row * cols + col]);
  const queue: Array<[number, number]> = [[col, row]];
  const out: Array<[number, number]> = [];
  while (queue.length && out.length < limit) {
    const [c, r] = queue.pop()!;
    out.push([c, r]);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const key = nr * cols + nc;
      if (seen.has(key) || at(nc, nr) !== target) continue;
      seen.add(key);
      queue.push([nc, nr]);
    }
  }
  return out;
}

/** Cells of the filled rectangle between two corners. */
export function rectCells(a: [number, number], b: [number, number]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = Math.min(a[1], b[1]); r <= Math.max(a[1], b[1]); r++) for (let c = Math.min(a[0], b[0]); c <= Math.max(a[0], b[0]); c++) out.push([c, r]);
  return out;
}

/** Cells on a straight line (so fast brush strokes leave no gaps). */
export function lineCells(a: [number, number], b: [number, number]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  for (let i = 0; i <= n; i++) out.push([Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n)]);
  return out;
}

/** World position -> grid cell for a tile map at `origin`. 2D maps grow down the -Y axis; 3D along +Z. */
export function worldToCell(world: [number, number, number], origin: [number, number, number], size: number, mode2d: boolean): [number, number] {
  const col = Math.round((world[0] - origin[0]) / size);
  const row = mode2d ? Math.round(-(world[1] - origin[1]) / size) : Math.round((world[2] - origin[2]) / size);
  return [col, row];
}

/** Where the entity must move so the existing tiles stay in place after the grid grew on the left/top. */
export function originShift(origin: [number, number, number], shiftCols: number, shiftRows: number, size: number, mode2d: boolean): [number, number, number] {
  return mode2d ? [origin[0] - shiftCols * size, origin[1] + shiftRows * size, origin[2]] : [origin[0] - shiftCols * size, origin[1], origin[2] - shiftRows * size];
}
