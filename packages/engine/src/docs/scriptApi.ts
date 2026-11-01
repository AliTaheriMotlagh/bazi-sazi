/**
 * Type declarations of the scripting API. Loaded into the code editor for
 * autocomplete and sent to the AI assistant as reference documentation.
 * Keep in sync with runtime/scripting.ts (SCOPE) and GameApi/GameObject.
 */
export const SCRIPT_API_DTS = `
/** A 3D vector (three.js Vector3). */
interface Vector3 {
  x: number; y: number; z: number;
  set(x: number, y: number, z: number): this;
  copy(v: Vector3): this;
  clone(): Vector3;
  add(v: Vector3): this;
  sub(v: Vector3): this;
  multiplyScalar(s: number): this;
  addScaledVector(v: Vector3, s: number): this;
  normalize(): this;
  length(): number;
  distanceTo(v: Vector3): number;
  lerp(v: Vector3, t: number): this;
  dot(v: Vector3): number;
}
interface Euler { x: number; y: number; z: number; }

/** An entity in the running game. */
interface GameObject {
  readonly id: string;
  name: string;
  /** Local position (units). Change it directly or use setPosition/move. */
  readonly position: Vector3;
  /** Local rotation in RADIANS. */
  readonly rotation: Euler;
  readonly scale: Vector3;
  /** Physics velocity (copy). Use setVelocity to change it. */
  readonly velocity: Vector3;
  /** Free-form per-entity variables. */
  readonly vars: Record<string, any>;
  readonly alive: boolean;
  readonly parent: GameObject | null;
  /** True for avatars controlled by another online player. */
  readonly isRemote: boolean;
  visible: boolean;
  setPosition(x: number, y: number, z?: number): this;
  /** Move relative to the current position. */
  move(x: number, y: number, z?: number): this;
  /** Rotate by DEGREES. */
  rotate(x: number, y: number, z: number): this;
  lookAt(x: number, y: number, z: number): this;
  setVelocity(x: number, y: number, z?: number): this;
  applyImpulse(x: number, y: number, z?: number): this;
  isGrounded(): boolean;
  worldPosition(): Vector3;
  /** Facing direction (-Z in 3D, +X/-X in 2D). */
  forward(): Vector3;
  distanceTo(other: GameObject | Vector3): number;
  hasTag(tag: string): boolean;
  addTag(tag: string): this;
  removeTag(tag: string): this;
  /** Read a component's settings, e.g. getComponent('Sprite').color */
  getComponent(type: string): Record<string, any> | undefined;
  setColor(color: string): this;
  setText(text: string): this;
  playAnimation(name: string): this;
  /** Calls onMessage(name, data, from) on this entity's scripts. */
  send(message: string, data?: any, from?: GameObject | null): void;
  destroy(): void;
}

interface SpawnOptions {
  position?: [number, number, number];
  rotation?: [number, number, number];
  velocity?: [number, number, number];
  parent?: GameObject | null;
  name?: string;
}

interface Game {
  /** Game-wide variables. Show them in HUD/World Text with {name}. */
  readonly vars: Record<string, any>;
  readonly time: { elapsed: number; dt: number; frame: number; scale: number };
  readonly mode: '2d' | '3d';
  readonly sceneName: string;
  readonly camera: any;
  readonly hud: {
    set(key: string, text: string, style?: { anchor?: 'top-left' | 'top-center' | 'top-right' | 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right'; fontSize?: number; color?: string }): void;
    remove(key: string): void;
    /** Big centered message. seconds = 0 keeps it on screen. */
    message(text: string, seconds?: number): void;
  };
  find(name: string): GameObject | undefined;
  findAll(tag: string): GameObject[];
  get(id: string): GameObject | undefined;
  all(): GameObject[];
  /** Create an instance of a prefab by name. */
  spawn(prefab: string, options?: SpawnOptions): GameObject | null;
  destroy(entity: GameObject): void;
  loadScene(name: string): void;
  restart(): void;
  win(message?: string): void;
  gameOver(message?: string): void;
  /** Send a message to every entity. */
  broadcast(message: string, data?: any): void;
  raycast(origin: Vector3, direction: Vector3, maxDistance?: number, exclude?: GameObject): { entity: GameObject; point: Vector3; distance: number } | null;
  /** Pointer/touch position projected into the world (z=0 plane in 2D, ground in 3D). */
  pointerWorld(): Vector3;
  /** Run once after some seconds. Returns a cancel function. */
  after(seconds: number, fn: () => void): () => void;
  /** Run repeatedly. Returns a cancel function. */
  every(seconds: number, fn: () => void): () => void;
  pause(): void;
  resume(): void;
}

type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'fire' | 'action' | 'pause' | (string & {});
interface Input {
  /** Held down this frame. Accepts an action name or a key code like 'KeyQ'. */
  isDown(action: Action): boolean;
  /** Became pressed this frame. */
  pressed(action: Action): boolean;
  released(action: Action): boolean;
  /** -1..1 from arrows/WASD, gamepad stick and touch joystick. */
  axis(name: 'horizontal' | 'vertical'): number;
  /** Pointer position in normalized screen coordinates (-1..1). */
  readonly pointer: { x: number; y: number };
  readonly pointerDelta: { x: number; y: number };
}

type SoundPreset = 'coin' | 'jump' | 'hit' | 'explosion' | 'powerup' | 'laser' | 'blip' | 'lose' | 'win';
interface Audio {
  /** Play a built-in synthesized sound effect. */
  sfx(preset: SoundPreset, volume?: number): void;
  /** Play an uploaded audio asset by name (or a preset). */
  play(clip: string, options?: { volume?: number; loop?: boolean; pan?: number }): { stop(): void; setVolume(v: number): void };
  stopAll(): void;
  muted: boolean;
}

interface Net {
  readonly id: string | null;
  readonly isHost: boolean;
  readonly connected: boolean;
  readonly ping: number;
  readonly players: Map<string, { id: string; name: string }>;
  /** Shared room key/value state (late joiners receive it). */
  readonly state: Record<string, any>;
  setState(key: string, value: any): void;
  /** Send an event to other players. */
  send(type: string, data?: any, to?: string): void;
  /** Listen for events: custom types, or 'join' | 'leave' | 'state' | 'host'. */
  on(type: string, handler: (data: any, from: string) => void): () => void;
}

/** The entity this script is attached to. */
declare const self: GameObject;
declare const game: Game;
declare const input: Input;
declare const audio: Audio;
/** Multiplayer client (null when multiplayer is off). */
declare const net: Net | null;
/** Values from the Script component's Parameters. */
declare const params: Record<string, any>;
/** The full three.js library for advanced users. */
declare const THREE: any;
declare function log(...args: any[]): void;
declare function warn(...args: any[]): void;
declare function vec3(x?: number, y?: number, z?: number): Vector3;
declare function random(min?: number, max?: number): number;
declare function clamp(v: number, min: number, max: number): number;
declare function lerp(a: number, b: number, t: number): number;

// ── Lifecycle hooks: declare any of these functions in your script ──
// function start(): void
// function update(dt: number): void
// function lateUpdate(dt: number): void
// function onCollision(other: GameObject): void
// function onCollisionEnd(other: GameObject): void
// function onTrigger(other: GameObject): void
// function onTriggerEnd(other: GameObject): void
// function onMessage(name: string, data: any, from: GameObject | null): void
// function onClick(): void
// function onDestroy(): void
`;
