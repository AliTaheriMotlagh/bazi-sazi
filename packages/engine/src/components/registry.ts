import type { AssetType, ComponentData, GameMode } from '../types';

/**
 * Component schemas drive everything that is component-specific outside the
 * runtime: the inspector UI, default values, validation, AI tool docs and
 * documentation. Adding a component = add a schema here + a builder/behaviour.
 */

export type FieldType =
  | 'number'
  | 'string'
  | 'text'
  | 'boolean'
  | 'color'
  | 'vec3'
  | 'select'
  | 'asset'
  | 'script'
  | 'graph'
  | 'prefab'
  | 'scene'
  | 'entity'
  | 'action'
  | 'params';

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  default: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  assetType?: AssetType;
  help?: string;
  /** Only show this field when the predicate passes (keeps the inspector simple). */
  showIf?: (props: Record<string, unknown>) => boolean;
}

export type ComponentCategory =
  | 'Rendering'
  | 'Camera'
  | 'Physics'
  | 'Scripting'
  | 'Audio'
  | 'Effects'
  | 'Gameplay'
  | 'UI'
  | 'Level'
  | 'Strategy'
  | 'Network';

export interface ComponentSchema {
  type: string;
  label: string;
  category: ComponentCategory;
  description: string;
  /** lucide icon name used by the editor */
  icon: string;
  fields: FieldSchema[];
  /** Allow several instances on one entity (e.g. Script). */
  multiple?: boolean;
  modes?: GameMode[];
}

const SFX = ['none', 'coin', 'jump', 'hit', 'explosion', 'powerup', 'laser', 'blip', 'lose', 'win'];

const f = (
  key: string,
  label: string,
  type: FieldType,
  def: unknown,
  extra: Partial<FieldSchema> = {},
): FieldSchema => ({ key, label, type, default: def, ...extra });

export const COMPONENTS: ComponentSchema[] = [
  // ───────────────────────── Rendering
  {
    type: 'Mesh',
    label: 'Mesh',
    category: 'Rendering',
    icon: 'Box',
    description: 'A 3D primitive shape with a physically-based material. Size it with the transform scale.',
    fields: [
      f('shape', 'Shape', 'select', 'box', {
        options: ['box', 'sphere', 'plane', 'cylinder', 'cone', 'capsule', 'torus', 'icosahedron'],
      }),
      f('color', 'Color', 'color', '#5b8def'),
      f('texture', 'Texture', 'asset', '', { assetType: 'image' }),
      f('textureRepeat', 'Texture repeat', 'number', 1, { min: 0.01, step: 0.25, showIf: (p) => !!p.texture }),
      f('metalness', 'Metalness', 'number', 0.1, { min: 0, max: 1, step: 0.05 }),
      f('roughness', 'Roughness', 'number', 0.6, { min: 0, max: 1, step: 0.05 }),
      f('emissive', 'Glow color', 'color', '#000000'),
      f('emissiveIntensity', 'Glow strength', 'number', 1, { min: 0, max: 20, step: 0.1 }),
      f('opacity', 'Opacity', 'number', 1, { min: 0, max: 1, step: 0.05 }),
      f('wireframe', 'Wireframe', 'boolean', false),
      f('castShadow', 'Cast shadows', 'boolean', true),
      f('receiveShadow', 'Receive shadows', 'boolean', true),
    ],
  },
  {
    type: 'Sprite',
    label: 'Sprite',
    category: 'Rendering',
    icon: 'Image',
    description: 'A flat image (or colored rectangle). Supports sprite-sheet animation.',
    fields: [
      f('image', 'Image', 'asset', '', { assetType: 'image' }),
      f('color', 'Tint', 'color', '#ffffff'),
      f('width', 'Width', 'number', 1, { min: 0, step: 0.1 }),
      f('height', 'Height', 'number', 1, { min: 0, step: 0.1 }),
      f('flipX', 'Flip X', 'boolean', false),
      f('columns', 'Sheet columns', 'number', 1, { min: 1, step: 1, help: 'Sprite-sheet frames per row' }),
      f('rows', 'Sheet rows', 'number', 1, { min: 1, step: 1 }),
      f('fps', 'Animation FPS', 'number', 0, { min: 0, step: 1, help: '0 = no animation' }),
      f('billboard', 'Face camera', 'boolean', false, { help: '3D only: always faces the camera' }),
      f('opacity', 'Opacity', 'number', 1, { min: 0, max: 1, step: 0.05 }),
      f('layer', 'Draw order', 'number', 0, { step: 1, help: 'Higher draws on top (2D)' }),
    ],
  },
  {
    type: 'Model',
    label: '3D Model',
    category: 'Rendering',
    icon: 'Shapes',
    description: 'A glTF/GLB model with optional skeletal animation.',
    modes: ['3d'],
    fields: [
      f('model', 'Model', 'asset', '', { assetType: 'model' }),
      f('animation', 'Animation', 'string', '', { help: 'Clip name to play. Empty = first clip.' }),
      f('animationSpeed', 'Animation speed', 'number', 1, { step: 0.1 }),
      f('rotationOffset', 'Turn model (°)', 'number', 0, { step: 90, help: 'Use 180 if the model walks backwards' }),
      f('castShadow', 'Cast shadows', 'boolean', true),
    ],
  },
  {
    type: 'Video',
    label: 'Video',
    category: 'Rendering',
    icon: 'Clapperboard',
    description: 'Play a video on a screen in the world, or full-screen as a cutscene.',
    fields: [
      f('video', 'Video', 'asset', '', { assetType: 'video' }),
      f('mode', 'Show as', 'select', 'world', { options: ['world', 'fullscreen'] }),
      f('width', 'Width', 'number', 4, { min: 0.1, step: 0.1, showIf: (p) => p.mode !== 'fullscreen' }),
      f('height', 'Height', 'number', 2.25, { min: 0.1, step: 0.1, showIf: (p) => p.mode !== 'fullscreen' }),
      f('autoplay', 'Play on start', 'boolean', true),
      f('loop', 'Loop', 'boolean', true),
      f('muted', 'Muted', 'boolean', true, { help: 'Browsers only autoplay muted videos' }),
    ],
  },
  {
    type: 'Text',
    label: 'World Text',
    category: 'Rendering',
    icon: 'Type',
    description: 'Text placed in the world. Use {var} to show game variables, e.g. "Score: {score}".',
    fields: [
      f('text', 'Text', 'text', 'Hello world'),
      f('color', 'Color', 'color', '#ffffff'),
      f('size', 'Height', 'number', 1, { min: 0.05, step: 0.1 }),
      f('bold', 'Bold', 'boolean', true),
      f('billboard', 'Face camera', 'boolean', false),
    ],
  },
  {
    type: 'Light',
    label: 'Light',
    category: 'Rendering',
    icon: 'Lightbulb',
    description: 'Illuminates the scene.',
    fields: [
      f('kind', 'Kind', 'select', 'directional', {
        options: ['directional', 'point', 'spot', 'hemisphere', 'ambient'],
      }),
      f('color', 'Color', 'color', '#ffffff'),
      f('groundColor', 'Ground color', 'color', '#444466', { showIf: (p) => p.kind === 'hemisphere' }),
      f('intensity', 'Intensity', 'number', 1.5, { min: 0, step: 0.1 }),
      f('distance', 'Range', 'number', 0, {
        min: 0,
        step: 1,
        help: '0 = infinite',
        showIf: (p) => p.kind === 'point' || p.kind === 'spot',
      }),
      f('angle', 'Cone angle', 'number', 30, { min: 1, max: 89, showIf: (p) => p.kind === 'spot' }),
      f('castShadow', 'Cast shadows', 'boolean', true, {
        showIf: (p) => p.kind !== 'ambient' && p.kind !== 'hemisphere',
      }),
    ],
  },
  // ───────────────────────── Camera
  {
    type: 'Camera',
    label: 'Camera',
    category: 'Camera',
    icon: 'Video',
    description: 'The view the player sees. The first camera marked "primary" is used.',
    fields: [
      f('projection', 'Projection', 'select', 'auto', {
        options: ['auto', 'perspective', 'orthographic'],
        help: 'auto = orthographic for 2D games, perspective for 3D',
      }),
      f('fov', 'Field of view', 'number', 60, { min: 10, max: 150 }),
      f('size', 'Ortho size', 'number', 8, { min: 0.5, step: 0.5, help: 'Half the visible height (orthographic)' }),
      f('near', 'Near', 'number', 0.1, { min: 0.001, step: 0.1 }),
      f('far', 'Far', 'number', 1000, { min: 1, step: 10 }),
      f('primary', 'Primary', 'boolean', true),
    ],
  },
  {
    type: 'FollowCamera',
    label: 'Follow Target',
    category: 'Camera',
    icon: 'Crosshair',
    description: 'Smoothly follows another entity (put it on the camera).',
    fields: [
      f('target', 'Target', 'entity', 'Player'),
      f('offset', 'Offset', 'vec3', [0, 4, 10]),
      f('smoothing', 'Smoothing', 'number', 6, { min: 0, step: 0.5, help: '0 = snap' }),
      f('lookAt', 'Look at target', 'boolean', true),
    ],
  },
  // ───────────────────────── Physics
  {
    type: 'RigidBody',
    label: 'Rigid Body',
    category: 'Physics',
    icon: 'Atom',
    description: 'Makes the entity physically simulated. Needs a Collider.',
    fields: [
      f('bodyType', 'Type', 'select', 'dynamic', {
        options: ['dynamic', 'fixed', 'kinematic'],
        help: 'dynamic = falls & collides, fixed = never moves, kinematic = moved by scripts',
      }),
      f('mass', 'Mass', 'number', 1, { min: 0.001, step: 0.1 }),
      f('gravityScale', 'Gravity scale', 'number', 1, { step: 0.1 }),
      f('linearDamping', 'Linear damping', 'number', 0, { min: 0, step: 0.1 }),
      f('angularDamping', 'Angular damping', 'number', 0.05, { min: 0, step: 0.05 }),
      f('lockRotation', 'Lock rotation', 'boolean', false),
      f('ccd', 'Continuous collision', 'boolean', false, { help: 'For fast objects like bullets' }),
    ],
  },
  {
    type: 'Collider',
    label: 'Collider',
    category: 'Physics',
    icon: 'Square',
    description: 'Physical shape. Without a Rigid Body it acts as static level geometry.',
    fields: [
      f('shape', 'Shape', 'select', 'auto', { options: ['auto', 'box', 'sphere', 'capsule', 'cylinder'] }),
      f('size', 'Size', 'vec3', [1, 1, 1], { showIf: (p) => p.shape !== 'auto', help: 'Multiplied by scale' }),
      f('offset', 'Offset', 'vec3', [0, 0, 0]),
      f('friction', 'Friction', 'number', 0.5, { min: 0, step: 0.05 }),
      f('restitution', 'Bounciness', 'number', 0, { min: 0, max: 1, step: 0.05 }),
      f('isTrigger', 'Is trigger', 'boolean', false, { help: 'Detects overlaps without physical collision' }),
    ],
  },
  // ───────────────────────── Scripting
  {
    type: 'Script',
    label: 'Script',
    category: 'Scripting',
    icon: 'Code',
    multiple: true,
    description: 'Attach JavaScript/TypeScript code with start/update/onCollision hooks.',
    fields: [
      f('script', 'Script', 'script', ''),
      f('params', 'Parameters', 'params', {}, { help: 'Values available as params.name in the script' }),
    ],
  },
  {
    type: 'VisualScript',
    label: 'Visual Script',
    category: 'Scripting',
    icon: 'Workflow',
    multiple: true,
    description: 'No-code logic built from connected nodes.',
    fields: [f('graph', 'Graph', 'graph', '')],
  },
  // ───────────────────────── Audio
  {
    type: 'AudioSource',
    label: 'Audio Source',
    category: 'Audio',
    icon: 'Volume2',
    description: 'Plays a sound file or a built-in synthesized effect.',
    fields: [
      f('clip', 'Audio file', 'asset', '', { assetType: 'audio' }),
      f('preset', 'Built-in sound', 'select', 'none', { options: SFX, showIf: (p) => !p.clip }),
      f('volume', 'Volume', 'number', 0.8, { min: 0, max: 1, step: 0.05 }),
      f('loop', 'Loop', 'boolean', false),
      f('autoplay', 'Play on start', 'boolean', true),
      f('spatial', '3D positional', 'boolean', false),
    ],
  },
  // ───────────────────────── Effects
  {
    type: 'Particles',
    label: 'Particles',
    category: 'Effects',
    icon: 'Sparkles',
    description: 'Fire, smoke, sparks, magic, rain...',
    fields: [
      f('rate', 'Rate / second', 'number', 30, { min: 0, step: 1 }),
      f('burst', 'Burst on start', 'number', 0, { min: 0, step: 1 }),
      f('lifetime', 'Lifetime', 'number', 1.2, { min: 0.05, step: 0.1 }),
      f('speed', 'Speed', 'number', 2, { min: 0, step: 0.1 }),
      f('spread', 'Spread', 'number', 0.4, { min: 0, max: 1, step: 0.05 }),
      f('direction', 'Direction', 'vec3', [0, 1, 0]),
      f('gravity', 'Gravity', 'number', 0, { step: 0.5 }),
      f('size', 'Size', 'number', 0.25, { min: 0.01, step: 0.05 }),
      f('colorStart', 'Start color', 'color', '#ffd166'),
      f('colorEnd', 'End color', 'color', '#ef476f'),
      f('additive', 'Glow (additive)', 'boolean', true),
      f('maxParticles', 'Max particles', 'number', 400, { min: 1, step: 50 }),
    ],
  },
  // ───────────────────────── Gameplay behaviours (no code needed)
  {
    type: 'PlatformerController',
    label: 'Platformer Controller',
    category: 'Gameplay',
    icon: 'Footprints',
    description: 'Run & jump with arrows/WASD + Space. Needs Rigid Body + Collider.',
    fields: [
      f('speed', 'Run speed', 'number', 7, { min: 0, step: 0.5 }),
      f('jumpForce', 'Jump force', 'number', 11, { min: 0, step: 0.5 }),
      f('airJumps', 'Air jumps', 'number', 0, { min: 0, step: 1, help: '1 = double jump' }),
      f('airControl', 'Air control', 'number', 0.8, { min: 0, max: 1, step: 0.05 }),
    ],
  },
  {
    type: 'TopDownController',
    label: 'Top-Down Controller',
    category: 'Gameplay',
    icon: 'Move',
    description: 'Move in all directions (XY in 2D, XZ in 3D).',
    fields: [
      f('speed', 'Speed', 'number', 6, { min: 0, step: 0.5 }),
      f('faceMovement', 'Face movement direction', 'boolean', true),
      f('cameraRelative', 'Relative to camera', 'boolean', true, { help: '3D only' }),
    ],
  },
  {
    type: 'FirstPersonController',
    label: 'First-Person Controller',
    category: 'Gameplay',
    icon: 'Eye',
    modes: ['3d'],
    description: 'WASD + mouse look (click to capture mouse). Put a Camera on a child entity.',
    fields: [
      f('speed', 'Walk speed', 'number', 5, { min: 0, step: 0.5 }),
      f('jumpForce', 'Jump force', 'number', 6, { min: 0, step: 0.5 }),
      f('sensitivity', 'Mouse sensitivity', 'number', 0.15, { min: 0.01, step: 0.01 }),
    ],
  },
  {
    type: 'Rotator',
    label: 'Rotator',
    category: 'Gameplay',
    icon: 'RotateCw',
    description: 'Spins constantly.',
    fields: [f('speed', 'Degrees / second', 'vec3', [0, 90, 0])],
  },
  {
    type: 'Oscillator',
    label: 'Oscillator',
    category: 'Gameplay',
    icon: 'Waves',
    description: 'Moves back and forth (moving platforms, floating items).',
    fields: [
      f('axis', 'Axis', 'vec3', [0, 1, 0]),
      f('amplitude', 'Distance', 'number', 1, { step: 0.1 }),
      f('frequency', 'Cycles / second', 'number', 0.5, { min: 0, step: 0.05 }),
    ],
  },
  {
    type: 'Collectible',
    label: 'Collectible',
    category: 'Gameplay',
    icon: 'Coins',
    description: 'Adds to a game variable and disappears when touched.',
    fields: [
      f('variable', 'Variable', 'string', 'score'),
      f('amount', 'Amount', 'number', 1, { step: 1 }),
      f('collectorTag', 'Collected by tag', 'string', 'player'),
      f('sound', 'Sound', 'select', 'coin', { options: SFX }),
    ],
  },
  {
    type: 'Health',
    label: 'Health',
    category: 'Gameplay',
    icon: 'Heart',
    description: 'Hit points. Damage reduces it; at 0 the entity dies.',
    fields: [
      f('max', 'Max health', 'number', 3, { min: 1, step: 1 }),
      f('onDeath', 'On death', 'select', 'destroy', { options: ['destroy', 'respawn', 'game over', 'win', 'nothing'] }),
      f('invulnerableTime', 'Invulnerable after hit (s)', 'number', 0.6, { min: 0, step: 0.1 }),
      f('showInHud', 'Show in HUD', 'boolean', false),
      f('showBar', 'Health bar', 'boolean', false, { help: 'Floating bar above the entity' }),
      f('damageNumbers', 'Damage numbers', 'boolean', false),
      f('rewardVariable', 'Reward variable', 'string', '', { help: 'e.g. gold — added when this dies' }),
      f('rewardAmount', 'Reward amount', 'number', 0, { step: 1, showIf: (p) => !!p.rewardVariable }),
    ],
  },
  {
    type: 'Damage',
    label: 'Damage',
    category: 'Gameplay',
    icon: 'Swords',
    description: 'Hurts entities with a tag on touch (spikes, enemies, bullets).',
    fields: [
      f('amount', 'Amount', 'number', 1, { min: 0, step: 1 }),
      f('targetTag', 'Target tag', 'string', 'player'),
      f('destroySelf', 'Destroy self on hit', 'boolean', false),
      f('knockback', 'Knockback', 'number', 6, { min: 0, step: 0.5 }),
    ],
  },
  {
    type: 'Spawner',
    label: 'Spawner',
    category: 'Gameplay',
    icon: 'CopyPlus',
    description: 'Creates copies of a prefab over time.',
    fields: [
      f('prefab', 'Prefab', 'prefab', ''),
      f('interval', 'Interval (s)', 'number', 2, { min: 0.05, step: 0.1 }),
      f('maxAlive', 'Max alive', 'number', 10, { min: 1, step: 1 }),
      f('radius', 'Random radius', 'number', 0, { min: 0, step: 0.5 }),
      f('velocity', 'Initial velocity', 'vec3', [0, 0, 0]),
    ],
  },
  {
    type: 'Shooter',
    label: 'Shooter',
    category: 'Gameplay',
    icon: 'Target',
    description: 'Fires projectile prefabs when an input action is pressed.',
    fields: [
      f('prefab', 'Projectile', 'prefab', ''),
      f('action', 'Fire action', 'action', 'fire'),
      f('speed', 'Projectile speed', 'number', 16, { min: 0, step: 0.5 }),
      f('cooldown', 'Cooldown (s)', 'number', 0.25, { min: 0, step: 0.05 }),
      f('aim', 'Aim', 'select', 'facing', { options: ['facing', 'pointer'] }),
      f('auto', 'Hold to auto-fire', 'boolean', true),
      f('sound', 'Sound', 'select', 'laser', { options: SFX }),
    ],
  },
  {
    type: 'DestroyAfter',
    label: 'Destroy After',
    category: 'Gameplay',
    icon: 'Timer',
    description: 'Removes the entity after some seconds.',
    fields: [f('seconds', 'Seconds', 'number', 3, { min: 0, step: 0.1 })],
  },
  {
    type: 'Goal',
    label: 'Goal / Portal',
    category: 'Gameplay',
    icon: 'Flag',
    description: 'Win the level or travel to another scene when touched.',
    fields: [
      f('tag', 'Activated by tag', 'string', 'player'),
      f('scene', 'Go to scene', 'scene', '', { help: 'Empty = show the win message' }),
      f('message', 'Message', 'string', 'You win!'),
    ],
  },
  // ───────────────────────── UI
  {
    type: 'HudText',
    label: 'HUD Text',
    category: 'UI',
    icon: 'PanelTop',
    description: 'Screen-space text. Use {var} for live values, e.g. "Coins: {score}".',
    fields: [
      f('text', 'Text', 'text', 'Score: {score}'),
      f('anchor', 'Anchor', 'select', 'top-left', {
        options: ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'],
      }),
      f('fontSize', 'Font size', 'number', 24, { min: 6, step: 1 }),
      f('color', 'Color', 'color', '#ffffff'),
    ],
  },
  // ───────────────────────── Level
  {
    type: 'TileMap',
    label: 'Tile Map',
    category: 'Level',
    icon: 'Grid3x3',
    description: 'Draw levels with characters. Each character in the legend spawns a prefab.',
    fields: [
      f('map', 'Map', 'text', '..........\n..........\n##########'),
      f('legend', 'Legend', 'text', '#=Ground', { help: 'One per line: character=PrefabName' }),
      f('tileSize', 'Tile size', 'number', 1, { min: 0.1, step: 0.1 }),
    ],
  },
  // ───────────────────────── Strategy & simulation
  {
    type: 'UnitAI',
    label: 'Unit AI',
    category: 'Strategy',
    icon: 'Swords',
    description: 'Autonomous fighter: finds the nearest enemy team, walks there with pathfinding and attacks. Speed 0 = tower/defense.',
    fields: [
      f('team', 'Team', 'select', 'red', { options: ['blue', 'red', 'green', 'yellow'] }),
      f('speed', 'Move speed', 'number', 2, { min: 0, step: 0.1, help: '0 = building / tower' }),
      f('targets', 'Targets', 'select', 'any', { options: ['any', 'buildings'] }),
      f('aggroRange', 'Sight range', 'number', 6, { min: 0, step: 0.5 }),
      f('attackRange', 'Attack range', 'number', 0.8, { min: 0, step: 0.1 }),
      f('damage', 'Damage', 'number', 1, { min: 0, step: 1 }),
      f('attackCooldown', 'Attack every (s)', 'number', 1, { min: 0.05, step: 0.05 }),
      f('projectile', 'Projectile', 'select', 'none', { options: ['none', 'arrow', 'cannonball', 'magic'] }),
      f('projectileSpeed', 'Projectile speed', 'number', 14, { min: 1, step: 1, showIf: (p) => p.projectile !== 'none' }),
      f('separation', 'Personal space', 'number', 0.45, { min: 0, step: 0.05 }),
      f('turnToTarget', 'Face target', 'boolean', true),
    ],
  },
  {
    type: 'NavAgent',
    label: 'Nav Agent',
    category: 'Strategy',
    icon: 'Footprints',
    description: 'Walks around obstacles with pathfinding. Call self.moveTo(x, y, z) or use the "Move To" node.',
    fields: [
      f('speed', 'Speed', 'number', 3.5, { min: 0, step: 0.1 }),
      f('stoppingDistance', 'Stop distance', 'number', 0.2, { min: 0, step: 0.05 }),
      f('separation', 'Personal space', 'number', 0.4, { min: 0, step: 0.05 }),
      f('faceMovement', 'Face movement', 'boolean', true),
    ],
  },
  {
    type: 'SpawnMenu',
    label: 'Card Deck / Build Menu',
    category: 'Strategy',
    icon: 'Layers',
    description: 'Cards that cost a resource and spawn prefabs where you tap (Clash Royale) or place buildings on a grid (Clash of Clans). Can also act as an AI opponent.',
    fields: [
      f('items', 'Cards', 'text', 'Knight:3:⚔️\nArcher:3:🏹', { help: 'One per line: Prefab:cost:icon' }),
      f('label', 'Resource label', 'string', 'Elixir'),
      f('currency', 'Resource variable', 'string', 'elixir'),
      f('start', 'Start amount', 'number', 5, { min: 0, step: 1 }),
      f('max', 'Max amount', 'number', 10, { min: 0, step: 1, help: '0 = unlimited' }),
      f('regen', 'Regen / second', 'number', 0.4, { min: 0, step: 0.05 }),
      f('mode', 'Mode', 'select', 'deploy', { options: ['deploy', 'build'] }),
      f('gridSize', 'Grid snap', 'number', 0, { min: 0, step: 0.5, help: '0 = free placement' }),
      f('team', 'Team', 'select', 'blue', { options: ['blue', 'red', 'green', 'yellow'] }),
      f('areaMin', 'Allowed area min', 'vec3', [-100, -100, -100]),
      f('areaMax', 'Allowed area max', 'vec3', [100, 100, 100]),
      f('ai', 'AI controlled', 'boolean', false, { help: 'Plays cards automatically (enemy opponent)' }),
      f('aiInterval', 'AI think time (s)', 'number', 4, { min: 0.2, step: 0.5, showIf: (p) => !!p.ai }),
    ],
  },
  {
    type: 'ResourceGenerator',
    label: 'Resource Generator',
    category: 'Strategy',
    icon: 'Coins',
    description: 'Produces a resource over time (gold mine, elixir pump, farm).',
    fields: [
      f('variable', 'Variable', 'string', 'gold'),
      f('amount', 'Amount', 'number', 5, { step: 1 }),
      f('interval', 'Every (s)', 'number', 3, { min: 0.1, step: 0.5 }),
      f('cap', 'Cap', 'number', 0, { min: 0, step: 10, help: '0 = no limit' }),
      f('showPopup', 'Show "+5" popup', 'boolean', true),
      f('icon', 'Icon', 'string', '🪙'),
    ],
  },
  {
    type: 'StrategyCamera',
    label: 'Strategy Camera',
    category: 'Camera',
    icon: 'Move3d',
    description: 'RTS / builder camera: drag or WASD to pan, wheel or pinch to zoom. Put it on the camera.',
    fields: [
      f('dragPan', 'Drag to pan', 'boolean', true),
      f('keyboard', 'Keyboard pan', 'boolean', true),
      f('panSpeed', 'Pan speed', 'number', 14, { min: 0, step: 1 }),
      f('zoomMin', 'Zoom min', 'number', 4, { min: 0.5, step: 0.5 }),
      f('zoomMax', 'Zoom max', 'number', 40, { min: 1, step: 1 }),
      f('zoomSpeed', 'Zoom speed', 'number', 1, { min: 0.1, step: 0.1 }),
      f('boundsMin', 'Bounds min', 'vec3', [-30, -30, -30]),
      f('boundsMax', 'Bounds max', 'vec3', [30, 30, 30]),
    ],
  },
  {
    type: 'PathFollower',
    label: 'Path Follower',
    category: 'Strategy',
    icon: 'Waypoints',
    description: 'Walks along waypoints — tower-defense enemies, patrols, trains. Waypoints = children of an entity, or a list of names.',
    fields: [
      f('path', 'Path', 'string', 'Path', { help: 'Entity whose children are waypoints, or "A, B, C"' }),
      f('speed', 'Speed', 'number', 2.5, { min: 0, step: 0.1 }),
      f('loop', 'At the end', 'select', 'once', { options: ['once', 'loop', 'pingpong'] }),
      f('faceMovement', 'Face movement', 'boolean', true),
      f('endTarget', 'Damage at end', 'entity', '', { help: 'Entity hurt when the end is reached (e.g. Base)' }),
      f('endDamage', 'End damage', 'number', 1, { min: 0, step: 1 }),
      f('destroyAtEnd', 'Destroy at end', 'boolean', true),
      f('team', 'Team', 'select', '', { options: ['', 'blue', 'red', 'green', 'yellow'], help: 'Set so towers (Unit AI) can target it' }),
    ],
  },
  {
    type: 'RouteBuilder',
    label: 'Route Builder',
    category: 'Strategy',
    icon: 'Route',
    description: 'Players drag between stations to draw colored lines; a vehicle shuttles along each line (Mini Metro style).',
    fields: [
      f('stationTag', 'Station tag', 'string', 'station'),
      f('vehicle', 'Vehicle prefab', 'prefab', ''),
      f('colors', 'Line colors', 'string', '#e63946,#1d7fd6,#2a9d8f,#f4a261,#9b5de5'),
      f('maxLines', 'Max lines', 'number', 3, { min: 1, step: 1 }),
      f('lineWidth', 'Line width', 'number', 0.25, { min: 0.02, step: 0.05 }),
      f('vehicleSpeed', 'Vehicle speed', 'number', 3, { min: 0.1, step: 0.1 }),
      f('stopTime', 'Stop at stations (s)', 'number', 0.6, { min: 0, step: 0.1 }),
    ],
  },
  // ───────────────────────── Network
  {
    type: 'NetworkSync',
    label: 'Network Sync',
    category: 'Network',
    icon: 'Wifi',
    description: 'Shares this entity\'s position with other players in multiplayer games.',
    fields: [f('interpolate', 'Smooth remote movement', 'boolean', true)],
  },
];

const BY_TYPE = new Map(COMPONENTS.map((c) => [c.type, c]));

export function getComponentSchema(type: string): ComponentSchema | undefined {
  return BY_TYPE.get(type);
}

/** Create a component with every field set to its default value. */
export function createComponent(type: string, overrides: Record<string, unknown> = {}): ComponentData {
  const schema = BY_TYPE.get(type);
  const base: ComponentData = { type };
  if (schema) for (const field of schema.fields) base[field.key] = structuredClone(field.default);
  return { ...base, ...overrides, type };
}

/** Read a component prop falling back to the schema default (robust to old/partial data). */
export function prop<T>(component: ComponentData, key: string): T {
  if (component[key] !== undefined) return component[key] as T;
  const field = BY_TYPE.get(component.type)?.fields.find((x) => x.key === key);
  return field?.default as T;
}
