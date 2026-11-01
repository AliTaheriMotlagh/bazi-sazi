import type { ComponentData, EntityData, GameMode, GraphData, ProjectData, Vec3 } from '../types';
import { uid } from '../util';
import { comp, createEntity, createPrefab, createProject, createScript } from './defaults';

export interface Template {
  id: string;
  name: string;
  description: string;
  mode: GameMode;
  tags: string[];
  /** Two-color gradient for the card. */
  colors: [string, string];
  build(name?: string): ProjectData;
}

interface T {
  p?: Vec3;
  r?: Vec3;
  s?: Vec3;
  tags?: string[];
  parent?: EntityData;
}
const E = (name: string, t: T, ...components: ComponentData[]): EntityData =>
  createEntity({ name, position: t.p, rotation: t.r, scale: t.s, tags: t.tags, parent: t.parent?.id ?? null, components });

function base(name: string, mode: GameMode): { project: ProjectData; entities: EntityData[] } {
  const project = createProject(name, mode);
  const entities = project.scenes[0].entities;
  return { project, entities };
}

// ───────────────────────────────────────── 2D platformer
function platformer(name = '2D Platformer'): ProjectData {
  const { project, entities } = base(name, '2d');
  project.description = 'Run, jump, collect coins and reach the flag.';
  project.settings.background = '#7ec8f2';
  entities.length = 0;
  const box = (color: string, w = 1, h = 1, extra: ComponentData[] = [], tags: string[] = []) => [
    E('Tile', { tags }, comp('Sprite', { color, width: w, height: h }), comp('Collider'), ...extra),
  ];
  project.prefabs.push(
    createPrefab('Grass', box('#5cb85c', 1, 1, [], ['ground'])),
    createPrefab('Dirt', box('#8d5a3b', 1, 1, [], ['ground'])),
    createPrefab('Platform', box('#b07a4f', 1, 0.4, [], ['ground'])),
    createPrefab('Coin', [
      E('Coin', { tags: ['coin'] }, comp('Sprite', { color: '#ffd166', width: 0.5, height: 0.5 }), comp('Collider', { isTrigger: true }), comp('Collectible'), comp('Rotator', { speed: [0, 180, 0] })),
    ]),
    createPrefab('Spike', [
      E('Spike', { p: [0, -0.3, 0], tags: ['hazard'] }, comp('Sprite', { color: '#ef476f', width: 0.8, height: 0.4 }), comp('Collider', { isTrigger: true }), comp('Damage', { knockback: 9 })),
    ]),
    createPrefab('Flag', [
      E('Flag', { p: [0, 0.3, 0] }, comp('Sprite', { color: '#06d6a0', width: 0.5, height: 1.6 }), comp('Collider', { isTrigger: true }), comp('Goal', { message: 'Level complete! 🎉' }), comp('Particles', { rate: 12, colorStart: '#ffffff', colorEnd: '#06d6a0', speed: 1, size: 0.2, gravity: 1 })),
    ]),
  );
  const map = [
    '........................................',
    '..........C.C.C.........................',
    '.........======.........C.C.C...........',
    '...........................=====....C.C.',
    '......C.C........C.....................F',
    '....======......===..............=======',
    '........................................',
    '..............^^.......^^...............',
    'GGGGGGGGGGGGGGGGGGGG...GGGGGGGGGGGGGGGGG',
    'DDDDDDDDDDDDDDDDDDDD...DDDDDDDDDDDDDDDDD',
  ].join('\n');
  entities.push(
    E('Main Camera', { p: [0, 0, 10] }, comp('Camera', { size: 7 }), comp('FollowCamera', { target: 'Player', offset: [2, 1.5, 10], smoothing: 5 })),
    E('Player', { p: [-6, -1, 0], tags: ['player'] },
      comp('Sprite', { color: '#4361ee', width: 0.8, height: 1.1 }),
      comp('RigidBody', { lockRotation: true }),
      comp('Collider', { friction: 0 }),
      comp('PlatformerController', { airJumps: 1 }),
      comp('Health', { max: 3, onDeath: 'respawn', showInHud: true }),
    ),
    E('Level', { p: [-10, 5, 0] }, comp('TileMap', { map, legend: 'G=Grass\nD=Dirt\n==Platform\nC=Coin\n^=Spike\nF=Flag' })),
    E('Moving Platform', { p: [11, -2.5, 0], tags: ['ground'] }, comp('Sprite', { color: '#b07a4f', width: 2.5, height: 0.4 }), comp('Collider'), comp('RigidBody', { bodyType: 'kinematic' }), comp('Oscillator', { axis: [0, 1, 0], amplitude: 1.2, frequency: 0.25 })),
    E('Kill Zone', { p: [10, -12, 0], s: [80, 1, 1] }, comp('Collider', { shape: 'box', isTrigger: true }), comp('Damage', { amount: 99, knockback: 0 })),
    E('HUD', {}, comp('HudText', { text: '🪙 {score}' })),
    E('Hint', { p: [-6, 2, 0] }, comp('Text', { text: '← → to run, Space to jump (twice!)', size: 0.5, color: '#1d3557' })),
    E('Sun', { p: [6, 6, -5] }, comp('Sprite', { color: '#ffe066', width: 2.5, height: 2.5 })),
  );
  return project;
}

// ───────────────────────────────────────── 2D top-down shooter
const CHASE = `// Enemies walk toward the player. Speed comes from the "speed" parameter.
let target;

function update(dt) {
  if (!target || !target.alive) target = game.find('Player');
  if (!target) return;
  const dir = target.position.clone().sub(self.position).normalize();
  const speed = params.speed ?? 2.5;
  self.setVelocity(dir.x * speed, dir.y * speed);
  self.rotation.z = Math.atan2(dir.y, dir.x);
}

function onMessage(name) {
  if (name === 'died') {
    game.vars.score = (game.vars.score || 0) + 10;
    audio.sfx('explosion', 0.4);
  }
}
`;

function shooter(name = 'Top-Down Shooter'): ProjectData {
  const { project, entities } = base(name, '2d');
  project.description = 'Survive the waves. Move with WASD/stick, hold J/fire to shoot.';
  project.settings.gravity = [0, 0, 0];
  project.settings.background = '#10131f';
  project.settings.graphics.bloom = true;
  entities.length = 0;
  const chase = createScript('Chase Player', CHASE);
  project.scripts.push(chase);
  project.prefabs.push(
    createPrefab('Bullet', [
      E('Bullet', { tags: ['bullet'] }, comp('Sprite', { color: '#ffd166', width: 0.35, height: 0.12 }), comp('RigidBody', { gravityScale: 0, ccd: true, mass: 0.1 }), comp('Collider', { isTrigger: true }), comp('Damage', { targetTag: 'enemy', destroySelf: true, knockback: 3 }), comp('DestroyAfter', { seconds: 1.4 })),
    ]),
    createPrefab('Enemy', [
      E('Enemy', { tags: ['enemy'] }, comp('Sprite', { color: '#ef476f', width: 0.9, height: 0.9 }), comp('RigidBody', { gravityScale: 0, lockRotation: true, linearDamping: 1 }), comp('Collider'), comp('Health', { max: 2, invulnerableTime: 0.1 }), comp('Damage', { targetTag: 'player', knockback: 8 }), comp('Script', { script: chase.id, params: { speed: 2.5 } })),
    ]),
  );
  const player = E('Player', { tags: ['player'] },
    comp('Sprite', { color: '#4cc9f0', width: 0.9, height: 0.9 }),
    comp('RigidBody', { gravityScale: 0, lockRotation: true }),
    comp('Collider'),
    comp('TopDownController', { speed: 7 }),
    comp('Shooter', { prefab: 'Bullet', cooldown: 0.15, speed: 20 }),
    comp('Health', { max: 5, onDeath: 'game over', showInHud: true, invulnerableTime: 1 }),
  );
  const wall = (n: string, p: Vec3, s: Vec3) => E(n, { p, s, tags: ['wall'] }, comp('Sprite', { color: '#2b2f45' }), comp('Collider'));
  entities.push(
    E('Main Camera', { p: [0, 0, 10] }, comp('Camera', { size: 9 })),
    E('Floor', { p: [0, 0, -1] }, comp('Sprite', { color: '#171b2e', width: 30, height: 18 })),
    player,
    E('Gun', { p: [0.55, 0, 0], parent: player }, comp('Sprite', { color: '#ffffff', width: 0.35, height: 0.18 })),
    wall('Wall Top', [0, 9, 0], [30, 1, 1]),
    wall('Wall Bottom', [0, -9, 0], [30, 1, 1]),
    wall('Wall Left', [-15, 0, 0], [1, 18, 1]),
    wall('Wall Right', [15, 0, 0], [1, 18, 1]),
    ...([[-12, 6], [12, 6], [-12, -6], [12, -6]] as const).map(([x, y], i) =>
      E(`Spawner ${i + 1}`, { p: [x, y, 0] }, comp('Spawner', { prefab: 'Enemy', interval: 2.5 + i * 0.4, maxAlive: 4 }), comp('Particles', { rate: 20, colorStart: '#ef476f', colorEnd: '#3a0ca3', speed: 0.8, spread: 1, size: 0.3 })),
    ),
    E('HUD', {}, comp('HudText', { text: 'Score: {score}' })),
  );
  return project;
}

// ───────────────────────────────────────── 3D collector (shows visual scripting)
function jumpGraph(): GraphData {
  const ev = uid('n_');
  const jump = uid('n_');
  return {
    id: uid('g_'),
    name: 'Jump On Space',
    nodes: [
      { id: ev, type: 'event.actionPressed', position: { x: 40, y: 60 }, data: { action: 'jump' } },
      { id: jump, type: 'action.jump', position: { x: 320, y: 40 }, data: { force: 6 } },
    ],
    edges: [{ id: uid('ed_'), source: ev, sourceHandle: 'out', target: jump, targetHandle: 'in' }],
  };
}

const WIN_CHECK = `// Wins the game when every coin is collected.
const total = game.findAll('coin').length;

function update() {
  if ((game.vars.score || 0) >= total) game.win('All coins collected! 🏆');
}
`;

function collector(name = '3D Coin Adventure'): ProjectData {
  const { project, entities } = base(name, '3d');
  project.description = 'Explore a little island and collect every coin.';
  project.scenes[0].environment.fogDensity = 0.015;
  project.settings.background = '#c8d8ec';
  const graph = jumpGraph();
  project.graphs.push(graph);
  const win = createScript('Win Check', WIN_CHECK);
  project.scripts.push(win);
  entities[0].components.push(comp('FollowCamera', { target: 'Player', offset: [0, 6, 9], smoothing: 4 }));
  entities.push(
    E('Ground', { s: [60, 1, 60] }, comp('Mesh', { shape: 'plane', color: '#7cc36b', roughness: 0.9 }), comp('Collider')),
    E('Player', { p: [0, 1, 0], tags: ['player'] },
      comp('Mesh', { shape: 'capsule', color: '#4361ee' }),
      comp('RigidBody', { lockRotation: true }),
      comp('Collider', { friction: 0 }),
      comp('TopDownController', { speed: 6 }),
      comp('VisualScript', { graph: graph.id }),
    ),
    E('Game Manager', {}, comp('Script', { script: win.id }), comp('HudText', { text: 'Coins: {score}' })),
  );
  const coinSpots: Vec3[] = [[5, 1, 3], [-6, 1, -4], [8, 1, -8], [-10, 1, 6], [0, 1, -12], [12, 1, 10], [-14, 1, -12], [3, 3.2, -4]];
  coinSpots.forEach((p, i) =>
    entities.push(E(`Coin ${i + 1}`, { p, r: [90, 0, 0], s: [0.8, 0.15, 0.8], tags: ['coin'] }, comp('Mesh', { shape: 'cylinder', color: '#ffd166', metalness: 0.8, roughness: 0.25, emissive: '#7a5a00' }), comp('Collider', { isTrigger: true, shape: 'box', size: [1.4, 6, 1.4] }), comp('Collectible'), comp('Rotator', { speed: [0, 0, 120] }))),
  );
  entities.push(E('Platform', { p: [3, 1, -4], s: [3, 2, 3] }, comp('Mesh', { color: '#c9a27e' }), comp('Collider')));
  const trees: Vec3[] = [[-4, 0, 4], [7, 0, 6], [-9, 0, -8], [10, 0, -3], [-2, 0, -9], [14, 0, 2]];
  trees.forEach((p, i) => {
    const trunk = E(`Tree ${i + 1}`, { p: [p[0], 1, p[2]], s: [0.5, 2, 0.5] }, comp('Mesh', { shape: 'cylinder', color: '#8b5a2b' }), comp('Collider'));
    entities.push(trunk, E('Leaves', { p: [0, 1.2, 0], s: [5, 1.4, 5], parent: trunk }, comp('Mesh', { shape: 'cone', color: '#2d6a4f' })));
  });
  for (let i = 0; i < 6; i++)
    entities.push(E(`Crate ${i + 1}`, { p: [-4 + (i % 3) * 1.05, 0.5 + Math.floor(i / 3), 8] }, comp('Mesh', { color: '#d4a373' }), comp('RigidBody', { mass: 0.5 }), comp('Collider')));
  return project;
}

// ───────────────────────────────────────── 3D physics playground (first person)
function playground(name = 'Physics Playground'): ProjectData {
  const { project, entities } = base(name, '3d');
  project.description = 'First-person sandbox: click to look around, fire balls at towers.';
  project.prefabs.push(
    createPrefab('Ball', [
      E('Ball', { s: [0.4, 0.4, 0.4] }, comp('Mesh', { shape: 'sphere', color: '#ff7b00', metalness: 0.3, roughness: 0.3 }), comp('RigidBody', { mass: 4, ccd: true }), comp('Collider', { restitution: 0.4 }), comp('DestroyAfter', { seconds: 10 })),
    ]),
  );
  entities.splice(0, 1); // the player carries the camera
  const player = E('Player', { p: [0, 1.2, 12], tags: ['player'] },
    comp('RigidBody', { lockRotation: true }),
    comp('Collider', { shape: 'capsule', size: [0.8, 1.8, 0.8] }),
    comp('FirstPersonController'),
    comp('Shooter', { prefab: 'Ball', speed: 22, cooldown: 0.3, auto: false, sound: 'blip' }),
  );
  entities.push(
    player,
    E('Eyes', { p: [0, 0.6, 0], parent: player }, comp('Camera', { fov: 70 })),
    E('Ground', { s: [80, 1, 80] }, comp('Mesh', { shape: 'plane', color: '#9aa5b1' }), comp('Collider')),
    E('Ramp', { p: [-8, 1, 0], r: [0, 0, 20], s: [8, 0.4, 4] }, comp('Mesh', { color: '#6c757d' }), comp('Collider')),
    E('Crosshair', {}, comp('HudText', { text: '+', anchor: 'center', fontSize: 28 })),
    E('Help', {}, comp('HudText', { text: 'Click to look • WASD move • Space jump • Click to shoot', anchor: 'bottom-center', fontSize: 16 })),
  );
  const colors = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec'];
  for (let layer = 0; layer < 5; layer++)
    for (let i = 0; i < 5 - layer; i++)
      entities.push(E(`Box ${layer}-${i}`, { p: [-2.2 + i * 1.05 + layer * 0.52, 0.5 + layer, 0] }, comp('Mesh', { color: colors[layer] }), comp('RigidBody', { mass: 0.6 }), comp('Collider')));
  for (let i = 0; i < 8; i++)
    entities.push(E(`Pin ${i + 1}`, { p: [6 + (i % 4) * 0.8, 1, -4 - Math.floor(i / 4) * 0.8], s: [0.4, 2, 0.4] }, comp('Mesh', { shape: 'cylinder', color: '#f8f9fa' }), comp('RigidBody', { mass: 0.3 }), comp('Collider')));
  return project;
}

// ───────────────────────────────────────── multiplayer arena
const ONLINE = `// Keeps the "players" game variable up to date for the HUD.
function update() {
  game.vars.players = net ? net.players.size + 1 : 1;
}
`;

function arena(name = 'Multiplayer Arena'): ProjectData {
  const { project, entities } = base(name, '3d');
  project.description = 'Push the big ball around together. Share the link to invite friends!';
  project.settings.multiplayer = { enabled: true, maxPlayers: 16, tickRate: 20, playerPrefab: 'Player' };
  const online = createScript('Online Counter', ONLINE);
  project.scripts.push(online);
  project.prefabs.push(
    createPrefab('Player', [
      E('Player', { tags: ['player'] }, comp('Mesh', { shape: 'capsule', color: '#f72585' }), comp('RigidBody', { lockRotation: true, mass: 2 }), comp('Collider'), comp('TopDownController', { speed: 7 }), comp('NetworkSync')),
    ]),
  );
  entities[0].transform.position = [0, 18, 18];
  entities[0].components.push(comp('FollowCamera', { target: 'Player', offset: [0, 12, 12], smoothing: 3 }));
  entities.push(
    E('Arena', { s: [30, 1, 30] }, comp('Mesh', { shape: 'plane', color: '#3a86ff' }), comp('Collider')),
    E('Big Ball', { p: [0, 2, 0], s: [2.5, 2.5, 2.5] }, comp('Mesh', { shape: 'sphere', color: '#ffbe0b', metalness: 0.2 }), comp('RigidBody', { mass: 1, linearDamping: 0.3 }), comp('Collider', { restitution: 0.5 }), comp('NetworkSync')),
    E('Game Manager', {}, comp('Script', { script: online.id }), comp('HudText', { text: 'Players online: {players}' })),
  );
  for (const [n, p, s] of [
    ['Wall N', [0, 1, -15], [30, 2, 0.5]],
    ['Wall S', [0, 1, 15], [30, 2, 0.5]],
    ['Wall W', [-15, 1, 0], [0.5, 2, 30]],
    ['Wall E', [15, 1, 0], [0.5, 2, 30]],
  ] as [string, Vec3, Vec3][])
    entities.push(E(n, { p, s }, comp('Mesh', { color: '#8ecae6' }), comp('Collider')));
  ([[-10, 1, -10], [10, 1, -10], [-10, 1, 10], [10, 1, 10]] as Vec3[]).forEach((p, i) => entities.push(E(`Spawn ${i + 1}`, { p, tags: ['spawn'] })));
  return project;
}

// ───────────────────────────────────────── VR gallery
function vr(name = 'VR Gallery'): ProjectData {
  const { project, entities } = base(name, '3d');
  project.description = 'A small room built for WebXR headsets (works on desktop too).';
  project.settings.xr.enabled = true;
  project.settings.graphics.bloom = true;
  project.settings.background = '#0b0d17';
  entities[0].transform.position = [0, 1.6, 4];
  entities[0].transform.rotation = [0, 0, 0];
  entities.push(
    E('Floor', { s: [20, 1, 20] }, comp('Mesh', { shape: 'plane', color: '#22223b', roughness: 0.3, metalness: 0.4 })),
    E('Glow Ring', { p: [0, 1.6, -2], s: [2, 2, 2] }, comp('Mesh', { shape: 'torus', color: '#7209b7', emissive: '#b5179e', emissiveIntensity: 3 }), comp('Rotator', { speed: [20, 40, 0] })),
    E('Orb', { p: [0, 1.6, -2], s: [0.6, 0.6, 0.6] }, comp('Mesh', { shape: 'icosahedron', color: '#4cc9f0', emissive: '#4cc9f0', emissiveIntensity: 2 }), comp('Oscillator', { amplitude: 0.2 }), comp('Particles', { rate: 30, colorStart: '#4cc9f0', colorEnd: '#7209b7', spread: 1, speed: 0.6, size: 0.06 })),
    E('Lamp', { p: [0, 3, 0] }, comp('Light', { kind: 'point', color: '#f72585', intensity: 3, distance: 12 })),
    E('Title', { p: [0, 3, -4] }, comp('Text', { text: 'Welcome to VR', size: 0.6, color: '#f1faee' })),
  );
  return project;
}

// ───────────────────────────────────────── visual scripting starter (2D)
function noCodeGraph(): GraphData {
  const id = () => uid('n_');
  const [update, axis, mul, vel, setVel, press, jump, hit, add, destroy, sound] = Array.from({ length: 11 }, id);
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ id: uid('ed_'), source, sourceHandle, target, targetHandle });
  return {
    id: uid('g_'),
    name: 'Player Logic',
    nodes: [
      { id: update, type: 'event.update', position: { x: 0, y: 0 }, data: {} },
      { id: axis, type: 'input.axis', position: { x: 0, y: 140 }, data: {} },
      { id: mul, type: 'math.op', position: { x: 220, y: 140 }, data: { op: '×', b: 6 } },
      { id: vel, type: 'data.velocity', position: { x: 220, y: 290 }, data: {} },
      { id: setVel, type: 'action.setVelocity', position: { x: 480, y: 20 }, data: {} },
      { id: press, type: 'event.actionPressed', position: { x: 0, y: 430 }, data: { action: 'jump' } },
      { id: jump, type: 'action.jump', position: { x: 260, y: 430 }, data: { force: 11 } },
      { id: hit, type: 'event.collision', position: { x: 0, y: 600 }, data: { tag: 'coin' } },
      { id: add, type: 'var.add', position: { x: 260, y: 600 }, data: { name: 'score', amount: 1 } },
      { id: destroy, type: 'action.destroy', position: { x: 500, y: 600 }, data: {} },
      { id: sound, type: 'action.sound', position: { x: 740, y: 600 }, data: { sound: 'coin' } },
    ],
    edges: [
      edge(update, 'out', setVel, 'in'),
      edge(axis, 'x', mul, 'a'),
      edge(mul, 'result', setVel, 'x'),
      edge(vel, 'y', setVel, 'y'),
      edge(press, 'out', jump, 'in'),
      edge(hit, 'out', add, 'in'),
      edge(add, 'out', destroy, 'in'),
      edge(hit, 'other', destroy, 'target'),
      edge(destroy, 'out', sound, 'in'),
    ],
  };
}

function noCode(name = 'No-Code Starter'): ProjectData {
  const { project, entities } = base(name, '2d');
  project.description = 'A player built entirely with visual scripting — open the graph to see how.';
  project.settings.background = '#264653';
  const graph = noCodeGraph();
  project.graphs.push(graph);
  entities.push(
    E('Player', { p: [0, 0, 0], tags: ['player'] }, comp('Sprite', { color: '#e9c46a', width: 0.9, height: 0.9 }), comp('RigidBody', { lockRotation: true }), comp('Collider'), comp('VisualScript', { graph: graph.id })),
    E('Ground', { p: [0, -4, 0], s: [24, 1, 1] }, comp('Sprite', { color: '#2a9d8f' }), comp('Collider')),
    E('Step', { p: [4, -2, 0], s: [3, 0.5, 1] }, comp('Sprite', { color: '#2a9d8f' }), comp('Collider')),
    E('HUD', {}, comp('HudText', { text: 'Stars: {score}' })),
  );
  ([[-5, -3], [-2, -3], [4, -1], [7, -3], [9, 0]] as const).forEach(([x, y], i) =>
    entities.push(E(`Star ${i + 1}`, { p: [x, y, 0], tags: ['coin'] }, comp('Sprite', { color: '#f4a261', width: 0.5, height: 0.5 }), comp('Collider', { isTrigger: true }), comp('Rotator', { speed: [0, 0, 90] }))),
  );
  return project;
}

export const TEMPLATES: Template[] = [
  { id: 'empty-3d', name: 'Empty 3D', description: 'Camera, sun and sky. Start from scratch.', mode: '3d', tags: ['3D'], colors: ['#4361ee', '#4cc9f0'], build: (n) => createProject(n ?? 'My 3D Game', '3d') },
  { id: 'empty-2d', name: 'Empty 2D', description: 'A blank 2D canvas with an orthographic camera.', mode: '2d', tags: ['2D'], colors: ['#7209b7', '#f72585'], build: (n) => createProject(n ?? 'My 2D Game', '2d') },
  { id: 'platformer', name: '2D Platformer', description: 'Tile-map level, coins, spikes, double-jump and a goal flag.', mode: '2d', tags: ['2D', 'No code'], colors: ['#06d6a0', '#118ab2'], build: platformer },
  { id: 'shooter', name: 'Top-Down Shooter', description: 'Waves of enemies, bullets, health and score. Glowing graphics.', mode: '2d', tags: ['2D', 'Scripts'], colors: ['#ef476f', '#ffd166'], build: shooter },
  { id: 'collector', name: '3D Coin Adventure', description: 'Third-person island with physics crates and collectibles.', mode: '3d', tags: ['3D', 'Visual script'], colors: ['#2d6a4f', '#95d5b2'], build: collector },
  { id: 'playground', name: 'Physics Playground', description: 'First-person controller, ball cannon and physics towers.', mode: '3d', tags: ['3D', 'FPS'], colors: ['#ff7b00', '#ffb700'], build: playground },
  { id: 'arena', name: 'Multiplayer Arena', description: 'Real-time online play. Everyone pushes the same ball.', mode: '3d', tags: ['3D', 'Multiplayer'], colors: ['#3a86ff', '#8338ec'], build: arena },
  { id: 'vr', name: 'VR Gallery', description: 'WebXR-ready scene for headsets, with bloom glow.', mode: '3d', tags: ['3D', 'VR'], colors: ['#240046', '#c77dff'], build: vr },
  { id: 'nocode', name: 'No-Code Starter', description: 'Player logic built only with visual scripting nodes.', mode: '2d', tags: ['2D', 'Visual script'], colors: ['#264653', '#e9c46a'], build: noCode },
];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
