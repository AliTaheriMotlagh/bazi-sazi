import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { EnvironmentData, ProjectSettings } from '../types';
import { DEG2RAD } from '../util';

/**
 * Background + image-based lighting. Environment maps are prefiltered once
 * per change (PMREM), so they cost nothing per frame.
 */
export class EnvironmentController {
  private pmrem: THREE.PMREMGenerator;
  private sky: Sky | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private gradient: THREE.CanvasTexture | null = null;
  private key = '';
  readonly sunDirection = new THREE.Vector3(0.5, 0.6, 0.3).normalize();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  apply(env: EnvironmentData, settings: ProjectSettings): void {
    const is3d = settings.mode === '3d';
    const sky = env.sky === 'procedural' && !is3d ? 'gradient' : env.sky;
    const key = JSON.stringify([sky, env.skyTop, env.skyBottom, env.sunElevation, env.envLight, settings.background, is3d]);
    // Sky radiance is HDR-bright; scale it so "1" means "looks right".
    const skyLit = env.envLight === 'sky' && env.sky === 'procedural' && settings.mode === '3d';
    this.scene.environmentIntensity = (env.envIntensity ?? 1) * (skyLit ? 0.3 : 1);
    this.scene.fog = env.fogDensity > 0 ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null;
    if (key === this.key) return;
    this.key = key;
    this.clear();

    const elevation = (env.sunElevation ?? 35) * DEG2RAD;
    this.sunDirection.set(Math.cos(elevation) * 0.6, Math.sin(elevation), Math.cos(elevation) * 0.8).normalize();

    if (sky === 'procedural') {
      const s = createSky(this.sunDirection);
      s.userData.editorOnly = true;
      this.sky = s;
      this.scene.add(s);
      this.scene.background = null;
    } else if (sky === 'gradient') {
      this.gradient = gradientTexture(env.skyTop, env.skyBottom);
      this.scene.background = this.gradient;
    } else {
      this.scene.background = new THREE.Color(settings.background);
    }

    if (!is3d || env.envLight === 'none') {
      this.scene.environment = null;
      return;
    }
    if (env.envLight === 'studio') {
      this.envTarget = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    } else {
      // Light the scene with its own sky (or gradient) for coherent colors.
      const lightScene = new THREE.Scene();
      if (this.sky) {
        lightScene.add(createSky(this.sunDirection));
      } else {
        lightScene.background = gradientTexture(env.skyTop, env.skyBottom, true);
        lightScene.add(new THREE.HemisphereLight(env.skyTop, env.skyBottom, 2));
      }
      this.envTarget = this.pmrem.fromScene(lightScene, 0.02);
    }
    this.scene.environment = this.envTarget.texture;
  }

  /** Keep the sky centered on the camera. */
  update(camera: THREE.Camera | null): void {
    if (this.sky && camera) camera.getWorldPosition(this.sky.position);
  }

  private clear(): void {
    this.sky?.removeFromParent();
    this.sky?.material.dispose();
    this.sky = null;
    this.envTarget?.dispose();
    this.envTarget = null;
    this.gradient?.dispose();
    this.gradient = null;
  }

  dispose(): void {
    this.clear();
    this.pmrem.dispose();
  }
}

function gradientTexture(top: string, bottom: string, equirect = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(equirect ? 0.5 : 1, bottom);
  if (equirect) g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (equirect) tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/**
 * Physically based sky, scaled down from raw HDR radiance so it sits well
 * with the scene's lights at exposure 1 (the stock shader is far brighter).
 */
function createSky(sun: THREE.Vector3): Sky {
  const s = new Sky();
  s.scale.setScalar(900);
  s.frustumCulled = false;
  const u = s.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sun);
  s.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * 0.42, 1.0 );');
  };
  return s;
}
