// look.js: one call makes any scene look like a shipped stylised game. See CONTRACT.md and docs/Look.md.
//   Look.apply(game, 'toon_bright' | 'candy' | 'sunset' | 'neon_night' | 'dark_fantasy' | 'cozy' | 'desert' | 'snow' | 'realistic', overrides)
//   Look.material(game, { color, kind: 'toon'|'standard'|'emissive'|'glass'|'metal', ... })  -> cached Material
//   Look.palette(game) -> { primary, secondary, accent, ground, foliage, water, ui, ... } as '#rrggbb'
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

// ------------------------------------------------------------------------------------------------ presets
// palette keys are the shared vocabulary of every kit (world props, UI themes, FX colours)
const BASE = {
  palette: {
    primary: '#ff6b4a', secondary: '#4aa3ff', accent: '#ffd23a', danger: '#ff3b5c', good: '#5be36b',
    ground: '#b5794a', ground2: '#8e5a36', grass: '#78c24f', grass2: '#b9d962', cliff: '#9a8574', cliff2: '#6f6058',
    foliage: '#4b9a3c', foliage2: '#93c63e', trunk: '#8a5a3a', flower: '#ff6fa8', flower2: '#fff27a',
    water: '#2fc3e0', waterDeep: '#1868b0', foam: '#ffffff', sand: '#f0d494', snow: '#f4f8ff',
    wood: '#b8763f', stone: '#c2bcb0', roof: '#e5533d', metal: '#a8b4c4', cloud: '#ffffff', glow: '#fff4b0',
    ui: '#2b3a67', uiText: '#ffffff', uiAccent: '#ffd23a',
  },
  sky: { top: '#3d8bff', horizon: '#c4e8ff', bottom: '#eaf6ff', sunSize: 2.2, sunGlow: 0.6, stars: 0, aurora: 0, exponent: 0.55 },
  sun: { color: '#fff1d6', intensity: 2.4, elevation: 52, azimuth: 35 },
  hemi: { sky: '#cfe6ff', ground: '#7a8f5a', intensity: 1.0 },
  env: 0.6,
  exposure: 1.0, toneMapping: 'neutral',
  fog: { color: null, near: 0.35, far: 1.0 },          // near/far as fractions of the level's fog range (see Look.fit)
  bloom: { strength: 0.35, radius: 0.4, threshold: 1.2 },
  edges: { color: '#1b2238', strength: 0.85, threshold: 0.18 },
  grade: { saturation: 1.04, contrast: 1.06, lift: '#000000', gain: '#ffffff', vignette: 0.28 },
  rim: { color: '#ffffff', strength: 0.35 },
  kind: 'toon',
  flora: {},                                            // remap foliage kinds per look, e.g. desert tree -> cactus
};

const LOOKS = {
  toon_bright: {},
  candy: {
    palette: { primary: '#ff5fa2', secondary: '#6fd6ff', accent: '#fff35c', ground: '#ffb0d6', ground2: '#e98bbd',
      grass: '#8ef0b8', grass2: '#c2ffa0', cliff: '#c7a2ff', cliff2: '#9a7ae6', foliage: '#ff8fc8', foliage2: '#ffc56e',
      trunk: '#c97a9a', flower: '#ffffff', flower2: '#7ff0ff', water: '#7fe6ff', waterDeep: '#5aa8ff', sand: '#ffe2c4',
      wood: '#ff9f86', stone: '#f2e0ff', roof: '#ff6fb0', metal: '#d8c8ff', cloud: '#fff4fb', glow: '#fff2a8',
      ui: '#ff5fa2', uiText: '#ffffff', uiAccent: '#fff35c' },
    sky: { top: '#7cc6ff', horizon: '#ffd9f0', bottom: '#fff0f8', sunGlow: 0.5 },
    sun: { color: '#fff4fa', intensity: 2.6, elevation: 58 },
    hemi: { sky: '#ffe6f6', ground: '#b49ae6', intensity: 1.6 },
    edges: { color: '#6a3a7a', strength: 0.7 },
    grade: { saturation: 1.15, contrast: 1.0, vignette: 0.18 },
    rim: { color: '#fff0ff', strength: 0.45 },
    flora: { tree_pine: 'tree_round', rock: 'crystal' },
  },
  sunset: {
    palette: { primary: '#ff6a3d', secondary: '#7a5cff', accent: '#ffd04a', ground: '#b46a48', ground2: '#874a38',
      grass: '#a8b44a', grass2: '#d6c25a', cliff: '#9a5f50', cliff2: '#6a3c3c', foliage: '#6f9a3a', foliage2: '#e08a3a',
      trunk: '#6a3a2a', flower: '#ff5a7a', flower2: '#ffd04a', water: '#4a7ac0', waterDeep: '#2a3a7a', foam: '#ffe0c8',
      wood: '#a8603a', stone: '#c49a88', roof: '#c8443a', cloud: '#ffc0a0', glow: '#ffd090',
      ui: '#3a2a5a', uiText: '#fff4e6', uiAccent: '#ffb04a' },
    sky: { top: '#2e3f86', horizon: '#ff9a5c', bottom: '#ff7a6a', sunSize: 3.2, sunGlow: 1.2, exponent: 0.45 },
    sun: { color: '#ffb070', intensity: 2.6, elevation: 11, azimuth: 70 },
    hemi: { sky: '#ffb0a0', ground: '#4a3048', intensity: 1.25 },
    exposure: 1.05,
    bloom: { strength: 0.6, radius: 0.7, threshold: 0.85 },
    edges: { color: '#2a1430', strength: 0.8 },
    grade: { saturation: 1.12, contrast: 1.08, lift: '#140818', vignette: 0.34 },
    rim: { color: '#ffb080', strength: 0.55 },
  },
  neon_night: {
    palette: { primary: '#ff2fd0', secondary: '#2fd0ff', accent: '#00ffc8', ground: '#2a2048', ground2: '#1a1430',
      grass: '#3a2f7a', grass2: '#6a3fd0', cliff: '#2e2a4e', cliff2: '#1c1934', foliage: '#4a2fa0', foliage2: '#ff3fd8',
      trunk: '#2a2040', flower: '#00ffd0', flower2: '#ff4fe0', water: '#1a1060', waterDeep: '#08041e', foam: '#4ff0ff',
      sand: '#3a3060', snow: '#c8c0ff', wood: '#3a2c5a', stone: '#4a4470', roof: '#ff2fa0', metal: '#6a7ab0',
      cloud: '#5a3a9a', glow: '#00ffd0', ui: '#120a2a', uiText: '#ffffff', uiAccent: '#00ffc8' },
    sky: { top: '#04030f', horizon: '#3a1060', bottom: '#120626', sunSize: 1.6, sunGlow: 0.25, stars: 1, aurora: 0.6, exponent: 0.5 },
    sun: { color: '#8aa8ff', intensity: 0.9, elevation: 40, azimuth: -30 },
    hemi: { sky: '#7a5aff', ground: '#200a30', intensity: 1.1 },
    env: 0.35, exposure: 1.1,
    bloom: { strength: 1.05, radius: 0.6, threshold: 0.6 },
    edges: { color: '#000000', strength: 0.9 },
    grade: { saturation: 1.2, contrast: 1.1, lift: '#06021a', vignette: 0.42 },
    rim: { color: '#2ff0ff', strength: 1.1 },
    flora: { rock: 'crystal', mushroom: 'mushroom_glow', flowers: 'flowers_glow' },
    night: true,
  },
  dark_fantasy: {
    palette: { primary: '#a8304a', secondary: '#4a6ab0', accent: '#9aff6a', ground: '#4a3a40', ground2: '#2e242a',
      grass: '#3e5a42', grass2: '#5a7a4a', cliff: '#4e4856', cliff2: '#2e2a36', foliage: '#2f4a3e', foliage2: '#5a3a6a',
      trunk: '#2e2226', flower: '#b080ff', flower2: '#9aff6a', water: '#1e3a4a', waterDeep: '#0a1420', foam: '#a0ffd0',
      wood: '#4a3830', stone: '#6a6470', roof: '#4a2a4a', metal: '#7a7a90', cloud: '#5a5068', glow: '#9aff6a',
      ui: '#1a1420', uiText: '#e8e0ff', uiAccent: '#9aff6a' },
    sky: { top: '#0b0d1e', horizon: '#4f3d63', bottom: '#1a1424', sunSize: 2.6, sunGlow: 0.45, stars: 0.7, aurora: 0.45, exponent: 0.6 },
    sun: { color: '#b8c8ff', intensity: 1.5, elevation: 32, azimuth: -50 },
    hemi: { sky: '#8a7aa8', ground: '#2a1e2a', intensity: 1.15 },
    env: 0.35, exposure: 1.05,
    fog: { near: 0.25, far: 0.95 },
    bloom: { strength: 0.85, radius: 0.65, threshold: 0.7 },
    edges: { color: '#08060c', strength: 0.9 },
    grade: { saturation: 0.92, contrast: 1.12, lift: '#0a0614', vignette: 0.5 },
    rim: { color: '#9ab0ff', strength: 0.6 },
    flora: { flowers: 'flowers_glow', mushroom: 'mushroom_glow', tree_round: 'tree_dead' },
    night: true,
  },
  cozy: {
    palette: { primary: '#e2725b', secondary: '#5aa89a', accent: '#ffcc4d', ground: '#a8744e', ground2: '#7e5236',
      grass: '#8cc152', grass2: '#c2d46a', cliff: '#a78468', cliff2: '#7a5e4a', foliage: '#6aa84a', foliage2: '#e5a53a',
      trunk: '#7a4e32', flower: '#ff7a8a', flower2: '#fff0a0', water: '#4ab8c8', waterDeep: '#2a6a9a',
      wood: '#b07a46', stone: '#d2c4ae', roof: '#c4583a', cloud: '#fff8ee', glow: '#ffd890',
      ui: '#5a3a2a', uiText: '#fff8ec', uiAccent: '#ffcc4d' },
    sky: { top: '#76b2e6', horizon: '#ffe4c2', bottom: '#fff2e0', sunGlow: 0.8 },
    sun: { color: '#ffd9a8', intensity: 2.9, elevation: 34, azimuth: 55 },
    hemi: { sky: '#ffe8cc', ground: '#7a6a4a', intensity: 1.4 },
    edges: { color: '#3a2418', strength: 0.75 },
    grade: { saturation: 1.08, contrast: 1.04, lift: '#0c0602', gain: '#fff4e4', vignette: 0.3 },
    rim: { color: '#ffe0b0', strength: 0.4 },
  },
  desert: {
    palette: { primary: '#e0603a', secondary: '#3a9ad0', accent: '#3ae0d0', ground: '#e6bc78', ground2: '#c99a5a',
      grass: '#e8c27a', grass2: '#f2d494', cliff: '#c9804a', cliff2: '#9a5634', foliage: '#5a9a4a', foliage2: '#9ab84a',
      trunk: '#8a5a3a', flower: '#ff6a8a', flower2: '#ffe05a', water: '#2ec4c0', waterDeep: '#1a7a9a', sand: '#efce8a',
      wood: '#a8703a', stone: '#d8b890', roof: '#c8643a', cloud: '#fff6ea', glow: '#ffe8a0',
      ui: '#6a3a1a', uiText: '#fff8ea', uiAccent: '#3ae0d0' },
    sky: { top: '#2e86d6', horizon: '#ffe2b4', bottom: '#fff0d8', sunSize: 2.4, sunGlow: 0.9 },
    sun: { color: '#fff0d4', intensity: 3.2, elevation: 48, azimuth: 20 },
    hemi: { sky: '#d8e8ff', ground: '#c09060', intensity: 1.3 },
    exposure: 0.95,
    edges: { color: '#4a2410', strength: 0.75 },
    grade: { saturation: 1.1, contrast: 1.06, gain: '#fff6ea', vignette: 0.3 },
    rim: { color: '#fff0d0', strength: 0.35 },
    flora: { tree_round: 'cactus', tree_pine: 'palm', grass: 'grass_dry', bush: 'cactus_small', flowers: 'grass_dry', mushroom: 'rock' },
  },
  snow: {
    palette: { primary: '#3a7aff', secondary: '#ff4a6a', accent: '#ffd23a', ground: '#e4ecf8', ground2: '#c4d2e8',
      grass: '#f4f8ff', grass2: '#dfe9fa', cliff: '#8a9ab4', cliff2: '#5e6c88', foliage: '#2f6a5a', foliage2: '#4a8a6a',
      trunk: '#5a4036', flower: '#ff4a6a', flower2: '#9ad8ff', water: '#8ad8ff', waterDeep: '#3a8ac8', foam: '#ffffff',
      sand: '#e8eef8', wood: '#8a5a40', stone: '#a8b4c8', roof: '#c84a4a', cloud: '#ffffff', glow: '#bfe8ff',
      ui: '#24406a', uiText: '#ffffff', uiAccent: '#ffd23a' },
    sky: { top: '#5a96e0', horizon: '#e6efff', bottom: '#f6f9ff', sunGlow: 0.7 },
    sun: { color: '#fff6ec', intensity: 2.3, elevation: 26, azimuth: 40 },
    hemi: { sky: '#dce8ff', ground: '#8a9ab8', intensity: 1.25 },
    exposure: 0.92,
    bloom: { strength: 0.35, radius: 0.5, threshold: 1.05 },
    edges: { color: '#2a3a5a', strength: 0.7 },
    grade: { saturation: 1.08, contrast: 1.08, lift: '#02040c', gain: '#f2f6ff', vignette: 0.26 },
    rim: { color: '#e8f4ff', strength: 0.3 },
    flora: { tree_round: 'tree_pine_snow', tree_pine: 'tree_pine_snow', grass: 'grass_snow', flowers: 'rock_small', mushroom: 'rock_small', bush: 'bush_snow' },
  },
  realistic: {
    sky: { top: '#3f7fd8', horizon: '#cfe0f0', bottom: '#e6eef6', sunGlow: 0.6 },
    sun: { color: '#fff4e4', intensity: 3.4, elevation: 40 },
    hemi: { sky: '#cfe0ff', ground: '#6a6048', intensity: 0.9 },
    env: 1.0, toneMapping: 'aces', exposure: 0.95,
    edges: { strength: 0 },
    grade: { saturation: 1.0, contrast: 1.02, vignette: 0.22 },
    rim: { strength: 0.08 },
    kind: 'standard',
    bloom: { strength: 0.3, radius: 0.4, threshold: 1.0 },
  },
};
export const looks = Object.keys(LOOKS);

function deepMerge(a, b) {
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof THREE.Color) && a && typeof a[k] === 'object'
      ? deepMerge(a[k], v) : v;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ shared uniforms
// one set of uniforms shared by every kit material: time (wind/water), rim colour, wind strength
const U = {
  uTime: { value: 0 },
  uRimColor: { value: new THREE.Color('#ffffff') },
  uRimStrength: { value: 0.35 },
  uWind: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
};
export const uniforms = U;

let gradientTex = null;
function gradientMap() {
  if (gradientTex) return gradientTex;
  const n = 256, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);              // 0.5 = terminator
    const s = (a, b) => THREE.MathUtils.smoothstep(x, a, b);
    const v = 0.34 + 0.31 * s(0.47, 0.5) + 0.35 * s(0.6, 0.63);
    const c = Math.round(v * 255);
    data.set([c, c, c, 255], i * 4);
  }
  gradientTex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  gradientTex.minFilter = gradientTex.magFilter = THREE.LinearFilter;
  gradientTex.generateMipmaps = false;
  gradientTex.needsUpdate = true;
  return gradientTex;
}

// injects rim light (fragment) and wind sway (vertex, for foliage) into any built-in material
function patch(mat, { rim = 1, wind = 0 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uRimColor = U.uRimColor; sh.uniforms.uRimStrength = U.uRimStrength;
    sh.uniforms.uWind = U.uWind;
    sh.uniforms.uRimMul = { value: rim };
    sh.uniforms.uSway = { value: wind };
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      if (uSway > 0.0) {
        vec4 wpos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpos = instanceMatrix * wpos;
        #endif
        wpos = modelMatrix * wpos;
        float hgt = max(position.y, 0.0);
        float ph = uTime * 1.7 + wpos.x * 0.21 + wpos.z * 0.17;
        float gust = 0.6 + 0.4 * sin(uTime * 0.53 + wpos.x * 0.03);
        vec2 sw = vec2(sin(ph), cos(ph * 0.83)) * uSway * uWind * gust * hgt * hgt;
        transformed.xz += sw;
      }`);
    sh.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimMul;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 vd = normalize(vViewPosition);
        float rimF = 1.0 - clamp(dot(normal, vd), 0.0, 1.0);
        rimF = smoothstep(0.62, 0.92, rimF);
        outgoingLight += uRimColor * rimF * uRimStrength * uRimMul * (0.4 + 0.6 * diffuseColor.rgb);
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `kitpatch-${rim > 0 ? 1 : 0}-${wind > 0 ? 1 : 0}`;
  return mat;
}

// ------------------------------------------------------------------------------------------------ materials
const matCache = new Map();
function lookOf(game) { return (game && game.look) || null; }

function resolveColor(game, c, fallback = '#cccccc') {
  if (c instanceof THREE.Color) return c.clone();
  if (typeof c === 'number') return new THREE.Color(c);
  if (typeof c === 'string') {
    const pal = palette(game);
    if (pal[c]) return new THREE.Color(pal[c]);
    try { return new THREE.Color(c); } catch { /* fallthrough */ }
  }
  return new THREE.Color(fallback);
}
export { resolveColor as color };

/**
 * Look.material(game, opts) -> a cached Material that fits the active look.
 * opts: color ('#hex' | palette key like 'foliage'), kind ('toon' default | 'standard' | 'emissive' | 'glass' | 'metal'),
 *       emissive (colour), emissiveIntensity, opacity, vertexColors, flat (flat shading), rim (0..2), wind (0..0.3 sway),
 *       side ('front'|'double'), map (Texture), roughness, metalness.
 */
export function material(game, opts = {}) {
  if (typeof opts === 'string' || typeof opts === 'number' || opts instanceof THREE.Color) opts = { color: opts };
  const L = lookOf(game);
  const kind = opts.kind || (L ? L.preset.kind : 'toon');
  const KINDS = ['toon', 'standard', 'emissive', 'glass', 'metal'];
  if (!KINDS.includes(kind)) throw new Error(`Look.material: unknown kind "${kind}"; kinds: ${KINDS.join(', ')}`);
  const col = resolveColor(game, opts.color ?? (opts.vertexColors ? '#ffffff' : 'primary'));
  const key = JSON.stringify([kind, col.getHex(), opts.emissive ? resolveColor(game, opts.emissive).getHex() : 0,
    opts.emissiveIntensity, opts.opacity, !!opts.vertexColors, !!opts.flat, opts.rim, opts.wind, opts.side,
    opts.map ? opts.map.uuid : 0, opts.roughness, opts.metalness, L ? L.name : '']);
  if (matCache.has(key)) return matCache.get(key);
  const side = opts.side === 'double' ? THREE.DoubleSide : THREE.FrontSide;
  const common = { color: col, vertexColors: !!opts.vertexColors, side, map: opts.map || null };
  let m;
  if (kind === 'toon') {
    m = new THREE.MeshToonMaterial({ ...common, gradientMap: gradientMap() });
    if (opts.emissive) { m.emissive = resolveColor(game, opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
    patch(m, { rim: opts.rim ?? 1, wind: opts.wind || 0 });
  } else if (kind === 'standard' || kind === 'metal') {
    m = new THREE.MeshStandardMaterial({ ...common, flatShading: !!opts.flat, roughness: opts.roughness ?? (kind === 'metal' ? 0.3 : 0.8),
      metalness: opts.metalness ?? (kind === 'metal' ? 0.9 : 0.0) });
    if (opts.emissive) { m.emissive = resolveColor(game, opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
    patch(m, { rim: opts.rim ?? 0.5, wind: opts.wind || 0 });
  } else if (kind === 'emissive') {
    // glows through bloom: emissive above 1.0 in HDR. Toon-shaded underneath so it still has form.
    m = new THREE.MeshToonMaterial({ ...common, gradientMap: gradientMap() });
    m.emissive = resolveColor(game, opts.emissive ?? col);
    m.emissiveIntensity = opts.emissiveIntensity ?? 2.2;
    patch(m, { rim: opts.rim ?? 1.2, wind: opts.wind || 0 });
  } else if (kind === 'glass') {
    m = new THREE.MeshStandardMaterial({ ...common, roughness: 0.08, metalness: 0.1, transparent: true,
      opacity: opts.opacity ?? 0.45, depthWrite: false });
    if (opts.emissive) { m.emissive = resolveColor(game, opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 0.6; }
    patch(m, { rim: opts.rim ?? 2.0, wind: 0 });
  }
  if (opts.opacity != null && opts.opacity < 1 && kind !== 'glass') { m.transparent = true; m.opacity = opts.opacity; }
  m.name = `kit:${kind}:${col.getHexString()}`;
  matCache.set(key, m);
  return m;
}

/** Look.palette(game) -> active palette ('#rrggbb' strings). Works before apply (toon_bright defaults). */
export function palette(game) {
  const L = lookOf(game);
  return L ? L.palette : { ...BASE.palette };
}

// ------------------------------------------------------------------------------------------------ sky
const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
uniform float sunSize; uniform float sunGlow; uniform float stars; uniform float aurora; uniform float time;
uniform float exponent; uniform float discMul;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash(vec3(i,0.)), b=hash(vec3(i+vec2(1,0),0.)), c=hash(vec3(i+vec2(0,1),0.)), d=hash(vec3(i+vec2(1,1),0.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), exponent)) : mix(horizon, bottom, pow(clamp(-h*2.5,0.0,1.0), 0.6));
  // soft horizon haze band
  col = mix(col, horizon * 1.05, exp(-abs(h) * 18.0) * 0.35);
  float s = max(dot(d, sunDir), 0.0);
  float cs = cos(radians(sunSize));
  float disc = smoothstep(cs, cs + 0.0009, s);
  col += sunColor * (pow(s, 6.0) * 0.25 + pow(s, 48.0) * 0.6) * sunGlow;
  col += sunColor * disc * 6.0 * discMul;
  if (stars > 0.0 && h > -0.05) {
    vec3 sp = d * 220.0; vec3 cell = floor(sp); float r = hash(cell);
    float st = step(0.9965, r) * smoothstep(0.0, 0.25, h + 0.05);
    float tw = 0.6 + 0.4 * sin(time * (2.0 + r * 5.0) + r * 40.0);
    vec3 fp = fract(sp) - 0.5; float dd = length(fp);
    col += vec3(0.9, 0.95, 1.0) * st * tw * smoothstep(0.35, 0.0, dd) * 3.0 * stars;
  }
  if (aurora > 0.0 && h > 0.0) {
    vec2 q = d.xz / (h + 0.25);
    float band = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float n = noise(q * (0.9 + fi * 0.4) + vec2(time * 0.04 * (fi + 1.0), fi * 3.1));
      band += smoothstep(0.55, 0.0, abs(sin(q.x * 0.8 + n * 4.0 + fi) * 0.5 + q.y * 0.15 - 0.2)) * (0.5 + 0.5 * n);
    }
    float fall = smoothstep(0.02, 0.25, h) * smoothstep(0.85, 0.35, h);
    col += mix(vec3(0.1, 1.0, 0.6), vec3(0.6, 0.2, 1.0), clamp(h * 1.6, 0.0, 1.0)) * band * fall * aurora * 0.45;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function makeSkyMaterial(p, sunDir) {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    uniforms: {
      top: { value: new THREE.Color(p.sky.top) }, horizon: { value: new THREE.Color(p.sky.horizon) },
      bottom: { value: new THREE.Color(p.sky.bottom) }, sunDir: { value: sunDir.clone() },
      sunColor: { value: new THREE.Color(p.sun.color) }, sunSize: { value: p.sky.sunSize }, sunGlow: { value: p.sky.sunGlow },
      stars: { value: p.sky.stars }, aurora: { value: p.sky.aurora }, time: U.uTime, exponent: { value: p.sky.exponent },
      discMul: { value: 1 },
    },
  });
}

// ------------------------------------------------------------------------------------------------ post
// LookPass: depth-based ink edges (silhouettes + creases from the Laplacian of inverse depth), colour grade, vignette.
const LookShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, resolution: { value: new THREE.Vector2(1280, 720) },
    cameraNear: { value: 0.1 }, cameraFar: { value: 4000 }, edgeColor: { value: new THREE.Color('#1b2238') },
    edgeStrength: { value: 0.85 }, edgeThreshold: { value: 0.18 }, edgeFade: { value: 260 },
    saturation: { value: 1.1 }, contrast: { value: 1.05 }, lift: { value: new THREE.Color(0, 0, 0) },
    gain: { value: new THREE.Color(1, 1, 1) }, vignette: { value: 0.28 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 resolution;
    uniform float cameraNear; uniform float cameraFar; uniform vec3 edgeColor; uniform float edgeStrength;
    uniform float edgeThreshold; uniform float edgeFade;
    uniform float saturation; uniform float contrast; uniform vec3 lift; uniform vec3 gain; uniform float vignette;
    varying vec2 vUv;
    float viewZ(vec2 uv){ float z = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(z, cameraNear, cameraFar); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      if (edgeStrength > 0.0) {
        vec2 px = 1.0 / resolution;
        float zc = viewZ(vUv);
        float wc = 1.0 / zc;
        float wl = 1.0 / viewZ(vUv - vec2(px.x, 0.0)), wr = 1.0 / viewZ(vUv + vec2(px.x, 0.0));
        float wd = 1.0 / viewZ(vUv - vec2(0.0, px.y)), wu = 1.0 / viewZ(vUv + vec2(0.0, px.y));
        float lap = (wl + wr + wd + wu - 4.0 * wc) / wc;          // 0 on any plane; < 0 on the near side of an edge
        float e = smoothstep(edgeThreshold, edgeThreshold * 2.5, -lap);
        e *= smoothstep(edgeFade, edgeFade * 0.35, zc) * step(zc, cameraFar * 0.95);
        col = mix(col, edgeColor * (0.25 + 0.35 * col), e * edgeStrength);
      }
      // grade in linear HDR, before tone mapping
      col = col * gain + lift * (1.0 - clamp(col, 0.0, 1.0));
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = max(vec3(0.0), (col - 0.18) * contrast + 0.18);
      vec2 q = vUv - 0.5; q.x *= resolution.x / resolution.y;
      col *= 1.0 - vignette * smoothstep(0.35, 1.05, length(q));
      gl_FragColor = vec4(col, c.a);
    }`,
};

class LookPass extends ShaderPass {
  constructor() { super(LookShader); }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }
}

const TONE = { neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping,
  none: THREE.NoToneMapping };

// ------------------------------------------------------------------------------------------------ apply
/**
 * Look.apply(game, name = 'toon_bright', overrides = {}) -> game.look
 * overrides: any preset section, e.g. { palette: { primary: '#ff0000' }, sun: { elevation: 20 }, quality: 'low',
 *   bloom: { strength: 1 }, fog: { far: 0.8 } }. Call once, before Level.build / World.* so materials pick up the palette.
 */
export function apply(game, name = 'toon_bright', overrides = {}) {
  if (!game || !game.renderer || !game.scene) throw new Error('Look.apply(game, name): first argument must be the game from createGame()');
  if (typeof name === 'object' && name) { overrides = name; name = overrides.look || 'toon_bright'; }
  if (!LOOKS[name]) throw new Error(`Look.apply: unknown look "${name}"; looks: ${Object.keys(LOOKS).join(', ')}`);
  const p = deepMerge(deepMerge(BASE, LOOKS[name]), overrides || {});
  const quality = overrides.quality || (game.look && game.look.quality) || 'high';
  const { renderer, scene, camera } = game;
  if (game.look) game.look.dispose();
  matCache.clear();

  renderer.toneMapping = TONE[p.toneMapping] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = p.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  if (quality === 'low') renderer.setPixelRatio(1);

  U.uRimColor.value.set(p.rim.color);
  U.uRimStrength.value = p.rim.strength;

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - p.sun.elevation),
    THREE.MathUtils.degToRad(p.sun.azimuth));
  U.uSunDir.value.copy(sunDir);

  // lights
  const root = new THREE.Group(); root.name = 'kit:look';
  const hemi = new THREE.HemisphereLight(p.hemi.sky, p.hemi.ground, p.hemi.intensity);
  const sun = new THREE.DirectionalLight(p.sun.color, p.sun.intensity);
  sun.castShadow = true;
  const sm = quality === 'low' ? 1024 : 4096;
  sun.shadow.mapSize.set(sm, sm);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 3;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
  root.add(hemi, sun, sun.target);

  // sky dome (follows the camera) + environment map from the same shader
  const skyMat = makeSkyMaterial(p, sunDir);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.name = 'kit:sky'; sky.frustumCulled = false; sky.renderOrder = -1000; sky.castShadow = sky.receiveShadow = false;
  root.add(sky);
  scene.add(root);
  scene.background = new THREE.Color(p.sky.horizon);

  let envRT = null;
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envMat = makeSkyMaterial(p, sunDir); envMat.uniforms.discMul.value = 0.15;
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat));
    envRT = pm.fromScene(envScene, 0.02, 0.1, 200);
    scene.environment = envRT.texture;
    scene.environmentIntensity = p.env;
    pm.dispose(); envMat.dispose();
  } catch (e) { console.warn('[kit] Look: environment map failed', e); }

  // fog: linear, colour = horizon so silhouettes melt into the sky. Range fitted to the level by Look.fit.
  const fogCol = new THREE.Color(p.fog.color || p.sky.horizon);
  scene.fog = new THREE.Fog(fogCol, 120, 700);

  // post
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(size.x * pr, size.y * pr) });
  rt.depthTexture.type = THREE.UnsignedIntType;
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const lookPass = new LookPass();
  const lu = lookPass.uniforms;
  lu.edgeColor.value.set(p.edges.color ?? '#1b2238');
  lu.edgeStrength.value = p.edges.strength ?? 0.85;
  lu.edgeThreshold.value = p.edges.threshold ?? 0.18;
  lu.saturation.value = p.grade.saturation; lu.contrast.value = p.grade.contrast;
  lu.lift.value.set(p.grade.lift || '#000000'); lu.gain.value.set(p.grade.gain || '#ffffff');
  lu.vignette.value = p.grade.vignette;
  composer.addPass(lookPass);
  const bloomScale = quality === 'low' ? 0.5 : 1;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bloomScale, size.y * bloomScale), p.bloom.strength,
    p.bloom.radius, p.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const aa = quality === 'low' ? new FXAAPass() : new SMAAPass();
  composer.addPass(aa);
  game.composer = composer;

  // per frame: time uniform, sky follows camera, shadow frustum follows the focus point
  const focus = new THREE.Vector3(), fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
  let shadowRange = 60;
  const look = {
    name, preset: p, palette: { ...p.palette }, quality, sun, hemi, sky, composer, bloom, lookPass, root,
    sunDir: sunDir.clone(), fogRange: 700,
    focus: null,               // set to a live Vector3 (e.g. player.position) to centre shadows on it
    /** fit fog + shadow range to a level (Box3 or radius) */
    fit(boxOrRadius) {
      const r = typeof boxOrRadius === 'number' ? boxOrRadius
        : boxOrRadius.getSize(tmp).length() * 0.5;
      look.fogRange = Math.max(160, r * 2.4);
      lu.edgeFade.value = Math.max(160, r * 2.2);
    },
    setQuality(q) { look.quality = q; renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2)); },
    dispose() {
      scene.remove(root);
      sky.geometry.dispose(); skyMat.dispose();
      if (envRT) envRT.dispose();
      composer.dispose && composer.dispose();
      game.removeUpdate(tick);
      game.off && game.off('resize', onResize);
      game.composer = null;
      game.look = null;
    },
  };
  look.fit(140);

  function tick() {
    U.uTime.value = game.time;
    sky.position.copy(camera.position);
    // focus: explicit (player) > debug camera target > point ahead of the camera
    if (look.focus) focus.copy(look.focus);
    else if (game.cameraOverride) focus.copy(game.cameraOverride.target);
    else {
      camera.getWorldDirection(fwd);
      const t = fwd.y < -0.05 ? Math.min(-camera.position.y / fwd.y, 120) : 40;
      focus.copy(camera.position).addScaledVector(fwd, Math.max(t, 10));
    }
    const camDist = camera.position.distanceTo(focus);
    scene.fog.near = camDist * 0.6 + look.fogRange * p.fog.near;
    scene.fog.far = camDist * 0.6 + look.fogRange * p.fog.far * 1.4;
    shadowRange = THREE.MathUtils.clamp(camDist * 0.9, 40, 170);
    const sc = sun.shadow.camera;
    if (sc.right !== shadowRange) {
      sc.left = -shadowRange; sc.right = shadowRange; sc.top = shadowRange; sc.bottom = -shadowRange;
      sc.updateProjectionMatrix();
    }
    // snap to shadow texels so edges do not shimmer while moving
    const texel = (2 * shadowRange) / sun.shadow.mapSize.x;
    focus.x = Math.round(focus.x / texel) * texel; focus.z = Math.round(focus.z / texel) * texel;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, 250);
    lu.cameraNear.value = camera.near; lu.cameraFar.value = camera.far;
    lu.resolution.value.set(rt.width, rt.height);
  }
  game.lateUpdate(tick, 25);
  function onResize() { /* composer resize handled by core; keep uniforms current */ lu.resolution.value.set(rt.width, rt.height); }
  game.on && game.on('resize', onResize);
  tick();
  game.look = look;
  return look;
}

/** Look.fit(game, level | box | radius): fit fog + shadow distance to a level. Level.build calls this for you. */
export function fit(game, what) {
  if (!game.look) return;
  if (what && what.bounds) what = what.bounds;
  game.look.fit(what || 140);
}

/** Look.list() -> names of all looks */
export function list() { return Object.keys(LOOKS); }

/** Look.preset(name) -> a copy of the preset (sky, sun, palette...) without applying it */
export function preset(name) {
  if (!LOOKS[name]) throw new Error(`Look.preset: unknown look "${name}"; looks: ${Object.keys(LOOKS).join(', ')}`);
  return deepMerge(BASE, LOOKS[name]);
}

/** Look.flora(game, kind) -> the foliage kind this look uses for `kind` (e.g. desert maps tree_round -> cactus) */
export function flora(game, kind) {
  const L = lookOf(game);
  const f = L ? L.preset.flora : {};
  return f[kind] === undefined ? kind : f[kind];
}

/** Look.isNight(game) */
export function isNight(game) { const L = lookOf(game); return !!(L && L.preset.night); }
