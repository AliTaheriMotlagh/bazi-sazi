import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { prop } from '../components/registry';
import type { EntityData, LogLevel, Logger, PrefabData, ProjectData, SceneData, Vec3 } from '../types';
import { damp, uid } from '../util';
import { createGraphBehaviour } from '../visual/interpreter';
import { AssetCache } from './assets';
import { AudioEngine } from './audio';
import { BEHAVIOURS } from './behaviours';
import { buildVisuals } from './builders';
import { GameObject } from './GameObject';
import { Hud, injectRuntimeCss } from './hud';
import { Input } from './input';
import { NetClient } from './network';
import { initPhysics, Physics, type RayHit } from './physics';
import { createScriptInstance, ScriptCache } from './scripting';
import { TouchControls } from './touch';

export interface RuntimeOptions {
  canvas: HTMLCanvasElement;
  /** Container for HUD and touch controls (play mode). Defaults to the canvas parent. */
  overlay?: HTMLElement;
  project: ProjectData;
  mode: 'edit' | 'play';
  sceneId?: string;
  logger?: Logger;
  network?: { url: string; name: string } | null;
  onSceneChange?: (sceneId: string) => void;
}

export interface RuntimeStats {
  fps: number;
  frameMs: number;
  updateMs: number;
  physicsMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  entities: number;
  bodies: number;
  ping: number;
}

export interface SpawnOptions {
  position?: Vec3;
  rotation?: Vec3;
  velocity?: Vec3;
  parent?: GameObject | null;
  name?: string;
}

export interface HudApi {
  set(key: string, text: string, style?: { anchor?: string; fontSize?: number; color?: string }): void;
  remove(key: string): void;
  message(text: string, seconds?: number): void;
}

/** The `game` object scripts and visual graphs talk to (facade pattern). */
export interface GameApi {
  readonly vars: Record<string, unknown>;
  readonly time: { elapsed: number; dt: number; frame: number; scale: number };
  readonly input: Input;
  readonly audio: AudioEngine;
  readonly net: NetClient | null;
  readonly hud: HudApi;
  readonly mode: '2d' | '3d';
  readonly camera: THREE.Camera | null;
  readonly scene: THREE.Scene;
  readonly sceneName: string;
  find(name: string): GameObject | undefined;
  findAll(tag: string): GameObject[];
  get(id: string): GameObject | undefined;
  all(): GameObject[];
  spawn(prefab: string, opts?: SpawnOptions): GameObject | null;
  destroy(go: GameObject): void;
  loadScene(name: string): void;
  restart(): void;
  win(message?: string): void;
  gameOver(message?: string): void;
  broadcast(message: string, data?: unknown): void;
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance?: number, exclude?: GameObject): RayHit | null;
  pointerWorld(): THREE.Vector3;
  after(seconds: number, fn: () => void): () => void;
  every(seconds: number, fn: () => void): () => void;
  log(level: LogLevel, args: unknown[], source?: string, entityId?: string): void;
  pause(): void;
  resume(): void;
}

interface Timer {
  at: number;
  fn: () => void;
  interval?: number;
  cancelled?: boolean;
}

interface NetTransform {
  n: string;
  p: Vec3;
  q: [number, number, number, number];
  f?: string | null;
  nm?: string;
  fc?: number;
}

const NO_HUD: HudApi = { set() {}, remove() {}, message() {} };
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane();
const _v = new THREE.Vector3();

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof GameObject) return `[${a.name}]`;
  if (a instanceof THREE.Vector3) return `(${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)})`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export class Runtime {
  readonly mode: 'edit' | 'play';
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly entities = new Map<string, GameObject>();
  readonly assets: AssetCache;
  readonly input: Input;
  readonly audio: AudioEngine;
  readonly api: GameApi;
  readonly stats: RuntimeStats = { fps: 0, frameMs: 0, updateMs: 0, physicsMs: 0, renderMs: 0, drawCalls: 0, triangles: 0, entities: 0, bodies: 0, ping: 0 };
  readonly time = { elapsed: 0, dt: 0, frame: 0, scale: 1 };
  project: ProjectData;
  sceneId: string;
  physics: Physics | null = null;
  hud: Hud | null = null;
  net: NetClient | null = null;
  camera: THREE.Camera | null = null;
  /** Camera supplied by the editor viewport (edit mode). */
  editorCamera: THREE.Camera | null = null;
  paused = false;
  physicsDebug = false;
  vars: Record<string, unknown> = {};
  /** Called every frame before rendering (editor tools, debug overlays). */
  readonly frameHooks = new Set<(dt: number) => void>();

  private overlay: HTMLElement | null;
  private logger: Logger;
  private scripts = new ScriptCache();
  private timers: Timer[] = [];
  private ambient = new THREE.AmbientLight();
  private defaultCamera: THREE.Camera | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private touch: TouchControls | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private stepOnce = false;
  private ended = false;
  private disposed = false;
  private netAccumulator = 0;
  private netTargets = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private dataHashes = new Map<string, string>();
  private disposers: (() => void)[] = [];
  private onSceneChange?: (sceneId: string) => void;
  private networkOptions: RuntimeOptions['network'];

  private constructor(opts: RuntimeOptions) {
    this.mode = opts.mode;
    this.canvas = opts.canvas;
    this.project = opts.project;
    this.sceneId = opts.sceneId ?? opts.project.settings.startScene ?? opts.project.scenes[0]?.id;
    this.logger = opts.logger ?? ((e) => console[e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : 'log'](e.source ?? '', e.message));
    this.overlay = opts.overlay ?? opts.canvas.parentElement;
    this.onSceneChange = opts.onSceneChange;
    this.networkOptions = opts.network;

    const g = opts.project.settings.graphics;
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: g.antialias && !g.pixelArt, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, g.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = g.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = g.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (g.pixelArt) opts.canvas.style.imageRendering = 'pixelated';
    this.scene.add(this.ambient);

    this.assets = new AssetCache(opts.project.assets, g.pixelArt);
    this.input = new Input(opts.canvas, opts.project.settings.input);
    this.input.enabled = this.isPlaying;
    this.audio = new AudioEngine(this.assets);
    this.api = this.createApi();

    if (this.isPlaying && this.overlay) {
      injectRuntimeCss();
      this.hud = new Hud(this.overlay);
      if (TouchControls.shouldShow(opts.project.settings.touchControls)) this.touch = new TouchControls(this.overlay, this.input);
      const resumeAudio = () => this.audio.resume();
      window.addEventListener('pointerdown', resumeAudio);
      window.addEventListener('keydown', resumeAudio);
      this.disposers.push(() => {
        window.removeEventListener('pointerdown', resumeAudio);
        window.removeEventListener('keydown', resumeAudio);
      });
      const onClick = (e: PointerEvent) => this.handleClick(e);
      opts.canvas.addEventListener('pointerdown', onClick);
      this.disposers.push(() => opts.canvas.removeEventListener('pointerdown', onClick));
    }
    if (this.isPlaying && opts.project.settings.xr.enabled) {
      this.renderer.xr.enabled = true;
      // 'local' keeps the authored camera height as eye height.
      this.renderer.xr.setReferenceSpaceType('local');
    }
    // Created up-front so scripts can capture `net` before the socket connects.
    if (this.isPlaying && opts.network && opts.project.settings.multiplayer.enabled) this.net = this.createNetClient(opts.network);
    if (g.bloom) this.setupBloom();
  }

  /** Create a runtime. Play mode initializes physics (WASM) first. */
  static async create(opts: RuntimeOptions): Promise<Runtime> {
    if (opts.mode === 'play' && opts.project.settings.physics.enabled) await initPhysics();
    const rt = new Runtime(opts);
    rt.loadScene(rt.sceneId, true);
    rt.observeResize();
    return rt;
  }

  get isPlaying(): boolean {
    return this.mode === 'play';
  }

  get mode2d(): boolean {
    return this.project.settings.mode === '2d';
  }

  get viewportHeight(): number {
    return this.renderer.domElement.height;
  }

  get currentScene(): SceneData | undefined {
    return this.project.scenes.find((s) => s.id === this.sceneId);
  }

  log(entry: { level: LogLevel; message: string; source?: string; entityId?: string }): void {
    this.logger(entry);
  }

  // ════════════════════════════════════════ lifecycle
  start(): void {
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
    if (this.net) void this.connectNetwork();
    else if (this.isPlaying && this.project.settings.multiplayer.enabled) this.spawnLocalAvatar();
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const go of [...this.entities.values()]) this.destroy(go, true);
    this.physics?.dispose();
    this.net?.disconnect();
    this.hud?.dispose();
    this.touch?.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.assets.dispose();
    this.resizeObserver?.disconnect();
    for (const d of this.disposers) d();
    this.composer?.dispose();
    this.renderer.dispose();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Advance exactly one frame while paused (debugging). */
  step(): void {
    this.stepOnce = true;
  }

  private observeResize(): void {
    const target = this.canvas.parentElement ?? this.canvas;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(target);
    this.resize();
  }

  resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.updateCameraProjection(w / h);
  }

  private updateCameraProjection(aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)): void {
    const cams = [this.camera, this.editorCamera].filter(Boolean) as THREE.Camera[];
    for (const cam of cams) {
      if (cam instanceof THREE.PerspectiveCamera) {
        if (cam.aspect !== aspect) {
          cam.aspect = aspect;
          cam.updateProjectionMatrix();
        }
      } else if (cam instanceof THREE.OrthographicCamera) {
        const size = (cam.userData.orthoSize as number) ?? 8;
        const zoom = cam.zoom;
        if (cam.top !== size || cam.right !== size * aspect) {
          cam.top = size;
          cam.bottom = -size;
          cam.left = -size * aspect;
          cam.right = size * aspect;
          cam.zoom = zoom;
          cam.updateProjectionMatrix();
        }
      }
    }
  }

  private setupBloom(): void {
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), this.project.settings.graphics.bloomStrength, 0.4, 0.82));
    this.composer.addPass(new OutputPass());
  }

  // ════════════════════════════════════════ frame
  private frame(now: number): void {
    const frameStart = performance.now();
    const rawDt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const running = this.isPlaying && (!this.paused || this.stepOnce) && !this.ended;
    const dt = this.stepOnce ? 1 / 60 : rawDt * this.time.scale;
    this.stepOnce = false;

    let t0 = performance.now();
    if (this.isPlaying) {
      this.input.poll();
      this.pollXrInput();
    }
    if (running) {
      this.time.dt = dt;
      this.time.elapsed += dt;
      this.time.frame++;
      this.runTimers();
      const objects = [...this.entities.values()];
      for (const go of objects) if (go.alive) go.invoke('update', dt);
      this.stats.updateMs = performance.now() - t0;

      t0 = performance.now();
      if (this.physics) {
        for (const ev of this.physics.step(dt)) {
          const [ha, hb] = ev.trigger
            ? ev.started ? (['onTrigger', 'onTrigger'] as const) : (['onTriggerEnd', 'onTriggerEnd'] as const)
            : ev.started ? (['onCollision', 'onCollision'] as const) : (['onCollisionEnd', 'onCollisionEnd'] as const);
          if (ev.a.alive && ev.b.alive) ev.a.invoke(ha, ev.b);
          if (ev.a.alive && ev.b.alive) ev.b.invoke(hb, ev.a);
        }
        this.physics.debugDraw(this.scene, this.physicsDebug || this.project.settings.physics.debug);
      }
      this.stats.physicsMs = performance.now() - t0;
      for (const go of [...this.entities.values()]) if (go.alive) go.invoke('lateUpdate', dt);
      this.syncNetwork(dt);
    } else if (this.isPlaying && this.physics) {
      this.physics.debugDraw(this.scene, this.physicsDebug || this.project.settings.physics.debug);
    }

    const visualDt = running || !this.isPlaying ? (this.isPlaying ? dt : rawDt) : 0;
    for (const go of this.entities.values()) for (const v of go.visuals) v.update?.(visualDt);

    for (const hook of this.frameHooks) hook(rawDt);
    t0 = performance.now();
    this.render();
    this.stats.renderMs = performance.now() - t0;
    if (this.isPlaying) this.input.endFrame();

    this.stats.frameMs = performance.now() - frameStart;
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.entities = this.entities.size;
    this.stats.bodies = this.physics?.bodyCount ?? 0;
    this.stats.ping = this.net?.ping ?? 0;
    this.fpsFrames++;
    this.fpsTime += rawDt;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  render(): void {
    const camera = this.isPlaying ? this.camera : (this.editorCamera ?? this.camera);
    if (!camera) return;
    this.updateCameraProjection();
    if (this.composer && this.renderPass && !this.renderer.xr.isPresenting) {
      this.renderPass.camera = camera;
      this.composer.render();
    } else this.renderer.render(this.scene, camera);
  }

  private pollXrInput(): void {
    const session = this.renderer.xr.getSession?.();
    if (!session) return;
    for (const src of session.inputSources) {
      const pad = src.gamepad;
      if (!pad) continue;
      if (src.handedness === 'left' || session.inputSources.length === 1) {
        const x = pad.axes[2] ?? 0;
        const y = pad.axes[3] ?? 0;
        this.input.setVirtualAxis(Math.abs(x) > 0.2 ? x : 0, Math.abs(y) > 0.2 ? -y : 0);
      }
      this.input.setVirtual(src.handedness === 'left' ? 'jump' : 'fire', !!pad.buttons[0]?.pressed);
      if (src.handedness === 'right') this.input.setVirtual('jump', !!pad.buttons[4]?.pressed);
    }
  }

  private runTimers(): void {
    if (this.timers.length === 0) return;
    const now = this.time.elapsed;
    const due = this.timers.filter((t) => !t.cancelled && t.at <= now);
    this.timers = this.timers.filter((t) => !t.cancelled && t.at > now);
    for (const t of due) {
      try {
        t.fn();
      } catch (err) {
        this.log({ level: 'error', message: `Timer failed: ${String(err)}` });
      }
      if (t.interval !== undefined && !t.cancelled) {
        t.at = now + t.interval;
        this.timers.push(t);
      }
    }
  }

  private handleClick(e: PointerEvent): void {
    if (!this.camera || this.ended) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const id = this.pick(ndc, this.camera);
    if (id) this.entities.get(id)?.invoke('onClick');
  }

  /** Return the entity id under a screen point (NDC). */
  pick(ndc: THREE.Vector2, camera: THREE.Camera, includeHelpers = false): string | null {
    _ray.setFromCamera(ndc, camera);
    const hits = _ray.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      if (!hit.object.visible || (hit.object as THREE.Points).isPoints || (hit.object as THREE.Line).isLine) continue;
      if (hit.object.userData.editorOnly && !includeHelpers) continue;
      const id = hit.object.userData.entityId as string | undefined;
      if (!id) continue;
      let go = this.entities.get(id);
      while (go?.generated && go.parent) go = go.parent;
      if (go) return go.id;
    }
    return null;
  }

  // ════════════════════════════════════════ scenes
  findScene(ref: string): SceneData | undefined {
    return this.project.scenes.find((s) => s.id === ref) ?? this.project.scenes.find((s) => s.name.toLowerCase() === ref.toLowerCase());
  }

  loadScene(ref: string, initial = false): void {
    const scene = this.findScene(ref) ?? this.project.scenes[0];
    if (!scene) return;
    for (const go of [...this.entities.values()]) this.destroy(go, true);
    this.entities.clear();
    this.dataHashes.clear();
    this.timers = [];
    this.netTargets.clear();
    this.ended = false;
    this.hud?.clear();
    this.audio.stopAll();
    this.physics?.dispose();
    this.physics = null;
    this.sceneId = scene.id;
    const s = this.project.settings;
    if (this.isPlaying && s.physics.enabled) this.physics = new Physics(s.gravity, s.mode === '2d', s.physics.fixedTimestep);
    this.applyEnvironment(scene);
    this.instantiate(scene.entities, null);
    this.chooseCamera();
    if (this.isPlaying) {
      this.time.elapsed = 0;
      if (!initial && this.project.settings.multiplayer.enabled && (!this.net || this.net.id)) {
        this.adoptSceneOwnership();
        this.spawnLocalAvatar();
      }
    }
    if (!initial) this.onSceneChange?.(scene.id);
  }

  private applyEnvironment(scene: SceneData): void {
    const env = scene.environment;
    this.scene.background = new THREE.Color(this.project.settings.background);
    this.ambient.color.set(env.ambientColor);
    this.ambient.intensity = env.ambientIntensity;
    this.scene.fog = env.fogDensity > 0 ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null;
  }

  private chooseCamera(): void {
    let fallback: THREE.Camera | null = null;
    let chosen: THREE.Camera | null = null;
    for (const go of this.entities.values()) {
      if (!go.camera || !go.alive) continue;
      fallback ??= go.camera;
      if (go.camera.userData.primary) {
        chosen = go.camera;
        break;
      }
    }
    this.camera = chosen ?? fallback ?? this.getDefaultCamera();
    this.updateCameraProjection();
  }

  private getDefaultCamera(): THREE.Camera {
    if (!this.defaultCamera) {
      const cam = this.mode2d ? new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 1000) : new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      cam.userData.orthoSize = 8;
      cam.position.set(0, this.mode2d ? 0 : 5, 10);
      if (!this.mode2d) cam.lookAt(0, 0, 0);
      this.scene.add(cam);
      this.defaultCamera = cam;
    }
    return this.defaultCamera;
  }

  // ════════════════════════════════════════ entities
  /**
   * Turn entity data into live GameObjects: create → parent → visuals →
   * tilemaps → physics → behaviours → start. Shared by scene loading,
   * prefab spawning, tilemaps and network replication.
   */
  instantiate(list: EntityData[], parent: GameObject | null, opts: { generated?: boolean; remote?: boolean; prefabId?: string } = {}): GameObject[] {
    const created: GameObject[] = [];
    const disabled = new Set<string>();
    for (const data of list) {
      if (this.isPlaying && (!data.enabled || (data.parent && disabled.has(data.parent)))) {
        disabled.add(data.id);
        continue;
      }
      const go = new GameObject(this, data);
      go.generated = !!opts.generated;
      go.isRemote = !!opts.remote;
      go.prefabId = opts.prefabId ?? null;
      this.entities.set(go.id, go);
      this.dataHashes.set(go.id, JSON.stringify(data));
      created.push(go);
    }
    for (const go of created) {
      const p = (go.data.parent && this.entities.get(go.data.parent)) || parent;
      this.attach(go, p ?? null);
    }
    this.scene.updateMatrixWorld(true);
    for (const go of created) {
      buildVisuals(go, this);
      if (!this.isPlaying) this.addEditorGizmo(go);
    }
    for (const go of created) this.expandTileMap(go);
    if (!this.isPlaying) return created;

    this.scene.updateMatrixWorld(true);
    for (const go of created) {
      this.physics?.add(go);
      if (go.isRemote) this.physics?.setKinematic(go);
      this.attachBehaviours(go);
    }
    for (const go of created) {
      if (!go.alive || go.started) continue;
      go.started = true;
      go.invoke('start');
    }
    return created;
  }

  private attach(go: GameObject, parent: GameObject | null): void {
    go.parent?.children.delete(go);
    go.parent = parent;
    if (parent) {
      parent.children.add(go);
      parent.object3d.add(go.object3d);
    } else this.scene.add(go.object3d);
  }

  private attachBehaviours(go: GameObject): void {
    for (const c of go.data.components) {
      if (c.enabled === false) continue;
      if (c.type === 'Script') {
        const script = this.project.scripts.find((s) => s.id === c.script || s.name === c.script);
        if (!script) continue;
        const compiled = this.scripts.get(script);
        if (compiled.error) {
          this.log({ level: 'error', message: `Syntax error: ${compiled.error}`, source: script.name, entityId: go.id });
          continue;
        }
        try {
          const inst = createScriptInstance(compiled, go, this.api, { ...((c.params as Record<string, unknown>) ?? {}) }, script.name);
          if (inst) go.addBehaviour(script.name, inst);
        } catch (err) {
          this.log({ level: 'error', message: `Script crashed while loading: ${String(err)}`, source: script.name, entityId: go.id });
        }
      } else if (c.type === 'VisualScript') {
        const graph = this.project.graphs.find((g) => g.id === c.graph || g.name === c.graph);
        if (graph) go.addBehaviour(graph.name, createGraphBehaviour(graph, go, this.api));
      } else {
        const factory = BEHAVIOURS[c.type];
        if (factory) go.addBehaviour(c.type, factory(go, c, this));
      }
    }
  }

  private expandTileMap(go: GameObject): void {
    const c = go.getComponent('TileMap');
    if (!c) return;
    const legend = new Map<string, PrefabData>();
    for (const line of String(prop<string>(c, 'legend')).split('\n')) {
      const idx = line.indexOf('=');
      if (idx < 1) continue;
      const prefab = this.findPrefab(line.slice(idx + 1).trim());
      if (prefab) legend.set(line.slice(0, idx), prefab);
    }
    const size = prop<number>(c, 'tileSize');
    const rows = String(prop<string>(c, 'map')).split('\n');
    rows.forEach((row, r) => {
      [...row].forEach((ch, col) => {
        const prefab = legend.get(ch);
        if (!prefab) return;
        // The prefab root's own position acts as an offset inside its tile.
        const o = prefab.entities.find((e) => !e.parent)?.transform.position ?? [0, 0, 0];
        const position: Vec3 = this.mode2d ? [col * size + o[0], -r * size + o[1], o[2]] : [col * size + o[0], o[1], r * size + o[2]];
        this.spawnPrefab(prefab, { position, parent: go }, { generated: true });
      });
    });
  }

  findPrefab(ref: string): PrefabData | undefined {
    return this.project.prefabs.find((p) => p.id === ref) ?? this.project.prefabs.find((p) => p.name.toLowerCase() === ref.toLowerCase());
  }

  /** Clone prefab entities with fresh ids and instantiate them. */
  spawnPrefab(prefab: PrefabData, opts: SpawnOptions = {}, flags: { generated?: boolean; remote?: boolean } = {}): GameObject | null {
    const ids = new Map<string, string>();
    for (const e of prefab.entities) ids.set(e.id, uid('e_'));
    const root = prefab.entities.find((e) => !e.parent || !ids.has(e.parent));
    if (!root) return null;
    const list: EntityData[] = prefab.entities.map((e) => {
      const copy = structuredClone(e);
      copy.id = ids.get(e.id)!;
      copy.parent = e.parent && ids.has(e.parent) ? ids.get(e.parent)! : null;
      if (e === root) {
        if (opts.position) copy.transform.position = [...opts.position];
        if (opts.rotation) copy.transform.rotation = [...opts.rotation];
        if (opts.name) copy.name = opts.name;
      }
      return copy;
    });
    const created = this.instantiate(list, opts.parent ?? null, { ...flags, prefabId: prefab.id });
    const go = created.find((g) => g.id === ids.get(root.id)) ?? null;
    if (go && opts.velocity) go.setVelocity(...opts.velocity);
    return go;
  }

  destroy(go: GameObject, silent = false): void {
    if (!go.alive) return;
    go.alive = false;
    go.invoke('onDestroy');
    for (const child of [...go.children]) this.destroy(child, silent);
    this.physics?.remove(go);
    go.parent?.children.delete(go);
    go.object3d.removeFromParent();
    go.dispose();
    this.entities.delete(go.id);
    this.dataHashes.delete(go.id);
    if (go.camera && go.camera === this.camera && !silent) this.chooseCamera();
  }

  // ════════════════════════════════════════ edit mode
  private addEditorGizmo(go: GameObject): void {
    const isCamera = !!go.getComponent('Camera');
    const isLight = !!go.getComponent('Light');
    const hasVisual = go.visuals.some((v) => v.kind !== 'Camera' && v.kind !== 'Light');
    if (!isCamera && !isLight && hasVisual) return;
    const color = isCamera ? 0x7dd3fc : isLight ? 0xfde047 : 0xa78bfa;
    const geometry = isCamera ? new THREE.ConeGeometry(0.35, 0.6, 4).rotateX(Math.PI / 2) : isLight ? new THREE.OctahedronGeometry(0.25) : new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false, transparent: true, opacity: 0.85 }));
    mesh.renderOrder = 999;
    mesh.userData.entityId = go.id;
    mesh.userData.editorOnly = true;
    go.object3d.add(mesh);
    go.visuals.push({
      kind: 'Gizmo',
      object: mesh,
      dispose: () => {
        mesh.removeFromParent();
        geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      },
    });
  }

  setEditorCamera(camera: THREE.Camera): void {
    this.editorCamera = camera;
    this.updateCameraProjection();
  }

  /**
   * Edit mode: reconcile live objects with new project data. Only entities
   * whose data changed are rebuilt; transform-only changes are applied in place.
   */
  sync(project: ProjectData, sceneId: string): void {
    const prev = this.project;
    this.project = project;
    this.assets.setAssets(project.assets);
    this.input.map = project.settings.input;
    const structural =
      sceneId !== this.sceneId ||
      prev.settings.mode !== project.settings.mode ||
      prev.prefabs !== project.prefabs ||
      prev.settings.graphics !== project.settings.graphics;
    if (structural) {
      this.renderer.shadowMap.enabled = project.settings.graphics.shadows;
      this.renderer.toneMapping = project.settings.graphics.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      this.loadScene(sceneId, true);
      return;
    }
    const scene = this.currentScene;
    if (!scene) return;
    this.applyEnvironment(scene);
    const next = new Map(scene.entities.map((e) => [e.id, e]));
    for (const go of [...this.entities.values()]) if (!go.generated && !next.has(go.id)) this.destroy(go, true);
    const toCreate: EntityData[] = [];
    for (const data of scene.entities) {
      const go = this.entities.get(data.id);
      const hash = JSON.stringify(data);
      if (!go) {
        toCreate.push(data);
        continue;
      }
      if (this.dataHashes.get(data.id) === hash) continue;
      const old = go.data;
      this.dataHashes.set(data.id, hash);
      go.data = data;
      go.name = data.name;
      go.object3d.name = data.name;
      go.tags.clear();
      for (const t of data.tags) go.tags.add(t);
      go.object3d.visible = data.enabled;
      go.applyTransform();
      if (old.parent !== data.parent) this.attach(go, data.parent ? (this.entities.get(data.parent) ?? null) : null);
      if (JSON.stringify(old.components) !== JSON.stringify(data.components)) this.rebuild(go);
    }
    if (toCreate.length) this.instantiate(toCreate, null);
    this.chooseCamera();
  }

  private rebuild(go: GameObject): void {
    for (const child of [...go.children]) if (child.generated) this.destroy(child, true);
    go.dispose();
    buildVisuals(go, this);
    this.addEditorGizmo(go);
    this.expandTileMap(go);
  }

  getObject(id: string): GameObject | undefined {
    return this.entities.get(id);
  }

  // ════════════════════════════════════════ multiplayer
  private createNetClient(options: { url: string; name: string }): NetClient {
    const net = new NetClient(options);
    net.on('__tf', (data, from) => this.receiveTransforms(data as NetTransform[], from));
    net.on('leave', (_d, from) => {
      for (const go of [...this.entities.values()]) if (go.ownerId === from) this.destroy(go);
      this.log({ level: 'info', message: `A player left (${net.players.size + 1} online)`, source: 'Network' });
    });
    net.on('join', (p) => this.log({ level: 'info', message: `${(p as { name: string }).name} joined`, source: 'Network' }));
    return net;
  }

  private async connectNetwork(): Promise<void> {
    const net = this.net!;
    try {
      await net.connect();
      if (this.disposed) return net.disconnect();
      this.log({ level: 'info', message: `Connected to room — you are ${net.isHost ? 'the host' : 'a guest'}.`, source: 'Network' });
      this.adoptSceneOwnership();
      this.spawnLocalAvatar();
    } catch (err) {
      if (this.disposed) return;
      this.log({ level: 'warn', message: `Multiplayer unavailable (${String((err as Error).message ?? err)}) — playing offline.`, source: 'Network' });
      this.spawnLocalAvatar();
    }
  }

  /** Scene entities with NetworkSync are simulated by the host only. */
  private adoptSceneOwnership(): void {
    if (!this.net || this.net.isHost) return;
    for (const go of this.entities.values()) {
      if (go.ownerId || !go.getComponent('NetworkSync')) continue;
      go.isRemote = true;
      go.netId = go.id;
      this.physics?.setKinematic(go);
    }
  }

  /** Spawn this player's avatar (offline too, so the game is always playable). */
  private spawnLocalAvatar(): void {
    const net = this.net?.id ? this.net : null;
    const prefabRef = this.project.settings.multiplayer.playerPrefab;
    const prefab = prefabRef ? this.findPrefab(prefabRef) : undefined;
    if (!prefab) return;
    const spawns = this.api.findAll('spawn');
    const spot = spawns.length ? spawns[Math.floor(Math.random() * spawns.length)].worldPosition() : new THREE.Vector3(0, this.mode2d ? 2 : 1, 0);
    const go = this.spawnPrefab(prefab, { position: [spot.x, spot.y, spot.z] });
    if (!go) return;
    go.ownerId = net?.id ?? 'local';
    go.netId = `${go.ownerId}:avatar`;
    go.vars.playerName = this.networkOptions?.name;
  }

  private syncNetwork(dt: number): void {
    const net = this.net;
    if (!net?.connected || !net.id) return;
    // Smoothly move remote objects toward their latest received transform.
    const k = damp(14, dt);
    for (const [netId, target] of this.netTargets) {
      const go = this.findByNetId(netId);
      if (!go) continue;
      const interpolate = go.getComponent('NetworkSync')?.interpolate !== false;
      go.position.lerp(target.p, interpolate ? k : 1);
      go.quaternion.slerp(target.q, interpolate ? k : 1);
    }
    this.netAccumulator += dt;
    const interval = 1 / Math.max(1, this.project.settings.multiplayer.tickRate);
    if (this.netAccumulator < interval) return;
    this.netAccumulator = 0;
    const out: NetTransform[] = [];
    for (const go of this.entities.values()) {
      if (go.isRemote || !go.getComponent('NetworkSync')) continue;
      const mine = go.ownerId === net.id || (go.ownerId === null && net.isHost);
      if (!mine) continue;
      const p = go.position;
      const q = go.quaternion;
      out.push({
        n: go.netId ?? go.id,
        p: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
        q: [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)],
        f: go.ownerId ? go.prefabId : undefined,
        nm: go.vars.playerName as string | undefined,
        fc: go.vars.facing as number | undefined,
      });
    }
    if (out.length) net.send('__tf', out);
  }

  private findByNetId(netId: string): GameObject | undefined {
    for (const go of this.entities.values()) if ((go.netId ?? go.id) === netId) return go;
    return undefined;
  }

  private receiveTransforms(list: NetTransform[], from: string): void {
    if (!Array.isArray(list)) return;
    for (const t of list.slice(0, 256)) {
      if (typeof t?.n !== 'string' || !Array.isArray(t.p) || !Array.isArray(t.q)) continue;
      let go = this.findByNetId(t.n);
      if (!go && t.f) {
        const prefab = this.findPrefab(t.f);
        if (!prefab) continue;
        // Distinct name so `game.find('Player')` keeps returning the local player.
        go = this.spawnPrefab(prefab, { position: t.p, name: `Remote ${t.nm ?? 'player'}` }, { remote: true }) ?? undefined;
        if (!go) continue;
        go.netId = t.n;
        go.ownerId = from;
        go.vars.playerName = t.nm;
      }
      if (!go || !go.isRemote) continue;
      if (t.fc !== undefined) go.vars.facing = t.fc;
      const target = this.netTargets.get(t.n) ?? { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      target.p.set(t.p[0], t.p[1], t.p[2]);
      target.q.set(t.q[0], t.q[1], t.q[2], t.q[3]).normalize();
      this.netTargets.set(t.n, target);
    }
  }

  // ════════════════════════════════════════ helpers for scripts
  interpolate(template: string): string {
    if (!template.includes('{')) return template;
    return template.replace(/\{(\w+)\}/g, (_, key: string) => {
      const v = this.vars[key];
      if (v === undefined) return '0';
      return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    });
  }

  private endGame(message: string, sound: string, restartAfter: number): void {
    if (this.ended) return;
    this.ended = true;
    this.hud?.message(message, 0);
    this.audio.sfx(sound);
    setTimeout(() => {
      if (!this.ended || this.disposed) return;
      this.vars = {};
      this.loadScene(this.project.settings.startScene);
    }, restartAfter * 1000);
  }

  private createApi(): GameApi {
    const rt = this;
    const hud: HudApi = {
      set: (k, t, s) => rt.hud?.set(k, t, s),
      remove: (k) => rt.hud?.remove(k),
      message: (t, s) => rt.hud?.message(t, s),
    };
    const addTimer = (seconds: number, fn: () => void, interval?: number) => {
      const timer: Timer = { at: rt.time.elapsed + seconds, fn, interval };
      rt.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    };
    const api: GameApi = {
      get vars() {
        return rt.vars;
      },
      time: rt.time,
      input: rt.input,
      audio: rt.audio,
      get net() {
        return rt.net;
      },
      hud: rt.isPlaying ? hud : NO_HUD,
      get mode() {
        return rt.project.settings.mode;
      },
      get camera() {
        return rt.camera;
      },
      scene: rt.scene,
      get sceneName() {
        return rt.currentScene?.name ?? '';
      },
      find: (name) => {
        for (const go of rt.entities.values()) if (go.alive && go.name === name) return go;
        return undefined;
      },
      findAll: (tag) => [...rt.entities.values()].filter((g) => g.alive && g.tags.has(tag)),
      get: (id) => rt.entities.get(id),
      all: () => [...rt.entities.values()].filter((g) => g.alive),
      spawn: (ref, opts) => {
        const prefab = rt.findPrefab(ref);
        if (!prefab) {
          rt.log({ level: 'warn', message: `Prefab "${ref}" not found` });
          return null;
        }
        return rt.spawnPrefab(prefab, opts);
      },
      destroy: (go) => rt.destroy(go),
      loadScene: (name) => {
        if (!rt.findScene(name)) return rt.log({ level: 'warn', message: `Scene "${name}" not found` });
        // Defer so we never tear down the world mid-update.
        addTimer(0, () => rt.loadScene(name));
      },
      restart: () =>
        addTimer(0, () => {
          rt.vars = {};
          rt.loadScene(rt.sceneId);
        }),
      win: (message = 'You win!') => rt.endGame(message, 'win', 4),
      gameOver: (message = 'Game over') => rt.endGame(message, 'lose', 2.5),
      broadcast: (message, data) => {
        for (const go of [...rt.entities.values()]) if (go.alive) go.send(message, data);
      },
      raycast: (origin, direction, maxDistance = 100, exclude) => rt.physics?.raycast(origin, direction, maxDistance, exclude) ?? null,
      pointerWorld: () => {
        const cam = rt.camera;
        if (!cam) return new THREE.Vector3();
        _ray.setFromCamera(rt.input.pointer, cam);
        if (rt.mode2d) _plane.set(new THREE.Vector3(0, 0, 1), 0);
        else _plane.set(new THREE.Vector3(0, 1, 0), 0);
        return _ray.ray.intersectPlane(_plane, _v)?.clone() ?? new THREE.Vector3();
      },
      after: (s, fn) => addTimer(s, fn),
      every: (s, fn) => addTimer(s, fn, Math.max(0.001, s)),
      log: (level, args, source, entityId) => rt.log({ level, message: args.map(formatArg).join(' '), source, entityId }),
      pause: () => rt.setPaused(true),
      resume: () => rt.setPaused(false),
    };
    return api;
  }
}
