/**
 * Custom materials. Every shader is a function body
 *   vec4 shade(vec2 uv, vec3 normal, vec3 viewDir, vec3 worldPos)
 * with these uniforms available: uTime, uColor, uColor2 (vec3), uSpeed, uIntensity (float).
 * Presets cover common looks; "custom" lets pros write their own.
 */

export const SHADER_PRESETS: Record<string, string> = {
  hologram: `float scan = 0.5 + 0.5 * sin(worldPos.y * 18.0 - uTime * uSpeed * 4.0);
float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
vec3 c = mix(uColor, uColor2, rim) * (0.35 + 0.65 * scan) * uIntensity;
return vec4(c, 0.35 + 0.65 * rim);`,
  toon: `vec3 light = normalize(vec3(0.5, 0.9, 0.4));
float d = dot(normal, light);
float band = d > 0.6 ? 1.0 : d > 0.15 ? 0.65 : 0.35;
float edge = step(0.28, dot(normal, viewDir));
return vec4(uColor * band * edge * uIntensity, 1.0);`,
  water: `float w = sin(uv.x * 14.0 + uTime * uSpeed) * 0.5 + sin(uv.y * 11.0 - uTime * uSpeed * 1.3) * 0.5;
float foam = smoothstep(0.7, 1.0, w * 0.5 + 0.5);
vec3 c = mix(uColor, uColor2, w * 0.5 + 0.5) + foam * 0.25;
return vec4(c * uIntensity, 0.85);`,
  dissolve: `float n = fract(sin(dot(floor(uv * 24.0), vec2(12.9898, 78.233))) * 43758.5453);
float t = fract(uTime * uSpeed * 0.2);
if (n < t) discard;
float edge = smoothstep(t, t + 0.08, n);
return vec4(mix(uColor2, uColor, edge) * uIntensity, 1.0);`,
  fresnel: `float f = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
return vec4(mix(uColor, uColor2, f) * uIntensity, 1.0);`,
  gradient: `return vec4(mix(uColor, uColor2, uv.y) * uIntensity, 1.0);`,
  scanlines: `float l = 0.5 + 0.5 * sin(uv.y * 80.0 + uTime * uSpeed * 6.0);
return vec4(mix(uColor2, uColor, l) * uIntensity, 1.0);`,
  pulse: `float p = 0.5 + 0.5 * sin(uTime * uSpeed * 3.0);
return vec4(mix(uColor, uColor2, p) * uIntensity, 1.0);`,
};

export const SHADER_PRESET_NAMES = ['custom', ...Object.keys(SHADER_PRESETS)];

export const DEFAULT_CUSTOM_SHADER = `// Write the body of: vec4 shade(vec2 uv, vec3 normal, vec3 viewDir, vec3 worldPos)
// Available: uTime, uColor, uColor2, uSpeed, uIntensity
float wave = 0.5 + 0.5 * sin(uv.x * 10.0 + uTime * uSpeed);
return vec4(mix(uColor, uColor2, wave) * uIntensity, 1.0);`;

export const SHADER_VERTEX = `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export function shaderFragment(body: string): string {
  return `
uniform float uTime; uniform vec3 uColor; uniform vec3 uColor2; uniform float uSpeed; uniform float uIntensity;
varying vec2 vUv; varying vec3 vNormalW; varying vec3 vWorld;
vec4 shade(vec2 uv, vec3 normal, vec3 viewDir, vec3 worldPos) {
${body}
}
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  gl_FragColor = shade(vUv, normalize(vNormalW), viewDir, vWorld);
}`;
}
