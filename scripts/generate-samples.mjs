#!/usr/bin/env node
/**
 * Generates the Starter Content library (all original, CC0):
 *   models/*.glb   low-poly animated characters, towers, buildings, props (three.js → GLTFExporter)
 *   sprites/*.svg  sprite sheets, tiles, icons
 *   audio/*.mp3    synthesized music loop + sound effects (needs ffmpeg)
 *   video/*.mp4    procedural intro + fractal clip (needs ffmpeg)
 *   manifest.json  what the studio's Content Browser lists
 *
 * Usage: npm run samples   (re-run any time; output is deterministic)
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'apps/studio/public/samples');
for (const d of ['models', 'sprites', 'audio', 'video']) mkdirSync(path.join(OUT, d), { recursive: true });
const manifest = [];
const add = (entry) => manifest.push(entry);

// GLTFExporter needs FileReader for binary output; Node has Blob but not FileReader.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
      this.onload?.({ target: this });
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
      this.onload?.({ target: this });
    });
  }
};

// ═══════════════════════════════════════════ MODELS
const D = Math.PI / 180;
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, flatShading: true, ...opts });
function part(name, geometry, material, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = []) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.position.set(x, y, z);
  m.rotation.set(rx * D, ry * D, rz * D);
  return m;
}
function pivot(name, [x = 0, y = 0, z = 0] = [], ...children) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  if (children.length) g.add(...children);
  return g;
}
const q = (x, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D)).toArray();
function rotTrack(node, times, eulers) {
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, eulers.flatMap((e) => q(...e)));
}
function posTrack(node, times, positions) {
  return new THREE.VectorKeyframeTrack(`${node}.position`, times, positions.flat());
}

const TEAM = { blue: '#2f7fe0', red: '#e23b4c' };
const SKIN = '#f2c29b';

/**
 * Humanoid with named pivots (hips, torso, head, arms, legs) and Idle / Walk /
 * Attack clips. Faces -Z (the engine's forward). Feet at y = 0.
 */
function humanoid(id, { team, body, scale = 1, weapon = 'sword', helmet = '#9aa3b2', skin = SKIN, bulky = 1 }) {
  const n = (s) => `${id}_${s}`;
  const teamMat = mat(team);
  const bodyMat = mat(body);
  const skinMat = mat(skin);
  const metal = mat(helmet, { metalness: 0.6, roughness: 0.35 });
  const legL = pivot(n('legL'), [-0.12 * bulky, 0, 0], part(n('legLm'), new THREE.BoxGeometry(0.16 * bulky, 0.5, 0.18), bodyMat, [0, -0.25, 0]));
  const legR = pivot(n('legR'), [0.12 * bulky, 0, 0], part(n('legRm'), new THREE.BoxGeometry(0.16 * bulky, 0.5, 0.18), bodyMat, [0, -0.25, 0]));
  const weaponMesh =
    weapon === 'sword'
      ? pivot(n('sword'), [0, -0.38, -0.05], part(n('blade'), new THREE.BoxGeometry(0.05, 0.62, 0.1), metal, [0, -0.02, -0.28], [90, 0, 0]), part(n('guard'), new THREE.BoxGeometry(0.22, 0.05, 0.08), mat('#8a6a2f'), [0, 0, -0.02]))
      : weapon === 'bow'
        ? pivot(n('bow'), [0, -0.36, -0.06], part(n('bowm'), new THREE.TorusGeometry(0.28, 0.025, 6, 16, Math.PI), mat('#8a5a2b'), [0, 0, 0], [0, 90, 90]))
        : weapon === 'club'
          ? pivot(n('club'), [0, -0.38, -0.05], part(n('clubm'), new THREE.CylinderGeometry(0.12, 0.06, 0.7, 7), mat('#6b4423'), [0, 0, -0.3], [90, 0, 0]))
          : pivot(n('staff'), [0, -0.38, -0.05], part(n('staffm'), new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), mat('#5b3a8c'), [0, 0, -0.2], [90, 0, 0]), part(n('orb'), new THREE.IcosahedronGeometry(0.1, 0), mat('#c084fc', { emissive: '#a855f7', emissiveIntensity: 2 }), [0, 0, -0.66]));
  const armL = pivot(n('armL'), [-0.3 * bulky, 0.42, 0], part(n('armLm'), new THREE.BoxGeometry(0.13 * bulky, 0.42, 0.14 * bulky), bodyMat, [0, -0.2, 0]), part(n('handL'), new THREE.SphereGeometry(0.07 * bulky, 8, 6), skinMat, [0, -0.43, 0]));
  const armR = pivot(n('armR'), [0.3 * bulky, 0.42, 0], part(n('armRm'), new THREE.BoxGeometry(0.13 * bulky, 0.42, 0.14 * bulky), bodyMat, [0, -0.2, 0]), part(n('handR'), new THREE.SphereGeometry(0.07 * bulky, 8, 6), skinMat, [0, -0.43, 0]), weapon === 'bow' ? new THREE.Group() : weaponMesh);
  if (weapon === 'bow') armL.add(weaponMesh);
  if (weapon === 'sword') armL.add(part(n('shield'), new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), teamMat, [-0.07, -0.25, -0.08], [90, 0, 90]));
  const head = pivot(
    n('head'),
    [0, 0.55, 0],
    part(n('face'), new THREE.SphereGeometry(0.17 * bulky, 12, 10), skinMat, [0, 0.12, 0]),
    part(n('helmet'), new THREE.SphereGeometry(0.19 * bulky, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), weapon === 'bow' ? teamMat : metal, [0, 0.15, 0]),
    part(n('eyeL'), new THREE.SphereGeometry(0.025, 6, 4), mat('#111'), [-0.06, 0.13, -0.15]),
    part(n('eyeR'), new THREE.SphereGeometry(0.025, 6, 4), mat('#111'), [0.06, 0.13, -0.15]),
  );
  const torso = pivot(n('torso'), [0, 0.05, 0], part(n('chest'), new THREE.BoxGeometry(0.46 * bulky, 0.5, 0.28 * bulky), teamMat, [0, 0.22, 0]), part(n('belt'), new THREE.BoxGeometry(0.48 * bulky, 0.08, 0.3 * bulky), mat('#4a3520'), [0, 0, 0]), head, armL, armR);
  const hips = pivot(n('hips'), [0, 0.55, 0], torso, legL, legR);
  const model = pivot(id, [0, 0, 0], hips);
  model.scale.setScalar(scale);

  const idle = new THREE.AnimationClip('Idle', 1.6, [
    posTrack(n('hips'), [0, 0.8, 1.6], [[0, 0.55, 0], [0, 0.575, 0], [0, 0.55, 0]]),
    rotTrack(n('armL'), [0, 0.8, 1.6], [[0, 0, 4], [0, 0, 8], [0, 0, 4]]),
    rotTrack(n('armR'), [0, 0.8, 1.6], [[0, 0, -4], [0, 0, -8], [0, 0, -4]]),
    rotTrack(n('head'), [0, 0.8, 1.6], [[0, -6, 0], [0, 6, 0], [0, -6, 0]]),
  ]);
  const walk = new THREE.AnimationClip('Walk', 0.7, [
    rotTrack(n('legL'), [0, 0.175, 0.35, 0.525, 0.7], [[35, 0, 0], [0, 0, 0], [-35, 0, 0], [0, 0, 0], [35, 0, 0]]),
    rotTrack(n('legR'), [0, 0.175, 0.35, 0.525, 0.7], [[-35, 0, 0], [0, 0, 0], [35, 0, 0], [0, 0, 0], [-35, 0, 0]]),
    rotTrack(n('armL'), [0, 0.35, 0.7], [[-30, 0, 5], [30, 0, 5], [-30, 0, 5]]),
    rotTrack(n('armR'), [0, 0.35, 0.7], [[30, 0, -5], [-30, 0, -5], [30, 0, -5]]),
    posTrack(n('hips'), [0, 0.175, 0.35, 0.525, 0.7], [[0, 0.55, 0], [0, 0.6, 0], [0, 0.55, 0], [0, 0.6, 0], [0, 0.55, 0]]),
    rotTrack(n('torso'), [0, 0.35, 0.7], [[4, 6, 0], [4, -6, 0], [4, 6, 0]]),
  ]);
  const attack =
    weapon === 'bow'
      ? new THREE.AnimationClip('Attack', 0.6, [
          rotTrack(n('armL'), [0, 0.2, 0.45, 0.6], [[0, 0, 5], [-90, 0, 0], [-90, 0, 0], [0, 0, 5]]),
          rotTrack(n('armR'), [0, 0.2, 0.4, 0.45, 0.6], [[0, 0, -5], [-90, 0, 20], [-80, 0, 50], [-90, 0, 0], [0, 0, -5]]),
          rotTrack(n('torso'), [0, 0.3, 0.6], [[0, 0, 0], [0, 25, 0], [0, 0, 0]]),
        ])
      : new THREE.AnimationClip('Attack', 0.6, [
          rotTrack(n('armR'), [0, 0.25, 0.38, 0.6], [[0, 0, -5], [-150, 0, -10], [40, 0, -10], [0, 0, -5]]),
          rotTrack(n('torso'), [0, 0.25, 0.38, 0.6], [[0, 0, 0], [0, -20, 0], [8, 25, 0], [0, 0, 0]]),
          posTrack(n('hips'), [0, 0.38, 0.6], [[0, 0.55, 0], [0, 0.5, -0.05], [0, 0.55, 0]]),
        ]);
  return { scene: model, animations: [idle, walk, attack] };
}

function tower(id, team, { king = false } = {}) {
  const n = (s) => `${id}_${s}`;
  const stone = mat('#b9b2a5');
  const dark = mat('#8c857a');
  const r = king ? 1.15 : 0.85;
  const h = king ? 2.2 : 1.8;
  const g = pivot(id, [0, 0, 0]);
  g.add(part(n('base'), new THREE.CylinderGeometry(r * 1.12, r * 1.25, 0.35, 10), dark, [0, 0.175, 0]));
  g.add(part(n('body'), new THREE.CylinderGeometry(r, r * 1.08, h, 10), stone, [0, 0.35 + h / 2, 0]));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.add(part(n(`merlon${i}`), new THREE.BoxGeometry(0.28, 0.32, 0.22), stone, [Math.cos(a) * r, 0.5 + h, Math.sin(a) * r], [0, -a / D, 0]));
  }
  g.add(part(n('roof'), new THREE.ConeGeometry(r * 0.75, king ? 1.1 : 0.8, 10), mat(team), [0, 0.35 + h + (king ? 0.75 : 0.6), 0]));
  g.add(part(n('door'), new THREE.BoxGeometry(0.42, 0.62, 0.1), mat('#5a3c22'), [0, 0.65, -r * 1.02]));
  const flag = pivot(n('flag'), [0, 0.35 + h + (king ? 1.3 : 1.0), 0], part(n('pole'), new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), mat('#6b5236'), [0, 0.45, 0]), part(n('cloth'), new THREE.BoxGeometry(0.5, 0.3, 0.03), mat(team), [0.27, 0.75, 0]));
  g.add(flag);
  if (king) {
    const crown = pivot(n('crown'), [0, 0.35 + h + 1.45, 0]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      crown.add(part(n(`spike${i}`), new THREE.ConeGeometry(0.08, 0.22, 4), mat('#facc15', { metalness: 0.7, roughness: 0.3 }), [Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22]));
    }
    g.add(crown);
  }
  const idle = new THREE.AnimationClip('Idle', 2, [rotTrack(n('flag'), [0, 0.5, 1, 1.5, 2], [[0, 0, 0], [0, 25, 0], [0, 0, 0], [0, -25, 0], [0, 0, 0]])]);
  const attack = new THREE.AnimationClip('Attack', 0.4, [posTrack(n('roof'), [0, 0.1, 0.4], [[0, 0.35 + h + (king ? 0.75 : 0.6), 0], [0, 0.35 + h + (king ? 0.85 : 0.7), 0], [0, 0.35 + h + (king ? 0.75 : 0.6), 0]])]);
  return { scene: g, animations: [idle, attack] };
}

function building(id) {
  const n = (s) => `${id}_${s}`;
  const g = pivot(id);
  const anims = [];
  if (id === 'town_hall') {
    g.add(part(n('base'), new THREE.BoxGeometry(2.6, 0.3, 2.6), mat('#8c857a'), [0, 0.15, 0]));
    g.add(part(n('walls'), new THREE.BoxGeometry(2.2, 1.5, 2.2), mat('#e9dcc1'), [0, 1.05, 0]));
    g.add(part(n('roof'), new THREE.ConeGeometry(1.9, 1.3, 4), mat('#c2413b'), [0, 2.45, 0], [0, 45, 0]));
    g.add(part(n('door'), new THREE.BoxGeometry(0.6, 0.85, 0.08), mat('#5a3c22'), [0, 0.72, -1.12]));
    for (const x of [-0.65, 0.65]) g.add(part(n(`win${x}`), new THREE.BoxGeometry(0.35, 0.35, 0.06), mat('#7dd3fc', { emissive: '#1e3a5f', emissiveIntensity: 0.6 }), [x, 1.2, -1.12]));
    const flag = pivot(n('flag'), [0, 3.1, 0], part(n('pole'), new THREE.CylinderGeometry(0.04, 0.04, 1, 6), mat('#6b5236'), [0, 0.5, 0]), part(n('cloth'), new THREE.BoxGeometry(0.6, 0.36, 0.03), mat('#facc15'), [0.32, 0.8, 0]));
    g.add(flag);
    anims.push(new THREE.AnimationClip('Idle', 2, [rotTrack(n('flag'), [0, 0.5, 1, 1.5, 2], [[0, 0, 0], [0, 30, 0], [0, 0, 0], [0, -30, 0], [0, 0, 0]])]));
  } else if (id === 'house') {
    g.add(part(n('walls'), new THREE.BoxGeometry(1.4, 1, 1.4), mat('#f1e3c6'), [0, 0.5, 0]));
    g.add(part(n('roof'), new THREE.ConeGeometry(1.25, 0.9, 4), mat('#8b5e34'), [0, 1.45, 0], [0, 45, 0]));
    g.add(part(n('door'), new THREE.BoxGeometry(0.35, 0.55, 0.06), mat('#5a3c22'), [0, 0.28, -0.72]));
    g.add(part(n('chimney'), new THREE.BoxGeometry(0.22, 0.5, 0.22), mat('#9a9087'), [0.35, 1.6, 0.25]));
  } else if (id === 'gold_mine') {
    g.add(part(n('mound'), new THREE.DodecahedronGeometry(0.95, 0), mat('#8f8578'), [0, 0.45, 0.2], [0, 0, 0]));
    g.add(part(n('entrance'), new THREE.BoxGeometry(0.6, 0.6, 0.3), mat('#3b2a1a'), [0, 0.3, -0.62]));
    for (let i = 0; i < 5; i++) g.add(part(n(`nugget${i}`), new THREE.OctahedronGeometry(0.12, 0), mat('#facc15', { metalness: 0.8, roughness: 0.25, emissive: '#7a5a00', emissiveIntensity: 0.4 }), [Math.cos(i * 1.3) * 0.6, 0.85 + (i % 2) * 0.1, Math.sin(i * 1.3) * 0.5 + 0.2]));
    const wheel = pivot(n('wheel'), [0.9, 0.55, -0.4], part(n('wheelm'), new THREE.TorusGeometry(0.32, 0.05, 6, 14), mat('#6b4423'), [0, 0, 0], [0, 90, 0]), part(n('spokes'), new THREE.BoxGeometry(0.04, 0.62, 0.04), mat('#6b4423')), part(n('spokes2'), new THREE.BoxGeometry(0.04, 0.04, 0.62), mat('#6b4423')));
    g.add(wheel);
    anims.push(new THREE.AnimationClip('Work', 2, [rotTrack(n('wheel'), [0, 0.5, 1, 1.5, 2], [[0, 0, 0], [90, 0, 0], [180, 0, 0], [270, 0, 0], [360, 0, 0]])]));
  } else if (id === 'cannon') {
    g.add(part(n('base'), new THREE.CylinderGeometry(0.6, 0.7, 0.4, 10), mat('#7d766c'), [0, 0.2, 0]));
    const head = pivot(n('turret'), [0, 0.55, 0], part(n('body'), new THREE.SphereGeometry(0.38, 12, 10), mat('#3f3f46', { metalness: 0.5, roughness: 0.4 })), part(n('barrel'), new THREE.CylinderGeometry(0.13, 0.16, 0.8, 10), mat('#27272a', { metalness: 0.6, roughness: 0.35 }), [0, 0.05, -0.45], [90, 0, 0]));
    g.add(head);
    anims.push(new THREE.AnimationClip('Idle', 3, [rotTrack(n('turret'), [0, 1.5, 3], [[0, -20, 0], [0, 20, 0], [0, -20, 0]])]));
    anims.push(new THREE.AnimationClip('Attack', 0.35, [posTrack(n('turret'), [0, 0.08, 0.35], [[0, 0.55, 0], [0, 0.55, 0.15], [0, 0.55, 0]])]));
  } else if (id === 'wall') {
    g.add(part(n('block'), new THREE.BoxGeometry(1, 0.8, 0.5), mat('#a8a29e'), [0, 0.4, 0]));
    g.add(part(n('top'), new THREE.BoxGeometry(1.05, 0.12, 0.55), mat('#78716c'), [0, 0.86, 0]));
  } else if (id === 'tree') {
    g.add(part(n('trunk'), new THREE.CylinderGeometry(0.12, 0.18, 0.9, 7), mat('#7c5230'), [0, 0.45, 0]));
    g.add(part(n('leaves1'), new THREE.IcosahedronGeometry(0.62, 0), mat('#3f9d4a'), [0, 1.2, 0]));
    g.add(part(n('leaves2'), new THREE.IcosahedronGeometry(0.42, 0), mat('#58b85f'), [0.2, 1.65, 0.1]));
  } else if (id === 'pine') {
    g.add(part(n('trunk'), new THREE.CylinderGeometry(0.1, 0.14, 0.6, 6), mat('#7c5230'), [0, 0.3, 0]));
    for (let i = 0; i < 3; i++) g.add(part(n(`cone${i}`), new THREE.ConeGeometry(0.7 - i * 0.18, 0.8, 7), mat(i % 2 ? '#2f7d4f' : '#2a6d45'), [0, 0.8 + i * 0.45, 0]));
  } else if (id === 'rock') {
    g.add(part(n('rock'), new THREE.DodecahedronGeometry(0.5, 0), mat('#8b8f99'), [0, 0.35, 0], [10, 20, 5]));
    g.add(part(n('pebble'), new THREE.DodecahedronGeometry(0.22, 0), mat('#a1a6b0'), [0.45, 0.15, 0.2]));
  } else if (id === 'crystal') {
    const c = pivot(n('gem'), [0, 0.7, 0], part(n('gemm'), new THREE.OctahedronGeometry(0.45, 0), mat('#a78bfa', { emissive: '#7c3aed', emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.2 }), [0, 0, 0], [0, 0, 0]));
    g.add(c, part(n('base'), new THREE.CylinderGeometry(0.35, 0.45, 0.2, 8), mat('#6b7280'), [0, 0.1, 0]));
    anims.push(new THREE.AnimationClip('Idle', 3, [rotTrack(n('gem'), [0, 1, 2, 3], [[0, 0, 0], [0, 120, 0], [0, 240, 0], [0, 360, 0]]), posTrack(n('gem'), [0, 1.5, 3], [[0, 0.7, 0], [0, 0.85, 0], [0, 0.7, 0]])]));
  } else if (id === 'coin') {
    const c = pivot(n('disc'), [0, 0.5, 0], part(n('discm'), new THREE.CylinderGeometry(0.35, 0.35, 0.08, 20), mat('#fbbf24', { metalness: 0.85, roughness: 0.25, emissive: '#7a5a00', emissiveIntensity: 0.3 }), [0, 0, 0], [90, 0, 0]));
    g.add(c);
    anims.push(new THREE.AnimationClip('Spin', 1.2, [rotTrack(n('disc'), [0, 0.4, 0.8, 1.2], [[0, 0, 0], [0, 120, 0], [0, 240, 0], [0, 360, 0]])]));
  } else if (id === 'train') {
    g.add(part(n('body'), new THREE.BoxGeometry(0.7, 0.5, 1.4), mat('#f8fafc', { roughness: 0.4 }), [0, 0.4, 0]));
    g.add(part(n('stripe'), new THREE.BoxGeometry(0.72, 0.12, 1.42), mat('#e63946'), [0, 0.32, 0]));
    g.add(part(n('windows'), new THREE.BoxGeometry(0.72, 0.16, 1.1), mat('#1e293b', { roughness: 0.2, metalness: 0.4 }), [0, 0.52, 0]));
    for (const z of [-0.45, 0.45]) for (const x of [-0.3, 0.3]) g.add(part(n(`w${x}${z}`), new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), mat('#111827'), [x, 0.12, z], [0, 0, 90]));
  } else if (id === 'car') {
    g.add(part(n('body'), new THREE.BoxGeometry(0.8, 0.35, 1.5), mat('#3b82f6', { roughness: 0.35, metalness: 0.3 }), [0, 0.35, 0]));
    g.add(part(n('cabin'), new THREE.BoxGeometry(0.7, 0.32, 0.8), mat('#dbeafe', { roughness: 0.15, metalness: 0.2 }), [0, 0.66, 0.05]));
    const wheels = [];
    for (const z of [-0.5, 0.5]) for (const x of [-0.42, 0.42]) {
      const name = `wheel${x > 0 ? 'R' : 'L'}${z > 0 ? 'B' : 'F'}`;
      g.add(pivot(n(name), [x, 0.18, z], part(n(`${name}m`), new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12), mat('#111827'), [0, 0, 0], [0, 0, 90])));
      wheels.push(n(name));
    }
    anims.push(new THREE.AnimationClip('Drive', 0.6, wheels.map((w) => rotTrack(w, [0, 0.2, 0.4, 0.6], [[0, 0, 0], [-120, 0, 0], [-240, 0, 0], [-360, 0, 0]]))));
  }
  return { scene: g, animations: anims };
}

async function exportGlb(file, { scene, animations }) {
  scene.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(scene, { binary: true, animations, onlyVisible: true });
  writeFileSync(path.join(OUT, 'models', file), Buffer.from(glb));
}

const MODELS = [];
for (const team of ['blue', 'red']) {
  MODELS.push([`knight_${team}.glb`, `Knight (${team})`, humanoid(`Knight_${team}`, { team: TEAM[team], body: '#59607a' }), ['character', 'unit', team]]);
  MODELS.push([`archer_${team}.glb`, `Archer (${team})`, humanoid(`Archer_${team}`, { team: TEAM[team], body: '#4d6b3c', weapon: 'bow', scale: 0.92 }), ['character', 'unit', team]]);
  MODELS.push([`giant_${team}.glb`, `Giant (${team})`, humanoid(`Giant_${team}`, { team: TEAM[team], body: '#7a5b3a', weapon: 'club', scale: 1.55, bulky: 1.35, helmet: '#7a5b3a' }), ['character', 'unit', team]]);
  MODELS.push([`wizard_${team}.glb`, `Wizard (${team})`, humanoid(`Wizard_${team}`, { team: TEAM[team], body: '#3b2f6b', weapon: 'staff', helmet: '#4c1d95' }), ['character', 'unit', team]]);
  MODELS.push([`tower_${team}.glb`, `Crown Tower (${team})`, tower(`Tower_${team}`, TEAM[team]), ['building', 'tower', team]]);
  MODELS.push([`king_tower_${team}.glb`, `King Tower (${team})`, tower(`King_${team}`, TEAM[team], { king: true }), ['building', 'tower', team]]);
}
MODELS.push(['goblin.glb', 'Goblin', humanoid('Goblin', { team: '#65a30d', body: '#3f6212', skin: '#84cc16', scale: 0.75, helmet: '#57534e' }), ['character', 'enemy']]);
for (const [id, label, tags] of [
  ['town_hall', 'Town Hall', ['building']],
  ['house', 'House', ['building']],
  ['gold_mine', 'Gold Mine', ['building', 'resource']],
  ['cannon', 'Cannon', ['building', 'defense']],
  ['wall', 'Wall', ['building']],
  ['tree', 'Tree', ['nature']],
  ['pine', 'Pine Tree', ['nature']],
  ['rock', 'Rock', ['nature']],
  ['crystal', 'Crystal', ['prop', 'resource']],
  ['coin', 'Coin', ['prop', 'pickup']],
  ['train', 'Train Car', ['vehicle']],
  ['car', 'Car', ['vehicle']],
])
  MODELS.push([`${id}.glb`, label, building(id), tags]);

for (const [file, name, model, tags] of MODELS) {
  await exportGlb(file, model);
  add({ id: `model-${file.replace('.glb', '')}`, name, type: 'model', url: `/samples/models/${file}`, tags, clips: model.animations.map((a) => a.name) });
}
console.log(`✓ ${MODELS.length} models`);

// ═══════════════════════════════════════════ SPRITES (SVG)
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
function writeSvg(file, name, content, tags, extra = {}) {
  writeFileSync(path.join(OUT, 'sprites', file), content);
  add({ id: `sprite-${file.replace('.svg', '')}`, name, type: 'image', url: `/samples/sprites/${file}`, tags, ...extra });
}
// Hero run cycle: 4 frames of 64×64.
const heroFrame = (i) => {
  const ph = (i / 4) * Math.PI * 2;
  const leg = Math.sin(ph) * 14;
  const arm = -Math.sin(ph) * 16;
  const bob = Math.abs(Math.cos(ph)) * 2;
  const x = i * 64;
  return `<g transform="translate(0,${-bob.toFixed(2)})">
    <line x1="${x + 30}" y1="44" x2="${x + 30 + leg * 0.6}" y2="60" stroke="#1e3a8a" stroke-width="7" stroke-linecap="round"/>
    <line x1="${x + 34}" y1="44" x2="${x + 34 - leg * 0.6}" y2="60" stroke="#1d4ed8" stroke-width="7" stroke-linecap="round"/>
    <rect x="${x + 22}" y="24" width="20" height="22" rx="6" fill="#4361ee"/>
    <line x1="${x + 32}" y1="30" x2="${x + 32 + arm * 0.7}" y2="42" stroke="#f2c29b" stroke-width="6" stroke-linecap="round"/>
    <circle cx="${x + 33}" cy="16" r="10" fill="#f2c29b"/>
    <path d="M${x + 22} 13 q11 -12 22 0 v-3 q-11 -9 -22 0z" fill="#7c2d12"/>
    <circle cx="${x + 37}" cy="16" r="1.8" fill="#111"/>
  </g>`;
};
writeSvg('hero_run.svg', 'Hero run (4-frame sheet)', svg(256, 64, [0, 1, 2, 3].map(heroFrame).join('')), ['character', 'sheet'], { columns: 4, rows: 1 });
writeSvg(
  'coin_spin.svg',
  'Coin spin (6-frame sheet)',
  svg(384, 64, [0, 1, 2, 3, 4, 5].map((i) => { const w = Math.max(3, Math.abs(Math.cos((i / 6) * Math.PI)) * 24); return `<ellipse cx="${i * 64 + 32}" cy="32" rx="${w}" ry="24" fill="#fbbf24" stroke="#b45309" stroke-width="3"/><ellipse cx="${i * 64 + 32}" cy="32" rx="${w * 0.5}" ry="14" fill="none" stroke="#fde68a" stroke-width="3"/>`; }).join('')),
  ['pickup', 'sheet'],
  { columns: 6, rows: 1 },
);
writeSvg(
  'explosion.svg',
  'Explosion (6-frame sheet)',
  svg(384, 64, [0, 1, 2, 3, 4, 5].map((i) => { const r = 6 + i * 5; const o = 1 - i / 6; return `<g opacity="${o.toFixed(2)}"><circle cx="${i * 64 + 32}" cy="32" r="${r}" fill="#f97316"/><circle cx="${i * 64 + 32}" cy="32" r="${r * 0.65}" fill="#fde047"/><circle cx="${i * 64 + 32}" cy="32" r="${r * 0.3}" fill="#fff"/></g>`; }).join('')),
  ['fx', 'sheet'],
  { columns: 6, rows: 1 },
);
const tile = (fill, detail) => svg(64, 64, `<rect width="64" height="64" fill="${fill}"/>${detail}`);
writeSvg('tile_grass.svg', 'Grass tile', tile('#4caf50', '<rect y="0" width="64" height="10" fill="#66bb6a"/><path d="M8 10l3-6 3 6M30 10l3-7 3 7M50 10l3-5 3 5" stroke="#2e7d32" stroke-width="2" fill="none"/>'), ['tile']);
writeSvg('tile_dirt.svg', 'Dirt tile', tile('#8d5a3b', '<circle cx="14" cy="20" r="3" fill="#6d4c41"/><circle cx="44" cy="40" r="4" fill="#6d4c41"/><circle cx="30" cy="54" r="2" fill="#a1887f"/>'), ['tile']);
writeSvg('tile_stone.svg', 'Stone tile', tile('#78716c', '<path d="M0 32h64M32 0v32M16 32v32M48 32v32" stroke="#57534e" stroke-width="3"/>'), ['tile']);
writeSvg('tile_water.svg', 'Water tile', tile('#3b82f6', '<path d="M4 20q8-6 16 0t16 0 16 0M4 44q8-6 16 0t16 0 16 0" stroke="#93c5fd" stroke-width="3" fill="none"/>'), ['tile']);
writeSvg('station_circle.svg', 'Station ●', svg(64, 64, '<circle cx="32" cy="32" r="24" fill="#fff" stroke="#111" stroke-width="7"/>'), ['metro']);
writeSvg('station_triangle.svg', 'Station ▲', svg(64, 64, '<path d="M32 8 L58 54 H6 Z" fill="#fff" stroke="#111" stroke-width="7" stroke-linejoin="round"/>'), ['metro']);
writeSvg('station_square.svg', 'Station ■', svg(64, 64, '<rect x="9" y="9" width="46" height="46" fill="#fff" stroke="#111" stroke-width="7"/>'), ['metro']);
writeSvg('heart.svg', 'Heart icon', svg(64, 64, '<path d="M32 56 C8 40 4 24 14 14 c8-8 18-4 18 4 c0-8 10-12 18-4 c10 10 6 26 -18 42z" fill="#ef4444" stroke="#7f1d1d" stroke-width="3"/>'), ['ui']);
writeSvg('gem.svg', 'Gem icon', svg(64, 64, '<path d="M14 24 L24 10 H40 L50 24 L32 56 Z" fill="#a855f7" stroke="#4c1d95" stroke-width="3"/><path d="M14 24 H50 M24 10 L32 24 L40 10 M32 24 V56" stroke="#e9d5ff" stroke-width="2" fill="none"/>'), ['ui']);
writeSvg('hills_bg.svg', 'Hills background', svg(1024, 256, '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#e0f2fe"/></linearGradient></defs><rect width="1024" height="256" fill="url(#s)"/><path d="M0 200 Q160 110 320 190 T640 180 T1024 170 V256 H0Z" fill="#86efac"/><path d="M0 230 Q200 170 420 220 T820 210 T1024 220 V256 H0Z" fill="#4ade80"/>'), ['background']);
console.log('✓ sprites');

// ═══════════════════════════════════════════ AUDIO
const RATE = 22050;
function encodeMp3(file, samples, bitrate = '96k') {
  const wav = path.join(OUT, 'audio', `${file}.wav`);
  const pcm = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0 ? 0.92 / peak : 1;
  samples.forEach((s, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * norm)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(wav, Buffer.concat([header, pcm]));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', bitrate, path.join(OUT, 'audio', `${file}.mp3`)]);
  rmSync(wav);
}
const buf = (sec) => new Float32Array(Math.ceil(sec * RATE));
const freq = (note) => 440 * 2 ** ((note - 69) / 12);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function tone(out, start, dur, f0, { type = 'square', vol = 0.3, f1 = f0, attack = 0.005, release = 0.08 } = {}) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  let phase = 0;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / RATE;
    const f = f0 + (f1 - f0) * (i / n);
    phase += f / RATE;
    const p = phase % 1;
    const w = type === 'square' ? (p < 0.5 ? 1 : -1) * 0.6 : type === 'saw' ? 2 * p - 1 : type === 'tri' ? 1 - 4 * Math.abs(p - 0.5) : type === 'noise' ? rand() : Math.sin(phase * Math.PI * 2);
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    out[s0 + i] += w * vol * Math.max(0, env);
  }
}
function pluck(out, start, f, dur = 0.5, vol = 0.5) {
  // Karplus-Strong string (bow twang / harp).
  const period = Math.round(RATE / f);
  const ring = Float32Array.from({ length: period }, () => rand());
  const s0 = Math.floor(start * RATE);
  for (let i = 0; i < dur * RATE && s0 + i < out.length; i++) {
    const k = i % period;
    const next = (k + 1) % period;
    ring[k] = 0.5 * (ring[k] + ring[next]) * 0.996;
    out[s0 + i] += ring[k] * vol;
  }
}

// Music: 8-bar chiptune loop at 120 BPM (exactly 16 s → seamless loop).
{
  const bpm = 120;
  const beat = 60 / bpm;
  const bars = 8;
  const out = buf(bars * 4 * beat);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar % 4];
    const t0 = bar * 4 * beat;
    for (let i = 0; i < 8; i++) tone(out, t0 + i * beat * 0.5, beat * 0.45, freq(chord[0] - 24 + (i % 2 ? 12 : 0)), { type: 'tri', vol: 0.35 });
    for (let i = 0; i < 16; i++) tone(out, t0 + i * beat * 0.25, beat * 0.22, freq(chord[i % 3] + 12 + (bar >= 4 && i % 8 > 5 ? 12 : 0)), { type: 'square', vol: 0.08 });
    const melody = bar % 2 ? [0, 2, 4, 2, 7, 4, 2, 0] : [4, 4, 7, 9, 7, 4, 2, 4];
    if (bar >= 2) melody.forEach((m, i) => tone(out, t0 + i * beat * 0.5, beat * 0.42, freq(chord[0] + 12 + m), { type: 'square', vol: 0.12, release: 0.05 }));
    for (let b = 0; b < 4; b++) {
      tone(out, t0 + b * beat, 0.12, 120, { type: 'sine', vol: 0.6, f1: 40, release: 0.05 });
      tone(out, t0 + b * beat + beat * 0.5, 0.04, 0, { type: 'noise', vol: 0.12 });
      if (b % 2) tone(out, t0 + b * beat, 0.09, 0, { type: 'noise', vol: 0.25 });
    }
  }
  encodeMp3('music_adventure_loop', out, '96k');
  add({ id: 'audio-music', name: 'Adventure music (loop)', type: 'audio', url: '/samples/audio/music_adventure_loop.mp3', tags: ['music', 'loop'] });
}
const SFX = {
  ui_click: (o) => tone(o, 0, 0.05, 1200, { type: 'sine', vol: 0.5, f1: 900 }),
  coin_pickup: (o) => (tone(o, 0, 0.07, 988, { vol: 0.3 }), tone(o, 0.07, 0.22, 1319, { vol: 0.3 })),
  sword_slash: (o) => (tone(o, 0, 0.18, 0, { type: 'noise', vol: 0.4, release: 0.15 }), tone(o, 0.12, 0.12, 180, { type: 'sine', vol: 0.5, f1: 60 })),
  bow_shot: (o) => (pluck(o, 0, 196, 0.45, 0.6), tone(o, 0.02, 0.12, 0, { type: 'noise', vol: 0.15 })),
  explosion: (o) => (tone(o, 0, 0.9, 0, { type: 'noise', vol: 0.8, release: 0.7 }), tone(o, 0, 0.5, 90, { type: 'sine', vol: 0.8, f1: 30 })),
  build_place: (o) => [0, 4, 7, 12].forEach((n, i) => tone(o, i * 0.06, 0.18, freq(60 + n), { type: 'tri', vol: 0.4 })),
  magic_cast: (o) => { for (let i = 0; i < 10; i++) tone(o, i * 0.04, 0.25, freq(72 + ((i * 5) % 12)), { type: 'sine', vol: 0.18 }); },
  victory: (o) => [[60, 0], [64, 0.15], [67, 0.3], [72, 0.45], [67, 0.75], [72, 0.9]].forEach(([n, t]) => tone(o, t, n === 72 && t > 0.8 ? 0.7 : 0.14, freq(n), { vol: 0.3 })),
  defeat: (o) => [[67, 0], [63, 0.25], [60, 0.5], [55, 0.75]].forEach(([n, t]) => tone(o, t, 0.4, freq(n), { type: 'tri', vol: 0.4 })),
  hit_hurt: (o) => tone(o, 0, 0.2, 400, { type: 'saw', vol: 0.4, f1: 90 }),
};
for (const [name, fn] of Object.entries(SFX)) {
  const out = buf(1.2);
  fn(out);
  let end = out.length;
  while (end > RATE * 0.05 && Math.abs(out[end - 1]) < 1e-4) end--;
  encodeMp3(name, out.subarray(0, end + 200), '64k');
  add({ id: `audio-${name}`, name: name.replace(/_/g, ' '), type: 'audio', url: `/samples/audio/${name}.mp3`, tags: ['sfx'] });
}
console.log('✓ audio');

// ═══════════════════════════════════════════ VIDEO
async function renderVideo(file, w, h, seconds, fps, pixel) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', path.join(OUT, 'video', file)]);
  const done = new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
  const frame = Buffer.alloc(w * h * 3);
  for (let f = 0; f < seconds * fps; f++) {
    const t = f / fps;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = pixel(x / w, y / h, t);
        const i = (y * w + x) * 3;
        frame[i] = r;
        frame[i + 1] = g;
        frame[i + 2] = b;
      }
    if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
}
const clamp255 = (v) => Math.max(0, Math.min(255, v | 0));
// Seamless 6 s aurora loop with drifting glowing orbs (hero background / in-game screens).
await renderVideo('aurora_loop.mp4', 640, 360, 6, 30, (u, v, t) => {
  const T = (t / 6) * Math.PI * 2;
  const a = Math.sin(u * 6 + T) + Math.sin(v * 5 - T * 2 + u * 3) + Math.sin((u + v) * 4 + T);
  let r = 40 + 60 * Math.sin(a + 1.5) + 40;
  let g = 20 + 40 * Math.sin(a + 3) + 30;
  let b = 90 + 90 * Math.sin(a) + 60;
  for (let k = 0; k < 5; k++) {
    const ox = 0.5 + 0.38 * Math.cos(T + k * 1.256);
    const oy = 0.5 + 0.3 * Math.sin(T * 2 + k * 2.1);
    const d = (u - ox) ** 2 * 3 + (v - oy) ** 2;
    const glow = 0.0025 / (d + 0.002);
    r += glow * (k % 2 ? 60 : 200);
    g += glow * 140;
    b += glow * 255;
  }
  const vignette = 1 - ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 1.2;
  return [clamp255(r * vignette), clamp255(g * vignette), clamp255(b * vignette)];
});
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'mandelbrot=size=480x270:rate=24:start_scale=3:end_scale=0.05:end_pts=120', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', path.join(OUT, 'video', 'fractal_zoom.mp4')]);
add({ id: 'video-aurora', name: 'Aurora loop (video)', type: 'video', url: '/samples/video/aurora_loop.mp4', tags: ['background', 'loop'] });
add({ id: 'video-fractal', name: 'Fractal zoom (video)', type: 'video', url: '/samples/video/fractal_zoom.mp4', tags: ['cutscene'] });
console.log('✓ video');

for (const m of manifest) {
  const file = path.join(root, 'apps/studio/public', m.url);
  m.size = statSync(file).size;
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ version: 1, license: 'CC0-1.0', items: manifest }, null, 1));
writeFileSync(
  path.join(OUT, 'LICENSE.md'),
  '# Starter Content license\n\nEverything in this folder was generated by `scripts/generate-samples.mjs` for Bazi-Sazi and is released under **CC0 1.0** (public domain). Use it in any game, commercial or not, no attribution required.\n',
);
console.log(`✓ manifest: ${manifest.length} items → ${path.relative(root, OUT)}`);
