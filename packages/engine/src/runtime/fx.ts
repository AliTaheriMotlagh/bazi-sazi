import * as THREE from 'three';
import type { GameObject } from './GameObject';
import { ParticleSystem } from './particles';
import type { Runtime } from './Runtime';
import { createComponent } from '../components/registry';

// ───────────────────────── easing
export const EASINGS = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outElastic: (t: number) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
} as const;
export type Easing = keyof typeof EASINGS;

export interface TweenOptions {
  ease?: Easing;
  delay?: number;
  /** Play back to the start value after reaching the end. */
  yoyo?: boolean;
  /** Number of extra repeats (-1 = forever). */
  repeat?: number;
  onComplete?: () => void;
}

interface Tween {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  duration: number;
  time: number;
  opts: TweenOptions;
  repeatsLeft: number;
  forward: boolean;
  cancelled: boolean;
}

/** Numeric property animation (positions, scales, colors' r/g/b, custom vars). */
export class Tweens {
  private list: Tween[] = [];

  add(target: object, to: Record<string, number>, duration: number, opts: TweenOptions = {}): () => void {
    const t = target as Record<string, number>;
    const tween: Tween = {
      target: t,
      from: Object.fromEntries(Object.keys(to).map((k) => [k, Number(t[k]) || 0])),
      to,
      duration: Math.max(0.0001, duration),
      time: -(opts.delay ?? 0),
      opts,
      repeatsLeft: opts.repeat ?? 0,
      forward: true,
      cancelled: false,
    };
    this.list.push(tween);
    return () => void (tween.cancelled = true);
  }

  update(dt: number): void {
    if (!this.list.length) return;
    const done: Tween[] = [];
    for (const tw of this.list) {
      if (tw.cancelled) {
        done.push(tw);
        continue;
      }
      tw.time += dt;
      if (tw.time < 0) continue;
      const p = Math.min(1, tw.time / tw.duration);
      const e = EASINGS[tw.opts.ease ?? 'outQuad'](tw.forward ? p : 1 - p);
      for (const k in tw.to) tw.target[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (p < 1) continue;
      if (tw.opts.yoyo && tw.forward) {
        tw.forward = false;
        tw.time = 0;
      } else if (tw.repeatsLeft !== 0) {
        tw.repeatsLeft--;
        tw.forward = true;
        tw.time = 0;
      } else {
        done.push(tw);
        tw.opts.onComplete?.();
      }
    }
    if (done.length) this.list = this.list.filter((t) => !done.includes(t));
  }

  clear(): void {
    this.list = [];
  }
}

interface Popup {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}

const _v = new THREE.Vector3();

/** Game-feel effects: shake, floating text, bursts, flashes. */
export class Effects {
  private shakeTime = 0;
  private shakeStrength = 0;
  private shakeOffset = new THREE.Vector3();
  private popups: Popup[] = [];
  private bursts: { system: ParticleSystem; age: number; life: number }[] = [];

  constructor(private rt: Runtime) {}

  shake(strength = 0.3, duration = 0.3): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  /** Floating text that rises and fades (damage numbers, "+10 gold"…). */
  popText(position: THREE.Vector3 | { x: number; y: number; z: number }, text: string, color = '#ffffff', size = 22): void {
    const root = this.rt.hud?.root;
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'bz-pop';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    root.appendChild(el);
    this.popups.push({ el, pos: new THREE.Vector3(position.x, position.y, position.z), age: 0 });
  }

  /** One-shot particle explosion. */
  burst(position: THREE.Vector3 | { x: number; y: number; z: number }, color = '#ffd166', count = 40, speed = 4): void {
    const props = createComponent('Particles', { rate: 0, colorStart: color, colorEnd: '#222222', speed, spread: 1, size: this.rt.mode2d ? 0.25 : 0.18, lifetime: 0.7, gravity: -6, maxParticles: count });
    const system = new ParticleSystem(props);
    const emitter = new THREE.Object3D();
    emitter.position.set(position.x, position.y, position.z);
    emitter.updateMatrixWorld();
    system.burst(count, emitter);
    system.emitting = false;
    this.rt.scene.add(system.points);
    this.bursts.push({ system, age: 0, life: 1.2 });
  }

  /** Briefly tint an entity (hit feedback). */
  flash(go: GameObject, color = '#ffffff', duration = 0.12): void {
    const mats: { m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; c: THREE.Color; e?: THREE.Color }[] = [];
    go.object3d.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || Array.isArray(m) || !m.color || o.userData.editorOnly) return;
      mats.push({ m, c: m.color.clone(), e: (m as THREE.MeshStandardMaterial).emissive?.clone() });
      if ((m as THREE.MeshStandardMaterial).emissive) (m as THREE.MeshStandardMaterial).emissive.set(color);
      else m.color.set(color);
    });
    this.rt.api.after(duration, () => {
      for (const { m, c, e } of mats) {
        m.color.copy(c);
        if (e) (m as THREE.MeshStandardMaterial).emissive.copy(e);
      }
    });
  }

  /** Called before rendering. Returns the camera offset to apply (and remove after). */
  beforeRender(dt: number, camera: THREE.Camera | null): THREE.Vector3 {
    this.shakeOffset.set(0, 0, 0);
    if (this.shakeTime > 0 && camera) {
      this.shakeTime -= dt;
      const s = this.shakeStrength * Math.max(0, this.shakeTime) * 3;
      this.shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, this.rt.mode2d ? 0 : (Math.random() - 0.5) * s);
      if (this.shakeTime <= 0) this.shakeStrength = 0;
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      b.system.setViewportHeight(this.rt.viewportHeight);
      b.system.update(dt, b.system.points);
      if (b.age > b.life) {
        b.system.points.removeFromParent();
        b.system.dispose();
        this.bursts.splice(i, 1);
      }
    }
    if (this.popups.length && camera) {
      const canvas = this.rt.canvas;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.age += dt;
        p.pos.y += dt * (this.rt.mode2d ? 1.2 : 1.6);
        _v.copy(p.pos).project(camera);
        p.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.25 - p.age) * 2})`;
        p.el.style.opacity = String(Math.max(0, 1 - p.age / 1.1));
        if (p.age > 1.1) {
          p.el.remove();
          this.popups.splice(i, 1);
        }
      }
    }
    return this.shakeOffset;
  }

  clear(): void {
    for (const p of this.popups) p.el.remove();
    this.popups = [];
    for (const b of this.bursts) {
      b.system.points.removeFromParent();
      b.system.dispose();
    }
    this.bursts = [];
    this.shakeTime = 0;
  }
}
