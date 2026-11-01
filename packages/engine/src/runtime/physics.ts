import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { prop } from '../components/registry';
import type { ComponentData, Vec3 } from '../types';
import type { GameObject } from './GameObject';

interface BodyEntry {
  go: GameObject;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  type: 'dynamic' | 'fixed' | 'kinematic';
  /** Half height of the collider, used for ground checks. */
  halfHeight: number;
  lastPos: THREE.Vector3;
  lastQuat: THREE.Quaternion;
}

export interface CollisionEvent {
  a: GameObject;
  b: GameObject;
  started: boolean;
  trigger: boolean;
}

export interface RayHit {
  entity: GameObject;
  point: THREE.Vector3;
  distance: number;
}

let initPromise: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  // rapier's compat build inlines its wasm; init once per page.
  initPromise ??= RAPIER.init();
  return initPromise;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _size = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Thin adapter between GameObjects and Rapier. 2D games use the same 3D
 * engine with Z translation and X/Y rotation locked — one code path, two modes.
 */
export class Physics {
  readonly world: RAPIER.World;
  private queue = new RAPIER.EventQueue(true);
  private entries = new Map<string, BodyEntry>();
  private byCollider = new Map<number, BodyEntry>();
  private accumulator = 0;
  private debugLines: THREE.LineSegments | null = null;

  constructor(
    gravity: Vec3,
    private mode2d: boolean,
    private fixedStep: number,
  ) {
    this.world = new RAPIER.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
    this.world.timestep = fixedStep;
  }

  get bodyCount(): number {
    return this.entries.size;
  }

  add(go: GameObject): void {
    const colliderData = go.getComponent('Collider');
    if (!colliderData) return;
    const rb = go.getComponent('RigidBody');
    const type = (rb ? prop<string>(rb, 'bodyType') : 'fixed') as BodyEntry['type'];

    go.object3d.updateWorldMatrix(true, false);
    go.object3d.matrixWorld.decompose(_p, _q, _s);

    let desc =
      type === 'dynamic'
        ? RAPIER.RigidBodyDesc.dynamic()
        : type === 'kinematic'
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.fixed();
    desc = desc.setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    const lockRotation = rb ? prop<boolean>(rb, 'lockRotation') : false;
    if (rb) {
      desc = desc
        .setGravityScale(prop<number>(rb, 'gravityScale'))
        .setLinearDamping(prop<number>(rb, 'linearDamping'))
        .setAngularDamping(prop<number>(rb, 'angularDamping'))
        .setCcdEnabled(prop<boolean>(rb, 'ccd'));
    }
    if (this.mode2d) {
      desc = desc.enabledTranslations(true, true, false).enabledRotations(false, false, !lockRotation);
    } else if (lockRotation) {
      desc = desc.lockRotations();
    }
    const body = this.world.createRigidBody(desc);
    const { desc: cdesc, halfHeight } = this.colliderDesc(go, colliderData, _s);
    cdesc
      .setFriction(prop<number>(colliderData, 'friction'))
      .setRestitution(prop<number>(colliderData, 'restitution'))
      .setSensor(prop<boolean>(colliderData, 'isTrigger'))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC);
    if (rb && type === 'dynamic') cdesc.setMass(prop<number>(rb, 'mass'));
    const collider = this.world.createCollider(cdesc, body);
    const entry: BodyEntry = {
      go,
      body,
      collider,
      type,
      halfHeight,
      lastPos: _p.clone(),
      lastQuat: _q.clone(),
    };
    this.entries.set(go.id, entry);
    this.byCollider.set(collider.handle, entry);
  }

  private colliderDesc(go: GameObject, c: ComponentData, scale: THREE.Vector3): { desc: RAPIER.ColliderDesc; halfHeight: number } {
    let shape = prop<string>(c, 'shape');
    const size = prop<Vec3>(c, 'size');
    const offset = prop<Vec3>(c, 'offset');
    let hx = 0.5 * size[0] * scale.x;
    let hy = 0.5 * size[1] * scale.y;
    let hz = 0.5 * size[2] * scale.z;

    if (shape === 'auto') {
      const mesh = go.getComponent('Mesh');
      const sprite = go.getComponent('Sprite');
      if (mesh) {
        const s = prop<string>(mesh, 'shape');
        shape = s === 'sphere' || s === 'icosahedron' ? 'sphere' : s === 'capsule' ? 'capsule' : s === 'cylinder' ? 'cylinder' : 'box';
        hx = 0.5 * scale.x;
        hy = (s === 'capsule' ? 1 : 0.5) * scale.y;
        hz = 0.5 * scale.z;
        if (s === 'plane') hy = this.mode2d ? hy : 0.01;
        if (s === 'plane' && this.mode2d) hz = 0.5;
      } else if (sprite) {
        shape = 'box';
        hx = 0.5 * prop<number>(sprite, 'width') * scale.x;
        hy = 0.5 * prop<number>(sprite, 'height') * scale.y;
        hz = 0.5 * scale.z;
      } else {
        // Fall back to the rendered bounds (models, text...).
        _box.setFromObject(go.object3d);
        shape = 'box';
        if (!_box.isEmpty()) {
          _box.getSize(_size);
          hx = Math.max(0.05, _size.x / 2);
          hy = Math.max(0.05, _size.y / 2);
          hz = Math.max(0.05, _size.z / 2);
        }
      }
    }
    if (this.mode2d) hz = Math.max(hz, 0.5);

    let desc: RAPIER.ColliderDesc;
    let halfHeight = hy;
    switch (shape) {
      case 'sphere': {
        const r = Math.max(hx, hy, this.mode2d ? 0 : hz);
        desc = RAPIER.ColliderDesc.ball(r);
        halfHeight = r;
        break;
      }
      case 'capsule': {
        const r = Math.max(hx, this.mode2d ? 0 : hz);
        desc = RAPIER.ColliderDesc.capsule(Math.max(0.01, hy - r), r);
        break;
      }
      case 'cylinder':
        desc = RAPIER.ColliderDesc.cylinder(hy, Math.max(hx, hz));
        break;
      default:
        desc = RAPIER.ColliderDesc.cuboid(Math.max(0.005, hx), Math.max(0.005, hy), Math.max(0.005, hz));
    }
    desc.setTranslation(offset[0], offset[1], offset[2]);
    return { desc, halfHeight };
  }

  /** Rebuild a body whose visual size was only known after async load. */
  refreshAutoCollider(go: GameObject): void {
    const c = go.getComponent('Collider');
    if (!c || prop<string>(c, 'shape') !== 'auto' || go.getComponent('Mesh') || go.getComponent('Sprite')) return;
    if (!this.entries.has(go.id)) return;
    const vel = this.getVelocity(go);
    this.remove(go);
    this.add(go);
    this.setVelocity(go, vel.x, vel.y, vel.z);
  }

  remove(go: GameObject): void {
    const e = this.entries.get(go.id);
    if (!e) return;
    this.byCollider.delete(e.collider.handle);
    this.entries.delete(go.id);
    this.world.removeRigidBody(e.body);
  }

  has(go: GameObject): boolean {
    return this.entries.has(go.id);
  }

  /** Push the object's transform into the physics body (scripts moved it). */
  teleport(go: GameObject): void {
    const e = this.entries.get(go.id);
    if (!e) return;
    go.object3d.updateWorldMatrix(true, false);
    go.object3d.matrixWorld.decompose(_p, _q, _s);
    if (e.type === 'kinematic') {
      e.body.setNextKinematicTranslation(_p);
      e.body.setNextKinematicRotation(_q);
    } else {
      e.body.setTranslation(_p, true);
      e.body.setRotation(_q, true);
    }
    e.lastPos.copy(_p);
    e.lastQuat.copy(_q);
  }

  getVelocity(go: GameObject): THREE.Vector3 {
    const e = this.entries.get(go.id);
    if (!e) return new THREE.Vector3();
    const v = e.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  setVelocity(go: GameObject, x: number, y: number, z: number): void {
    const e = this.entries.get(go.id);
    if (e && e.type === 'dynamic') e.body.setLinvel({ x, y, z: this.mode2d ? 0 : z }, true);
  }

  applyImpulse(go: GameObject, x: number, y: number, z: number): void {
    const e = this.entries.get(go.id);
    if (e && e.type === 'dynamic') e.body.applyImpulse({ x, y, z: this.mode2d ? 0 : z }, true);
  }

  setGravityScale(go: GameObject, scale: number): void {
    this.entries.get(go.id)?.body.setGravityScale(scale, true);
  }

  /** Hand control of a body to code/network (remote players). */
  setKinematic(go: GameObject): void {
    const e = this.entries.get(go.id);
    if (!e || e.type === 'kinematic') return;
    e.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    e.type = 'kinematic';
  }

  isGrounded(go: GameObject): boolean {
    const e = this.entries.get(go.id);
    if (!e) return false;
    const t = e.body.translation();
    const hit = this.world.castRay(
      new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 }),
      e.halfHeight + 0.12,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      e.collider,
      e.body,
    );
    return hit !== null;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number, exclude?: GameObject): RayHit | null {
    const d = dir.clone().normalize();
    const ex = exclude ? this.entries.get(exclude.id) : undefined;
    const hit = this.world.castRay(
      new RAPIER.Ray(origin, d),
      maxDistance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      ex?.collider,
      ex?.body,
    );
    if (!hit) return null;
    const entry = this.byCollider.get(hit.collider.handle);
    if (!entry) return null;
    return { entity: entry.go, point: origin.clone().addScaledVector(d, hit.timeOfImpact), distance: hit.timeOfImpact };
  }

  /**
   * Advance the simulation with a fixed timestep; returns collision events
   * that happened during this frame.
   */
  step(dt: number): CollisionEvent[] {
    const events: CollisionEvent[] = [];
    // 1. Scripts may have moved objects directly — sync them into bodies.
    for (const e of this.entries.values()) {
      e.go.object3d.updateWorldMatrix(true, false);
      e.go.object3d.matrixWorld.decompose(_p, _q, _s);
      if (e.type === 'kinematic') {
        e.body.setNextKinematicTranslation(_p);
        e.body.setNextKinematicRotation(_q);
      } else if (_p.distanceToSquared(e.lastPos) > 1e-8 || 1 - Math.abs(_q.dot(e.lastQuat)) > 1e-8) {
        e.body.setTranslation(_p, true);
        e.body.setRotation(_q, true);
      }
    }
    // 2. Step.
    this.accumulator = Math.min(this.accumulator + dt, this.fixedStep * 5);
    while (this.accumulator >= this.fixedStep) {
      this.world.step(this.queue);
      this.accumulator -= this.fixedStep;
      this.queue.drainCollisionEvents((h1, h2, started) => {
        const a = this.byCollider.get(h1);
        const b = this.byCollider.get(h2);
        if (!a || !b) return;
        events.push({ a: a.go, b: b.go, started, trigger: a.collider.isSensor() || b.collider.isSensor() });
      });
    }
    // 3. Bodies -> objects.
    for (const e of this.entries.values()) {
      if (e.type === 'dynamic') {
        const t = e.body.translation();
        const r = e.body.rotation();
        _p.set(t.x, t.y, t.z);
        _q.set(r.x, r.y, r.z, r.w);
        const obj = e.go.object3d;
        if (obj.parent && obj.parent.type !== 'Scene') {
          obj.parent.updateWorldMatrix(true, false);
          obj.position.copy(obj.parent.worldToLocal(_p));
          obj.parent.getWorldQuaternion(_pq).invert();
          obj.quaternion.copy(_pq.multiply(_q));
        } else {
          obj.position.copy(_p);
          obj.quaternion.copy(_q);
        }
        e.lastPos.set(t.x, t.y, t.z);
        e.lastQuat.set(r.x, r.y, r.z, r.w);
      } else {
        const t = e.body.translation();
        const r = e.body.rotation();
        e.lastPos.set(t.x, t.y, t.z);
        e.lastQuat.set(r.x, r.y, r.z, r.w);
      }
    }
    return events;
  }

  /** Wireframe of every collider, for debugging. */
  debugDraw(scene: THREE.Scene, enabled: boolean): void {
    if (!enabled) {
      this.debugLines?.removeFromParent();
      return;
    }
    if (!this.debugLines) {
      this.debugLines = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
      );
      this.debugLines.renderOrder = 9999;
      this.debugLines.frustumCulled = false;
    }
    if (!this.debugLines.parent) scene.add(this.debugLines);
    const { vertices, colors } = this.world.debugRender();
    const geo = this.debugLines.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  }

  dispose(): void {
    this.debugLines?.removeFromParent();
    this.debugLines?.geometry.dispose();
    this.queue.free();
    this.world.free();
    this.entries.clear();
    this.byCollider.clear();
  }
}
