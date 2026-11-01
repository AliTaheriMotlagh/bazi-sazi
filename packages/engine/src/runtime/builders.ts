import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { prop } from '../components/registry';
import { decodeHeights, flatHeights, terrainMesh } from '../project/terrain';
import type { ComponentData } from '../types';
import { DEG2RAD } from '../util';
import type { GameObject } from './GameObject';
import { ParticleSystem } from './particles';
import type { Runtime } from './Runtime';

/** The renderable/runtime part of a component, owned by a GameObject. */
export interface Visual {
  readonly kind: string;
  object?: THREE.Object3D;
  update?(dt: number): void;
  setColor?(color: string): void;
  setText?(text: string): void;
  setOpacity?(opacity: number): void;
  playAnimation?(name: string, fade?: number): void;
  dispose(): void;
}

// Shared unit geometries (never disposed per-entity).
const GEOMETRY: Record<string, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 32, 16),
  plane: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  plane2d: () => new THREE.PlaneGeometry(1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  cone: () => new THREE.ConeGeometry(0.5, 1, 32),
  capsule: () => new THREE.CapsuleGeometry(0.5, 1, 8, 16),
  torus: () => new THREE.TorusGeometry(0.4, 0.15, 16, 48),
  icosahedron: () => new THREE.IcosahedronGeometry(0.5, 0),
};
const geometryCache = new Map<string, THREE.BufferGeometry>();
export function sharedGeometry(shape: string): THREE.BufferGeometry {
  let g = geometryCache.get(shape);
  if (!g) geometryCache.set(shape, (g = (GEOMETRY[shape] ?? GEOMETRY.box)()));
  return g;
}

const _q = new THREE.Quaternion();

function faceCamera(object: THREE.Object3D, camera: THREE.Camera | null): void {
  if (!camera || !object.parent) return;
  object.parent.getWorldQuaternion(_q).invert();
  object.quaternion.copy(_q.multiply(camera.quaternion));
}

function buildMesh(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  let shape = prop<string>(c, 'shape');
  if (shape === 'plane' && rt.mode2d) shape = 'plane2d';
  const texture = rt.assets.texture(prop<string>(c, 'texture'));
  if (texture) {
    const repeat = prop<number>(c, 'textureRepeat');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
  }
  const opacity = prop<number>(c, 'opacity');
  const material = new THREE.MeshStandardMaterial({
    color: prop<string>(c, 'color'),
    map: texture,
    metalness: prop<number>(c, 'metalness'),
    roughness: prop<number>(c, 'roughness'),
    emissive: prop<string>(c, 'emissive'),
    emissiveIntensity: prop<number>(c, 'emissiveIntensity'),
    wireframe: prop<boolean>(c, 'wireframe'),
    transparent: opacity < 1,
    opacity,
  });
  const mesh = new THREE.Mesh(sharedGeometry(shape), material);
  mesh.castShadow = prop<boolean>(c, 'castShadow');
  mesh.receiveShadow = prop<boolean>(c, 'receiveShadow');
  go.object3d.add(mesh);
  return {
    kind: 'Mesh',
    object: mesh,
    setColor: (color) => material.color.set(color),
    setOpacity: (o) => {
      material.opacity = o;
      material.transparent = o < 1;
    },
    dispose: () => {
      mesh.removeFromParent();
      material.dispose();
    },
  };
}

function buildSprite(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const base = rt.assets.texture(prop<string>(c, 'image'));
  const cols = Math.max(1, Math.floor(prop<number>(c, 'columns')));
  const rows = Math.max(1, Math.floor(prop<number>(c, 'rows')));
  const animated = cols * rows > 1;
  const texture = base && animated ? base.clone() : base;
  if (texture && animated) {
    texture.repeat.set(1 / cols, 1 / rows);
    texture.needsUpdate = true;
  }
  const opacity = prop<number>(c, 'opacity');
  const material = new THREE.MeshBasicMaterial({
    color: prop<string>(c, 'color'),
    map: texture,
    transparent: true,
    opacity,
    alphaTest: 0.02,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(prop<number>(c, 'width'), prop<number>(c, 'height'));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = prop<number>(c, 'layer');
  if (prop<boolean>(c, 'flipX')) mesh.scale.x = -1;
  go.object3d.add(mesh);

  const fps = prop<number>(c, 'fps');
  const frames = cols * rows;
  let time = 0;
  const setFrame = (frame: number) => {
    if (!texture || !animated) return;
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    texture.offset.set(col / cols, 1 - (row + 1) / rows);
  };
  setFrame(0);
  const billboard = prop<boolean>(c, 'billboard') && !rt.mode2d;

  return {
    kind: 'Sprite',
    object: mesh,
    update(dt) {
      if (fps > 0 && animated) {
        time += dt;
        setFrame(Math.floor(time * fps) % frames);
      }
      // Auto-flip sprites of characters that face left.
      const facing = go.vars.facing as number | undefined;
      if (facing !== undefined) mesh.scale.x = Math.abs(mesh.scale.x) * (prop<boolean>(c, 'flipX') ? -facing : facing);
      if (billboard) faceCamera(mesh, rt.camera);
    },
    setColor: (color) => material.color.set(color),
    setOpacity: (o) => (material.opacity = o),
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      if (texture && texture !== base) texture.dispose();
    },
  };
}

/** Build the geometry of a Terrain component (shared with the editor's sculpting). */
export function buildTerrainGeometry(c: ComponentData): THREE.BufferGeometry {
  const resolution = Math.max(8, Math.min(128, Math.round(prop<number>(c, 'resolution'))));
  const size = prop<number>(c, 'size');
  const height = prop<number>(c, 'height');
  const heights = prop<string>(c, 'heights') || flatHeights(resolution);
  const levels = decodeHeights(heights, resolution);
  const { positions, indices } = terrainMesh(levels, resolution, size, height);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const uv = new Float32Array((resolution + 1) * (resolution + 1) * 2);
  const colors = new Float32Array((resolution + 1) * (resolution + 1) * 3);
  const low = new THREE.Color(prop<string>(c, 'lowColor'));
  const high = new THREE.Color(prop<string>(c, 'highColor'));
  const tmp = new THREE.Color();
  for (let i = 0; i < levels.length; i++) {
    uv[i * 2] = (i % (resolution + 1)) / resolution;
    uv[i * 2 + 1] = 1 - Math.floor(i / (resolution + 1)) / resolution;
    tmp.copy(low).lerp(high, Math.max(0, Math.min(1, (levels[i] - 64) / 120)));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildTerrain(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const geometry = buildTerrainGeometry(c);
  const texture = rt.assets.texture(prop<string>(c, 'texture'));
  if (texture) {
    const repeat = prop<number>(c, 'textureRepeat');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  go.object3d.add(mesh);
  return {
    kind: 'Terrain',
    object: mesh,
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

function buildModel(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const holder = new THREE.Group();
  holder.rotation.y = prop<number>(c, 'rotationOffset') * DEG2RAD;
  go.object3d.add(holder);
  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let current: THREE.AnimationAction | null = null;
  let pending: string | null = null;
  let disposed = false;
  const find = (name: string) => {
    const n = name.toLowerCase();
    return clips.find((x) => x.name.toLowerCase() === n) ?? clips.find((x) => x.name.toLowerCase().includes(n));
  };
  /** Cross-fade to a clip by (partial) name; unknown names are ignored. */
  const play = (name: string, fallbackFirst = false, fade = 0.15) => {
    if (!mixer) {
      pending = name;
      return;
    }
    const clip = (name && find(name)) || (fallbackFirst ? clips[0] : undefined);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (next === current) {
      if (/attack|shoot|hit/i.test(clip.name)) next.reset().play();
      return;
    }
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    current?.fadeOut(fade);
    current = next;
  };
  rt.assets
    .model(prop<string>(c, 'model'))
    ?.then((gltf) => {
      if (disposed) return;
      const scene = cloneSkinned(gltf.scene);
      const shadow = prop<boolean>(c, 'castShadow');
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = shadow;
          o.receiveShadow = true;
          o.userData.entityId = go.id;
          // Clone materials so per-entity tints/flashes don't leak to every copy.
          const m = o as THREE.Mesh;
          m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        }
      });
      holder.add(scene);
      clips = gltf.animations;
      if (clips.length) {
        mixer = new THREE.AnimationMixer(scene);
        mixer.timeScale = prop<number>(c, 'animationSpeed');
        play(pending ?? prop<string>(c, 'animation'), true);
        pending = null;
      }
      rt.physics?.refreshAutoCollider(go);
      rt.nav?.markDirty();
    })
    .catch((err) => rt.log({ level: 'error', message: `Model failed to load: ${err}`, entityId: go.id }));
  return {
    kind: 'Model',
    object: holder,
    update: (dt) => mixer?.update(dt),
    playAnimation: (name, fade) => play(name, false, fade),
    setColor: (color) =>
      holder.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && !Array.isArray(m) && m.color) m.color.set(color);
      }),
    dispose() {
      disposed = true;
      holder.removeFromParent();
      mixer?.stopAllAction();
    },
  };
}

function buildVideo(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const url = rt.assets.url(prop<string>(c, 'video'));
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.muted = prop<boolean>(c, 'muted');
  video.loop = prop<boolean>(c, 'loop');
  video.preload = 'auto';
  if (url) video.src = url;
  const fullscreen = prop<string>(c, 'mode') === 'fullscreen' && rt.isPlaying && rt.hud;
  let overlay: HTMLDivElement | null = null;
  let mesh: THREE.Mesh | null = null;
  let texture: THREE.VideoTexture | null = null;
  if (fullscreen) {
    overlay = document.createElement('div');
    overlay.className = 'bz-video';
    const skip = document.createElement('button');
    skip.textContent = 'Skip ▸';
    const end = () => {
      overlay?.remove();
      video.pause();
      go.send('videoEnded');
    };
    skip.onclick = end;
    video.onended = () => !video.loop && end();
    overlay.append(video, skip);
    rt.hud!.root.appendChild(overlay);
  } else {
    texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(prop<number>(c, 'width'), prop<number>(c, 'height')), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }));
    go.object3d.add(mesh);
    video.onended = () => go.send('videoEnded');
  }
  if (rt.isPlaying && prop<boolean>(c, 'autoplay')) void video.play().catch(() => rt.log({ level: 'info', message: 'Video will start after the first click (browser autoplay rules).', entityId: go.id }));
  else video.addEventListener('loadeddata', () => (video.currentTime = 0.1), { once: true });
  return {
    kind: 'Video',
    object: mesh ?? undefined,
    dispose() {
      video.pause();
      video.removeAttribute('src');
      video.load();
      overlay?.remove();
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      (mesh?.material as THREE.Material | undefined)?.dispose();
      texture?.dispose();
    },
  };
}

function buildText(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(sharedGeometry('plane2d'), material);
  go.object3d.add(mesh);
  const template = prop<string>(c, 'text');
  let override: string | null = null;
  let color = prop<string>(c, 'color');
  let rendered = '';
  const height = prop<number>(c, 'size');
  const draw = (text: string) => {
    if (text === rendered) return;
    rendered = text;
    const px = 96;
    const font = `${prop<boolean>(c, 'bold') ? '700' : '400'} ${px}px Inter, system-ui, sans-serif`;
    ctx2d.font = font;
    const lines = text.split('\n');
    const width = Math.max(1, ...lines.map((l) => ctx2d.measureText(l).width));
    canvas.width = Math.ceil(width + 16);
    canvas.height = Math.ceil(px * 1.25 * lines.length);
    ctx2d.font = font;
    ctx2d.fillStyle = color;
    ctx2d.textBaseline = 'middle';
    ctx2d.textAlign = 'center';
    lines.forEach((l, i) => ctx2d.fillText(l, canvas.width / 2, px * 1.25 * (i + 0.5)));
    texture.needsUpdate = true;
    mesh.scale.set((height * canvas.width) / canvas.height, height, 1);
  };
  const billboard = prop<boolean>(c, 'billboard') && !rt.mode2d;
  draw(rt.interpolate(template));
  return {
    kind: 'Text',
    object: mesh,
    update() {
      draw(override ?? rt.interpolate(template));
      if (billboard) faceCamera(mesh, rt.camera);
    },
    setText: (t) => (override = t),
    setColor(cl) {
      color = cl;
      rendered = '';
    },
    dispose() {
      mesh.removeFromParent();
      material.dispose();
      texture.dispose();
    },
  };
}

function buildLight(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const kind = prop<string>(c, 'kind');
  const color = prop<string>(c, 'color');
  const intensity = prop<number>(c, 'intensity');
  const shadows = prop<boolean>(c, 'castShadow') && rt.project.settings.graphics.shadows;
  let light: THREE.Light;
  switch (kind) {
    case 'point':
      light = new THREE.PointLight(color, intensity * 4, prop<number>(c, 'distance'), 1);
      break;
    case 'spot': {
      const spot = new THREE.SpotLight(color, intensity * 4, prop<number>(c, 'distance'), prop<number>(c, 'angle') * DEG2RAD, 0.3, 1);
      spot.target.position.set(0, 0, -1);
      spot.add(spot.target);
      light = spot;
      break;
    }
    case 'hemisphere':
      light = new THREE.HemisphereLight(color, prop<string>(c, 'groundColor'), intensity);
      break;
    case 'ambient':
      light = new THREE.AmbientLight(color, intensity);
      break;
    default: {
      const dir = new THREE.DirectionalLight(color, intensity);
      dir.target.position.set(0, 0, -1);
      dir.add(dir.target);
      const cam = dir.shadow.camera;
      cam.left = cam.bottom = -25;
      cam.right = cam.top = 25;
      cam.near = 0.5;
      cam.far = 120;
      light = dir;
    }
  }
  if (shadows && 'shadow' in light && light.shadow) {
    light.castShadow = true;
    const shadow = light.shadow as THREE.LightShadow;
    shadow.mapSize.set(2048, 2048);
    shadow.bias = -0.0005;
    shadow.normalBias = 0.02;
  }
  go.object3d.add(light);
  return {
    kind: 'Light',
    object: light,
    setColor: (cl) => light.color.set(cl),
    dispose() {
      light.removeFromParent();
      light.dispose();
    },
  };
}

function buildCamera(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const projection = prop<string>(c, 'projection');
  const ortho = projection === 'orthographic' || (projection === 'auto' && rt.mode2d);
  const near = prop<number>(c, 'near');
  const far = prop<number>(c, 'far');
  const camera = ortho
    ? new THREE.OrthographicCamera(-1, 1, 1, -1, near, far)
    : new THREE.PerspectiveCamera(prop<number>(c, 'fov'), 1, near, far);
  camera.userData.orthoSize = prop<number>(c, 'size');
  camera.userData.primary = prop<boolean>(c, 'primary');
  go.object3d.add(camera);
  go.camera = camera;
  return {
    kind: 'Camera',
    object: camera,
    dispose() {
      camera.removeFromParent();
      if (go.camera === camera) go.camera = null;
    },
  };
}

function buildParticles(go: GameObject, c: ComponentData, rt: Runtime): Visual {
  const system = new ParticleSystem(c);
  rt.scene.add(system.points);
  const burst = prop<number>(c, 'burst');
  if (burst > 0 && rt.isPlaying) system.burst(burst, go.object3d);
  return {
    kind: 'Particles',
    object: system.points,
    update(dt) {
      system.setViewportHeight(rt.viewportHeight);
      system.update(dt, go.object3d);
    },
    dispose() {
      system.points.removeFromParent();
      system.dispose();
    },
  };
}

type Builder = (go: GameObject, c: ComponentData, rt: Runtime) => Visual;

const BUILDERS: Record<string, Builder> = {
  Mesh: buildMesh,
  Sprite: buildSprite,
  Terrain: buildTerrain,
  Model: buildModel,
  Text: buildText,
  Light: buildLight,
  Camera: buildCamera,
  Particles: buildParticles,
  Video: buildVideo,
};

/** Build all visuals for an entity's components. */
export function buildVisuals(go: GameObject, rt: Runtime): void {
  for (const c of go.data.components) {
    if (c.enabled === false) continue;
    const builder = BUILDERS[c.type];
    if (!builder) continue;
    try {
      const v = builder(go, c, rt);
      v.object?.traverse((o) => (o.userData.entityId = go.id));
      go.visuals.push(v);
    } catch (err) {
      rt.log({ level: 'error', message: `Could not build ${c.type}: ${String(err)}`, entityId: go.id });
    }
  }
}
