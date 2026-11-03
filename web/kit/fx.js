// ThreeKit FX: GPU point-sprite particles (bursts, sparkles, dust, smoke, fire, magic, splash), instanced confetti,
// ribbon trails, shockwave rings, floating text, screen shake, hit/screen flash, speed lines and slow-mo.
// FX.auto(game) wires sensible defaults to the CONTRACT events. See docs/FX.md.
import * as THREE from 'three';
import { reportError } from './core.js';

// ---------- per-game FX state ----------
function sys(game) {
  if (!game || !game.scene) throw new Error('FX: first argument must be the game from createGame()');
  if (game.__fx) return game.__fx;
  const s = game.__fx = {
    add: new Pool(game, 6000, THREE.AdditiveBlending),
    alpha: new Pool(game, 3000, THREE.NormalBlending),
    confetti: null, rings: [], trails: new Set(), emitters: new Set(), texts: [], shake: { trauma: 0, offset: new THREE.Vector3(), applied: false, t: 0 },
    flashEl: null, linesCv: null, lines: { level: 0, target: 0, until: 0, color: '#ffffff' },
  };
  // shake: undo last frame's offset before the camera kit (lateUpdate 20) reads the camera, re-apply after it (30)
  game.lateUpdate(() => { if (s.shake.applied) { game.camera.position.sub(s.shake.offset); s.shake.applied = false; } }, -100);
  game.lateUpdate((dt) => step(game, s, dt), 30);
  return s;
}

// ---------- particle pool (one Points draw call per blend mode) ----------
const SHAPES = { glow: 0, star: 1, smoke: 2, ring: 3, square: 4, spark: 5, drop: 6 };
const vert = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute float aShape; attribute float aRot; attribute vec3 aColor;
varying float vAlpha; varying float vShape; varying float vRot; varying vec3 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.05), 0.0, 512.0);
  vAlpha = aAlpha; vShape = aShape; vRot = aRot; vColor = aColor;
}`;
const frag = /* glsl */`
varying float vAlpha; varying float vShape; varying float vRot; varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c, -s, s, c) * p;
  float r = length(p), a = 0.0;
  vec3 col = vColor;
  if (vShape < 0.5) {                      // glow: hot core + soft halo
    a = exp(-r * r * 4.0) + 0.5 * exp(-r * r * 22.0);
    col = mix(vColor, vec3(1.0), exp(-r * r * 30.0) * 0.7);
  } else if (vShape < 1.5) {               // star: 4-point twinkle with a core
    float arms = max(exp(-abs(p.x) * 8.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.y))), exp(-abs(p.y) * 8.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.x))));
    a = min(1.0, arms * 1.2 + exp(-r * r * 7.0));
    col = mix(vColor, vec3(1.0), exp(-r * r * 26.0));
  } else if (vShape < 2.5) {               // smoke: soft lumpy puff
    float lump = 0.9 + 0.1 * sin(atan(p.y, p.x) * 3.0 + vRot * 3.0);
    a = smoothstep(lump, lump * 0.25, r) * 0.85;
    col = vColor * (1.0 - 0.22 * (p.y + 1.0) * 0.5);
  } else if (vShape < 3.5) {               // ring
    a = smoothstep(0.62, 0.82, r) * (1.0 - smoothstep(0.86, 1.0, r));
  } else if (vShape < 4.5) {               // square chip
    a = step(abs(p.x), 0.7) * step(abs(p.y), 0.7);
  } else if (vShape < 5.5) {               // spark: stretched streak
    a = exp(-p.x * p.x * 40.0) * (1.0 - smoothstep(0.2, 1.0, abs(p.y)));
    col = mix(vColor, vec3(1.0), exp(-p.x * p.x * 120.0) * 0.6);
  } else {                                 // drop: round, crisp, with a highlight
    a = 1.0 - smoothstep(0.75, 0.95, r);
    col = mix(vColor, vec3(1.0), smoothstep(0.35, 0.0, length(p - vec2(-0.3, 0.3))) * 0.8);
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(game, n, blending) {
    this.game = game; this.n = n; this.count = 0;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.shape = new Float32Array(n); this.rot = new Float32Array(n);
    const dyn = (arr, k) => { const a = new THREE.BufferAttribute(arr, k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('position', dyn(this.pos, 3)); g.setAttribute('aColor', dyn(this.col, 3)); g.setAttribute('aSize', dyn(this.size, 1));
    g.setAttribute('aAlpha', dyn(this.alpha, 1)); g.setAttribute('aShape', dyn(this.shape, 1)); g.setAttribute('aRot', dyn(this.rot, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { uScale: { value: 500 } },
      transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 20 : 19;
    this.points.name = 'fx-particles';
    game.scene.add(this.points);
    // simulation state
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.spin = new Float32Array(n); this.fadeIn = new Float32Array(n);
  }
  emit(p) {
    if (this.count >= this.n) return;   // full: drop rather than steal (bursts are short)
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx; this.vel[i3 + 1] = p.vy; this.vel[i3 + 2] = p.vz;
    this.life[i] = 0; this.max[i] = p.life;
    this.s0[i] = p.size; this.s1[i] = p.sizeEnd ?? p.size; this.a0[i] = p.alpha ?? 1;
    this.c0[i3] = p.c0.r; this.c0[i3 + 1] = p.c0.g; this.c0[i3 + 2] = p.c0.b;
    const c1 = p.c1 || p.c0; this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.grav[i] = p.gravity ?? 0; this.drag[i] = p.drag ?? 1.5; this.spin[i] = p.spin ?? 0; this.fadeIn[i] = p.fadeIn ?? 0.05;
    this.shape[i] = p.shape; this.rot[i] = p.rot ?? 0;
  }
  update(dt) {
    const r = this.game.renderer, cam = this.game.camera;
    const h = r.domElement.height || innerHeight;
    this.mat.uniforms.uScale.value = h * 0.5 * (cam.projectionMatrix.elements[5] || 1.7);
    let i = 0;
    while (i < this.count) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) { this.kill(i); continue; }
      const i3 = i * 3, k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.max[i];
      const e = 1 - (1 - t) * (1 - t);
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      const fin = this.fadeIn[i] > 0 ? Math.min(1, this.life[i] / this.fadeIn[i]) : 1;
      this.alpha[i] = this.a0[i] * fin * (1 - t * t * t) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 * 0.6 : 1);
      for (let c = 0; c < 3; c++) this.col[i3 + c] = this.c0[i3 + c] + (this.c1[i3 + c] - this.c0[i3 + c]) * t;
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.count);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape', 'aRot']) g.attributes[k].needsUpdate = true;
  }
  kill(i) {
    const j = --this.count;
    if (i === j) return;
    const cp3 = (a) => { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; };
    const cp1 = (a) => { a[i] = a[j]; };
    [this.pos, this.col, this.vel, this.c0, this.c1].forEach(cp3);
    [this.size, this.alpha, this.shape, this.rot, this.life, this.max, this.s0, this.s1, this.a0, this.grav, this.drag, this.spin, this.fadeIn].forEach(cp1);
  }
}

// ---------- helpers ----------
const tmpC = new THREE.Color();
function col(c, fallback = '#ffffff') { try { return new THREE.Color(c ?? fallback); } catch { return new THREE.Color(fallback); } }
function palette(c) { return (Array.isArray(c) ? c : [c]).map(x => col(x)); }
export function positionOf(x) {
  if (!x) return null;
  if (x.isVector3) return x.clone();
  if (Array.isArray(x) && x.length >= 3) return new THREE.Vector3(x[0], x[1], x[2]);
  if (x.isObject3D) return x.getWorldPosition(new THREE.Vector3());
  for (const k of ['position', 'object', 'mesh', 'group']) {
    const v = x[k];
    if (v && v.isVector3) return v.clone();
    if (v && v.isObject3D) return v.getWorldPosition(new THREE.Vector3());
  }
  if (typeof x.x === 'number') return new THREE.Vector3(x.x, x.y || 0, x.z || 0);
  return null;
}
function need(pos, fn) { const p = positionOf(pos); if (!p) throw new Error(`FX.${fn}(game, pos, opts): pos must be a Vector3, [x,y,z] or an object with .position`); return p; }
const R = Math.random;
function sphere(v, s = 1) { const u = R() * 2 - 1, th = R() * Math.PI * 2, q = Math.sqrt(1 - u * u); return v.set(q * Math.cos(th) * s, u * s, q * Math.sin(th) * s); }
const tv = new THREE.Vector3();

function particles(game, pool, pos, n, f) {
  const s = sys(game);
  const P = s[pool];
  for (let i = 0; i < n; i++) { const p = f(i); p.x += pos.x; p.y += pos.y; p.z += pos.z; P.emit(p); }
}

// ---------- public effects ----------
// burst: radial explosion of glowy bits. sparkle/starBurst are presets of it.
export function burst(game, pos, opts = {}) {
  const p = need(pos, 'burst');
  const { count = 24, speed = 6, size = 0.35, life = 0.7, gravity = 4, shape = 'glow', color = '#ffd34d', colorEnd = null, up = 0.4, spread = 1, drag = 2.2, blend = shape === 'star' ? 'alpha' : 'add' } = opts;
  const cs = palette(color), ce = colorEnd ? col(colorEnd) : null;
  particles(game, blend === 'add' ? 'add' : 'alpha', p, count, () => {
    sphere(tv, 1); tv.y = tv.y * spread + up; tv.normalize().multiplyScalar(speed * (0.45 + R() * 0.75));
    const c0 = cs[Math.floor(R() * cs.length)];
    return { x: 0, y: 0, z: 0, vx: tv.x, vy: tv.y, vz: tv.z, life: life * (0.6 + R() * 0.6), size: size * (0.6 + R() * 0.8), sizeEnd: size * 0.15,
      c0, c1: ce || c0, gravity, drag, shape: SHAPES[shape] ?? 0, rot: R() * 6.28, spin: (R() - 0.5) * 6 };
  });
}
export function sparkle(game, pos, opts = {}) {
  const p = need(pos, 'sparkle');
  const color = opts.color ?? '#ffd34d';
  const k = opts.scale || 1;
  burst(game, p, { count: 1, speed: 0, size: 2.4 * k, life: 0.16, gravity: 0, shape: 'glow', color });   // pop flash
  burst(game, p, { count: 14, speed: 5, size: 0.9 * k, life: 0.6, gravity: 2, shape: 'star', color: [color, '#ffffff'], up: 0.6, ...opts });
  burst(game, p, { count: 10, speed: 2.2, size: 0.22, life: 0.9, gravity: -1.5, shape: 'glow', color, up: 1.2, drag: 1.2, ...opts, count: opts.count ? Math.ceil(opts.count / 2) : 10 });
  ring(game, p, { color, radius: 1.2 * (opts.scale || 1), life: 0.35, flat: false, width: 0.12 });
}
export function starBurst(game, pos, opts = {}) {
  const p = need(pos, 'starBurst');
  burst(game, p, { count: 40, speed: 10, size: 1.0, life: 0.9, gravity: 6, shape: 'star', color: opts.color ?? ['#ffe14d', '#ffffff', '#ff9d2e'], ...opts });
  burst(game, p, { count: 1, speed: 0, size: 5 * (opts.scale || 1), life: 0.25, gravity: 0, shape: 'glow', color: opts.color ?? '#fff3b0' });
}
// dust: deliberately SMALL and subtle (feet puffs on land/run). scale with opts.amount (0..1)
export function dust(game, pos, opts = {}) {
  const p = need(pos, 'dust');
  const { amount = 0.5, color = '#e9dfcf', size = 0.32 } = opts;
  const n = Math.max(2, Math.round(3 + amount * 6));
  particles(game, 'alpha', p, n, (i) => {
    const a = (i / n) * Math.PI * 2 + R() * 0.6, sp = 0.9 + amount * 1.6 + R() * 0.5;
    return { x: Math.cos(a) * 0.15, y: 0.05, z: Math.sin(a) * 0.15, vx: Math.cos(a) * sp, vy: 0.35 + R() * 0.5, vz: Math.sin(a) * sp, life: 0.45 + R() * 0.25,
      size: size * (0.6 + amount * 0.5), sizeEnd: size * (1.3 + amount), c0: col(color), alpha: 0.42, gravity: 0.4, drag: 4.5, shape: SHAPES.smoke, rot: R() * 6, spin: (R() - 0.5) * 2, fadeIn: 0.04 };
  });
}
export function smoke(game, pos, opts = {}) {
  const p = need(pos, 'smoke');
  const { count = 14, color = '#8b8f99', size = 1.0, life = 1.6, rise = 1.6, spread = 0.6 } = opts;
  particles(game, 'alpha', p, count, () => ({ x: (R() - 0.5) * spread, y: R() * 0.3, z: (R() - 0.5) * spread, vx: (R() - 0.5) * 1.2, vy: rise * (0.6 + R() * 0.6), vz: (R() - 0.5) * 1.2,
    life: life * (0.7 + R() * 0.5), size: size * 0.5, sizeEnd: size * 2.2, c0: col(color), c1: col(color).lerp(tmpC.set('#d9dde6'), 0.4), alpha: 0.55, gravity: -0.3, drag: 1.4, shape: SHAPES.smoke, rot: R() * 6, spin: (R() - 0.5) * 1.5, fadeIn: 0.15 }));
}
// poof: a quick cartoon smoke ball (death, despawn, teleport)
export function poof(game, pos, opts = {}) {
  const p = need(pos, 'poof');
  const { color = '#f4f1ec', size = 0.9, count = 12 } = opts;
  particles(game, 'alpha', p, count, () => { sphere(tv, 1); tv.y = Math.abs(tv.y) * 0.6; tv.multiplyScalar(3 + R() * 2);
    return { x: 0, y: 0.3, z: 0, vx: tv.x, vy: tv.y, vz: tv.z, life: 0.55 + R() * 0.3, size: size * 0.7, sizeEnd: size * 1.8, c0: col(color), alpha: 0.85, gravity: -0.6, drag: 5, shape: SHAPES.smoke, rot: R() * 6, spin: (R() - 0.5) * 3, fadeIn: 0.03 }; });
  burst(game, p, { count: 8, speed: 5, size: 0.25, life: 0.4, gravity: 4, shape: 'spark', color: '#ffffff' });
}
export function magic(game, pos, opts = {}) {
  const p = need(pos, 'magic');
  const { count = 36, color = ['#b47cff', '#62e6ff', '#ffffff'], radius = 1.2, height = 2.4, life = 1.1 } = opts;
  const cs = palette(color);
  particles(game, 'add', p, count, (i) => { const a = (i / count) * Math.PI * 4, r = radius * (0.6 + R() * 0.5);
    return { x: Math.cos(a) * r, y: R() * 0.4, z: Math.sin(a) * r, vx: -Math.sin(a) * 1.5 - Math.cos(a) * 0.6, vy: height * (0.5 + R() * 0.7), vz: Math.cos(a) * 1.5 - Math.sin(a) * 0.6,
      life: life * (0.6 + R() * 0.6), size: 0.28 + R() * 0.25, sizeEnd: 0.05, c0: cs[i % cs.length], gravity: -0.5, drag: 1.2, shape: i % 3 ? SHAPES.glow : SHAPES.star, rot: R() * 6, spin: 3 }; });
}
export function splash(game, pos, opts = {}) {
  const p = need(pos, 'splash');
  const { count = 26, color = '#dff6ff', speed = 6, size = 0.22 } = opts;
  particles(game, 'alpha', p, count, () => { const a = R() * 6.283, sp = speed * (0.3 + R() * 0.6);
    return { x: 0, y: 0, z: 0, vx: Math.cos(a) * sp * 0.45, vy: sp * (0.8 + R() * 0.6), vz: Math.sin(a) * sp * 0.45, life: 0.7 + R() * 0.4, size: size * (0.6 + R()), sizeEnd: size * 0.4,
      c0: col(color), alpha: 0.95, gravity: 16, drag: 0.6, shape: SHAPES.drop }; });
  ring(game, p, { color: '#ffffff', radius: 1.6 * (opts.scale || 1), life: 0.6, flat: true, width: 0.18, opacity: 0.7 });
}
// fire/smoke/sparkles emitters: continuous until handle.stop(); attach to an Object3D with {follow: object}
export function fire(game, pos, opts = {}) {
  const { rate = 40, size = 0.8, color = ['#ffdd55', '#ff7a1a'], colorEnd = '#c2181a', duration = Infinity, smoke: withSmoke = true } = opts;
  const cs = palette(color), ce = col(colorEnd);
  return emitter(game, pos, opts, duration, rate, (P, at) => {
    P.add.emit({ x: at.x + (R() - 0.5) * size * 0.6, y: at.y, z: at.z + (R() - 0.5) * size * 0.6, vx: (R() - 0.5) * 0.6, vy: 1.6 + R() * 1.6, vz: (R() - 0.5) * 0.6,
      life: 0.5 + R() * 0.4, size: size * (0.7 + R() * 0.5), sizeEnd: size * 0.15, c0: cs[Math.floor(R() * cs.length)], c1: ce, gravity: -2.5, drag: 1.5, shape: SHAPES.glow });
    if (withSmoke && R() < 0.12) P.alpha.emit({ x: at.x, y: at.y + size, z: at.z, vx: (R() - 0.5) * 0.4, vy: 1.2, vz: (R() - 0.5) * 0.4, life: 1.4, size: size * 0.6, sizeEnd: size * 2, c0: col('#4a4440'), alpha: 0.35, gravity: -0.3, drag: 0.8, shape: SHAPES.smoke, rot: R() * 6, spin: 0.5, fadeIn: 0.2 });
  });
}
export function sparkles(game, pos, opts = {}) {
  const { rate = 8, color = '#fff2a8', radius = 0.8, size = 0.3, duration = Infinity } = opts;
  const cs = palette(color);
  return emitter(game, pos, opts, duration, rate, (P, at) => { sphere(tv, radius * Math.cbrt(R()));
    P.add.emit({ x: at.x + tv.x, y: at.y + tv.y, z: at.z + tv.z, vx: 0, vy: 0.4, vz: 0, life: 0.6 + R() * 0.5, size, sizeEnd: 0, c0: cs[Math.floor(R() * cs.length)], gravity: 0, drag: 1, shape: SHAPES.star, rot: R() * 6, spin: 2, fadeIn: 0.2 }); });
}
function emitter(game, pos, opts, duration, rate, fn) {
  const s = sys(game);
  const follow = opts.follow || (pos && pos.isObject3D ? pos : null);
  const offset = opts.offset ? positionOf(opts.offset) : new THREE.Vector3();
  const base = follow ? null : need(pos, 'emitter');
  const h = { t: 0, acc: 0, duration, rate, alive: true, stop() { h.alive = false; s.emitters.delete(h); }, set rateValue(v) { h.rate = v; } };
  const at = new THREE.Vector3();
  h.tick = (dt) => {
    h.t += dt;
    if (h.t > h.duration || (follow && !follow.parent)) return h.stop();
    h.acc += dt * h.rate;
    if (follow) follow.localToWorld(at.copy(offset)); else at.copy(base).add(offset);
    while (h.acc >= 1) { h.acc -= 1; fn(s, at); }
  };
  s.emitters.add(h);
  return h;
}

// ring: shockwave disc on the ground (flat) or facing the camera
let ringGeo = null;
export function ring(game, pos, opts = {}) {
  const s = sys(game), p = need(pos, 'ring');
  const { color = '#ffffff', radius = 3, life = 0.5, flat = true, width = 0.14, opacity = 0.9 } = opts;
  ringGeo = ringGeo || new THREE.RingGeometry(0.86, 1, 64);
  const geo = width === 0.14 ? ringGeo : new THREE.RingGeometry(1 - width, 1, 64);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col(color), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  m.position.copy(p); if (flat) { m.rotation.x = -Math.PI / 2; m.position.y += 0.06; }
  m.renderOrder = 21; m.frustumCulled = false;
  game.scene.add(m);
  s.rings.push({ m, t: 0, life, radius, flat, opacity, own: geo !== ringGeo });
  m.scale.setScalar(0.01);
}

// confetti: instanced tumbling paper chips. Without pos it rains over the camera view.
export function confetti(game, pos = null, opts = {}) {
  const s = sys(game);
  if (pos && !positionOf(pos) && typeof pos === 'object') { opts = pos; pos = null; }
  const { count = 160, colors = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ffffff'], spread = 6, speed = 9, size = 1 } = opts;
  if (!s.confetti) {
    const N = 900;
    const geo = new THREE.PlaneGeometry(0.16, 0.26);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    const im = new THREE.InstancedMesh(geo, mat, N);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.setColorAt(0, new THREE.Color());
    im.count = 0; im.frustumCulled = false; im.name = 'fx-confetti'; im.renderOrder = 18;
    game.scene.add(im);
    s.confetti = { im, N, parts: [] };
  }
  const C = s.confetti, cs = palette(colors);
  let origin, rain = !pos, right = null, fwd = null;
  if (rain) {   // a curtain 10-17 units in front of the view, so no chip ever fills the screen
    const cam = viewCamera(game); fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    origin = cam.position.clone().addScaledVector(fwd, 13.5); origin.y += 5;
  } else origin = positionOf(pos);
  const k = Math.min(count, C.N - C.parts.length);
  for (let i = 0; i < k; i++) {
    let v;
    if (rain) v = new THREE.Vector3((R() - 0.5) * 3, R() * 2, (R() - 0.5) * 3);
    else { v = sphere(new THREE.Vector3(), 1); v.y = Math.abs(v.y) + 1.2; v.normalize().multiplyScalar(speed * (0.5 + R() * 0.7)); }
    const o = rain ? right.clone().multiplyScalar((R() - 0.5) * spread * 3.4).addScaledVector(fwd, (R() - 0.5) * 7).setY(R() * 4) : new THREE.Vector3();
    C.parts.push({ p: origin.clone().add(o), v, q: new THREE.Quaternion().random(), w: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(14), t: 0, life: rain ? 4 + R() * 2 : 2.6 + R() * 1.6,
      c: cs[Math.floor(R() * cs.length)], ph: R() * 6, s: size * (0.7 + R() * 0.6) });
  }
}

// ribbon trail behind an object (vehicles, boost, sword swings). handle.stop() to remove.
export function trail(game, object, opts = {}) {
  const s = sys(game);
  if (!object || !object.isObject3D) throw new Error('FX.trail(game, object, opts): object must be an Object3D (e.g. player.object)');
  const { color = '#ffffff', colorEnd = null, width = 0.6, length = 28, offset = [0, 0.3, 0], opacity = 0.75, minSpeed = 0.5, vertical = false, blend = 'add' } = opts;
  const n = Math.max(4, length | 0);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 2 * 3), colA = new Float32Array(n * 2 * 4);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 4).setUsage(THREE.DynamicDrawUsage));
  const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 17; mesh.name = 'fx-trail';
  game.scene.add(mesh);
  const pts = [], off = positionOf(offset), c0 = col(color), c1 = colorEnd ? col(colorEnd) : c0;
  const h = { mesh, enabled: true, width, opacity, stop() { s.trails.delete(h); game.scene.remove(mesh); geo.dispose(); mat.dispose(); } };
  const prev = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  h.tick = (dt) => {
    if (!object.parent) return h.stop();
    const p = object.localToWorld(off.clone());
    const moving = pts.length === 0 || p.distanceTo(pts[0]) > minSpeed * dt;
    if (h.enabled && moving) { pts.unshift(p); if (pts.length > n) pts.pop(); }
    else if (pts.length) pts.pop();                       // shrink when stopped / disabled
    for (let i = 0; i < n; i++) {
      const a = pts[Math.min(i, pts.length - 1)] || p, b = pts[Math.min(i + 1, pts.length - 1)] || a;
      dir.subVectors(a, b); if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
      if (vertical) side.set(0, 1, 0); else side.crossVectors(dir, up).normalize();
      const t = pts.length > 1 ? i / (n - 1) : 1, w = h.width * (1 - t) * 0.5;
      pos.set([a.x + side.x * w, a.y + side.y * w, a.z + side.z * w, a.x - side.x * w, a.y - side.y * w, a.z - side.z * w], i * 6);
      tmpC.copy(c0).lerp(c1, t);
      const al = i < pts.length ? h.opacity * (1 - t) * (1 - t) : 0;
      colA.set([tmpC.r, tmpC.g, tmpC.b, al, tmpC.r, tmpC.g, tmpC.b, al], i * 8);
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  };
  s.trails.add(h);
  return h;
}

// floating text (+10, CRIT!, names) rising from a world position. DOM, styled like the UI kit.
let textCss = false;
export function text(game, pos, str, opts = {}) {
  const s = sys(game), p = need(pos, 'text');
  const { color = '#ffe14d', size = 1, life = 1.0, rise = 1.6, outline = '#1b1430' } = opts;
  if (!textCss) {
    textCss = true;
    const st = document.createElement('style');
    st.textContent = `@font-face{font-family:'TK Lilita';src:url('${new URL('./ui/fonts/LilitaOne.ttf', import.meta.url)}') format('truetype');font-display:block}
.tk-ftext{position:fixed;left:0;top:0;z-index:17;pointer-events:none;font:400 calc(var(--s,1)*clamp(18px,2.6vmin,40px))/1 'TK Lilita',system-ui,sans-serif;white-space:nowrap;
 -webkit-text-stroke:.16em var(--o);paint-order:stroke fill;text-shadow:0 .1em 0 var(--o),0 .18em .25em rgba(0,0,0,.35);will-change:transform,opacity;letter-spacing:.02em}`;
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'tk-ftext'; el.textContent = String(str);
  el.style.color = color; el.style.setProperty('--o', outline); el.style.setProperty('--s', size);
  document.body.appendChild(el);
  s.texts.push({ el, p: p.clone(), t: 0, life, rise, dx: (R() - 0.5) * 0.6 });
  return el;
}

// screen shake: trauma model (amount 0..1 adds trauma; shake = trauma^2), applied as a camera offset after the camera kit
export function shake(game, amount = 0.35, opts = {}) {
  const s = sys(game);
  s.shake.trauma = Math.min(1, s.shake.trauma + Math.max(0, +amount || 0));
  s.shake.max = opts.max ?? 0.9;      // world units at trauma 1
  s.shake.decay = opts.decay ?? 1.6;  // trauma per second
}

// full-screen colour flash (hit = red, heal = green, win = white)
export function flash(game, color = '#ffffff', opts = {}) {
  const s = sys(game);
  const { duration = 0.22, opacity = 0.45, vignette = false } = opts;
  if (!s.flashEl) { s.flashEl = document.createElement('div'); s.flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:16;opacity:0'; document.body.appendChild(s.flashEl); }
  const el = s.flashEl;
  el.style.background = vignette ? `radial-gradient(ellipse at center, transparent 35%, ${color} 120%)` : color;
  el.animate([{ opacity }, { opacity: 0 }], { duration: duration * 1000, easing: 'cubic-bezier(.2,.7,.3,1)' });
}

// flash an object's materials (damage). Materials are cloned per object once so shared materials don't all blink.
export function hitFlash(game, object, opts = {}) {
  sys(game);
  const o = object && (object.isObject3D ? object : (object.object || object.mesh));
  if (!o || !o.isObject3D) return;
  const { color = '#ffffff', duration = 0.16, intensity = 1.6 } = opts;
  const c = col(color);
  const mats = [];
  o.traverse((m) => {
    if (!m.isMesh || !m.material) return;
    if (!m.userData.tkOwnMat) { m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone(); m.userData.tkOwnMat = true; }
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material])) if (mt.emissive) mats.push(mt);
  });
  for (const mt of mats) {
    if (!mt.userData.tkBase) mt.userData.tkBase = { e: mt.emissive.clone(), i: mt.emissiveIntensity ?? 1 };
    mt.emissive.copy(c); mt.emissiveIntensity = intensity;
  }
  game.__fx.hits = game.__fx.hits || [];
  game.__fx.hits.push({ mats, t: 0, duration });
}

// speed lines: anime-style streaks from the screen edges. speedLines(game, 0..1) holds a level; {pulse: seconds} for a burst
export function speedLines(game, level = 0.8, opts = {}) {
  const s = sys(game);
  if (!s.linesCv) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:15';
    document.body.appendChild(cv); s.linesCv = cv;
    s.linesSeeds = Array.from({ length: 56 }, () => ({ a: R() * Math.PI * 2, l: 0.12 + R() * 0.2, w: 0.8 + R() * 1.8, o: R() * 6, sp: 0.8 + R() * 1.6 }));
  }
  s.lines.color = opts.color || s.lines.color;
  if (opts.pulse) { s.lines.level = Math.max(s.lines.level, level); s.lines.target = 0; s.lines.until = performance.now() + opts.pulse * 1000; }
  else { s.lines.target = Math.max(0, Math.min(1, level)); s.lines.until = 0; }
}

// slow-mo hook: timeScale for `duration` REAL seconds, then restore (wins, big hits)
export function slowmo(game, scale = 0.3, duration = 0.6) {
  const s = sys(game);
  if (s.slowmoRestore == null) s.slowmoRestore = game.timeScale;
  game.timeScale = scale;
  clearTimeout(s.slowmoTimer);
  s.slowmoTimer = setTimeout(() => { game.timeScale = s.slowmoRestore ?? 1; s.slowmoRestore = null; }, duration * 1000);
}

// ---------- per-frame ----------
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v3 = new THREE.Vector3(), eq = new THREE.Quaternion();
// the camera as it will be rendered this frame (core applies cameraOverride after every lateUpdate)
const viewCam = new THREE.PerspectiveCamera();
function viewCamera(game) {
  const c = game.camera, o = game.cameraOverride;
  if (!o) { c.updateMatrixWorld(); return c; }
  viewCam.copy(c, false); viewCam.position.copy(o.position); viewCam.lookAt(o.target); viewCam.updateMatrixWorld(); viewCam.updateProjectionMatrix();
  return viewCam;
}
function step(game, s, dtGame) {
  const now = performance.now();
  const realDt = Math.min(0.05, (now - (s.lastNow || now)) / 1000); s.lastNow = now;
  const dt = game.paused ? 0 : dtGame;
  s.add.update(dt); s.alpha.update(dt);
  for (const e of [...s.emitters]) e.tick(dt);
  for (const t of [...s.trails]) t.tick(dt);
  // rings
  for (let i = s.rings.length - 1; i >= 0; i--) {
    const r = s.rings[i]; r.t += dt;
    const k = Math.min(1, r.t / r.life), e = 1 - Math.pow(1 - k, 3);
    r.m.scale.setScalar(Math.max(0.01, r.radius * e));
    r.m.material.opacity = r.opacity * (1 - k);
    if (!r.flat) r.m.quaternion.copy(viewCamera(game).quaternion);
    if (k >= 1) { game.scene.remove(r.m); r.m.material.dispose(); if (r.own) r.m.geometry.dispose(); s.rings.splice(i, 1); }
  }
  // confetti
  if (s.confetti) {
    const C = s.confetti, ps = C.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]; p.t += dt;
      if (p.t > p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.v.y -= 9 * dt; const drag = Math.exp(-2.6 * dt); p.v.multiplyScalar(drag);
      if (p.v.y < -2.2) p.v.y = -2.2;                         // paper terminal velocity
      p.p.addScaledVector(p.v, dt); p.p.x += Math.sin(p.t * 3 + p.ph) * 0.9 * dt; p.p.z += Math.cos(p.t * 2.3 + p.ph) * 0.6 * dt;
      eq.setFromEuler(new THREE.Euler(p.w.x * dt, p.w.y * dt, p.w.z * dt)); p.q.multiply(eq);
    }
    C.im.count = ps.length;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], fade = Math.min(1, (p.life - p.t) / 0.5);
      m4.compose(p.p, p.q, sc.setScalar(p.s * fade)); C.im.setMatrixAt(i, m4); C.im.setColorAt(i, p.c);
    }
    C.im.instanceMatrix.needsUpdate = true; if (C.im.instanceColor) C.im.instanceColor.needsUpdate = true;
  }
  // hit flashes (real time so they still read during slow-mo)
  if (s.hits) for (let i = s.hits.length - 1; i >= 0; i--) {
    const h = s.hits[i]; h.t += realDt;
    const k = Math.min(1, h.t / h.duration);
    for (const mt of h.mats) { const b = mt.userData.tkBase; mt.emissive.lerp(b.e, k); mt.emissiveIntensity = b.i + (mt.emissiveIntensity - b.i) * (1 - k); }
    if (k >= 1) { for (const mt of h.mats) { const b = mt.userData.tkBase; mt.emissive.copy(b.e); mt.emissiveIntensity = b.i; } s.hits.splice(i, 1); }
  }
  // floating text
  if (s.texts.length) {
    const w = innerWidth, hgt = innerHeight, cam = viewCamera(game);
    for (let i = s.texts.length - 1; i >= 0; i--) {
      const t = s.texts[i]; t.t += realDt;
      const k = t.t / t.life;
      if (k >= 1) { t.el.remove(); s.texts.splice(i, 1); continue; }
      v3.copy(t.p); v3.y += t.rise * (1 - Math.pow(1 - k, 2)); v3.x += t.dx * k; v3.project(cam);
      const vis = v3.z < 1;
      const pop = k < 0.12 ? 0.4 + (k / 0.12) * 0.9 : k < 0.22 ? 1.3 - (k - 0.12) / 0.1 * 0.3 : 1;
      t.el.style.opacity = vis ? String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1) : '0';
      t.el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px, ${(-v3.y * 0.5 + 0.5) * hgt}px) translate(-50%,-50%) scale(${pop})`;
    }
  }
  // speed lines
  if (s.linesCv) {
    const L = s.lines;
    if (L.until && now > L.until) L.until = 0;
    const tgt = L.until ? L.level : L.target;
    L.level += (tgt - L.level) * Math.min(1, realDt * (L.until ? 20 : 4));
    const cv = s.linesCv, ctx2 = cv.getContext('2d');
    if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight; }
    ctx2.clearRect(0, 0, cv.width, cv.height);
    if (L.level > 0.01) {
      const cx = cv.width / 2, cy = cv.height / 2, R0 = Math.hypot(cx, cy);
      ctx2.strokeStyle = L.color; ctx2.lineCap = 'round';
      for (const sd of s.linesSeeds) {
        const ph = (now / 1000 * sd.sp * 2 + sd.o) % 1;
        // streaks live in the outer ring of the screen and rush outward; the centre stays clean
        const r0 = R0 * (0.62 + 0.3 * ph - 0.12 * L.level), r1 = r0 + R0 * sd.l * (0.5 + L.level);
        ctx2.globalAlpha = Math.min(1, L.level) * 0.42 * Math.sin(ph * Math.PI);
        ctx2.lineWidth = sd.w * (cv.height / 720);
        ctx2.beginPath(); ctx2.moveTo(cx + Math.cos(sd.a) * r0, cy + Math.sin(sd.a) * r0 * 0.75); ctx2.lineTo(cx + Math.cos(sd.a) * r1, cy + Math.sin(sd.a) * r1 * 0.75); ctx2.stroke();
      }
      ctx2.globalAlpha = 1;
    }
  }
  // screen shake (after the camera kit at 20, undone at -100 next frame)
  const S = s.shake;
  if (S.trauma > 0 && !game.cameraOverride) {
    S.t += realDt;
    const a = S.trauma * S.trauma * (S.max || 0.9);
    const n = (f, o) => Math.sin(S.t * f + o) * 0.6 + Math.sin(S.t * f * 2.13 + o * 1.7) * 0.4;
    S.offset.set(n(37, 1) * a, n(41, 4) * a * 0.8, n(33, 7) * a * 0.6);
    game.camera.position.add(S.offset); S.applied = true;
    S.trauma = Math.max(0, S.trauma - (S.decay || 1.6) * realDt);
  }
}

// CONTRACT choice list: every effect function name
export const NAMES = ['burst', 'sparkle', 'starBurst', 'dust', 'smoke', 'poof', 'magic', 'splash', 'fire', 'sparkles', 'ring', 'confetti', 'trail', 'text', 'shake', 'flash', 'hitFlash', 'speedLines', 'slowmo'];

// ---------- auto: CONTRACT events -> effects ----------
const TAG_COLORS = { coin: '#ffd23f', gold: '#ffd23f', star: '#fff07a', gem: '#5ef1ff', crystal: '#9d7bff', heart: '#ff5d8f', key: '#ffcf4a', seed: '#9be564', orb: '#7af0ff', ring: '#ffd23f', fruit: '#ff8a4c', flower: '#ff9de2' };
export function auto(game, opts = {}) {
  const s = sys(game);
  if (s.autoOn) return s.autoHandle;
  s.autoOn = true;
  const { shake: shakeOn = true, dust: dustOn = true, text: textOn = true } = opts;
  const feet = (pl) => {
    const p = positionOf(pl && (pl.position || pl.object)) || new THREE.Vector3();
    if (pl && pl.object && pl.__fxFeet == null) { try { const b = new THREE.Box3().setFromObject(pl.object); pl.__fxFeet = Number.isFinite(b.min.y) ? Math.max(0, p.y - b.min.y) : 0; } catch { pl.__fxFeet = 0; } }
    p.y -= (pl && pl.__fxFeet) || 0;
    return p;
  };
  const offs = [];
  const on = (ev, fn) => offs.push(game.on(ev, (...a) => { try { fn(...a); } catch (e) { reportError(e); } }));
  on('collect', (item) => {
    const p = positionOf(item); if (!p) return;
    const tag = item && (item.tag || item.kind || item.type);
    const c = (item && item.color) || TAG_COLORS[tag] || opts.collectColor || '#ffd23f';
    sparkle(game, p, { color: c, scale: item && item.value > 1 ? 1.4 : 1 });
    if (textOn && item && (item.value > 1 || item.points)) text(game, p, `+${item.points || item.value}`, { color: c });
  });
  on('checkpoint', (cp) => {
    const p = positionOf(cp); if (!p) return;
    ring(game, p, { color: '#7dfcff', radius: (cp && cp.radius) ? cp.radius * 1.6 : 5, life: 0.7, opacity: 0.6, width: 0.08 });
    magic(game, p, { color: ['#7dfcff', '#ffffff', '#ffe066'], radius: (cp && cp.radius) || 1.4, height: 4 });
  });
  on('damage', (target, amount) => {
    const o = target && (target.object || target.mesh || target);
    hitFlash(game, o, { color: '#ff3b3b' });
    const p = positionOf(target); if (p) burst(game, p.add(new THREE.Vector3(0, 0.8, 0)), { count: 10, color: ['#ff4040', '#ffffff'], shape: 'spark', speed: 7, size: 0.35, life: 0.35 });
    if (target && (target === opts.player || target.controls || target.type === 'platformer' || target.setInput)) { if (shakeOn) shake(game, 0.45); flash(game, '#ff2a2a', { opacity: 0.32, vignette: true, duration: 0.35 }); }
    else if (shakeOn) shake(game, 0.15);
  });
  on('death', (target) => { const p = positionOf(target); if (p) poof(game, p, { color: '#efe9f2' }); if (shakeOn) shake(game, 0.5); });
  on('respawn', (pl) => { const p = feet(pl); magic(game, p, { color: ['#ffffff', '#9ff3ff'], radius: 0.9, height: 3, count: 26 }); ring(game, p, { color: '#9ff3ff', radius: 2.2, life: 0.5 }); });
  on('jump', (pl) => { if (dustOn) dust(game, feet(pl), { amount: 0.2 }); });
  on('land', (pl, speed) => {
    const sp = Math.abs(+speed || 0);
    if (dustOn && sp > 4) dust(game, feet(pl), { amount: Math.min(1, (sp - 4) / 16) });
    if (shakeOn && sp > 20) shake(game, Math.min(0.35, (sp - 20) / 40));
  });
  on('boost', (pl) => {
    speedLines(game, 0.9, { pulse: 0.9 });
    if (shakeOn) shake(game, 0.18);
    const p = positionOf(pl); if (p) burst(game, p, { count: 16, color: ['#7df9ff', '#ffffff'], shape: 'spark', speed: 8, size: 0.4, life: 0.4, gravity: 0 });
  });
  on('lap', (pl) => { const p = positionOf(pl); if (p) starBurst(game, p.add(new THREE.Vector3(0, 2, 0)), { scale: 0.6, count: 24 }); });
  on('goal', (pl) => { const p = positionOf(pl); if (p) starBurst(game, p.add(new THREE.Vector3(0, 1.5, 0))); });
  on('win', () => { confetti(game); setTimeout(() => confetti(game), 450); flash(game, '#ffffff', { opacity: 0.35, duration: 0.5 }); if (opts.slowmo !== false) slowmo(game, 0.35, 0.9); });
  on('lose', () => { flash(game, '#2a0010', { opacity: 0.55, duration: 0.9, vignette: true }); });
  s.autoHandle = { stop() { offs.forEach(f => f && f()); s.autoOn = false; } };
  return s.autoHandle;
}

export function clear(game) {
  const s = sys(game);
  s.add.count = 0; s.alpha.count = 0;
  if (s.confetti) s.confetti.parts.length = 0;
  for (const e of [...s.emitters]) e.stop();
  for (const t of s.texts) t.el.remove(); s.texts.length = 0;
}
