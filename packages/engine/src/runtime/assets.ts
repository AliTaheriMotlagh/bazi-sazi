import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AssetData } from '../types';

/**
 * Loads and caches assets by id. Textures are returned synchronously (they
 * fill in when loaded) so building visuals never blocks the frame.
 */
export class AssetCache {
  private textures = new Map<string, THREE.Texture>();
  private models = new Map<string, Promise<GLTF>>();
  private audio = new Map<string, Promise<AudioBuffer>>();
  private textureLoader = new THREE.TextureLoader();
  private gltfLoader = new GLTFLoader();
  private byId = new Map<string, AssetData>();
  private pending = 0;
  private done = 0;
  private listeners = new Set<() => void>();

  constructor(
    assets: AssetData[],
    private pixelArt: boolean,
  ) {
    this.textureLoader.setCrossOrigin('anonymous');
    this.setAssets(assets);
  }

  /** Loads in flight (models, textures, audio). `total` resets to 0 once everything has arrived. */
  get loading(): { loaded: number; total: number } {
    return { loaded: this.done, total: this.pending };
  }

  /** Be told whenever a load starts or finishes (used for the editor's "Loading…" indicator). */
  onLoadingChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private begin(): void {
    this.pending++;
    this.listeners.forEach((l) => l());
  }

  private end(): void {
    this.done++;
    if (this.done >= this.pending) this.done = this.pending = 0;
    this.listeners.forEach((l) => l());
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.begin();
    promise.then(() => this.end(), () => this.end());
    return promise;
  }

  setAssets(assets: AssetData[]): void {
    this.byId = new Map(assets.map((a) => [a.id, a]));
  }

  url(id: string): string | undefined {
    return this.byId.get(id)?.url;
  }

  find(idOrName: string): AssetData | undefined {
    return this.byId.get(idOrName) ?? [...this.byId.values()].find((a) => a.name === idOrName);
  }

  texture(id: string): THREE.Texture | null {
    if (!id) return null;
    const cached = this.textures.get(id);
    if (cached) return cached;
    const url = this.url(id);
    if (!url) return null;
    this.begin();
    const tex = this.textureLoader.load(url, () => this.end(), undefined, () => this.end());
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.pixelArt) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
    }
    this.textures.set(id, tex);
    return tex;
  }

  model(id: string): Promise<GLTF> | null {
    if (!id) return null;
    const cached = this.models.get(id);
    if (cached) return cached;
    const url = this.url(id);
    if (!url) return null;
    const promise = this.track(this.gltfLoader.loadAsync(url));
    this.models.set(id, promise);
    return promise;
  }

  audioBuffer(idOrName: string, ctx: AudioContext): Promise<AudioBuffer> | null {
    const asset = this.find(idOrName);
    if (!asset) return null;
    const cached = this.audio.get(asset.id);
    if (cached) return cached;
    const promise = this.track(
      fetch(asset.url)
        .then((r) => r.arrayBuffer())
        .then((buf) => ctx.decodeAudioData(buf)),
    );
    this.audio.set(asset.id, promise);
    return promise;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.models.clear();
    this.audio.clear();
  }
}
