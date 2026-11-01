import { transform } from 'sucrase';
import type { ScriptData } from '../types';
import { errorMessage } from '../util';
import type { Behaviour } from './GameObject';

export const SCRIPT_HOOKS = [
  'start',
  'update',
  'lateUpdate',
  'onCollision',
  'onCollisionEnd',
  'onTrigger',
  'onTriggerEnd',
  'onMessage',
  'onClick',
  'onDestroy',
] as const;

/** Names injected into every script's scope. Kept in sync with scriptApi.d.ts. */
const SCOPE = ['self', 'game', 'input', 'audio', 'net', 'params', 'THREE', 'log', 'warn', 'vec3', 'random', 'clamp', 'lerp'];

export type ScriptFactory = (ctx: Record<string, unknown>) => Behaviour;

export interface CompiledScript {
  factory: ScriptFactory | null;
  error: string | null;
}

/** Strip TypeScript types and module syntax so code can run as a function body. */
export function toRunnableJs(script: Pick<ScriptData, 'code' | 'language'>): string {
  let code = script.code;
  if (script.language === 'typescript') code = transform(code, { transforms: ['typescript'] }).code;
  return code.replace(/^\s*export\s+(default\s+)?/gm, '').replace(/^\s*import\s.+$/gm, '');
}

export function compileScript(script: Pick<ScriptData, 'code' | 'language'>): CompiledScript {
  try {
    const js = toRunnableJs(script);
    const returns = SCRIPT_HOOKS.map((h) => `${h}: typeof ${h} === 'function' ? ${h} : undefined`).join(',\n');
    // Each instance gets its own closure, so top-level `let` variables are per-entity state.
    const body = `"use strict";\nconst { ${SCOPE.join(', ')} } = __ctx;\n${js}\n;return {\n${returns}\n};`;
    const factory = new Function('__ctx', body) as ScriptFactory;
    return { factory, error: null };
  } catch (err) {
    return { factory: null, error: errorMessage(err) };
  }
}
