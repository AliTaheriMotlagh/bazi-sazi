import type { AssetType, ComponentData, EntityData, ProjectData, Vec3 } from '../types';
import { uid } from '../util';
import { comp, createEntity, createPrefab, createProject, createScript } from './defaults';

/**
 * Strategy templates built from Starter Content (/samples). They double as
 * reference implementations of the strategy components.
 */

interface T {
  p?: Vec3;
  r?: Vec3;
  s?: Vec3;
  tags?: string[];
  parent?: EntityData;
}
const E = (name: string, t: T, ...components: ComponentData[]): EntityData =>
  createEntity({ name, position: t.p, rotation: t.r, scale: t.s, tags: t.tags, parent: t.parent?.id ?? null, components });

/** Register a Starter Content file as a project asset and return its id. */
function sample(project: ProjectData, name: string, type: AssetType, url: string): string {
  const existing = project.assets.find((a) => a.url === url);
  if (existing) return existing.id;
  const id = uid('a_');
  project.assets.push({ id, name, type, url });
  return id;
}
const model = (p: ProjectData, file: string) => sample(p, file.replace('.glb', ''), 'model', `/samples/models/${file}`);
const music = (p: ProjectData) => sample(p, 'Adventure music', 'audio', '/samples/audio/music_adventure_loop.mp3');

function strategySettings(project: ProjectData): void {
  project.settings.touchControls = 'never';
  project.settings.graphics.vignette = 0.3;
  project.settings.physics.enabled = true;
}

// ════════════════════════════════════════ Royale Arena (Clash Royale style)
interface UnitSpec {
  name: string;
  file: string;
  hp: number;
  speed: number;
  damage: number;
  range: number;
  cooldown: number;
  projectile?: string;
  targets?: string;
}
const UNITS: UnitSpec[] = [
  { name: 'Knight', file: 'knight', hp: 14, speed: 1.6, damage: 2, range: 0.5, cooldown: 1.1 },
  { name: 'Archer', file: 'archer', hp: 7, speed: 1.7, damage: 1, range: 4.5, cooldown: 0.9, projectile: 'arrow' },
  { name: 'Giant', file: 'giant', hp: 36, speed: 1.05, damage: 4, range: 0.7, cooldown: 1.5, targets: 'buildings' },
  { name: 'Wizard', file: 'wizard', hp: 8, speed: 1.5, damage: 2, range: 4.5, cooldown: 1.4, projectile: 'magic' },
];

function unitPrefab(project: ProjectData, u: UnitSpec, team: 'blue' | 'red') {
  return createPrefab(team === 'blue' ? u.name : `${u.name} Red`, [
    E(u.name, { r: [0, team === 'red' ? 180 : 0, 0] },
      comp('Model', { model: model(project, `${u.file}_${team}.glb`), animation: 'Idle' }),
      comp('UnitAI', { team, speed: u.speed, damage: u.damage, attackRange: u.range, attackCooldown: u.cooldown, projectile: u.projectile ?? 'none', targets: u.targets ?? 'any', aggroRange: 5.5 }),
      comp('Health', { max: u.hp, invulnerableTime: 0, showBar: true, damageNumbers: true }),
    ),
  ]);
}

export function royaleArena(name = 'Royale Arena'): ProjectData {
  const project = createProject(name, '3d');
  strategySettings(project);
  project.description = 'Clash-style battle: play cards with elixir, your troops cross the bridges and attack. Destroy the red King Tower to win!';
  const e = project.scenes[0].entities;
  e.length = 0;
  for (const u of UNITS) project.prefabs.push(unitPrefab(project, u, 'blue'), unitPrefab(project, u, 'red'));
  e.push(
    E('Main Camera', { p: [0, 21, 15], r: [-56, 0, 0] }, comp('Camera', { fov: 50 })),
    E('Sun', { p: [6, 14, 6], r: [-55, 35, 0] }, comp('Light', { kind: 'directional', intensity: 2.4 })),
    E('Meadow', { p: [0, -0.1, 0], s: [90, 1, 90] }, comp('Mesh', { shape: 'plane', color: '#5d9a4f', roughness: 1 })),
    E('Arena', { s: [15, 1, 26] }, comp('Mesh', { shape: 'plane', color: '#7cc576', roughness: 0.95 }), comp('Collider')),
    E('Arena Border', { p: [0, -0.06, 0], s: [16.5, 0.1, 27.5] }, comp('Mesh', { color: '#c7a76c', roughness: 1 })),
  );
  // River with two bridges: river pieces are obstacles, so pathfinding routes troops over the bridges.
  for (const [x, w] of [[-5.65, 2.7], [0, 5.4], [5.65, 2.7]] as const)
    e.push(E('River', { p: [x, 0.02, 0], s: [w, 0.3, 1.8] }, comp('Mesh', { color: '#3b82f6', roughness: 0.1, metalness: 0.2, opacity: 0.9 }), comp('Collider')));
  for (const x of [-3.5, 3.5]) e.push(E('Bridge', { p: [x, 0.08, 0], s: [1.6, 0.18, 2.4], tags: ['walkable'] }, comp('Mesh', { color: '#a0743f' })));
  const tower = (label: string, team: 'blue' | 'red', x: number, z: number, king: boolean) =>
    E(label, { p: [x, 0, z], r: [0, team === 'red' ? 180 : 0, 0] },
      comp('Model', { model: model(project, `${king ? 'king_tower' : 'tower'}_${team}.glb`), animation: 'Idle' }),
      comp('Collider', { shape: 'cylinder', size: [king ? 2.3 : 1.8, 3, king ? 2.3 : 1.8], offset: [0, 1.5, 0] }),
      comp('UnitAI', { team, speed: 0, aggroRange: king ? 6.5 : 7.5, attackRange: king ? 6 : 7, damage: king ? 3 : 2, attackCooldown: king ? 1.2 : 0.8, projectile: king ? 'cannonball' : 'arrow', projectileSpeed: 16 }),
      comp('Health', { max: king ? 70 : 45, invulnerableTime: 0, showBar: true, damageNumbers: true, onDeath: king ? (team === 'red' ? 'win' : 'game over') : 'destroy' }),
    );
  e.push(
    tower('Blue King Tower', 'blue', 0, 10.5, true),
    tower('Blue Tower Left', 'blue', -3.5, 7.5, false),
    tower('Blue Tower Right', 'blue', 3.5, 7.5, false),
    tower('Red King Tower', 'red', 0, -10.5, true),
    tower('Red Tower Left', 'red', -3.5, -7.5, false),
    tower('Red Tower Right', 'red', 3.5, -7.5, false),
    E('Player Deck', {}, comp('SpawnMenu', { items: 'Knight:3:⚔️\nArcher:3:🏹\nGiant:5:🗿\nWizard:4:🔮', label: 'Elixir', currency: 'elixir', start: 6, max: 10, regen: 0.4, team: 'blue', areaMin: [-6.5, 0, 1.5], areaMax: [6.5, 0, 12] })),
    E('Enemy AI', {}, comp('SpawnMenu', { items: 'Knight Red:3\nArcher Red:3\nGiant Red:5\nWizard Red:4', currency: 'enemyElixir', start: 5, max: 10, regen: 0.36, team: 'red', ai: true, aiInterval: 3.2, areaMin: [-6, 0, -11.5], areaMax: [6, 0, -2] })),
    E('Title', {}, comp('HudText', { text: '👑 Destroy the red King Tower!', anchor: 'top-center', fontSize: 20 })),
    E('Music', {}, comp('AudioSource', { clip: music(project), loop: true, volume: 0.35 })),
  );
  const trees: Vec3[] = [[-9, 0, -11], [9, 0, -6], [-9.5, 0, 4], [9.3, 0, 11], [-9, 0, 12], [9.5, 0, -12.5], [-9.6, 0, -3]];
  trees.forEach((p, i) => e.push(E(`Tree ${i + 1}`, { p, s: [1.3, 1.3, 1.3] }, comp('Model', { model: model(project, i % 2 ? 'pine.glb' : 'tree.glb') }))));
  return project;
}

// ════════════════════════════════════════ Village Builder (Clash of Clans style)
function building(project: ProjectData, prefabName: string, file: string, hp: number, extra: ComponentData[] = [], anim = '') {
  return createPrefab(prefabName, [
    E(prefabName, {},
      comp('Model', { model: model(project, file), animation: anim }),
      comp('Collider', { shape: 'box', size: [1.6, 1.5, 1.6], offset: [0, 0.75, 0] }),
      comp('Health', { max: hp, invulnerableTime: 0, showBar: true, damageNumbers: true }),
      ...extra,
    ),
  ]);
}

export function villageBuilder(name = 'Village Builder'): ProjectData {
  const project = createProject(name, '3d');
  strategySettings(project);
  project.description = 'Build a village: gold mines make gold, cannons defend, walls slow goblin raids. Keep your Town Hall alive!';
  const e = project.scenes[0].entities;
  e.length = 0;
  const passive = (team = 'blue') => comp('UnitAI', { team, speed: 0, aggroRange: 0, damage: 0 });
  project.prefabs.push(
    building(project, 'House', 'house.glb', 30, [passive(), comp('ResourceGenerator', { variable: 'gold', amount: 2, interval: 5 })]),
    building(project, 'Gold Mine', 'gold_mine.glb', 40, [passive(), comp('ResourceGenerator', { variable: 'gold', amount: 8, interval: 4 })], 'Work'),
    building(project, 'Cannon', 'cannon.glb', 50, [comp('UnitAI', { team: 'blue', speed: 0, aggroRange: 8.5, attackRange: 8, damage: 2, attackCooldown: 1, projectile: 'cannonball', projectileSpeed: 15 })], 'Idle'),
    building(project, 'Wall', 'wall.glb', 30, [passive()]),
    createPrefab('Goblin', [
      E('Goblin', {},
        comp('Model', { model: model(project, 'goblin.glb') }),
        comp('UnitAI', { team: 'red', speed: 2.1, targets: 'buildings', damage: 1, attackRange: 0.6, attackCooldown: 0.8, aggroRange: 12 }),
        comp('Health', { max: 6, invulnerableTime: 0, showBar: true, damageNumbers: true, rewardVariable: 'gold', rewardAmount: 5 }),
      ),
    ]),
  );
  e.push(
    E('Main Camera', { p: [0, 17, 15], r: [-50, 0, 0] }, comp('Camera', { fov: 50 }), comp('StrategyCamera', { boundsMin: [-18, 0, -18], boundsMax: [18, 0, 18], zoomMin: 8, zoomMax: 40 })),
    E('Sun', { p: [8, 14, 6], r: [-55, 40, 0] }, comp('Light', { kind: 'directional', intensity: 2.4 })),
    E('Meadow', { s: [44, 1, 44], tags: ['ground'] }, comp('Mesh', { shape: 'plane', color: '#79b85d', roughness: 1 }), comp('Collider')),
    E('Far Fields', { p: [0, -0.1, 0], s: [140, 1, 140] }, comp('Mesh', { shape: 'plane', color: '#5d9a4f', roughness: 1 })),
    E('Town Hall', {},
      comp('Model', { model: model(project, 'town_hall.glb'), animation: 'Idle' }),
      comp('Collider', { shape: 'box', size: [2.6, 3, 2.6], offset: [0, 1.5, 0] }),
      passive(),
      comp('Health', { max: 80, invulnerableTime: 0, showBar: true, damageNumbers: true, onDeath: 'game over' }),
    ),
    E('Gold Mine', { p: [4, 0, 2] }, ...project.prefabs[1].entities[0].components.map((c) => structuredClone(c))),
    E('Cannon', { p: [-4, 0, -2] }, ...project.prefabs[2].entities[0].components.map((c) => structuredClone(c))),
    E('Build Menu', {}, comp('SpawnMenu', { items: 'House:30:🏠\nGold Mine:60:⛏️\nCannon:90:💣\nWall:10:🧱', label: 'Gold', currency: 'gold', start: 150, max: 0, regen: 0, mode: 'build', gridSize: 2, team: 'blue', areaMin: [-18, 0, -18], areaMax: [18, 0, 18] })),
    E('Raid North', { p: [0, 0, -19] }, comp('Spawner', { prefab: 'Goblin', interval: 9, maxAlive: 5, radius: 3 })),
    E('Raid East', { p: [19, 0, 4] }, comp('Spawner', { prefab: 'Goblin', interval: 13, maxAlive: 4, radius: 3 })),
    E('Tip', {}, comp('HudText', { text: 'Tap a card, then tap the meadow to build • drag to look around', anchor: 'top-center', fontSize: 16 })),
    E('Music', {}, comp('AudioSource', { clip: music(project), loop: true, volume: 0.3 })),
  );
  const decor: [string, Vec3][] = [['pine.glb', [-15, 0, -14]], ['pine.glb', [-12, 0, -16]], ['tree.glb', [14, 0, -13]], ['rock.glb', [12, 0, 12]], ['tree.glb', [-14, 0, 13]], ['pine.glb', [16, 0, 9]], ['rock.glb', [-8, 0, 15]], ['crystal.glb', [10, 0, -6]]];
  decor.forEach(([file, p], i) => e.push(E(`Nature ${i + 1}`, { p, s: [1.4, 1.4, 1.4] }, comp('Model', { model: model(project, file), animation: 'Idle' }), comp('Collider', { shape: 'box', size: [0.8, 1.5, 0.8], offset: [0, 0.75, 0] }))));
  return project;
}

// ════════════════════════════════════════ Tower Defense
const WAVES = `// Every 20 seconds a harder wave starts: enemies come faster.
let wave = 1;

function start() {
  game.vars.wave = wave;
  game.every(20, () => {
    wave++;
    game.vars.wave = wave;
    const spawner = game.find('Enemy Gate');
    const settings = spawner.getComponent('Spawner');
    settings.interval = Math.max(0.5, settings.interval * 0.85);
    game.hud.message('Wave ' + wave + '!', 1.5);
    game.fx.shake(0.2, 0.4);
    audio.sfx('powerup');
  });
}
`;

export function towerDefense(name = 'Tower Defense'): ProjectData {
  const project = createProject(name, '3d');
  strategySettings(project);
  project.description = 'Goblins march along the road. Build archer towers and cannons with gold (kills pay gold). Protect the castle!';
  const e = project.scenes[0].entities;
  e.length = 0;
  const waves = createScript('Waves', WAVES);
  project.scripts.push(waves);
  const tower = (prefab: string, file: string, ai: Record<string, unknown>) =>
    createPrefab(prefab, [
      E(prefab, {},
        comp('Model', { model: model(project, file), animation: 'Idle' }),
        comp('Collider', { shape: 'box', size: [1.6, 2, 1.6], offset: [0, 1, 0] }),
        comp('UnitAI', { team: 'blue', speed: 0, ...ai }),
        comp('Health', { max: 20, showBar: true, invulnerableTime: 0 }),
      ),
    ]);
  project.prefabs.push(
    tower('Archer Tower', 'tower_blue.glb', { aggroRange: 6.5, attackRange: 6, damage: 1, attackCooldown: 0.45, projectile: 'arrow', projectileSpeed: 20 }),
    tower('Cannon', 'cannon.glb', { aggroRange: 5.5, attackRange: 5, damage: 4, attackCooldown: 1.4, projectile: 'cannonball', projectileSpeed: 12 }),
    tower('Wizard Tower', 'crystal.glb', { aggroRange: 7, attackRange: 6.5, damage: 2, attackCooldown: 0.7, projectile: 'magic', projectileSpeed: 14 }),
    createPrefab('Goblin', [
      E('Goblin', {},
        comp('Model', { model: model(project, 'goblin.glb') }),
        comp('PathFollower', { path: 'Road', speed: 2, endTarget: 'Castle', endDamage: 1, team: 'red' }),
        comp('Health', { max: 5, invulnerableTime: 0, showBar: true, damageNumbers: true, rewardVariable: 'gold', rewardAmount: 4 }),
      ),
    ]),
  );
  // Road: an S-shaped path. Waypoints are children of "Road".
  const points: Vec3[] = [[-14, 0, -9], [8, 0, -9], [8, 0, -3], [-8, 0, -3], [-8, 0, 3], [8, 0, 3], [8, 0, 9], [12, 0, 9]];
  const road = E('Road', {});
  e.push(road);
  points.forEach((p, i) => e.push(E(`Waypoint ${i + 1}`, { p, parent: road })));
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) + 1.6;
    const horizontal = Math.abs(b[0] - a[0]) > 0.1;
    e.push(E('Road Tile', { p: [(a[0] + b[0]) / 2, 0.02, (a[2] + b[2]) / 2], s: horizontal ? [len, 0.06, 1.6] : [1.6, 0.06, len], tags: ['road'] }, comp('Mesh', { color: '#d6b98c', roughness: 1 })));
  }
  e.push(
    E('Main Camera', { p: [0, 19, 14], r: [-55, 0, 0] }, comp('Camera', { fov: 50 }), comp('StrategyCamera', { boundsMin: [-12, 0, -12], boundsMax: [12, 0, 12], zoomMin: 10, zoomMax: 32 })),
    E('Sun', { p: [8, 14, 6], r: [-60, 30, 0] }, comp('Light', { kind: 'directional', intensity: 2.4 })),
    E('Meadow', { p: [0, -0.1, 0], s: [90, 1, 90] }, comp('Mesh', { shape: 'plane', color: '#6fa556', roughness: 1 })),
    E('Field', { s: [34, 1, 26], tags: ['ground'] }, comp('Mesh', { shape: 'plane', color: '#8bbf6a', roughness: 1 }), comp('Collider')),
    E('Castle', { p: [13.5, 0, 9], r: [0, -90, 0] },
      comp('Model', { model: model(project, 'king_tower_blue.glb'), animation: 'Idle' }),
      comp('Collider', { shape: 'cylinder', size: [2.3, 3, 2.3], offset: [0, 1.5, 0] }),
      comp('UnitAI', { team: 'blue', speed: 0, aggroRange: 5, attackRange: 5, damage: 1, attackCooldown: 1, projectile: 'arrow' }),
      comp('Health', { max: 15, invulnerableTime: 0, showBar: true, onDeath: 'game over' }),
    ),
    E('Enemy Gate', { p: [-14, 0, -9] }, comp('Spawner', { prefab: 'Goblin', interval: 2.4, maxAlive: 25 }), comp('Particles', { rate: 25, colorStart: '#a3e635', colorEnd: '#14532d', spread: 0.8, speed: 1.2, size: 0.25 })),
    E('Build Menu', {}, comp('SpawnMenu', { items: 'Archer Tower:40:🏹\nCannon:70:💣\nWizard Tower:90:🔮', label: 'Gold', currency: 'gold', start: 100, max: 0, regen: 0.5, mode: 'build', gridSize: 2, team: 'blue', areaMin: [-16, 0, -12], areaMax: [16, 0, 12] })),
    E('Game Manager', {}, comp('Script', { script: waves.id }), comp('HudText', { text: '🌊 Wave {wave}', anchor: 'top-center', fontSize: 22 })),
    E('Music', {}, comp('AudioSource', { clip: music(project), loop: true, volume: 0.3 })),
  );
  ([[-13, 0, 6], [-12, 0, 10], [13, 0, -4], [3, 0, 11], [-3, 0, -12], [12, 0, -11]] as Vec3[]).forEach((p, i) => e.push(E(`Tree ${i + 1}`, { p, s: [1.3, 1.3, 1.3] }, comp('Model', { model: model(project, i % 2 ? 'pine.glb' : 'tree.glb') }), comp('Collider', { shape: 'box', size: [0.8, 1.5, 0.8], offset: [0, 0.75, 0] }))));
  return project;
}

// ════════════════════════════════════════ Metro Lines (Mini Metro style)
const STATION = `// Passengers appear at stations and want to travel to a different shape.
// Trains pick them up and drop them at a station of the shape they want.
const SYMBOL = { circle: '●', triangle: '▲', square: '■' };
const shapes = Object.keys(SYMBOL);
let waiting = [];
let timer = Math.random() * 2;

function start() {
  render();
}

function update(dt) {
  timer += dt;
  if (timer < params.every) return;
  timer = 0;
  params.every = Math.max(1.8, params.every * 0.985); // it gets busier
  const others = shapes.filter((s) => s !== params.shape);
  waiting.push(others[Math.floor(Math.random() * others.length)]);
  render();
  if (waiting.length > 7) {
    game.fx.shake(0.3, 0.5);
    game.gameOver('Overcrowded! You delivered ' + (game.vars.score || 0) + ' passengers');
  }
}

function onMessage(name, data) {
  if (name !== 'vehicleArrived') return;
  const train = data.vehicle;
  const riders = train.vars.riders || (train.vars.riders = []);
  const before = riders.length;
  train.vars.riders = riders.filter((s) => s !== params.shape);
  const delivered = before - train.vars.riders.length;
  if (delivered > 0) {
    game.vars.score = (game.vars.score || 0) + delivered;
    game.fx.popText(self.position, '+' + delivered, '#2a9d8f', 24);
    audio.sfx('coin', 0.35);
  }
  while (waiting.length && train.vars.riders.length < 6) train.vars.riders.push(waiting.shift());
  render();
}

function render() {
  const label = game.find(self.name + ' Queue');
  if (label) label.setText(waiting.map((s) => SYMBOL[s]).join(' ') || ' ');
  self.setColor(waiting.length > 5 ? '#ffb4a2' : '#ffffff');
}
`;

export function metroLines(name = 'Metro Lines'): ProjectData {
  const project = createProject(name, '2d');
  project.settings.touchControls = 'never';
  project.settings.gravity = [0, 0, 0];
  project.settings.background = '#f4efe6';
  project.description = 'Drag from station to station to draw subway lines. Deliver passengers to their shape before stations overflow.';
  const e = project.scenes[0].entities;
  e.length = 0;
  const station = createScript('Station', STATION);
  project.scripts.push(station);
  const icons = {
    circle: sample(project, 'station_circle', 'image', '/samples/sprites/station_circle.svg'),
    triangle: sample(project, 'station_triangle', 'image', '/samples/sprites/station_triangle.svg'),
    square: sample(project, 'station_square', 'image', '/samples/sprites/station_square.svg'),
  };
  project.prefabs.push(createPrefab('Train', [E('Train', { tags: ['train'] }, comp('Sprite', { width: 1, height: 0.5, color: '#ffffff', layer: 3 }))]));
  e.push(
    E('Main Camera', { p: [0, 0, 10] }, comp('Camera', { size: 8.5 })),
    E('River', { p: [1, 0, -1], r: [0, 0, 18], s: [3, 30, 1] }, comp('Sprite', { color: '#bcd9ef', layer: -2 })),
    E('Metro', {}, comp('RouteBuilder', { vehicle: 'Train', maxLines: 3, lineWidth: 0.28, vehicleSpeed: 3.2 })),
    E('Score', {}, comp('HudText', { text: '🚇 Delivered: {score}', anchor: 'top-left', fontSize: 22, color: '#1f2937' })),
    E('Help', {}, comp('HudText', { text: 'Drag from one station to another to build a line • extend lines from their ends', anchor: 'bottom-center', fontSize: 15, color: '#475569' })),
  );
  const stations: [string, keyof typeof icons, number, number][] = [
    ['Oak St', 'circle', -9, 4], ['Mill Rd', 'triangle', -4, -4], ['Harbor', 'square', 4, 5],
    ['Park', 'circle', 9, -3], ['Market', 'triangle', -1, 1], ['Airport', 'square', 11, 5.5],
    ['Uni', 'circle', -11, -5], ['Docks', 'triangle', 6, -6],
  ];
  for (const [label, shape, x, y] of stations) {
    const st = E(label, { p: [x, y, 0], tags: ['station', shape] }, comp('Sprite', { image: icons[shape], width: 0.9, height: 0.9, layer: 2 }), comp('Script', { script: station.id, params: { shape, every: 5 + Math.random() * 3 } }));
    e.push(st, E(`${label} Queue`, { p: [0, 0.85, 0.1], parent: st }, comp('Text', { text: ' ', size: 0.4, color: '#1f2937' })), E(`${label} Name`, { p: [0, -0.8, 0.1], parent: st }, comp('Text', { text: label, size: 0.32, color: '#64748b', bold: false })));
  }
  return project;
}
