import * as THREE from 'three';
import { prop } from '../components/registry';
import type { ComponentData, Vec3 } from '../types';
import { damp } from '../util';
import type { Behaviour, GameObject } from './GameObject';
import type { Runtime } from './Runtime';

/**
 * Strategy & simulation building blocks (Clash-style battles, base building,
 * tower defense, Mini Metro-style routes). Each is a Behaviour factory.
 */
type Factory = (go: GameObject, c: ComponentData, rt: Runtime) => Behaviour;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export const TEAM_COLORS: Record<string, string> = { blue: '#3fa9ff', red: '#ff4d5e', green: '#4ade80', yellow: '#facc15' };

/** Horizontal (ground-plane) distance — ignores height in 3D, depth in 2D. */
function planarDistance(rt: Runtime, a: THREE.Vector3, b: THREE.Vector3): number {
  return rt.mode2d ? Math.hypot(a.x - b.x, a.y - b.y) : Math.hypot(a.x - b.x, a.z - b.z);
}

/** Approximate footprint radius of an entity (cached). */
export function footprint(go: GameObject): number {
  if (typeof go.vars.__radius === 'number') return go.vars.__radius;
  _box.setFromObject(go.object3d, true);
  if (_box.isEmpty()) return 0.4; // model still loading — don't cache
  const r = Math.max(0.3, Math.max(_box.getSize(_size).x, go.runtime.mode2d ? _size.y : _size.z) / 2);
  go.vars.__radius = r;
  return r;
}

/** Play the first clip whose name contains `name` (Walk / Attack / Idle…). */
function animate(go: GameObject, name: string): void {
  if (go.vars.__anim === name) return;
  go.vars.__anim = name;
  go.playAnimation(name);
}

/**
 * Shared locomotion: follows a path computed on the nav grid, steers around
 * nearby agents (separation) and faces the direction of travel.
 */
export class Mover {
  path: THREE.Vector3[] = [];
  private index = 0;
  private repath = 0;
  private lastGoal = new THREE.Vector3(Infinity, Infinity, Infinity);
  readonly velocity = new THREE.Vector3();

  constructor(
    private go: GameObject,
    private rt: Runtime,
  ) {}

  /** Request a path (throttled; re-plans when the goal moves). */
  goTo(goal: THREE.Vector3, dt: number): void {
    this.repath -= dt;
    if (this.repath > 0 && goal.distanceToSquared(this.lastGoal) < 0.25) return;
    this.repath = 0.6 + Math.random() * 0.3;
    this.lastGoal.copy(goal);
    const from = this.go.worldPosition(_a);
    const path = this.rt.nav?.findPath(from, goal) ?? null;
    this.path = path ?? [goal.clone()];
    this.index = this.path.length > 1 ? 1 : 0;
  }

  stop(): void {
    this.path = [];
    this.velocity.set(0, 0, 0);
    if (this.rt.physics?.has(this.go)) {
      const v = this.go.velocity;
      this.go.setVelocity(0, this.rt.mode2d ? 0 : v.y, 0);
    }
  }

  /** Advance along the path. Returns true once the end is reached. */
  step(dt: number, speed: number, stopDistance = 0.1, separation = 0.5, face = true): boolean {
    const go = this.go;
    const pos = go.worldPosition(_a);
    let target = this.path[this.index];
    while (target && planarDistance(this.rt, pos, target) < Math.max(0.15, speed * dt * 1.5) && this.index < this.path.length - 1) target = this.path[++this.index];
    if (!target) return true;
    const remaining = planarDistance(this.rt, pos, target);
    const last = this.index >= this.path.length - 1;
    if (last && remaining <= stopDistance) {
      this.stop();
      return true;
    }
    const dir = _b.copy(target).sub(pos);
    if (this.rt.mode2d) dir.z = 0;
    else dir.y = 0;
    dir.normalize();
    // Separation from neighbours so crowds don't stack.
    if (separation > 0) {
      for (const other of this.rt.agents) {
        if (other === go || !other.alive) continue;
        const op = other.object3d.position;
        const d = planarDistance(this.rt, pos, op);
        if (d > 0.001 && d < separation * 2) {
          const push = (separation * 2 - d) / (separation * 2);
          if (this.rt.mode2d) {
            dir.x += ((pos.x - op.x) / d) * push * 1.5;
            dir.y += ((pos.y - op.y) / d) * push * 1.5;
          } else {
            dir.x += ((pos.x - op.x) / d) * push * 1.5;
            dir.z += ((pos.z - op.z) / d) * push * 1.5;
          }
        }
      }
      if (dir.lengthSq() > 1) dir.normalize();
    }
    this.velocity.copy(dir).multiplyScalar(speed);
    if (this.rt.physics?.has(go)) {
      const v = go.velocity;
      go.setVelocity(this.velocity.x, this.rt.mode2d ? this.velocity.y : v.y, this.rt.mode2d ? 0 : this.velocity.z);
    } else go.move(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    if (face && dir.lengthSq() > 0.01) faceDirection(this.rt, go, dir, dt);
    return false;
  }
}

function faceDirection(rt: Runtime, go: GameObject, dir: THREE.Vector3, dt: number): void {
  if (rt.mode2d) {
    if (Math.abs(dir.x) > 0.05) go.vars.facing = Math.sign(dir.x);
    return;
  }
  const yaw = Math.atan2(-dir.x, -dir.z);
  const d = Math.atan2(Math.sin(yaw - go.rotation.y), Math.cos(yaw - go.rotation.y));
  go.rotation.y += d * damp(12, dt);
}

// ───────────────────────── NavAgent: point-and-click / scripted movement
const NavAgent: Factory = (go, c, rt) => {
  const mover = new Mover(go, rt);
  let goal: THREE.Vector3 | null = null;
  return {
    start() {
      rt.agents.add(go);
    },
    update(dt) {
      if (!goal) return;
      mover.goTo(goal, dt);
      const done = mover.step(dt, prop<number>(c, 'speed'), prop<number>(c, 'stoppingDistance'), prop<number>(c, 'separation'), prop<boolean>(c, 'faceMovement'));
      animate(go, done ? 'Idle' : 'Walk');
      if (done) {
        goal = null;
        go.send('arrived');
      }
    },
    onMessage(name, data) {
      if (name === 'moveTo') {
        const p = data as { x: number; y: number; z: number };
        goal = new THREE.Vector3(p.x, p.y, p.z);
      }
      if (name === 'stop') {
        goal = null;
        mover.stop();
      }
    },
    onDestroy() {
      rt.agents.delete(go);
    },
  };
};

// ───────────────────────── UnitAI: autonomous combat (troops, towers, defenses)
interface Shot {
  mesh: THREE.Object3D;
  target: GameObject;
  from: THREE.Vector3;
  t: number;
  duration: number;
  damage: number;
  arc: number;
}

const UnitAI: Factory = (go, c, rt) => {
  const team = String(prop<string>(c, 'team') || 'red');
  const speed = prop<number>(c, 'speed');
  const isBuilding = speed <= 0;
  const mover = new Mover(go, rt);
  const shots: Shot[] = [];
  let target: GameObject | null = null;
  let cooldown = prop<number>(c, 'attackCooldown') * Math.random();
  let retarget = 0;
  go.vars.team = team;
  go.addTag(`team-${team}`);
  go.addTag(isBuilding ? 'building' : 'unit');

  const enemies = () => [...rt.agents].filter((o) => o.alive && o !== go && o.vars.team !== undefined && o.vars.team !== team);

  const pick = (): GameObject | null => {
    const me = go.worldPosition(_a);
    const aggro = prop<number>(c, 'aggroRange');
    const onlyBuildings = prop<string>(c, 'targets') === 'buildings';
    let best: GameObject | null = null;
    let bestD = Infinity;
    for (const e of enemies()) {
      if (onlyBuildings && !e.hasTag('building')) continue;
      const d = planarDistance(rt, me, e.object3d.getWorldPosition(_b)) - footprint(e);
      if (d < aggro && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    if (best || isBuilding) return best;
    // Nothing nearby: march to the closest enemy building (then anything).
    for (const wantBuilding of [true, false]) {
      for (const e of enemies()) {
        if (wantBuilding && !e.hasTag('building')) continue;
        if (onlyBuildings && !e.hasTag('building')) continue;
        const d = planarDistance(rt, me, e.object3d.getWorldPosition(_b));
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      if (best) return best;
    }
    return null;
  };

  const hit = (t: GameObject, amount: number) => {
    if (!t.alive) return;
    t.send('damage', { amount, source: go }, go);
  };

  const fire = (t: GameObject) => {
    const damage = prop<number>(c, 'damage');
    const projectile = prop<string>(c, 'projectile');
    if (projectile === 'none') {
      // Melee: short wind-up so the attack animation reads well.
      rt.api.after(0.15, () => hit(t, damage));
      return;
    }
    const from = go.worldPosition(new THREE.Vector3());
    if (!rt.mode2d) from.y += Math.max(0.6, footprint(go) * 1.4);
    let mesh: THREE.Object3D;
    const prefab = projectile !== 'arrow' && projectile !== 'cannonball' && projectile !== 'magic' ? rt.findPrefab(projectile) : undefined;
    if (prefab) {
      const spawned = rt.spawnPrefab(prefab, { position: [from.x, from.y, from.z] }, { generated: true });
      mesh = spawned?.object3d ?? new THREE.Object3D();
    } else {
      const color = projectile === 'magic' ? '#c084fc' : projectile === 'cannonball' ? '#222222' : '#d4a373';
      const geo = projectile === 'arrow' ? new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6).rotateX(Math.PI / 2) : new THREE.SphereGeometry(projectile === 'cannonball' ? 0.18 : 0.14, 12, 8);
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: projectile === 'magic' ? color : '#000000', emissiveIntensity: 2 }));
      rt.scene.add(mesh);
    }
    mesh.position.copy(from);
    const dist = from.distanceTo(t.object3d.getWorldPosition(_b));
    shots.push({ mesh, target: t, from, t: 0, duration: Math.max(0.08, dist / prop<number>(c, 'projectileSpeed')), damage, arc: projectile === 'arrow' ? 0.15 : projectile === 'cannonball' ? 0.35 : 0 });
  };

  const updateShots = (dt: number) => {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.t += dt / s.duration;
      const end = s.target.alive ? s.target.object3d.getWorldPosition(_b) : _b.copy(s.mesh.position);
      if (!rt.mode2d && s.target.alive) end.y += footprint(s.target) * 0.8;
      const p = Math.min(1, s.t);
      const prev = s.mesh.position.clone();
      s.mesh.position.lerpVectors(s.from, end, p);
      s.mesh.position[rt.mode2d ? 'y' : 'y'] += Math.sin(p * Math.PI) * s.arc * s.from.distanceTo(end);
      if (!rt.mode2d) s.mesh.lookAt(s.mesh.position.clone().add(s.mesh.position.clone().sub(prev)));
      if (p >= 1) {
        if (s.target.alive) hit(s.target, s.damage);
        if (s.mesh.userData.entityId && rt.entities.get(s.mesh.userData.entityId)) rt.destroy(rt.entities.get(s.mesh.userData.entityId)!);
        else {
          s.mesh.removeFromParent();
          (s.mesh as THREE.Mesh).geometry?.dispose();
        }
        shots.splice(i, 1);
      }
    }
  };

  return {
    start() {
      rt.agents.add(go);
      animate(go, 'Idle');
    },
    update(dt) {
      updateShots(dt);
      cooldown -= dt;
      retarget -= dt;
      if (!target?.alive || retarget <= 0) {
        target = pick();
        retarget = 0.4 + Math.random() * 0.2;
      }
      if (!target) {
        if (!isBuilding) mover.stop();
        animate(go, 'Idle');
        return;
      }
      const me = go.worldPosition(_a);
      const tp = target.object3d.getWorldPosition(new THREE.Vector3());
      const gap = planarDistance(rt, me, tp) - footprint(target) - footprint(go) * 0.5;
      if (gap <= prop<number>(c, 'attackRange')) {
        if (!isBuilding) mover.stop();
        const dir = tp.sub(me);
        if (prop<boolean>(c, 'turnToTarget')) faceDirection(rt, go, dir.normalize(), dt * 2);
        if (cooldown <= 0) {
          cooldown = prop<number>(c, 'attackCooldown');
          go.vars.__anim = '';
          animate(go, 'Attack');
          fire(target);
        }
      } else if (!isBuilding) {
        mover.goTo(tp, dt);
        mover.step(dt, speed, 0, prop<number>(c, 'separation'));
        animate(go, 'Walk');
      }
    },
    onDestroy() {
      rt.agents.delete(go);
      for (const s of shots) {
        if (!s.mesh.userData.entityId) s.mesh.removeFromParent();
      }
    },
  };
};

// ───────────────────────── SpawnMenu: card decks (Clash Royale) & build menus (Clash of Clans)
interface MenuItem {
  prefab: string;
  cost: number;
  icon: string;
}

function parseItems(text: string): MenuItem[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [prefab, cost, icon] = line.split(':').map((x) => x.trim());
      return { prefab, cost: Number(cost) || 0, icon: icon || prefab.slice(0, 1).toUpperCase() };
    });
}

const SpawnMenu: Factory = (go, c, rt) => {
  const items = parseItems(prop<string>(c, 'items'));
  const currency = prop<string>(c, 'currency');
  const ai = prop<boolean>(c, 'ai');
  const build = prop<string>(c, 'mode') === 'build';
  const team = prop<string>(c, 'team');
  const areaMin = prop<Vec3>(c, 'areaMin');
  const areaMax = prop<Vec3>(c, 'areaMax');
  const grid = Math.max(0, prop<number>(c, 'gridSize'));
  let selected = -1;
  let aiTimer = prop<number>(c, 'aiInterval');
  let root: HTMLDivElement | null = null;
  let bar: HTMLDivElement | null = null;
  let marker: THREE.Mesh | null = null;
  let area: THREE.Mesh | null = null;
  const disposers: (() => void)[] = [];

  const amount = () => Number(rt.api.vars[currency] ?? 0);
  const inArea = (p: THREE.Vector3) => {
    const [ax, ay] = rt.mode2d ? [p.x, p.y] : [p.x, p.z];
    const [mx, my] = rt.mode2d ? [areaMin[0], areaMin[1]] : [areaMin[0], areaMin[2]];
    const [Mx, My] = rt.mode2d ? [areaMax[0], areaMax[1]] : [areaMax[0], areaMax[2]];
    return ax >= mx && ax <= Mx && ay >= my && ay <= My;
  };
  const snap = (p: THREE.Vector3) => {
    if (grid > 0) {
      p.x = Math.round(p.x / grid) * grid;
      if (rt.mode2d) p.y = Math.round(p.y / grid) * grid;
      else p.z = Math.round(p.z / grid) * grid;
    }
    return p;
  };
  const free = (p: THREE.Vector3) => {
    if (!build) return true;
    if (rt.nav && !rt.nav.isWalkable(p)) return false;
    for (const o of rt.agents) if (o.alive && o.hasTag('building') && planarDistance(rt, o.object3d.position, p) < Math.max(grid, 0.8) * 0.9) return false;
    return true;
  };

  const place = (index: number, p: THREE.Vector3): boolean => {
    const item = items[index];
    if (!item || amount() < item.cost || !inArea(p) || !free(p)) return false;
    const prefab = rt.findPrefab(item.prefab);
    if (!prefab) {
      rt.log({ level: 'warn', message: `Spawn menu: prefab "${item.prefab}" not found` });
      return false;
    }
    const offset = prefab.entities.find((e) => !e.parent)?.transform.position ?? [0, 0, 0];
    const pos: Vec3 = rt.mode2d ? [p.x, p.y, offset[2]] : [p.x, offset[1], p.z];
    const spawned = rt.spawnPrefab(prefab, { position: pos, team });
    if (!spawned) return false;
    rt.api.vars[currency] = amount() - item.cost;
    if (build) rt.nav?.markDirty();
    if (!ai) {
      rt.audio.sfx(build ? 'powerup' : 'blip', 0.5);
      // Pop-in animation for juice.
      const s = spawned.scale.clone();
      spawned.scale.multiplyScalar(0.2);
      rt.tweens.add(spawned.scale, { x: s.x, y: s.y, z: s.z }, 0.35, { ease: 'outBack' });
    }
    go.send('spawned', { entity: spawned, prefab: item.prefab });
    return true;
  };

  const renderUi = () => {
    if (!root || !bar) return;
    const have = amount();
    const max = prop<number>(c, 'max');
    if (max > 0) bar.style.setProperty('--fill', String(Math.min(1, have / max)));
    bar.dataset.value = String(Math.floor(have));
    root.querySelectorAll<HTMLButtonElement>('.bz-card').forEach((b, i) => {
      b.classList.toggle('disabled', have < items[i].cost);
      b.classList.toggle('selected', i === selected);
    });
  };

  const pointerGround = (e: PointerEvent): THREE.Vector3 | null => {
    if (!rt.camera) return null;
    const r = rt.canvas.getBoundingClientRect();
    rt.input.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return snap(rt.api.pointerWorld());
  };

  return {
    start() {
      if (rt.api.vars[currency] === undefined) rt.api.vars[currency] = prop<number>(c, 'start');
      if (ai || !rt.hud) return;
      root = document.createElement('div');
      root.className = 'bz-deck';
      bar = document.createElement('div');
      bar.className = 'bz-currency';
      bar.dataset.label = prop<string>(c, 'label') || currency;
      if (prop<number>(c, 'max') <= 0) bar.classList.add('plain');
      root.appendChild(bar);
      const cards = document.createElement('div');
      cards.className = 'bz-cards';
      items.forEach((item, i) => {
        const b = document.createElement('button');
        b.className = 'bz-card';
        b.innerHTML = `<span class="bz-card-icon"></span><span class="bz-card-name"></span><span class="bz-card-cost"></span>`;
        b.querySelector('.bz-card-icon')!.textContent = item.icon;
        b.querySelector('.bz-card-name')!.textContent = item.prefab;
        b.querySelector('.bz-card-cost')!.textContent = String(item.cost);
        b.onpointerdown = (e) => e.stopPropagation();
        b.onclick = () => {
          selected = selected === i ? -1 : i;
          rt.audio.sfx('blip', 0.3);
          renderUi();
        };
        cards.appendChild(b);
      });
      root.appendChild(cards);
      rt.hud.root.appendChild(root);

      // Placement marker + allowed-area overlay.
      const markerGeo = build ? new THREE.PlaneGeometry(Math.max(grid, 1), Math.max(grid, 1)) : new THREE.RingGeometry(0.35, 0.5, 32);
      if (!rt.mode2d) markerGeo.rotateX(-Math.PI / 2);
      marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.6, depthWrite: false }));
      marker.visible = false;
      marker.renderOrder = 50;
      rt.scene.add(marker);
      const w = areaMax[0] - areaMin[0];
      const h = rt.mode2d ? areaMax[1] - areaMin[1] : areaMax[2] - areaMin[2];
      if (Number.isFinite(w) && Number.isFinite(h) && w < 500 && h < 500) {
        const areaGeo = new THREE.PlaneGeometry(w, h);
        if (!rt.mode2d) areaGeo.rotateX(-Math.PI / 2);
        area = new THREE.Mesh(areaGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false }));
        area.position.set((areaMin[0] + areaMax[0]) / 2, rt.mode2d ? (areaMin[1] + areaMax[1]) / 2 : 0.02, rt.mode2d ? -0.4 : (areaMin[2] + areaMax[2]) / 2);
        area.visible = false;
        rt.scene.add(area);
      }

      const onMove = (e: PointerEvent) => {
        if (selected < 0 || !marker) return;
        const p = pointerGround(e);
        if (!p) return;
        marker.position.set(p.x, rt.mode2d ? p.y : 0.04, rt.mode2d ? 0.1 : p.z);
        const ok = inArea(p) && free(p) && amount() >= items[selected].cost;
        (marker.material as THREE.MeshBasicMaterial).color.set(ok ? '#4ade80' : '#ff4d5e');
      };
      const onUp = (e: PointerEvent) => {
        if (selected < 0 || rt.pointerDragged || e.button > 0) return;
        const p = pointerGround(e);
        if (!p) return;
        if (place(selected, p)) {
          if (build) selected = -1;
        } else {
          rt.audio.sfx('hit', 0.25);
          rt.fx.popText(p, amount() < items[selected].cost ? `Need ${items[selected].cost}` : 'Not here', '#ff4d5e', 16);
        }
        renderUi();
      };
      const onKey = (e: KeyboardEvent) => {
        const n = Number(e.key);
        if (n >= 1 && n <= items.length) {
          selected = selected === n - 1 ? -1 : n - 1;
          renderUi();
        }
        if (e.key === 'Escape') {
          selected = -1;
          renderUi();
        }
      };
      rt.canvas.addEventListener('pointermove', onMove);
      rt.canvas.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
      disposers.push(() => {
        rt.canvas.removeEventListener('pointermove', onMove);
        rt.canvas.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
      });
    },
    update(dt) {
      const max = prop<number>(c, 'max');
      const regen = prop<number>(c, 'regen');
      if (regen > 0) rt.api.vars[currency] = max > 0 ? Math.min(max, amount() + regen * dt) : amount() + regen * dt;
      if (ai) {
        aiTimer -= dt;
        if (aiTimer <= 0) {
          aiTimer = prop<number>(c, 'aiInterval') * (0.7 + Math.random() * 0.6);
          const affordable = items.map((it, i) => ({ it, i })).filter(({ it }) => it.cost <= amount());
          if (affordable.length) {
            const { i } = affordable[Math.floor(Math.random() * affordable.length)];
            for (let tries = 0; tries < 6; tries++) {
              const x = areaMin[0] + Math.random() * (areaMax[0] - areaMin[0]);
              const y = rt.mode2d ? areaMin[1] + Math.random() * (areaMax[1] - areaMin[1]) : 0;
              const z = rt.mode2d ? 0 : areaMin[2] + Math.random() * (areaMax[2] - areaMin[2]);
              if (place(i, snap(new THREE.Vector3(x, y, z)))) break;
            }
          }
        }
        return;
      }
      if (marker) marker.visible = selected >= 0;
      if (area) area.visible = selected >= 0;
      renderUi();
    },
    onMessage(name, data) {
      if (name === 'select') {
        selected = typeof data === 'number' ? data : -1;
        renderUi();
      }
    },
    onDestroy() {
      for (const d of disposers) d();
      root?.remove();
      marker?.removeFromParent();
      area?.removeFromParent();
    },
  };
};

// ───────────────────────── ResourceGenerator: gold mines, elixir pumps, farms
const ResourceGenerator: Factory = (go, c, rt) => {
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const interval = Math.max(0.1, prop<number>(c, 'interval'));
      if (t < interval) return;
      t -= interval;
      const key = prop<string>(c, 'variable');
      const amount = prop<number>(c, 'amount');
      const cap = prop<number>(c, 'cap');
      const current = Number(rt.api.vars[key] ?? 0);
      rt.api.vars[key] = cap > 0 ? Math.min(cap, current + amount) : current + amount;
      if (prop<boolean>(c, 'showPopup')) {
        const p = go.worldPosition(_a);
        if (!rt.mode2d) p.y += footprint(go) * 2;
        rt.fx.popText(p, `+${amount} ${prop<string>(c, 'icon')}`, '#ffd166', 18);
        const s = go.scale.clone();
        rt.tweens.add(go.scale, { x: s.x * 1.08, y: s.y * 1.12, z: s.z * 1.08 }, 0.12, { yoyo: true, ease: 'outQuad' });
      }
    },
  };
};

// ───────────────────────── StrategyCamera: pan / zoom / pinch for RTS & builder games
const StrategyCamera: Factory = (go, c, rt) => {
  const focus = new THREE.Vector3();
  const back = new THREE.Vector3();
  let distance = 10;
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number } | null = null;
  let pinch = 0;
  let lastGround: THREE.Vector3 | null = null;
  const disposers: (() => void)[] = [];
  const plane = new THREE.Plane(rt.mode2d ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Raycaster();

  const groundAt = (x: number, y: number): THREE.Vector3 | null => {
    const cam = go.camera ?? rt.camera;
    if (!cam) return null;
    const r = rt.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), cam);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  };
  const clampFocus = () => {
    const min = prop<Vec3>(c, 'boundsMin');
    const max = prop<Vec3>(c, 'boundsMax');
    focus.x = THREE.MathUtils.clamp(focus.x, min[0], max[0]);
    if (rt.mode2d) focus.y = THREE.MathUtils.clamp(focus.y, min[1], max[1]);
    else focus.z = THREE.MathUtils.clamp(focus.z, min[2], max[2]);
  };
  const zoom = (factor: number) => {
    const min = prop<number>(c, 'zoomMin');
    const max = prop<number>(c, 'zoomMax');
    const cam = go.camera;
    if (cam instanceof THREE.OrthographicCamera) cam.userData.orthoSize = THREE.MathUtils.clamp((cam.userData.orthoSize ?? 8) * factor, min, max);
    else distance = THREE.MathUtils.clamp(distance * factor, min, max);
  };
  const apply = () => {
    if (rt.mode2d) go.position.set(focus.x, focus.y, go.position.z);
    else go.position.copy(focus).addScaledVector(back, distance);
  };

  return {
    start() {
      go.object3d.updateWorldMatrix(true, false);
      if (rt.mode2d) focus.set(go.position.x, go.position.y, 0);
      else {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(go.quaternion);
        const hit = new THREE.Ray(go.position.clone(), forward).intersectPlane(plane, new THREE.Vector3());
        focus.copy(hit ?? new THREE.Vector3(go.position.x, 0, go.position.z - 5));
        back.copy(forward).negate();
        distance = go.position.distanceTo(focus);
      }
      const canvas = rt.canvas;
      const onDown = (e: PointerEvent) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
          downAt = { x: e.clientX, y: e.clientY };
          rt.pointerDragged = false;
          lastGround = groundAt(e.clientX, e.clientY);
        }
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = Math.hypot(a.x - b.x, a.y - b.y);
        }
      };
      const onMove = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch > 0 && d > 0) zoom(pinch / d);
          pinch = d;
          rt.pointerDragged = true;
          return;
        }
        if (!downAt || rt.pointerOwner || !prop<boolean>(c, 'dragPan')) return;
        if (!rt.pointerDragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) return;
        rt.pointerDragged = true;
        const now = groundAt(e.clientX, e.clientY);
        if (now && lastGround) {
          focus.add(lastGround.clone().sub(now));
          clampFocus();
          apply();
          go.object3d.updateMatrixWorld(true);
          lastGround = groundAt(e.clientX, e.clientY);
        }
      };
      const onUp = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) downAt = null;
        pinch = 0;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        zoom(1 + Math.sign(e.deltaY) * 0.1 * prop<number>(c, 'zoomSpeed'));
      };
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      disposers.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
      });
    },
    update(dt) {
      if (prop<boolean>(c, 'keyboard')) {
        const x = rt.input.axis('horizontal');
        const y = rt.input.axis('vertical');
        if (x || y) {
          const s = prop<number>(c, 'panSpeed') * dt * (rt.mode2d ? 1 : distance / 12);
          if (rt.mode2d) {
            focus.x += x * s;
            focus.y += y * s;
          } else {
            const fwd = _a.copy(back).negate().setY(0).normalize();
            const right = _b.set(-fwd.z, 0, fwd.x);
            focus.addScaledVector(right, x * s).addScaledVector(fwd, y * s);
          }
          clampFocus();
        }
      }
      apply();
    },
    onDestroy() {
      for (const d of disposers) d();
    },
  };
};

// ───────────────────────── PathFollower: tower-defense enemies, trains, patrols
function resolveWaypoints(rt: Runtime, spec: string): THREE.Vector3[] {
  const names = spec.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 1) {
    const holder = rt.api.find(names[0]);
    if (holder && holder.children.size) return [...holder.children].map((ch) => ch.worldPosition());
  }
  return names.map((n) => rt.api.find(n)?.worldPosition()).filter((p): p is THREE.Vector3 => !!p);
}

const PathFollower: Factory = (go, c, rt) => {
  let points: THREE.Vector3[] = [];
  let index = 0;
  let dir = 1;
  let done = false;
  const team = prop<string>(c, 'team');
  return {
    start() {
      if (team) {
        // Make walkers targetable by towers / Unit AI.
        go.vars.team = team;
        go.addTag(`team-${team}`).addTag('unit');
        rt.agents.add(go);
      }
      points = resolveWaypoints(rt, prop<string>(c, 'path'));
      if (!points.length) rt.log({ level: 'warn', message: `Path Follower: no waypoints found for "${prop<string>(c, 'path')}"`, entityId: go.id });
      animate(go, 'Walk');
    },
    update(dt) {
      if (done || !points.length) return;
      const target = points[index];
      const pos = go.worldPosition(_a);
      const step = prop<number>(c, 'speed') * dt;
      const delta = _b.copy(target).sub(pos);
      if (rt.mode2d) delta.z = 0;
      else delta.y = 0;
      const len = delta.length();
      if (len <= step) {
        go.setPosition(target.x, rt.mode2d ? target.y : go.position.y, rt.mode2d ? go.position.z : target.z);
        const loop = prop<string>(c, 'loop');
        if (index + dir >= points.length || index + dir < 0) {
          if (loop === 'loop') index = 0;
          else if (loop === 'pingpong') {
            dir = -dir;
            index += dir;
          } else {
            done = true;
            animate(go, 'Idle');
            go.send('pathEnd');
            const target = prop<string>(c, 'endTarget');
            if (target) rt.api.find(target)?.send('damage', { amount: prop<number>(c, 'endDamage'), source: go }, go);
            if (prop<boolean>(c, 'destroyAtEnd')) go.destroy();
          }
        } else index += dir;
        return;
      }
      if (go.vars.frozen) return;
      delta.divideScalar(len);
      go.move(delta.x * step, delta.y * step, delta.z * step);
      if (prop<boolean>(c, 'faceMovement')) faceDirection(rt, go, delta, dt);
    },
  };
};

// ───────────────────────── RouteBuilder: draw lines between stations (Mini Metro style)
interface Route {
  color: string;
  stations: GameObject[];
  group: THREE.Group;
  vehicle: GameObject | null;
  seg: number;
  t: number;
  dir: number;
  wait: number;
}

const RouteBuilder: Factory = (go, c, rt) => {
  const routes: Route[] = [];
  const colors = prop<string>(c, 'colors').split(',').map((s) => s.trim()).filter(Boolean);
  const tag = prop<string>(c, 'stationTag');
  const width = prop<number>(c, 'lineWidth');
  const lift = rt.mode2d ? -0.3 : 0.04;
  let drag: { route: Route; atStart: boolean } | null = null;
  let preview: THREE.Mesh | null = null;
  const disposers: (() => void)[] = [];

  const flat = (p: THREE.Vector3) => (rt.mode2d ? new THREE.Vector3(p.x, p.y, lift) : new THREE.Vector3(p.x, lift, p.z));
  const segmentMesh = (a: THREE.Vector3, b: THREE.Vector3, color: string, opacity = 1): THREE.Mesh => {
    const len = a.distanceTo(b);
    const geo = new THREE.PlaneGeometry(len + width, width);
    if (!rt.mode2d) geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    if (rt.mode2d) mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
    else mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    mesh.renderOrder = 5;
    return mesh;
  };
  const rebuild = (route: Route) => {
    route.group.clear();
    for (let i = 0; i < route.stations.length - 1; i++)
      route.group.add(segmentMesh(flat(route.stations[i].worldPosition()), flat(route.stations[i + 1].worldPosition()), route.color));
  };
  const stationAt = (e: PointerEvent): GameObject | null => {
    if (!rt.camera) return null;
    const r = rt.canvas.getBoundingClientRect();
    const id = rt.pick(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), rt.camera);
    let hit = id ? rt.entities.get(id) : undefined;
    while (hit && !hit.hasTag(tag) && hit.parent) hit = hit.parent;
    if (hit?.hasTag(tag)) return hit;
    // Generous touch target: nearest station within a radius.
    const p = rt.api.pointerWorld();
    let best: GameObject | null = null;
    let bestD = 1.2;
    for (const s of rt.api.findAll(tag)) {
      const d = planarDistance(rt, s.worldPosition(), p);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  };
  const spawnVehicle = (route: Route) => {
    if (route.vehicle || route.stations.length < 2) return;
    const prefab = rt.findPrefab(prop<string>(c, 'vehicle'));
    if (!prefab) return;
    const p = route.stations[0].worldPosition();
    route.vehicle = rt.spawnPrefab(prefab, { position: [p.x, rt.mode2d ? p.y : Math.max(p.y, 0.3), rt.mode2d ? 0.2 : p.z] });
    route.vehicle?.setColor(route.color);
    if (route.vehicle) route.vehicle.vars.line = routes.indexOf(route);
  };

  return {
    start() {
      const canvas = rt.canvas;
      const onDown = (e: PointerEvent) => {
        if (e.button > 0) return;
        rt.input.pointer.set(0, 0);
        const r = canvas.getBoundingClientRect();
        rt.input.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        const station = stationAt(e);
        if (!station) return;
        rt.pointerOwner = 'routes';
        for (const route of routes) {
          if (route.stations[route.stations.length - 1] === station) return void (drag = { route, atStart: false });
          if (route.stations[0] === station) return void (drag = { route, atStart: true });
        }
        if (routes.length >= prop<number>(c, 'maxLines')) {
          rt.fx.popText(station.worldPosition(), 'No free lines', '#ff4d5e', 16);
          rt.pointerOwner = null;
          return;
        }
        const route: Route = { color: colors[routes.length % colors.length] ?? '#ffffff', stations: [station], group: new THREE.Group(), vehicle: null, seg: 0, t: 0, dir: 1, wait: 0 };
        rt.scene.add(route.group);
        routes.push(route);
        drag = { route, atStart: false };
      };
      const onMove = (e: PointerEvent) => {
        if (!drag) return;
        const r = canvas.getBoundingClientRect();
        rt.input.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        const end = drag.atStart ? drag.route.stations[0] : drag.route.stations[drag.route.stations.length - 1];
        preview?.removeFromParent();
        preview = segmentMesh(flat(end.worldPosition()), flat(rt.api.pointerWorld()), drag.route.color, 0.5);
        rt.scene.add(preview);
      };
      const onUp = (e: PointerEvent) => {
        preview?.removeFromParent();
        preview = null;
        rt.pointerOwner = null;
        if (!drag) return;
        const { route, atStart } = drag;
        drag = null;
        const r = canvas.getBoundingClientRect();
        rt.input.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        const station = stationAt(e);
        if (station && !route.stations.includes(station)) {
          if (atStart) route.stations.unshift(station);
          else route.stations.push(station);
          rebuild(route);
          spawnVehicle(route);
          rt.audio.sfx('blip', 0.4);
          go.send('routeChanged', { line: routes.indexOf(route), stations: route.stations });
        } else if (route.stations.length < 2) {
          route.group.removeFromParent();
          routes.splice(routes.indexOf(route), 1);
        }
      };
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      disposers.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      });
    },
    update(dt) {
      const speed = prop<number>(c, 'vehicleSpeed');
      for (const route of routes) {
        const v = route.vehicle;
        if (!v?.alive || route.stations.length < 2) continue;
        if (route.wait > 0) {
          route.wait -= dt;
          continue;
        }
        route.seg = Math.min(route.seg, route.stations.length - 2);
        const from = route.stations[route.dir > 0 ? route.seg : route.seg + 1].worldPosition();
        const to = route.stations[route.dir > 0 ? route.seg + 1 : route.seg].worldPosition();
        const len = Math.max(0.01, planarDistance(rt, from, to));
        route.t += (speed * dt) / len;
        const p = from.clone().lerp(to, Math.min(1, route.t));
        v.setPosition(p.x, rt.mode2d ? p.y : Math.max(p.y, 0.3), rt.mode2d ? 0.2 : p.z);
        faceDirection(rt, v, to.clone().sub(from).normalize(), 1);
        if (rt.mode2d) v.rotation.z = Math.atan2(to.y - from.y, to.x - from.x);
        if (route.t >= 1) {
          route.t = 0;
          const arrived = route.stations[route.dir > 0 ? route.seg + 1 : route.seg];
          if (route.dir > 0) {
            if (route.seg + 1 >= route.stations.length - 1) route.dir = -1;
            else route.seg++;
          } else if (route.seg <= 0) route.dir = 1;
          else route.seg--;
          route.wait = prop<number>(c, 'stopTime');
          arrived.send('vehicleArrived', { vehicle: v, line: routes.indexOf(route) }, v);
          v.send('arrived', { station: arrived, line: routes.indexOf(route) }, arrived);
        }
      }
    },
    onDestroy() {
      for (const d of disposers) d();
      for (const r of routes) r.group.removeFromParent();
      preview?.removeFromParent();
    },
  };
};

export const STRATEGY_BEHAVIOURS: Record<string, Factory> = {
  NavAgent,
  UnitAI,
  SpawnMenu,
  ResourceGenerator,
  StrategyCamera,
  PathFollower,
  RouteBuilder,
};
