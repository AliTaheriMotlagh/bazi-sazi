import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface PostOptions {
  bloom: number; // 0 = off
  ssao: boolean;
  vignette: number;
  smaa: boolean;
  outline: boolean;
}

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.3 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, d), amount);
      gl_FragColor = c;
    }`,
};

/**
 * Post-processing stack: render → AO → bloom → outline → output (tone map +
 * sRGB) → vignette → SMAA. Only the passes that are switched on are created.
 */
export class PostFX {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private gtao: GTAOPass | null = null;
  private outline: OutlinePass | null = null;
  private camera: THREE.Camera;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    camera: THREE.Camera,
    readonly options: PostOptions,
  ) {
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: options.smaa ? 0 : 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (options.ssao && (camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    if (options.bloom > 0) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), options.bloom, 0.45, 0.85));
    if (options.outline) {
      this.outline = new OutlinePass(new THREE.Vector2(size.x, size.y), scene, camera);
      this.outline.edgeStrength = 4;
      this.outline.edgeThickness = 1.2;
      this.outline.edgeGlow = 0.3;
      this.outline.visibleEdgeColor.set('#ffb020');
      this.outline.hiddenEdgeColor.set('#7a5200');
      this.composer.addPass(this.outline);
    }
    this.composer.addPass(new OutputPass());
    if (options.vignette > 0) {
      const v = new ShaderPass(VignetteShader);
      v.uniforms.amount.value = options.vignette;
      this.composer.addPass(v);
    }
    if (options.smaa) this.composer.addPass(new SMAAPass());
  }

  get boundCamera(): THREE.Camera {
    return this.camera;
  }

  static sameOptions(a: PostOptions, b: PostOptions): boolean {
    return a.bloom === b.bloom && a.ssao === b.ssao && a.vignette === b.vignette && a.smaa === b.smaa && a.outline === b.outline;
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  setOutlined(objects: THREE.Object3D[]): void {
    if (this.outline) this.outline.selectedObjects = objects;
  }

  render(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
    if (this.outline) this.outline.renderCamera = camera;
    this.composer.render();
  }

  dispose(): void {
    this.gtao?.dispose();
    this.outline?.dispose();
    this.composer.dispose();
  }
}
