import type { AnimClip, AnimCondition, AnimKey, AnimTrack, AnimTransition, AnimatorData } from '../types';
import { uid } from '../util';

/**
 * Animation sampling and the animator state machine. Pure logic (no three.js)
 * so the editor preview, the runtime and the tests share exactly one implementation.
 */

export type AnimValue = number | string;
export type AnimPose = Record<string, AnimValue>;

const isColor = (v: AnimValue): v is string => typeof v === 'string';

function parseHex(c: string): [number, number, number] {
  const h = c.replace('#', '');
  const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h.padEnd(6, '0');
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}
const toHex = (rgb: number[]) => '#' + rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

export function mixValue(a: AnimValue, b: AnimValue, t: number): AnimValue {
  if (isColor(a) || isColor(b)) {
    const ca = parseHex(String(a));
    const cb = parseHex(String(b));
    return toHex(ca.map((x, i) => x + (cb[i] - x) * t));
  }
  return a + (b - a) * t;
}

export function sampleTrack(track: AnimTrack, time: number): AnimValue | undefined {
  const keys = track.keys;
  if (!keys.length) return undefined;
  if (time <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (time >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= time) i++;
  const a = keys[i];
  const b = keys[i + 1];
  if (a.ease === 'step') return a.v;
  let u = (time - a.t) / Math.max(1e-6, b.t - a.t);
  if (a.ease !== 'linear') u = u * u * (3 - 2 * u);
  return mixValue(a.v, b.v, u);
}

/** Wrap or clamp a time into the clip. */
export function clipTime(clip: AnimClip, time: number): number {
  if (clip.duration <= 0) return 0;
  return clip.loop ? ((time % clip.duration) + clip.duration) % clip.duration : Math.min(time, clip.duration);
}

export function sampleClip(clip: AnimClip, time: number): AnimPose {
  const t = clipTime(clip, time);
  const pose: AnimPose = {};
  for (const track of clip.tracks) {
    const v = sampleTrack(track, t);
    if (v !== undefined) pose[track.target] = v;
  }
  return pose;
}

export function blendPoses(a: AnimPose, b: AnimPose, w: number): AnimPose {
  const out: AnimPose = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? mixValue(a[k], v, w) : v;
  return out;
}

export function conditionPasses(c: AnimCondition, params: Record<string, unknown>): boolean {
  const raw = params[c.param];
  const v = typeof raw === 'boolean' ? Number(raw) : Number(raw ?? 0);
  switch (c.op) {
    case '>':
      return v > c.value;
    case '<':
      return v < c.value;
    case '==':
      return v === c.value;
    default:
      return v !== c.value;
  }
}

export interface AnimatorFrame {
  pose: AnimPose;
  /** The skeletal (glTF) clip the Model should be playing, if any, and the fade to use. */
  modelClip?: { name: string; fade: number };
  /** Set on the frame a state is entered. */
  entered?: string;
}

/** Runs one controller for one entity. Parameters live in the entity's `vars`. */
export class AnimatorInstance {
  state: string;
  time = 0;
  private from: { state: string; time: number } | null = null;
  private fade = 0;
  private fadeDuration = 0;
  private lastModelClip = '';
  private first = true;

  constructor(readonly data: AnimatorData) {
    this.state = data.states.some((s) => s.id === data.entry) ? data.entry : (data.states[0]?.id ?? '');
  }

  private clipOf(stateId: string): AnimClip | undefined {
    const st = this.data.states.find((s) => s.id === stateId);
    return st ? this.data.clips.find((c) => c.id === st.clip) : undefined;
  }

  private pickTransition(params: Record<string, unknown>): AnimTransition | undefined {
    const clip = this.clipOf(this.state);
    const finished = !clip || (!clip.loop && this.time >= clip.duration);
    for (const t of this.data.transitions) {
      if (t.from !== this.state && t.from !== 'any') continue;
      if (t.to === this.state) continue;
      if (t.exitTime && !finished) continue;
      if (!t.exitTime && !t.conditions.length) continue;
      if (t.conditions.every((c) => conditionPasses(c, params))) return t;
    }
    return undefined;
  }

  /** Advance by dt seconds. Trigger parameters used by a transition are reset in `params`. */
  update(dt: number, params: Record<string, unknown>): AnimatorFrame {
    let entered: string | undefined;
    if (this.first) {
      this.first = false;
      entered = this.state;
    }
    const st = this.data.states.find((s) => s.id === this.state);
    if (!st) return { pose: {} };
    this.time += dt * st.speed;
    if (this.from) {
      const fs = this.data.states.find((s) => s.id === this.from!.state);
      this.from.time += dt * (fs?.speed ?? 1);
      this.fade += dt;
      if (this.fade >= this.fadeDuration) this.from = null;
    }
    const tr = this.pickTransition(params);
    if (tr) {
      for (const c of tr.conditions) if (this.data.params.find((p) => p.name === c.param)?.type === 'trigger') params[c.param] = false;
      this.from = tr.duration > 0 ? { state: this.state, time: this.time } : null;
      this.fade = 0;
      this.fadeDuration = tr.duration;
      this.state = tr.to;
      this.time = 0;
      entered = tr.to;
    }
    const cur = this.data.states.find((s) => s.id === this.state)!;
    const curClip = this.clipOf(this.state);
    let pose: AnimPose = curClip ? sampleClip(curClip, this.time) : {};
    if (this.from) {
      const fromClip = this.clipOf(this.from.state);
      const fromPose = fromClip ? sampleClip(fromClip, this.from.time) : {};
      pose = blendPoses(fromPose, pose, Math.min(1, this.fade / Math.max(1e-6, this.fadeDuration)));
    }
    const frame: AnimatorFrame = { pose, entered };
    if (cur.modelClip && cur.modelClip !== this.lastModelClip) {
      this.lastModelClip = cur.modelClip;
      frame.modelClip = { name: cur.modelClip, fade: tr?.duration ?? 0.15 };
    }
    return frame;
  }
}

// ───────────── authoring helpers (used by the editor and the AI)
export function createClip(name = 'Clip'): AnimClip {
  return { id: uid('clip_'), name, duration: 1, loop: true, tracks: [] };
}

export function createAnimator(name = 'Animator'): AnimatorData {
  const clip = createClip('Idle');
  const state = { id: uid('st_'), name: 'Idle', clip: clip.id, modelClip: '', speed: 1, x: 80, y: 80 };
  return { id: uid('an_'), name, params: [], clips: [clip], states: [state], transitions: [], entry: state.id };
}

export const TRACK_TARGETS = ['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale.x', 'scale.y', 'scale.z', 'opacity', 'color'] as const;

export function defaultKeyValue(target: string): AnimValue {
  if (target === 'color') return '#ffffff';
  if (target.startsWith('scale') || target === 'opacity') return 1;
  return 0;
}

export function setKey(track: AnimTrack, key: AnimKey): void {
  const existing = track.keys.findIndex((k) => Math.abs(k.t - key.t) < 1e-4);
  if (existing >= 0) track.keys[existing] = { ...track.keys[existing], ...key };
  else track.keys.push(key);
  track.keys.sort((a, b) => a.t - b.t);
}
