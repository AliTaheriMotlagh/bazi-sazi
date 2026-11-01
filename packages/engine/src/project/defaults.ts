import { createComponent } from '../components/registry';
import type {
  ComponentData,
  EntityData,
  EnvironmentData,
  GameMode,
  GraphData,
  InputMap,
  PrefabData,
  ProjectData,
  ProjectSettings,
  SceneData,
  ScriptData,
  Vec3,
} from '../types';
import { uid } from '../util';

export const DEFAULT_INPUT: InputMap = {
  left: ['ArrowLeft', 'KeyA', 'PadLeft'],
  right: ['ArrowRight', 'KeyD', 'PadRight'],
  up: ['ArrowUp', 'KeyW', 'PadUp'],
  down: ['ArrowDown', 'KeyS', 'PadDown'],
  jump: ['Space', 'Pad0'],
  fire: ['KeyJ', 'Mouse0', 'Pad2', 'Pad7'],
  action: ['KeyE', 'Enter', 'Pad1'],
  pause: ['Escape', 'Pad9'],
};

export function defaultSettings(mode: GameMode, startScene: string): ProjectSettings {
  return {
    mode,
    background: mode === '2d' ? '#1d2b53' : '#87b5e5',
    gravity: mode === '2d' ? [0, -30, 0] : [0, -9.81, 0],
    startScene,
    graphics: {
      quality: 'auto',
      shadows: mode === '3d',
      antialias: true,
      toneMapping: mode === '3d',
      exposure: 1,
      bloom: false,
      bloomStrength: 0.6,
      ssao: false,
      vignette: mode === '3d' ? 0.25 : 0,
      pixelArt: false,
      maxPixelRatio: 2,
      adaptiveResolution: true,
    },
    navigation: { cellSize: 0.5 },
    physics: { enabled: true, debug: false, fixedTimestep: 1 / 60 },
    multiplayer: { enabled: false, maxPlayers: 8, tickRate: 15, playerPrefab: '' },
    xr: { enabled: false },
    input: structuredClone(DEFAULT_INPUT),
    touchControls: 'auto',
  };
}

export interface EntityInit {
  name?: string;
  parent?: string | null;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  tags?: string[];
  enabled?: boolean;
  components?: ComponentData[];
}

export function createEntity(init: EntityInit = {}): EntityData {
  return {
    id: uid('e_'),
    name: init.name ?? 'Entity',
    parent: init.parent ?? null,
    enabled: init.enabled ?? true,
    tags: init.tags ?? [],
    transform: {
      position: init.position ?? [0, 0, 0],
      rotation: init.rotation ?? [0, 0, 0],
      scale: init.scale ?? [1, 1, 1],
    },
    components: init.components ?? [],
  };
}

/** Shorthand used by templates and the AI: comp('Mesh', { color: '#f00' }) */
export const comp = (type: string, props: Record<string, unknown> = {}): ComponentData =>
  createComponent(type, props);

export function createScene(name: string, mode: GameMode, withDefaults = true): SceneData {
  const entities: EntityData[] = [];
  if (withDefaults) {
    if (mode === '3d') {
      entities.push(
        createEntity({ name: 'Main Camera', position: [0, 4, 10], rotation: [-15, 0, 0], components: [comp('Camera')] }),
        createEntity({
          name: 'Sun',
          position: [5, 10, 5],
          rotation: [-50, 30, 0],
          components: [comp('Light', { kind: 'directional', intensity: 2.2 })],
        }),
        createEntity({
          name: 'Sky Light',
          components: [comp('Light', { kind: 'hemisphere', color: '#cfe6ff', groundColor: '#5a4a3a', intensity: 0.8 })],
        }),
      );
    } else {
      entities.push(createEntity({ name: 'Main Camera', position: [0, 0, 10], components: [comp('Camera', { size: 8 })] }));
    }
  }
  return {
    id: uid('s_'),
    name,
    entities,
    environment: defaultEnvironment(mode),
  };
}

export function defaultEnvironment(mode: GameMode): EnvironmentData {
  return {
    ambientColor: '#ffffff',
    ambientIntensity: mode === '2d' ? 1 : 0.15,
    fogColor: '#c8d8ec',
    fogDensity: 0,
    sky: mode === '2d' ? 'color' : 'procedural',
    skyTop: '#3a7bd5',
    skyBottom: '#cfe8ff',
    sunElevation: 35,
    envLight: mode === '2d' ? 'none' : 'sky',
    envIntensity: 0.8,
  };
}

export function createScript(name: string, code?: string): ScriptData {
  return { id: uid('sc_'), name, language: 'javascript', code: code ?? DEFAULT_SCRIPT };
}

export function createGraph(name: string): GraphData {
  return {
    id: uid('g_'),
    name,
    nodes: [
      { id: uid('n_'), type: 'event.start', position: { x: 40, y: 40 }, data: {} },
      { id: uid('n_'), type: 'event.update', position: { x: 40, y: 200 }, data: {} },
    ],
    edges: [],
  };
}

export function createPrefab(name: string, entities: EntityData[]): PrefabData {
  return { id: uid('p_'), name, entities };
}

export function createProject(name: string, mode: GameMode = '3d'): ProjectData {
  const scene = createScene('Main', mode);
  return {
    format: 'bazi-sazi',
    version: 1,
    id: uid('pr_'),
    name,
    description: '',
    settings: defaultSettings(mode, scene.id),
    scenes: [scene],
    assets: [],
    scripts: [],
    graphs: [],
    prefabs: [],
    animators: [],
  };
}

export const DEFAULT_SCRIPT = `// Runs once when the game starts
function start() {
  log('Hello from', self.name);
}

// Runs every frame. dt = seconds since the last frame
function update(dt) {
  // Example: spin around the Y axis
  // self.rotation.y += 1.5 * dt;
}

// Runs when this entity touches another one
function onCollision(other) {
  // if (other.hasTag('enemy')) other.destroy();
}
`;
