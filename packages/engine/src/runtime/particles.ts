import * as THREE from 'three';
import type { ComponentData } from '../types';
import { prop } from '../components/registry';

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float scale = uScale * projectionMatrix[1][1] * 0.5;
  gl_PointSize = projectionMatrix[3][3] == 0.0 ? aSize * scale / -mv.z : aSize * scale;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/** CPU-simulated, GPU-rendered point particles (one draw call per emitter). */
export class ParticleSystem {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private ages: Float32Array;
  private lifetimes: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private alive = 0;
  private accumulator = 0;
  private max: number;
  private c0 = new THREE.Color();
  private c1 = new THREE.Color();
  private dir = new THREE.Vector3();
  private origin = new THREE.Vector3();
  emitting = true;

  constructor(private props: ComponentData) {
    this.max = Math.max(1, Math.floor(prop<number>(props, 'maxParticles')));
    this.positions = new Float32Array(this.max * 3);
    this.velocities = new Float32Array(this.max * 3);
    this.ages = new Float32Array(this.max);
    this.lifetimes = new Float32Array(this.max);
    this.colors = new Float32Array(this.max * 4);
    this.sizes = new Float32Array(this.max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: prop<boolean>(props, 'additive') ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.c0.set(prop<string>(props, 'colorStart'));
    this.c1.set(prop<string>(props, 'colorEnd'));
    const d = prop<number[]>(props, 'direction');
    this.dir.set(d[0], d[1], d[2]).normalize();
    if (this.dir.lengthSq() === 0) this.dir.set(0, 1, 0);
  }

  burst(count: number, emitter: THREE.Object3D): void {
    for (let i = 0; i < count; i++) this.spawn(emitter);
  }

  private spawn(emitter: THREE.Object3D): void {
    if (this.alive >= this.max) return;
    const i = this.alive++;
    emitter.getWorldPosition(this.origin);
    this.positions.set([this.origin.x, this.origin.y, this.origin.z], i * 3);
    const spread = prop<number>(this.props, 'spread');
    const speed = prop<number>(this.props, 'speed') * (0.6 + Math.random() * 0.8);
    const v = new THREE.Vector3(
      this.dir.x + (Math.random() * 2 - 1) * spread * 2,
      this.dir.y + (Math.random() * 2 - 1) * spread * 2,
      this.dir.z + (Math.random() * 2 - 1) * spread * 2,
    )
      .normalize()
      .multiplyScalar(speed);
    this.velocities.set([v.x, v.y, v.z], i * 3);
    this.ages[i] = 0;
    this.lifetimes[i] = prop<number>(this.props, 'lifetime') * (0.7 + Math.random() * 0.6);
  }

  update(dt: number, emitter: THREE.Object3D): void {
    if (this.emitting) {
      this.accumulator += prop<number>(this.props, 'rate') * dt;
      while (this.accumulator >= 1) {
        this.spawn(emitter);
        this.accumulator -= 1;
      }
    }
    const gravity = prop<number>(this.props, 'gravity');
    const baseSize = prop<number>(this.props, 'size');
    const color = new THREE.Color();
    for (let i = 0; i < this.alive; i++) {
      this.ages[i] += dt;
      if (this.ages[i] >= this.lifetimes[i]) {
        this.copy(this.alive - 1, i);
        this.alive--;
        i--;
        continue;
      }
      const t = this.ages[i] / this.lifetimes[i];
      this.velocities[i * 3 + 1] += gravity * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      color.copy(this.c0).lerp(this.c1, t);
      this.colors.set([color.r, color.g, color.b, 1 - t * t], i * 4);
      this.sizes[i] = baseSize * (1 - t * 0.5);
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.alive);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  private copy(from: number, to: number): void {
    if (from === to) return;
    this.positions.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.velocities.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.colors.copyWithin(to * 4, from * 4, from * 4 + 4);
    this.ages[to] = this.ages[from];
    this.lifetimes[to] = this.lifetimes[from];
    this.sizes[to] = this.sizes[from];
  }

  setViewportHeight(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px;
  }

  get count(): number {
    return this.alive;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
