import * as THREE from 'three';
import type { ScriptData } from '../types';
import { clamp, lerp } from '../util';
import { compileScript, type CompiledScript } from './compile';
import type { Behaviour, GameObject } from './GameObject';
import type { GameApi } from './Runtime';

export { compileScript, toRunnableJs, SCRIPT_HOOKS, type CompiledScript, type ScriptFactory } from './compile';

export class ScriptCache {
  private cache = new Map<string, { code: string; compiled: CompiledScript }>();

  get(script: ScriptData): CompiledScript {
    const hit = this.cache.get(script.id);
    if (hit && hit.code === script.code) return hit.compiled;
    const compiled = compileScript(script);
    this.cache.set(script.id, { code: script.code, compiled });
    return compiled;
  }
}

export function createScriptInstance(
  compiled: CompiledScript,
  go: GameObject,
  api: GameApi,
  params: Record<string, unknown>,
  source: string,
): Behaviour | null {
  if (!compiled.factory) return null;
  const log = (...args: unknown[]) => api.log('log', args, source, go.id);
  const warn = (...args: unknown[]) => api.log('warn', args, source, go.id);
  return compiled.factory({
    self: go,
    game: api,
    input: api.input,
    audio: api.audio,
    net: api.net,
    params,
    THREE,
    log,
    warn,
    vec3: (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z),
    random: (min = 0, max = 1) => min + Math.random() * (max - min),
    clamp,
    lerp,
  });
}
