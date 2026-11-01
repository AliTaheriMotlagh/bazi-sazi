import * as THREE from 'three';
import { EMPTY_STATS, textureBytes, type RenderStats } from '../systems/perf';

/** Measure what an object (and its children) costs to render. Shared geometry/textures are counted once. */
export function measureObject(root: THREE.Object3D): RenderStats {
  const stats: RenderStats = { ...EMPTY_STATS };
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;
    const instances = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    const position = geometry.getAttribute('position');
    const vertices = position?.count ?? 0;
    const triangles = mesh.isMesh ? (geometry.index ? geometry.index.count : vertices) / 3 : 0;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    stats.triangles += triangles * instances;
    stats.vertices += vertices * instances;
    // One draw call per material that has geometry assigned (instancing keeps it at one per material).
    stats.drawCalls += Math.max(1, materials.length);
    for (const m of materials) {
      if (!m) continue;
      for (const value of Object.values(m as unknown as Record<string, unknown>)) if ((value as THREE.Texture)?.isTexture) textures.add(value as THREE.Texture);
    }
  });
  for (const t of textures) {
    const image = t.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
    const w = image?.width ?? image?.videoWidth ?? 0;
    const h = image?.height ?? image?.videoHeight ?? 0;
    if (!w || !h) continue;
    stats.textures++;
    stats.textureBytes += textureBytes(w, h);
  }
  return stats;
}
