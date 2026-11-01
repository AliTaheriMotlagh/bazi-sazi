import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { measureObject } from '@bazi/engine';
import type { RenderStats } from '@bazi/engine/core';
import { kvGet, kvSet } from '../store/kv';

/**
 * Renders small preview images of 3D models (content browser, place panel).
 * One shared offscreen renderer, a sequential queue, and a two-level cache (memory + IndexedDB) so each
 * model is rendered once — ever, not once per session. Rendering also measures the model (triangles, draw
 * calls, texture memory) so the inspector can show its cost without loading it again.
 */
const SIZE = 256;
/** Bump when the look or the stored shape changes, so old cached images are ignored. */
const CACHE_VERSION = 'v3';
export interface ModelPreview {
  image: string;
  stats: RenderStats;
}
const cache = new Map<string, Promise<ModelPreview>>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let queue: Promise<unknown> = Promise.resolve();
const loader = new GLTFLoader();

function setup(): void {
  if (renderer) return;
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(3, 5, 2);
  scene.add(key, new THREE.AmbientLight('#ffffff', 0.4));
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
}

async function render(url: string): Promise<ModelPreview> {
  setup();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  const stats = measureObject(model);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  scene.add(model);
  const radius = Math.max(size.x, size.y, size.z) * 0.62;
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360);
  // Models face -Z: look at them from the front-left, slightly above.
  camera.position.set(-dist * 0.55, dist * 0.45, -dist * 0.75);
  camera.lookAt(0, 0, 0);
  renderer!.render(scene, camera);
  const data = renderer!.domElement.toDataURL('image/webp', 0.85);
  scene.remove(model);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      for (const value of Object.values(m as unknown as Record<string, unknown>)) if ((value as THREE.Texture)?.isTexture) (value as THREE.Texture).dispose();
      m.dispose();
    }
  });
  return { image: data, stats };
}

/** Preview image + cost of a model. Cached in memory and (content-addressed URLs never change) in IndexedDB. */
export function modelPreview(url: string): Promise<ModelPreview> {
  let p = cache.get(url);
  if (p) return p;
  const key = `thumb:${CACHE_VERSION}:${url}`;
  p = kvGet<ModelPreview>(key).then((stored) => {
    if (stored) return stored;
    // Rendering is sequential (one shared WebGL context), whatever the cache says about the others.
    const job = (queue = queue.then(() => render(url), () => render(url))) as Promise<ModelPreview>;
    return job.then((fresh) => (void kvSet(key, fresh), fresh));
  });
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  return p;
}

export const modelThumbnail = (url: string): Promise<string> => modelPreview(url).then((p) => p.image);
