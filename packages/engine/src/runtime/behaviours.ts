import * as THREE from 'three';
import { prop } from '../components/registry';
import type { ComponentData, Vec3 } from '../types';
import { DEG2RAD, damp, lerp } from '../util';
import type { Behaviour, GameObject } from './GameObject';
import type { Runtime } from './Runtime';

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
  const show = () => {
    if (prop<boolean>(c, 'showInHud')) rt.hud?.set(`hp:${go.id}`, '❤'.repeat(Math.max(0, go.vars.health as number)), { anchor: 'top-right', color: '#ff5d73' });
  };
  return {
    start() {
      go.vars.health = prop<number>(c, 'max');
      spawn.copy(go.position);
      show();
    },
    update(dt) {
      if (invulnerable > 0) {
        invulnerable -= dt;
        go.visible = invulnerable <= 0 || Math.floor(invulnerable * 12) % 2 === 0;
      }
    },
    onMessage(name, data) {
      if (name === 'heal') {
        go.vars.health = Math.min(prop<number>(c, 'max'), (go.vars.health as number) + ((data as { amount?: number })?.amount ?? 1));
        show();
        return;
      }
      if (name !== 'damage' || invulnerable > 0) return;
      go.vars.health = (go.vars.health as number) - ((data as { amount?: number })?.amount ?? 1);
      invulnerable = prop<number>(c, 'invulnerableTime');
      rt.audio.sfx('hit', 0.6);
      show();
      if ((go.vars.health as number) > 0) return;
      go.send('died');
      switch (prop<string>(c, 'onDeath')) {
        case 'destroy':
          go.destroy();
          break;
        case 'respawn':
          go.vars.health = prop<number>(c, 'max');
          go.setPosition(spawn.x, spawn.y, spawn.z);
          go.setVelocity(0, 0, 0);
          show();
          break;
        case 'game over':
          rt.api.gameOver();
          break;
      }
    },
    onDestroy() {
      rt.hud?.remove(`hp:${go.id}`);
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

export const BEHAVIOURS: Record<string, BehaviourFactory> = {
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
