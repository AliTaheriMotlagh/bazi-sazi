import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Renders small preview images of 3D models (content browser, place panel).
 * One shared offscreen renderer, a sequential queue, and an in-memory +
 * sessionStorage cache so each model is rendered once.
 */
const SIZE = 160;
const cache = new Map<string, Promise<string>>();
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

async function render(url: string): Promise<string> {
  setup();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
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
  model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  return data;
}

export function modelThumbnail(url: string): Promise<string> {
  let p = cache.get(url);
  if (p) return p;
  try {
    const stored = sessionStorage.getItem(`bz.thumb:${url}`);
    if (stored) {
      p = Promise.resolve(stored);
      cache.set(url, p);
      return p;
    }
  } catch {
    /* storage unavailable */
  }
  p = (queue = queue.then(() => render(url), () => render(url))) as Promise<string>;
  p.then((d) => {
    try {
      sessionStorage.setItem(`bz.thumb:${url}`, d);
    } catch {
      /* quota */
    }
  }).catch(() => cache.delete(url));
  cache.set(url, p);
  return p;
}
