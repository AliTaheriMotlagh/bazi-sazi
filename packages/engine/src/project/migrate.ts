import type { ProjectData } from '../types';
import { defaultEnvironment, defaultSettings, DEFAULT_INPUT } from './defaults';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fill in fields missing from `value` using `defaults` (never overwrites existing values). */
function withDefaults<T>(value: unknown, defaults: T): T {
  if (!isObject(value) || !isObject(defaults)) return (value === undefined ? defaults : value) as T;
  const out: Record<string, unknown> = { ...value };
  for (const [k, d] of Object.entries(defaults)) out[k] = withDefaults(value[k], d);
  return out as T;
}

/**
 * Bring a project saved by any older version up to the current shape.
 * Pure: returns a new object (safe on frozen editor state). Every load path
 * (editor, player, import) runs projects through this.
 */
export function normalizeProject(project: ProjectData): ProjectData {
  const mode = project.settings?.mode ?? '3d';
  const settings = withDefaults(project.settings, defaultSettings(mode, project.scenes?.[0]?.id ?? ''));
  // Input maps are user data: keep the user's actions, only add missing defaults.
  settings.input = { ...DEFAULT_INPUT, ...(project.settings?.input ?? {}) };
  return {
    ...project,
    settings,
    scenes: (project.scenes ?? []).map((s) => {
      // Scenes made before skies existed keep their old flat look.
      const legacy = !('sky' in (s.environment ?? {}));
      const env = withDefaults(s.environment, defaultEnvironment(mode));
      if (legacy) Object.assign(env, { sky: 'color', envLight: 'none' });
      return { ...s, environment: env };
    }),
    assets: project.assets ?? [],
    scripts: project.scripts ?? [],
    graphs: project.graphs ?? [],
    prefabs: project.prefabs ?? [],
  };
}
