/**
 * Performance budgets and ratings for objects and scenes. Pure maths over measured stats (see runtime/stats.ts),
 * so the editor, the player and tests can all use the same thresholds.
 */

export interface RenderStats {
  triangles: number;
  vertices: number;
  /** Roughly one per mesh/material pair. */
  drawCalls: number;
  textures: number;
  /** GPU memory for textures, including mipmaps. */
  textureBytes: number;
}

export type Rating = 'light' | 'ok' | 'heavy';

export const EMPTY_STATS: RenderStats = { triangles: 0, vertices: 0, drawCalls: 0, textures: 0, textureBytes: 0 };

/** What a whole scene can afford on a mid-range phone (the platform most games must still run on). */
export const PHONE_BUDGET = { triangles: 150_000, drawCalls: 120, textureBytes: 160 * 1024 * 1024 } as const;

/** Per-object ceilings: above `heavy`, a handful of copies already breaks the phone budget. */
const OBJECT_LIMITS = {
  ok: { triangles: 5_000, drawCalls: 4, textureBytes: 4 * 1024 * 1024 },
  heavy: { triangles: 25_000, drawCalls: 12, textureBytes: 16 * 1024 * 1024 },
} as const;

export const addStats = (a: RenderStats, b: RenderStats): RenderStats => ({
  triangles: a.triangles + b.triangles,
  vertices: a.vertices + b.vertices,
  drawCalls: a.drawCalls + b.drawCalls,
  textures: a.textures + b.textures,
  textureBytes: a.textureBytes + b.textureBytes,
});

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export interface ObjectVerdict {
  rating: Rating;
  /** Plain-language findings, worst first. */
  tips: string[];
}

/** Texture memory for an RGBA image of the given size, with a full mip chain (×4/3). */
export const textureBytes = (width: number, height: number): number => Math.round(width * height * 4 * (4 / 3));

export function rateObject(stats: RenderStats): ObjectVerdict {
  const tips: string[] = [];
  let rating: Rating = 'light';
  const bump = (to: Rating) => {
    if (to === 'heavy' || rating === 'light') rating = to;
  };
  const { ok, heavy } = OBJECT_LIMITS;
  if (stats.triangles > heavy.triangles) {
    bump('heavy');
    tips.push(`${formatCount(stats.triangles)} triangles is a lot for one object — use a simpler model or hide it when far away.`);
  } else if (stats.triangles > ok.triangles) {
    bump('ok');
    tips.push(`${formatCount(stats.triangles)} triangles — fine for a hero object, costly if you place many copies.`);
  }
  if (stats.drawCalls > heavy.drawCalls) {
    bump('heavy');
    tips.push(`${stats.drawCalls} draw calls: merge materials so the object is drawn in fewer steps.`);
  } else if (stats.drawCalls > ok.drawCalls) {
    bump('ok');
    tips.push(`${stats.drawCalls} draw calls — sharing one material between parts makes it faster.`);
  }
  if (stats.textureBytes > heavy.textureBytes) {
    bump('heavy');
    tips.push(`Textures use ${formatBytes(stats.textureBytes)} of video memory. Shrink images to 1024px or less for phones.`);
  } else if (stats.textureBytes > ok.textureBytes) {
    bump('ok');
    tips.push(`Textures use ${formatBytes(stats.textureBytes)} of video memory.`);
  }
  if (!tips.length) tips.push('Cheap to draw — you can place plenty of these.');
  return { rating, tips };
}

export interface SceneBudget {
  triangles: number;
  drawCalls: number;
  textureBytes: number;
  /** The worst of the three, 0…1+ (above 1 = over budget). */
  worst: number;
  rating: Rating;
}

/** How much of the phone budget a scene uses. */
export function sceneBudget(stats: RenderStats): SceneBudget {
  const triangles = stats.triangles / PHONE_BUDGET.triangles;
  const drawCalls = stats.drawCalls / PHONE_BUDGET.drawCalls;
  const memory = stats.textureBytes / PHONE_BUDGET.textureBytes;
  const worst = Math.max(triangles, drawCalls, memory);
  return { triangles, drawCalls, textureBytes: memory, worst, rating: worst > 1 ? 'heavy' : worst > 0.6 ? 'ok' : 'light' };
}
