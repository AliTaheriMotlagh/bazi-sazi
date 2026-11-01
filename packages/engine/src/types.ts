/**
 * Project data model.
 *
 * Everything a game is made of is plain, JSON-serializable data. The editor
 * edits it, the runtime plays it, the server stores and publishes it, and the
 * AI assistant reads and writes it. Keeping it as data (not classes) is what
 * makes undo/redo, config-file editing, import/export and publishing trivial.
 */

export type Vec3 = [number, number, number];
export type GameMode = '2d' | '3d';

export interface TransformData {
  position: Vec3;
  /** Euler angles in degrees (XYZ order). */
  rotation: Vec3;
  scale: Vec3;
}

export interface ComponentData {
  type: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface EntityData {
  id: string;
  name: string;
  parent: string | null;
  enabled: boolean;
  tags: string[];
  transform: TransformData;
  components: ComponentData[];
}

export type SkyMode = 'color' | 'gradient' | 'procedural';
export type EnvLight = 'none' | 'studio' | 'sky';

export interface EnvironmentData {
  ambientColor: string;
  ambientIntensity: number;
  fogColor: string;
  /** 0 disables fog. */
  fogDensity: number;
  /** Background: flat project color, a two-color gradient, or a physically based sky (3D). */
  sky: SkyMode;
  skyTop: string;
  skyBottom: string;
  /** Sun height in degrees for the procedural sky. */
  sunElevation: number;
  /** Image-based lighting: realistic reflections and soft light from the environment. */
  envLight: EnvLight;
  envIntensity: number;
}

export interface SceneData {
  id: string;
  name: string;
  entities: EntityData[];
  environment: EnvironmentData;
}

export type AssetType = 'image' | 'audio' | 'model' | 'video' | 'font' | 'other';

export interface AssetData {
  id: string;
  name: string;
  type: AssetType;
  url: string;
  size?: number;
}

export type ScriptLanguage = 'javascript' | 'typescript';

export interface ScriptData {
  id: string;
  name: string;
  language: ScriptLanguage;
  code: string;
}

export interface GraphNodeData {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface GraphData {
  id: string;
  name: string;
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

/** A reusable entity tree. The root is the entity whose parent is null. */
export interface PrefabData {
  id: string;
  name: string;
  entities: EntityData[];
}

/** action name -> list of input codes (KeyboardEvent.code, "Mouse0", "Pad0"...) */
export type InputMap = Record<string, string[]>;

export interface ProjectSettings {
  mode: GameMode;
  background: string;
  gravity: Vec3;
  startScene: string;
  graphics: {
    /** auto = high on desktop, low on phones. */
    quality: 'auto' | 'low' | 'medium' | 'high';
    shadows: boolean;
    antialias: boolean;
    toneMapping: boolean;
    exposure: number;
    bloom: boolean;
    bloomStrength: number;
    /** Ambient occlusion (contact shadows). 3D only, high quality only. */
    ssao: boolean;
    /** 0..1 darkening of the screen edges. */
    vignette: number;
    pixelArt: boolean;
    maxPixelRatio: number;
    /** Lower the render resolution automatically when the frame rate drops. */
    adaptiveResolution: boolean;
  };
  navigation: {
    /** Size of one pathfinding grid cell in world units. */
    cellSize: number;
  };
  physics: {
    enabled: boolean;
    debug: boolean;
    fixedTimestep: number;
  };
  multiplayer: {
    enabled: boolean;
    maxPlayers: number;
    tickRate: number;
    /** Prefab spawned for every connected player. */
    playerPrefab: string;
  };
  xr: { enabled: boolean };
  input: InputMap;
  touchControls: 'auto' | 'always' | 'never';
}

export interface ProjectData {
  format: 'bazi-sazi';
  version: 1;
  id: string;
  name: string;
  description: string;
  settings: ProjectSettings;
  scenes: SceneData[];
  assets: AssetData[];
  scripts: ScriptData[];
  graphs: GraphData[];
  prefabs: PrefabData[];
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  source?: string;
  entityId?: string;
  time: number;
}

export type Logger = (entry: Omit<LogEntry, 'time'>) => void;
