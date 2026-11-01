import * as THREE from 'three';
import { prop } from '../components/registry';
import { AnimatorInstance, type AnimPose } from '../project/animation';
import type { ComponentData, Vec3 } from '../types';
import { DEG2RAD, damp, lerp } from '../util';
import type { Behaviour, GameObject } from './GameObject';
import type { Runtime } from './Runtime';
import { TEAM_COLORS } from './strategy';

/**
 * Built-in, no-code behaviours. Each is a factory returning the same
 * Behaviour interface that user scripts implement.
 */
type BehaviourFactory = (go: GameObject, c: ComponentData, rt: Runtime) => Behaviour;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function isTagged(other: GameObject, tag: string): boolean {
  return !tag || other.hasTag(tag);
}

function angleLerp(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

const PlatformerController: BehaviourFactory = (go, c, rt) => {
  let jumpsLeft = 0;
  let coyote = 0;
  return {
    update(dt) {
      const speed = prop<number>(c, 'speed');
      const jump = prop<number>(c, 'jumpForce');
      const airJumps = prop<number>(c, 'airJumps');
      const input = rt.input;
      const h = input.axis('horizontal');
      const v = go.velocity;
      const grounded = go.isGrounded();
      if (grounded) {
        coyote = 0.1;
        jumpsLeft = airJumps;
      } else coyote -= dt;
      const control = grounded ? 1 : prop<number>(c, 'airControl');
      const vx = lerp(v.x, h * speed, damp(18 * control, dt));
      let vy = v.y;
      if (input.pressed('jump') || input.pressed('up')) {
        if (coyote > 0) {
          vy = jump;
          coyote = 0;
          rt.audio.sfx('jump', 0.6);
        } else if (jumpsLeft > 0) {
          jumpsLeft--;
          vy = jump;
          rt.audio.sfx('jump', 0.6);
        }
      }
      // Releasing early makes a shorter jump (feels much better).
      if ((input.released('jump') || input.released('up')) && vy > 0) vy *= 0.5;
      go.setVelocity(vx, vy, rt.mode2d ? 0 : lerp(v.z, 0, damp(18, dt)));
      if (Math.abs(h) > 0.1) go.vars.facing = Math.sign(h);
      go.vars.grounded = grounded;
    },
  };
};

const TopDownController: BehaviourFactory = (go, c, rt) => ({
  start() {
    if (rt.mode2d) rt.physics?.setGravityScale(go, 0);
  },
  update(dt) {
    const speed = prop<number>(c, 'speed');
    let x = rt.input.axis('horizontal');
    let y = rt.input.axis('vertical');
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const hasBody = rt.physics?.has(go);
    if (rt.mode2d) {
      if (hasBody) go.setVelocity(x * speed, y * speed, 0);
      else go.move(x * speed * dt, y * speed * dt);
      if (prop<boolean>(c, 'faceMovement') && len > 0.1) go.rotation.z = angleLerp(go.rotation.z, Math.atan2(y, x), damp(14, dt));
      return;
    }
    // 3D: move on XZ, optionally relative to where the camera looks.
    let dx = x;
    let dz = -y;
    if (prop<boolean>(c, 'cameraRelative') && rt.camera) {
      rt.camera.getWorldDirection(_v);
      _v.y = 0;
      if (_v.lengthSq() > 1e-6) {
        _v.normalize();
        _w.set(-_v.z, 0, _v.x); // right vector
        dx = _w.x * x + _v.x * y;
        dz = _w.z * x + _v.z * y;
      }
    }
    if (hasBody) go.setVelocity(dx * speed, go.velocity.y, dz * speed);
    else go.move(dx * speed * dt, 0, dz * speed * dt);
    if (prop<boolean>(c, 'faceMovement') && len > 0.1) go.rotation.y = angleLerp(go.rotation.y, Math.atan2(-dx, -dz), damp(12, dt));
  },
});

const FirstPersonController: BehaviourFactory = (go, c, rt) => {
  let pitch = 0;
  const lock = () => {
    if (rt.isPlaying && document.pointerLockElement !== rt.canvas) void rt.canvas.requestPointerLock?.();
  };
  return {
    start() {
      rt.canvas.addEventListener('click', lock);
    },
    update() {
      const sens = prop<number>(c, 'sensitivity') * DEG2RAD;
      const looking = document.pointerLockElement === rt.canvas || rt.input.isDown('Mouse2');
      if (looking) {
        go.rotation.y -= rt.input.pointerDelta.x * sens;
        pitch = THREE.MathUtils.clamp(pitch - rt.input.pointerDelta.y * sens, -1.45, 1.45);
        const cam = rt.camera;
        if (cam && cam.parent && cam.parent !== go.object3d) cam.parent.rotation.x = pitch;
        else if (cam) cam.rotation.x = pitch;
      }
      const speed = prop<number>(c, 'speed');
      const x = rt.input.axis('horizontal');
      const y = rt.input.axis('vertical');
      const yaw = go.rotation.y;
      const dx = Math.sin(yaw) * -y + Math.cos(yaw) * x;
      const dz = Math.cos(yaw) * -y - Math.sin(yaw) * x;
      const v = go.velocity;
      let vy = v.y;
      if (rt.input.pressed('jump') && go.isGrounded()) vy = prop<number>(c, 'jumpForce');
      go.setVelocity(dx * speed, vy, dz * speed);
    },
    onDestroy() {
      rt.canvas.removeEventListener('click', lock);
      if (document.pointerLockElement === rt.canvas) document.exitPointerLock();
    },
  };
};

const FollowCamera: BehaviourFactory = (go, c, rt) => {
  let target: GameObject | undefined;
  return {
    lateUpdate(dt) {
      const name = prop<string>(c, 'target');
      if (!target?.alive) target = rt.api.find(name);
      if (!target) return;
      const offset = prop<Vec3>(c, 'offset');
      target.worldPosition(_v).add(_w.set(offset[0], offset[1], offset[2]));
      if (rt.mode2d) _v.z = go.position.z;
      const s = prop<number>(c, 'smoothing');
      if (s <= 0) go.position.copy(_v);
      else go.position.lerp(_v, damp(s, dt));
      if (!rt.mode2d && prop<boolean>(c, 'lookAt')) {
        const t = target.worldPosition(_w);
        go.lookAt(t.x, t.y, t.z);
      }
    },
  };
};

const Rotator: BehaviourFactory = (go, c) => ({
  update(dt) {
    const s = prop<Vec3>(c, 'speed');
    go.rotation.x += s[0] * DEG2RAD * dt;
    go.rotation.y += s[1] * DEG2RAD * dt;
    go.rotation.z += s[2] * DEG2RAD * dt;
  },
});

const Oscillator: BehaviourFactory = (go, c) => {
  const origin = new THREE.Vector3();
  let t = 0;
  return {
    start() {
      origin.copy(go.position);
    },
    update(dt) {
      t += dt;
      const a = prop<Vec3>(c, 'axis');
      const k = Math.sin(t * Math.PI * 2 * prop<number>(c, 'frequency')) * prop<number>(c, 'amplitude');
      go.position.set(origin.x + a[0] * k, origin.y + a[1] * k, origin.z + a[2] * k);
    },
  };
};

const Collectible: BehaviourFactory = (go, c, rt) => {
  let collected = false;
  const collect = (other: GameObject) => {
    if (collected || !isTagged(other, prop<string>(c, 'collectorTag'))) return;
    collected = true;
    const key = prop<string>(c, 'variable');
    rt.api.vars[key] = ((rt.api.vars[key] as number) ?? 0) + prop<number>(c, 'amount');
    const sound = prop<string>(c, 'sound');
    if (sound !== 'none') rt.audio.sfx(sound, 0.7);
    other.send('collected', { item: go });
    go.destroy();
  };
  return { onCollision: collect, onTrigger: collect };
};

const Health: BehaviourFactory = (go, c, rt) => {
  let invulnerable = 0;
  const spawn = new THREE.Vector3();
  let bar: { group: THREE.Group; fill: THREE.Mesh; height: number; width: number; fitted: boolean } | null = null;
  const max = () => prop<number>(c, 'max');
  const teamColor = () => TEAM_COLORS[String(go.vars.team)] ?? '#4ade80';
  const show = () => {
    if (prop<boolean>(c, 'showInHud')) rt.hud?.set(`hp:${go.id}`, '❤'.repeat(Math.max(0, go.vars.health as number)), { anchor: 'top-right', color: '#ff5d73' });
    if (bar) {
      const ratio = Math.max(0, (go.vars.health as number) / max());
      bar.fill.scale.x = Math.max(0.0001, ratio);
      bar.group.visible = ratio < 1 || go.hasTag('building');
    }
  };
  /** Bar size from the entity's bounds (models load async, so this may run again later). */
  const measure = (): { width: number; height: number } | null => {
    const box = new THREE.Box3().setFromObject(go.object3d, true);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    return {
      width: Math.max(0.8, Math.min(3, Math.max(size.x, rt.mode2d ? 0 : size.z) * 1.1)),
      height: rt.mode2d ? size.y / 2 + 0.35 : box.max.y - go.worldPosition().y + 0.45,
    };
  };
  const makeBar = () => {
    const m = measure();
    const width = m?.width ?? 1;
    const group = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.08, 0.2), new THREE.MeshBasicMaterial({ color: '#111318', transparent: true, opacity: 0.85, depthTest: false }));
    const fillGeo = new THREE.PlaneGeometry(width, 0.13).translate(width / 2, 0, 0);
    const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: teamColor(), depthTest: false }));
    fill.position.set(-width / 2, 0, 0.001);
    bg.renderOrder = 60;
    fill.renderOrder = 61;
    group.add(bg, fill);
    rt.scene.add(group);
    bar = { group, fill, height: m?.height ?? (rt.mode2d ? 0.9 : 2), width, fitted: !!m };
  };
  return {
    start() {
      go.vars.health = max();
      go.vars.maxHealth = max();
      spawn.copy(go.position);
      if (prop<boolean>(c, 'showBar')) makeBar();
      show();
    },
    update(dt) {
      if (invulnerable > 0) {
        invulnerable -= dt;
        go.visible = invulnerable <= 0 || Math.floor(invulnerable * 12) % 2 === 0;
      }
    },
    lateUpdate() {
      if (!bar) return;
      if (!bar.fitted) {
        const m = measure();
        if (m) {
          bar.height = m.height;
          bar.group.scale.x = m.width / bar.width;
          bar.fitted = true;
        }
      }
      const p = go.worldPosition(_v);
      bar.group.position.set(p.x, p.y + bar.height, rt.mode2d ? p.z + 0.5 : p.z);
      if (!rt.mode2d && rt.camera) bar.group.quaternion.copy(rt.camera.getWorldQuaternion(new THREE.Quaternion()));
    },
    onMessage(name, data) {
      if (name === 'heal') {
        go.vars.health = Math.min(max(), (go.vars.health as number) + ((data as { amount?: number })?.amount ?? 1));
        show();
        return;
      }
      if (name !== 'damage' || invulnerable > 0 || (go.vars.health as number) <= 0) return;
      const amount = (data as { amount?: number })?.amount ?? 1;
      go.vars.health = (go.vars.health as number) - amount;
      invulnerable = prop<number>(c, 'invulnerableTime');
      const p = go.worldPosition();
      if (!rt.mode2d && bar) p.y += bar.height;
      if (prop<boolean>(c, 'damageNumbers')) rt.fx.popText(p, `-${amount}`, '#ff5d73', 18);
      rt.fx.flash(go, '#ff3b3b', 0.1);
      if (!go.getComponent('UnitAI')) rt.audio.sfx('hit', 0.5);
      show();
      if ((go.vars.health as number) > 0) return;
      go.send('died');
      rt.fx.burst(go.worldPosition(), go.vars.team ? teamColor() : '#ffd166', go.hasTag('building') ? 90 : 35, go.hasTag('building') ? 6 : 4);
      if (go.hasTag('building')) {
        rt.fx.shake(0.35, 0.35);
        rt.audio.sfx('explosion', 0.6);
      }
      const reward = prop<string>(c, 'rewardVariable');
      if (reward) {
        const amt = prop<number>(c, 'rewardAmount');
        rt.api.vars[reward] = Number(rt.api.vars[reward] ?? 0) + amt;
        if (amt) rt.fx.popText(go.worldPosition(), `+${amt}`, '#ffd166', 18);
      }
      switch (prop<string>(c, 'onDeath')) {
        case 'destroy':
          go.destroy();
          break;
        case 'respawn':
          go.vars.health = max();
          go.setPosition(spawn.x, spawn.y, spawn.z);
          go.setVelocity(0, 0, 0);
          show();
          break;
        case 'game over':
          rt.api.gameOver();
          go.destroy();
          break;
        case 'win':
          rt.api.win();
          go.destroy();
          break;
      }
    },
    onDestroy() {
      rt.hud?.remove(`hp:${go.id}`);
      bar?.group.removeFromParent();
    },
  };
};

const Damage: BehaviourFactory = (go, c) => {
  const hit = (other: GameObject) => {
    if (!isTagged(other, prop<string>(c, 'targetTag')) || other === go) return;
    other.send('damage', { amount: prop<number>(c, 'amount'), source: go }, go);
    const kb = prop<number>(c, 'knockback');
    if (kb > 0) {
      other.worldPosition(_v).sub(go.worldPosition(_w)).normalize();
      other.setVelocity(_v.x * kb, Math.max(_v.y * kb, kb * 0.6), _v.z * kb);
    }
    if (prop<boolean>(c, 'destroySelf')) go.destroy();
  };
  return { onCollision: hit, onTrigger: hit };
};

const Spawner: BehaviourFactory = (go, c, rt) => {
  let timer = 0;
  const alive: GameObject[] = [];
  return {
    update(dt) {
      timer += dt;
      if (timer < prop<number>(c, 'interval')) return;
      timer = 0;
      for (let i = alive.length - 1; i >= 0; i--) if (!alive[i].alive) alive.splice(i, 1);
      if (alive.length >= prop<number>(c, 'maxAlive')) return;
      const r = prop<number>(c, 'radius');
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * r;
      const p = go.worldPosition(_v);
      const pos: Vec3 = rt.mode2d
        ? [p.x + Math.cos(angle) * dist, p.y + Math.sin(angle) * dist, p.z]
        : [p.x + Math.cos(angle) * dist, p.y, p.z + Math.sin(angle) * dist];
      const spawned = rt.api.spawn(prop<string>(c, 'prefab'), { position: pos, velocity: prop<Vec3>(c, 'velocity') });
      if (spawned) alive.push(spawned);
    },
  };
};

const Shooter: BehaviourFactory = (go, c, rt) => {
  let cooldown = 0;
  return {
    update(dt) {
      cooldown -= dt;
      const action = prop<string>(c, 'action');
      const trigger = prop<boolean>(c, 'auto') ? rt.input.isDown(action) : rt.input.pressed(action);
      if (!trigger || cooldown > 0) return;
      cooldown = prop<number>(c, 'cooldown');
      const origin = go.worldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3();
      if (prop<string>(c, 'aim') === 'pointer') {
        dir.copy(rt.api.pointerWorld()).sub(origin);
        if (rt.mode2d) dir.z = 0;
        else dir.y = 0;
      } else go.forward(dir);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      dir.normalize();
      const speed = prop<number>(c, 'speed');
      const start = origin.clone().addScaledVector(dir, 0.9);
      const rotation: Vec3 = rt.mode2d ? [0, 0, (Math.atan2(dir.y, dir.x) * 180) / Math.PI] : [0, (Math.atan2(-dir.x, -dir.z) * 180) / Math.PI, 0];
      const bullet = rt.api.spawn(prop<string>(c, 'prefab'), {
        position: [start.x, start.y, start.z],
        rotation,
        velocity: [dir.x * speed, dir.y * speed, dir.z * speed],
      });
      if (bullet) bullet.vars.owner = go.id;
      const sound = prop<string>(c, 'sound');
      if (sound !== 'none') rt.audio.sfx(sound, 0.35);
    },
  };
};

const DestroyAfter: BehaviourFactory = (go, c) => {
  let t = 0;
  return {
    update(dt) {
      t += dt;
      if (t >= prop<number>(c, 'seconds')) go.destroy();
    },
  };
};

const Goal: BehaviourFactory = (go, c, rt) => {
  let done = false;
  const reach = (other: GameObject) => {
    if (done || !isTagged(other, prop<string>(c, 'tag'))) return;
    done = true;
    const scene = prop<string>(c, 'scene');
    if (scene) rt.api.loadScene(scene);
    else rt.api.win(prop<string>(c, 'message'));
  };
  return { onCollision: reach, onTrigger: reach };
};

const HudText: BehaviourFactory = (go, c, rt) => ({
  lateUpdate() {
    rt.hud?.set(go.id, rt.interpolate(prop<string>(c, 'text')), {
      anchor: prop<string>(c, 'anchor'),
      fontSize: prop<number>(c, 'fontSize'),
      color: prop<string>(c, 'color'),
    });
  },
  onDestroy() {
    rt.hud?.remove(go.id);
  },
});

const AudioSource: BehaviourFactory = (go, c, rt) => {
  let handle: { stop(): void; setVolume(v: number): void } | null = null;
  const play = () => {
    const clip = prop<string>(c, 'clip');
    const preset = prop<string>(c, 'preset');
    if (clip) handle = rt.audio.play(clip, { volume: prop<number>(c, 'volume'), loop: prop<boolean>(c, 'loop') });
    else if (preset !== 'none') rt.audio.sfx(preset, prop<number>(c, 'volume'));
  };
  return {
    start() {
      if (prop<boolean>(c, 'autoplay')) play();
    },
    update() {
      if (!handle || !prop<boolean>(c, 'spatial') || !rt.camera) return;
      const d = go.worldPosition(_v).distanceTo(rt.camera.getWorldPosition(_w));
      handle.setVolume(prop<number>(c, 'volume') / (1 + d * 0.15));
    },
    onMessage(name) {
      if (name === 'play') play();
      if (name === 'stop') handle?.stop();
    },
    onDestroy() {
      handle?.stop();
    },
  };
};

/**
 * Plays an animation controller. Parameters are read from `self.vars`
 * (floats, bools, triggers), so scripts, visual graphs and other behaviours
 * drive it without any glue.
 */
const Animator: BehaviourFactory = (go, c, rt) => {
  const ref = prop<string>(c, 'controller');
  const data = rt.project.animators?.find((a) => a.id === ref || a.name === ref);
  if (!data) {
    if (ref) rt.log({ level: 'warn', message: `Animator: controller "${ref}" not found`, entityId: go.id });
    return {};
  }
  const inst = new AnimatorInstance(data);
  const apply = (pose: AnimPose) => {
    const p = go.object3d.position;
    const r = go.object3d.rotation;
    const sc = go.object3d.scale;
    let moved = false;
    for (const [target, value] of Object.entries(pose)) {
      if (target === 'color') {
        go.setColor(String(value));
        continue;
      }
      const n = Number(value);
      if (target === 'opacity') {
        for (const v of go.visuals) v.setOpacity?.(n);
        continue;
      }
      if (target.startsWith('vars.')) {
        go.vars[target.slice(5)] = n;
        continue;
      }
      const [group, axis] = target.split('.');
      const key = axis as 'x' | 'y' | 'z';
      if (group === 'position') p[key] = n;
      else if (group === 'rotation') r[key] = n * DEG2RAD;
      else if (group === 'scale') sc[key] = n;
      else continue;
      moved = true;
    }
    if (moved) rt.physics?.teleport(go);
  };
  return {
    start() {
      for (const p of data.params) if (go.vars[p.name] === undefined) go.vars[p.name] = p.type === 'float' ? 0 : false;
    },
    update(dt) {
      const frame = inst.update(dt * prop<number>(c, 'speed'), go.vars);
      apply(frame.pose);
      if (frame.modelClip) for (const v of go.visuals) v.playAnimation?.(frame.modelClip.name, frame.modelClip.fade);
      if (frame.entered) {
        go.vars.animState = data.states.find((s) => s.id === frame.entered)?.name ?? '';
        go.send('animationState', { state: go.vars.animState });
      }
    },
  };
};

export const BEHAVIOURS: Record<string, BehaviourFactory> = {
  Animator,
  PlatformerController,
  TopDownController,
  FirstPersonController,
  FollowCamera,
  Rotator,
  Oscillator,
  Collectible,
  Health,
  Damage,
  Spawner,
  Shooter,
  DestroyAfter,
  Goal,
  HudText,
  AudioSource,
};
