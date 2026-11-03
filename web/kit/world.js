// world.js: procedural, instanced building blocks that look good in every look. See CONTRACT.md and docs/World.md.
//   World.island / ground / water / foliage / clouds / prop / rocks
// Every piece takes its colours from Look.palette(game) and its materials from Look.material(game, ...).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import * as Look from './look.js';

// ------------------------------------------------------------------------------------------------ helpers
function rng32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seedOf(game, opts) { return opts.seed != null ? opts.seed : Math.floor(game.rand() * 1e9); }
export function v3(p, fallback = [0, 0, 0]) {
  if (p == null) p = fallback;
  if (p.isVector3) return p.clone();
  if (Array.isArray(p)) return new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
  if (typeof p === 'object') return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
  throw new Error(`World: expected a position [x,y,z] or Vector3, got ${JSON.stringify(p)}`);
}
const C = (game, key) => new THREE.Color(Look.palette(game)[key] || key);
function needGame(game, fn) {
  if (!game || !game.scene) throw new Error(`World.${fn}(game, opts): first argument must be the game from createGame()`);
}
function groupFor(game, opts) {
  const parent = opts.parent || game.scene;
  return parent;
}

// colour a (non-indexed) geometry: col is a Color or fn(x,y,z,i) -> Color
function paint(g, col) {
  if (g.index) g = g.toNonIndexed();
  const pos = g.attributes.position, n = pos.count, arr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const cc = typeof col === 'function' ? col(pos.getX(i), pos.getY(i), pos.getZ(i), i, c) : col;
    arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function strip(g) { // keep only position/normal/color so geometries merge
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
function merge(list) {
  const gs = list.map(g => strip(g.index ? g.toNonIndexed() : g));
  for (const g of gs) if (!g.attributes.color) paint(g, new THREE.Color(1, 1, 1));
  const m = mergeGeometries(gs, false);
  return m;
}
// smooth blob: icosahedron displaced by noise, smooth normals
function blob(radius, detail, noise, amp, seedOff = 0, squashY = 1) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amp * noise.noise3d(x * 0.9 + seedOff, y * 0.9, z * 0.9 - seedOff);
    p.setXYZ(i, x * k, y * k * squashY, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function flatRock(radius, noise, amp, seedOff = 0, squashY = 0.7) {
  let g = new THREE.DodecahedronGeometry(radius, 1);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amp * noise.noise3d(x * 0.7 + seedOff, y * 0.7, z * 0.7);
    p.setXYZ(i, x * k, Math.max(y * k * squashY, -radius * 0.25), z * k);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();     // flat facets
  return g;
}
const tr = (g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, sy, sz));
  g.applyMatrix4(m); return g;
};

// ------------------------------------------------------------------------------------------------ colliders
// World pieces create static Rapier colliders directly and push a descriptor into the active sink (level.colliders).
let sink = null;
/** internal: Level.build collects every collider World makes into level.colliders */
export function _collect(arr) { const prev = sink; sink = arr; return prev; }
const WORLD_GROUPS = (1 << 16) | 0xffff;     // physics.js GROUPS.world: member 'world', collides with everything
function record(game, collider, info) {
  if (collider) { try { collider.setCollisionGroups(WORLD_GROUPS); } catch { /* old rapier */ } collider.__kit = { static: true, what: info.what }; }
  const d = { ...info, collider, handle: collider ? collider.handle : null };
  if (sink) sink.push(d);
  (game.kitColliders = game.kitColliders || []).push(d);
  return d;
}
function rapier(game) { return game.RAPIER; }
export function colliderTrimesh(game, geometry, matrix, info = {}) {
  const R = rapier(game);
  if (!R || !game.world) return null;
  const g = geometry.index ? geometry : mergeVertices(geometry.clone().deleteAttribute('normal').deleteAttribute('color') || geometry);
  const pos = g.attributes.position, v = new Float32Array(pos.count * 3), t = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    t.fromBufferAttribute(pos, i); if (matrix) t.applyMatrix4(matrix);
    v[i * 3] = t.x; v[i * 3 + 1] = t.y; v[i * 3 + 2] = t.z;
  }
  const idx = new Uint32Array(g.index.array);
  try {
    const c = game.world.createCollider(R.ColliderDesc.trimesh(v, idx).setFriction(0.8));
    return record(game, c, { type: 'trimesh', ...info });
  } catch (e) { console.warn('[kit] World: trimesh collider failed', e); return null; }
}
export function colliderBox(game, center, half, yaw = 0, info = {}) {
  const R = rapier(game); if (!R || !game.world) return null;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
  const c = game.world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setTranslation(center.x, center.y, center.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.8));
  return record(game, c, { type: 'box', position: center.clone(), half: half.clone(), yaw, ...info });
}
export function colliderBoxQ(game, center, half, quat, info = {}) {
  const R = rapier(game); if (!R || !game.world) return null;
  const c = game.world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setTranslation(center.x, center.y, center.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }).setFriction(0.8));
  return record(game, c, { type: 'box', position: center.clone(), half: half.clone(), ...info });
}
export function colliderCylinder(game, center, halfH, r, info = {}) {
  const R = rapier(game); if (!R || !game.world) return null;
  const c = game.world.createCollider(R.ColliderDesc.cylinder(halfH, r).setTranslation(center.x, center.y, center.z).setFriction(0.8));
  return record(game, c, { type: 'cylinder', position: center.clone(), halfHeight: halfH, radius: r, ...info });
}
export function colliderBall(game, center, r, info = {}) {
  const R = rapier(game); if (!R || !game.world) return null;
  const c = game.world.createCollider(R.ColliderDesc.ball(r).setTranslation(center.x, center.y, center.z).setFriction(0.8));
  return record(game, c, { type: 'ball', position: center.clone(), radius: r, ...info });
}

// registry of walkable surfaces (islands, ground) so foliage/props/water can find heights
function surfaces(game) { return (game._kitSurfaces = game._kitSurfaces || []); }
/** World.heightAt(game, x, z) -> highest kit surface height at (x, z), or null */
export function heightAt(game, x, z) {
  let best = null;
  for (const s of surfaces(game)) { const h = s.heightAt(x, z); if (h != null && (best == null || h > best)) best = h; }
  return best;
}

// ------------------------------------------------------------------------------------------------ island
/**
 * World.island(game, { position=[0,0,0] (centre of the TOP surface), radius=10, depth=radius*0.9, style='floating'|'ground',
 *   bumps=0.35, irregular=0.14, seed, waterfall=false, grassColor, cliffColor }) -> island
 * island: { group, position, radius, topY, heightAt(x,z), radiusAt(angle), contains(x,z,margin), edgePoint(angle) }
 */
export function island(game, opts = {}) {
  needGame(game, 'island');
  const pal = Look.palette(game);
  const pos = v3(opts.position);
  const radius = Math.max(2, opts.radius ?? 10);
  const depth = opts.depth ?? opts.height ?? radius * 0.9;
  const style = opts.style || 'floating';
  if (!['floating', 'ground'].includes(style)) throw new Error(`World.island: unknown style "${style}"; styles: floating, ground`);
  const bumps = opts.bumps ?? 0.35;
  const irregular = opts.irregular ?? 0.14;
  const seed = seedOf(game, opts);
  const rnd = rng32(seed);
  const N = new SimplexNoise({ random: rnd });
  const so = rnd() * 100;

  const radiusAt = (a) => radius * (1 + irregular * (0.65 * N.noise(Math.cos(a) * 1.3 + so, Math.sin(a) * 1.3)
    + 0.35 * N.noise(Math.cos(a) * 3.1 - so, Math.sin(a) * 3.1)));
  const minR = (() => { let m = Infinity; for (let i = 0; i < 64; i++) m = Math.min(m, radiusAt(i / 64 * Math.PI * 2)); return m; })();
  const bump = (x, z) => {         // local coords
    const d = Math.hypot(x, z), a = Math.atan2(z, x), rr = radiusAt(a), t = Math.min(d / rr, 1);
    const n = N.noise(x * 0.09 + so, z * 0.09) * 0.7 + N.noise(x * 0.25, z * 0.25 - so) * 0.3;
    return n * bumps * (1 - t * t * 0.5) - Math.pow(t, 6) * 0.35;
  };

  const SEG = Math.max(40, Math.min(96, Math.round(radius * 4)));
  const RINGS = Math.max(8, Math.min(20, Math.round(radius * 0.9)));
  const grassA = new THREE.Color(opts.grassColor || pal.grass), grassB = new THREE.Color(pal.grass2);
  const dirt = new THREE.Color(pal.ground), dirt2 = new THREE.Color(pal.ground2);
  const cliffA = new THREE.Color(opts.cliffColor || pal.cliff), cliffB = new THREE.Color(pal.cliff2);

  // --- top: polar grid, smooth
  const tv = [], tc = [], ti = [];
  tv.push(0, bump(0, 0), 0);
  const cc = new THREE.Color();
  const topCol = (x, z, t) => {
    const n = N.noise(x * 0.12 + 7, z * 0.12) * 0.5 + 0.5, m = N.noise(x * 0.5, z * 0.5 + 3) * 0.5 + 0.5;
    cc.copy(grassA).lerp(grassB, THREE.MathUtils.smoothstep(n, 0.35, 0.75) * 0.85);
    cc.multiplyScalar(0.92 + 0.12 * m);
    if (t > 0.9) cc.lerp(grassA.clone().multiplyScalar(0.8), (t - 0.9) * 6);
    return cc;
  };
  { const c0 = topCol(0, 0, 0); tc.push(c0.r, c0.g, c0.b); }
  for (let r = 1; r <= RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = s / SEG * Math.PI * 2, t = r / RINGS;
      const rr = radiusAt(a) * t;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      tv.push(x, bump(x, z), z);
      const c = topCol(x, z, t); tc.push(c.r, c.g, c.b);
    }
  }
  for (let s = 0; s < SEG; s++) ti.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let r = 1; r < RINGS; r++) {
    const a0 = 1 + (r - 1) * SEG, a1 = 1 + r * SEG;
    for (let s = 0; s < SEG; s++) {
      const s1 = (s + 1) % SEG;
      ti.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
    }
  }
  const topG = new THREE.BufferGeometry();
  topG.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3));
  topG.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
  topG.setIndex(ti);
  topG.computeVertexNormals();

  // --- sides: rings below the rim (lip, dirt band, rock strata, tip), flat shaded
  const sideRows = [];
  const SR = style === 'floating' ? 9 : 5;
  for (let k = 0; k <= SR; k++) {
    let t = k / SR, scale, y;
    if (k === 0) { scale = 0.985; y = -0.25; }
    else if (k === 1) { scale = 0.97; y = -0.9; }
    else if (style === 'floating') {
      const u = (k - 1) / (SR - 1);
      scale = 0.97 * Math.pow(1 - u, 0.85) * (1 - 0.08 * u) + (k === SR ? 0 : 0.02);
      y = -0.9 - u * depth;
    } else {
      const u = (k - 1) / (SR - 1);
      scale = 0.97 + u * 0.12;
      y = -0.9 - u * depth;
    }
    sideRows.push({ scale, y, t });
  }
  const sv = [], sc = [];
  const SSEG = Math.max(18, Math.round(SEG / 2));
  const rowPts = sideRows.map((row, k) => {
    const pts = [];
    for (let s = 0; s < SSEG; s++) {
      const a = s / SSEG * Math.PI * 2 + (k % 2) * (Math.PI / SSEG) * 0.6;
      const jitter = k > 1 ? 1 + 0.12 * N.noise(a * 2.3 + k * 1.7, k * 0.9 + so) : 1;
      const rr = radiusAt(a) * row.scale * jitter;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const yy = (k === 0 ? bump(x / row.scale, z / row.scale) : 0) + row.y + (k > 1 && k < SR ? N.noise(a * 3 + 9, k) * 0.6 : 0);
      pts.push(new THREE.Vector3(x, yy, z));
    }
    return pts;
  });
  const tipY = style === 'floating' ? -0.9 - depth * (1.05 + rnd() * 0.15) : null;
  const sideColor = (y) => {
    if (y > -1.2) return dirt;
    const u = THREE.MathUtils.clamp((-y - 1.2) / Math.max(depth, 1), 0, 1);
    const band = Math.sin(y * 1.3 + so) > 0.25 ? cliffA : cliffB;
    return cc.copy(band).lerp(cliffB.clone().multiplyScalar(0.7), u * 0.6);
  };
  const pushTri = (a, b, c) => {
    sv.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const col = sideColor((a.y + b.y + c.y) / 3);
    for (let i = 0; i < 3; i++) sc.push(col.r, col.g, col.b);
  };
  for (let k = 0; k < rowPts.length - 1; k++) {
    const A = rowPts[k], B = rowPts[k + 1];
    for (let s = 0; s < SSEG; s++) {
      const s1 = (s + 1) % SSEG;
      pushTri(A[s], B[s], A[s1]);
      pushTri(A[s1], B[s], B[s1]);
    }
  }
  const last = rowPts[rowPts.length - 1];
  if (style === 'floating') {
    const tip = new THREE.Vector3((rnd() - 0.5) * radius * 0.2, tipY, (rnd() - 0.5) * radius * 0.2);
    for (let s = 0; s < SSEG; s++) pushTri(last[s], tip, last[(s + 1) % SSEG]);
  }
  const sideG = new THREE.BufferGeometry();
  sideG.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
  sideG.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  sideG.computeVertexNormals();

  const group = new THREE.Group(); group.name = 'kit:island';
  group.position.copy(pos);
  const top = new THREE.Mesh(topG, Look.material(game, { color: '#ffffff', vertexColors: true, rim: 0.4 }));
  const sides = new THREE.Mesh(sideG, Look.material(game, { color: '#ffffff', vertexColors: true, flat: true, rim: 0.7 }));
  top.receiveShadow = true; top.castShadow = true;
  sides.receiveShadow = true; sides.castShadow = true;
  group.add(top, sides);

  // hanging rocks / small boulders on the rim for silhouette
  if (style === 'floating') {
    const rk = [];
    const nR = Math.round(radius * 0.4);
    for (let i = 0; i < nR; i++) {
      const a = rnd() * Math.PI * 2, rr = radiusAt(a) * (0.55 + rnd() * 0.25);
      const g = flatRock(0.6 + rnd() * radius * 0.08, N, 0.25, i);
      tr(g, Math.cos(a) * rr, -depth * (0.55 + rnd() * 0.35), Math.sin(a) * rr, rnd(), rnd() * 6, rnd());
      rk.push(paint(g, cliffB));
    }
    if (rk.length) {
      const m = new THREE.Mesh(merge(rk), Look.material(game, { color: '#ffffff', vertexColors: true, flat: true }));
      m.castShadow = true; group.add(m);
    }
  }
  (opts.parent || game.scene).add(group);
  group.updateMatrixWorld(true);

  const colliders = [];
  if (opts.collider !== false) {
    const cg = mergeGeometries([strip(topG.clone().toNonIndexed()), strip(sideG.clone())]);
    cg.deleteAttribute('normal'); cg.deleteAttribute('color');
    const ci = colliderTrimesh(game, mergeVertices(cg), group.matrixWorld, { what: 'island' });
    if (ci) colliders.push(ci);
  }

  const isl = {
    kind: 'island', group, top, sides, position: pos.clone(), radius, minRadius: minR, topY: pos.y, depth, style, colliders,
    radiusAt,
    heightAt(x, z) {
      const lx = x - pos.x, lz = z - pos.z, d = Math.hypot(lx, lz);
      if (d > radiusAt(Math.atan2(lz, lx)) * 0.995) return null;
      return pos.y + bump(lx, lz);
    },
    contains(x, z, margin = 0) {
      const lx = x - pos.x, lz = z - pos.z;
      return Math.hypot(lx, lz) <= radiusAt(Math.atan2(lz, lx)) - margin;
    },
    /** point on the walkable top at angle a, `inset` units inside the rim */
    edgePoint(a, inset = 1.2) {
      const rr = radiusAt(a) - inset, x = pos.x + Math.cos(a) * rr, z = pos.z + Math.sin(a) * rr;
      return new THREE.Vector3(x, pos.y + bump(x - pos.x, z - pos.z), z);
    },
    surfacePoint(x, z) { const h = isl.heightAt(x, z); return new THREE.Vector3(x, h == null ? pos.y : h, z); },
  };
  surfaces(game).push(isl);
  if (opts.waterfall) waterfall(game, isl, typeof opts.waterfall === 'object' ? opts.waterfall : {});
  return isl;
}

// a stylised waterfall pouring off an island rim (scrolling strip + foam + mist at the top)
function waterfall(game, isl, opts = {}) {
  const pal = Look.palette(game);
  const a = opts.angle ?? (isl.position.x * 0.37 + isl.position.z * 0.11);
  const len = opts.length ?? Math.max(isl.depth * 2.4, 14);
  const width = opts.width ?? Math.min(3.2, isl.radius * 0.3);
  const e = isl.edgePoint(a, -0.2);
  const g = new THREE.PlaneGeometry(width, len, 1, 24);
  g.translate(0, -len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = THREE.MathUtils.clamp(-p.getY(i) / len, 0, 1);   // 0 top .. 1 bottom
    p.setZ(i, Math.pow(y, 0.6) * 2.2 + y * 0.6);
    p.setX(i, p.getX(i) * (1 + y * 0.8));
  }
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      c1: { value: new THREE.Color(pal.water) }, c2: { value: new THREE.Color(pal.foam) } }]),
    vertexShader: `varying vec2 vUv; #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`
      .replace(/#include <fog_pars_vertex>/, '\n#include <fog_pars_vertex>\n').replace(/#include <fog_vertex>/, '\n#include <fog_vertex>\n'),
    fragmentShader: `uniform vec3 c1; uniform vec3 c2; uniform float uTime; varying vec2 vUv;
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec2 q = vec2(vUv.x * 6.0, vUv.y * 9.0 + uTime * 3.2);
        float s = n(q) * 0.6 + n(q * 2.3) * 0.4;
        float streak = smoothstep(0.55, 0.75, s);
        vec3 col = mix(c1 * 1.1, c2 * 1.3, streak);
        col = mix(col, c2 * 1.4, smoothstep(0.85, 1.0, vUv.y) * 0.8);
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float a = edge * smoothstep(0.0, 0.25, vUv.y) * 0.92;
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = Look.uniforms.uTime;
  const m = new THREE.Mesh(g, mat);
  m.position.copy(e).add(new THREE.Vector3(0, 0.15, 0));
  m.lookAt(e.x + Math.cos(a) * 10, e.y + 0.15, e.z + Math.sin(a) * 10);
  m.rotateY(Math.PI);
  m.renderOrder = 2;
  (opts.parent || game.scene).add(m);
  // foam lip
  const foam = new THREE.Mesh(blob(width * 0.45, 1, new SimplexNoise(), 0.3, 1, 0.5),
    Look.material(game, { color: pal.foam, emissive: pal.foam, emissiveIntensity: 0.25 }));
  foam.position.copy(e).add(new THREE.Vector3(Math.cos(a) * 0.6, 0.0, Math.sin(a) * 0.6));
  (opts.parent || game.scene).add(foam);
  return m;
}

// ------------------------------------------------------------------------------------------------ ground
/**
 * World.ground(game, { size=240, center=[0,0,0], style='grass'|'sand'|'snow'|'dirt'|'cobble', flat=size*0.32 (radius kept flat),
 *   hills=10 (height of the rim hills that frame the level), bumps=0.4, seed, color }) -> ground {mesh, heightAt(x,z)}
 */
export function ground(game, opts = {}) {
  needGame(game, 'ground');
  const pal = Look.palette(game);
  const size = opts.size ?? 240;
  const center = v3(opts.center);
  const style = opts.style || 'grass';
  const STYLES = ['grass', 'sand', 'snow', 'dirt', 'cobble'];
  if (!STYLES.includes(style)) throw new Error(`World.ground: unknown style "${style}"; styles: ${STYLES.join(', ')}`);
  const flat = opts.flat ?? size * 0.32;
  const hills = opts.hills ?? 10;
  const bumps = opts.bumps ?? 0.4;
  const seed = seedOf(game, opts);
  const N = new SimplexNoise({ random: rng32(seed) });
  const flatFn = opts.flatAt || null;                     // optional fn(x,z) -> 0..1 how flat to keep
  const h = (x, z) => {
    const lx = x - center.x, lz = z - center.z, d = Math.hypot(lx, lz);
    const rim = THREE.MathUtils.smoothstep(d, flat, size * 0.5) ;
    let y = N.noise(lx * 0.03, lz * 0.03) * bumps + N.noise(lx * 0.11, lz * 0.11) * bumps * 0.35;
    y += rim * rim * hills * (0.7 + 0.6 * (N.noise(lx * 0.015 + 4, lz * 0.015) * 0.5 + 0.5));
    if (flatFn) y *= 1 - flatFn(x, z);
    if (opts.height) y = opts.height(x, z, y);
    return center.y + y;
  };
  const SEG = opts.segments ?? Math.min(200, Math.round(size / 1.6));
  const g = new THREE.PlaneGeometry(size, size, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const base = {
    grass: [pal.grass, pal.grass2], sand: [pal.sand, pal.ground], snow: [pal.snow, pal.grass2],
    dirt: [pal.ground, pal.ground2], cobble: [pal.stone, pal.ground],
  }[style];
  const A = new THREE.Color(opts.color || base[0]), B = new THREE.Color(base[1]);
  const dirtC = new THREE.Color(pal.ground), cliffC = new THREE.Color(pal.cliff);
  const cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + center.x, z = p.getZ(i) + center.z;
    const y = h(x, z);
    p.setY(i, y - center.y);
    const n = N.noise(x * 0.05 + 11, z * 0.05) * 0.5 + 0.5, m = N.noise(x * 0.4, z * 0.4) * 0.5 + 0.5;
    c.copy(A).lerp(B, THREE.MathUtils.smoothstep(n, 0.3, 0.8) * 0.8).multiplyScalar(0.93 + 0.1 * m);
    if (opts.paint) opts.paint(x, z, c);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  // steep slopes read as rock / dirt
  const nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const ny = nrm.getY(i);
    if (ny < 0.8) {
      c.fromArray(cols, i * 3).lerp(ny < 0.62 ? cliffC : dirtC, THREE.MathUtils.smoothstep(0.8 - ny, 0, 0.25) * 0.7);
      cols.set([c.r, c.g, c.b], i * 3);
    }
  }
  const mesh = new THREE.Mesh(g, Look.material(game, { color: '#ffffff', vertexColors: true, rim: 0.15 }));
  mesh.position.copy(center); mesh.receiveShadow = true; mesh.name = 'kit:ground';
  (opts.parent || game.scene).add(mesh);
  mesh.updateMatrixWorld(true);
  if (opts.collider !== false) colliderTrimesh(game, g, mesh.matrixWorld, { what: 'ground' });
  const half = size / 2;
  const gr = {
    kind: 'ground', mesh, size, center,
    heightAt(x, z) { if (Math.abs(x - center.x) > half || Math.abs(z - center.z) > half) return null; return h(x, z); },
  };
  surfaces(game).push(gr);
  return gr;
}

// ------------------------------------------------------------------------------------------------ plaza
/**
 * World.plaza(game, { center=[0,0,0] (floor height = center.y), radius=20, ring=2.4 (tile ring width), tile=2.6,
 *   color='stone', trim='primary' (one ring of coloured tiles), emblem='accent' (centre star), trimAt=0.62 }) -> {mesh, y}
 * A crisp round tiled floor (arenas, town squares, goal pads), with a collider.
 */
export function plaza(game, opts = {}) {
  needGame(game, 'plaza');
  const c = v3(opts.center), R = opts.radius ?? 20, rw = opts.ring ?? 2.4, tw = opts.tile ?? 2.6;
  const rnd = rng32(seedOf(game, opts));
  const base = C(game, opts.color || 'stone'), trim = C(game, opts.trim || 'primary'), emb = C(game, opts.emblem || 'accent');
  const grout = base.clone().multiplyScalar(0.55);
  const v = [], col = [];
  const quad = (a, b, cc, d, k) => { for (const p of [a, b, cc, a, cc, d]) { v.push(p[0], p[1], p[2]); col.push(k.r, k.g, k.b); } };
  const y = 0.1;
  const P = (r, a, yy = y) => [Math.cos(a) * r, yy, Math.sin(a) * r];
  // grout base disc
  const SEG = 64;
  for (let i = 0; i < SEG; i++) { const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2; quad(P(0, 0, 0.06), P(R + 0.3, a1, 0.06), P(R + 0.3, a0, 0.06), P(0, 0, 0.06), grout); }
  const rings = Math.ceil(R / rw);
  const trimRing = Math.round(R * (opts.trimAt ?? 0.62) / rw);
  for (let k = 0; k < rings; k++) {
    const r0 = k * rw + (k === 0 ? 0 : 0.06), r1 = Math.min(R, (k + 1) * rw) - 0.06;
    const n = k === 0 ? 8 : Math.max(8, Math.round(2 * Math.PI * (r0 + r1) / 2 / tw));
    const off = (k % 2) * Math.PI / n;
    for (let i = 0; i < n; i++) {
      const g0 = 0.06 / Math.max(r0, 0.5), g1 = 0.06 / r1;
      const a0 = off + i / n * Math.PI * 2, a1 = off + (i + 1) / n * Math.PI * 2;
      let k2 = base.clone().multiplyScalar(0.9 + rnd() * 0.16);
      if (k === trimRing) k2 = trim.clone().multiplyScalar(0.92 + rnd() * 0.1);
      if (k === 0) k2 = (i % 2 ? emb : base).clone().multiplyScalar(0.95 + rnd() * 0.08);
      if (k === 1 && i % 2 === 0) k2 = emb.clone().lerp(base, 0.45);
      const am = (a0 + a1) / 2;
      quad(P(r0, a0 + g0), P(r1, a0 + g1), P(r1, am), P(r0, am), k2);
      quad(P(r0, am), P(r1, am), P(r1, a1 - g1), P(r0, a1 - g0), k2);
    }
  }
  // kerb ring
  for (let i = 0; i < SEG; i++) {
    const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2, k2 = base.clone().multiplyScalar(0.78);
    quad(P(R + 0.3, a0, 0.25), P(R + 0.3, a1, 0.25), P(R + 1.1, a1, 0.25), P(R + 1.1, a0, 0.25), k2);
    quad(P(R + 1.1, a0, 0.25), P(R + 1.1, a1, 0.25), P(R + 1.1, a1, -0.4), P(R + 1.1, a0, -0.4), k2.clone().multiplyScalar(0.85));
    quad(P(R + 0.3, a1, 0.25), P(R + 0.3, a0, 0.25), P(R + 0.3, a0, 0.06), P(R + 0.3, a1, 0.06), k2.clone().multiplyScalar(0.85));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // all quads were emitted clockwise from above for the floor; fix winding so faces point up
  const pa = g.attributes.position.array;
  for (let i = 0; i < pa.length; i += 9) {
    const ax = pa[i], az = pa[i + 2], bx = pa[i + 3], bz = pa[i + 5], cx = pa[i + 6], cz = pa[i + 8];
    const ay = pa[i + 1], by = pa[i + 4], cy = pa[i + 7];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const flat = Math.abs(ay - by) < 1e-4 && Math.abs(ay - cy) < 1e-4;
    if (flat && ny < 0) { for (let k = 0; k < 3; k++) { const t = pa[i + 3 + k]; pa[i + 3 + k] = pa[i + 6 + k]; pa[i + 6 + k] = t; } }
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, Look.material(game, { color: '#ffffff', vertexColors: true, rim: 0, side: 'double' }));
  mesh.position.copy(c); mesh.receiveShadow = true; mesh.name = 'kit:plaza';
  (opts.parent || game.scene).add(mesh);
  if (opts.collider !== false) colliderCylinder(game, new THREE.Vector3(c.x, c.y + 0.1 - 0.3, c.z), 0.3, R + 1.1, { what: 'plaza' });
  const pz = { kind: 'plaza', mesh, y: c.y + y, heightAt(x, z) { return Math.hypot(x - c.x, z - c.z) <= R + 1.1 ? c.y + y : null; } };
  surfaces(game).push(pz);
  return pz;
}

// ------------------------------------------------------------------------------------------------ water
/**
 * World.water(game, { level=0, size=600, center=[0,0,0], color, deep, waves=0.25, opacity=1 }) -> water {mesh, level}
 * Foam and shallow colour come from the kit surfaces (islands, ground) intersecting the water plane automatically.
 */
export function water(game, opts = {}) {
  needGame(game, 'water');
  const pal = Look.palette(game);
  const level = opts.level ?? 0;
  const size = opts.size ?? 600;
  const center = v3(opts.center);
  const waves = opts.waves ?? 0.25;
  // depth map: sample every surface below the plane once
  const RES = 256, data = new Uint8Array(RES * RES * 4);
  const shore = 1.6;
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const x = center.x + (i / (RES - 1) - 0.5) * size, z = center.z + (j / (RES - 1) - 0.5) * size;
    const hh = heightAt(game, x, z);
    const d = hh == null ? 99 : level - hh;            // depth below water; negative = land
    const v = THREE.MathUtils.clamp(d / shore, -1, 1) * 0.5 + 0.5;
    const k = (j * RES + i) * 4; data[k] = Math.round(v * 255); data[k + 1] = 0; data[k + 2] = 0; data[k + 3] = 255;
  }
  const depthTex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat);
  depthTex.minFilter = depthTex.magFilter = THREE.LinearFilter; depthTex.needsUpdate = true;

  const g = new THREE.PlaneGeometry(size, size, 160, 160);
  g.rotateX(-Math.PI / 2);
  const night = Look.isNight(game);
  const mat = new THREE.ShaderMaterial({
    fog: true, lights: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      shallow: { value: new THREE.Color(opts.color || pal.water) },
      deep: { value: new THREE.Color(opts.deep || pal.waterDeep) },
      foam: { value: new THREE.Color(pal.foam) },
      sky: { value: new THREE.Color(Look.preset(game.look ? game.look.name : 'toon_bright').sky.horizon) },
      tDepth: { value: depthTex }, size: { value: size }, center: { value: new THREE.Vector2(center.x, center.z) },
      waves: { value: waves }, foamGlow: { value: night ? 1.25 : 1.1 },
    }]),
    vertexShader: `
      uniform float uTime; uniform float waves; varying vec3 vW; varying float vH;
      #include <fog_pars_vertex>
      void main(){
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        float hgt = sin(w.x * 0.15 + uTime * 1.1) * cos(w.z * 0.12 + uTime * 0.9) + 0.5 * sin((w.x + w.z) * 0.31 + uTime * 1.7);
        p.y += hgt * waves; vH = hgt;
        w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 shallow; uniform vec3 deep; uniform vec3 foam; uniform vec3 sky; uniform sampler2D tDepth;
      uniform float size; uniform vec2 center; uniform float uTime; uniform float foamGlow; uniform vec3 uSunDir;
      varying vec3 vW; varying float vH;
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      vec2 cell(vec2 p){ vec2 i = floor(p), f = fract(p); float md = 8.0, md2 = 8.0;
        for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ vec2 g = vec2(x,y); vec2 o = vec2(h(i+g), h(i+g+17.0));
          o = 0.5 + 0.45 * sin(uTime * 0.6 + 6.2831 * o); float d = length(g + o - f);
          if (d < md) { md2 = md; md = d; } else if (d < md2) md2 = d; }
        return vec2(md, md2); }
      void main(){
        vec2 uv = (vW.xz - center) / size + 0.5;
        float dv = texture2D(tDepth, uv).r * 2.0 - 1.0;       // -1 land .. 0 shore .. 1 deep(>=3u)
        float depth = clamp(dv, 0.0, 1.0);
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
        vec3 col = mix(shallow, deep, smoothstep(0.0, 1.0, depth) * 0.75 + 0.25);
        col = mix(col, sky, fres * 0.45);
        // toon caustic web
        vec2 c = cell(vW.xz * 0.32);
        float web = smoothstep(0.06, 0.0, c.y - c.x) * smoothstep(0.0, 0.4, depth);
        col += foam * web * 0.13 * (1.0 - fres);
        // sun glints
        vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
        float sp = pow(max(dot(R, normalize(uSunDir)), 0.0), 180.0);
        float spark = step(0.6, n(vW.xz * 1.3 + uTime * 0.7)) * sp;
        col += vec3(1.0) * (sp * 1.2 + spark * 2.5);
        // shore foam: bands that breathe along the shoreline
        float fn = n(vW.xz * 0.6 + vec2(uTime * 0.25, 0.0));
        float sh = 1.0 - smoothstep(0.0, 0.45, depth + (fn - 0.5) * 0.18);
        float band = smoothstep(0.06, 0.0, abs(depth - (0.3 + 0.12 * sin(uTime * 1.3 + fn * 3.0)))) * smoothstep(0.7, 0.2, depth);
        float f = max(step(0.55, sh), band * step(0.4, fn));
        col = mix(col, foam * foamGlow, f);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = Look.uniforms.uTime;
  mat.uniforms.uSunDir = Look.uniforms.uSunDir;
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(center.x, level, center.z);
  mesh.name = 'kit:water'; mesh.receiveShadow = false;
  (opts.parent || game.scene).add(mesh);
  return { kind: 'water', mesh, level, size };
}

// ------------------------------------------------------------------------------------------------ foliage
// each kind -> parts [{geom (with colour), mat (Look.material opts)}], plus collider + placement hints
const FOLIAGE = {
  grass:        { density: 1.1, max: 26000, cluster: 0, scale: [0.7, 1.2], wind: 0.22, shadow: false, spacing: 0 },
  grass_dry:    { density: 0.28, scale: [0.8, 1.4], wind: 0.2, shadow: false, spacing: 0 },
  grass_snow:   { density: 0.2, scale: [0.6, 1.0], wind: 0.15, shadow: false, spacing: 0 },
  flowers:      { density: 0.12, max: 6000, scale: [0.8, 1.3], wind: 0.25, shadow: false, spacing: 0 },
  flowers_glow: { density: 0.1, max: 5000, scale: [0.8, 1.3], wind: 0.25, shadow: false, spacing: 0 },
  bush:         { density: 0.02, max: 1200, scale: [0.8, 1.5], wind: 0.015, shadow: true, spacing: 1.6 },
  bush_snow:    { density: 0.02, max: 1200, scale: [0.8, 1.5], wind: 0.01, shadow: true, spacing: 1.6 },
  tree_round:   { density: 0.007, max: 900, scale: [0.85, 1.35], wind: 0.004, shadow: true, spacing: 4, collider: 'trunk' },
  tree_pine:    { density: 0.007, max: 900, scale: [0.85, 1.4], wind: 0.003, shadow: true, spacing: 3.5, collider: 'trunk' },
  tree_pine_snow:{ density: 0.008, max: 900, scale: [0.85, 1.4], wind: 0.003, shadow: true, spacing: 3.5, collider: 'trunk' },
  tree_dead:    { density: 0.004, scale: [0.9, 1.4], wind: 0.002, shadow: true, spacing: 4, collider: 'trunk' },
  palm:         { density: 0.004, scale: [0.9, 1.3], wind: 0.004, shadow: true, spacing: 4, collider: 'trunk' },
  cactus:       { density: 0.005, scale: [0.8, 1.3], wind: 0, shadow: true, spacing: 3.5, collider: 'trunk' },
  cactus_small: { density: 0.015, scale: [0.7, 1.2], wind: 0, shadow: true, spacing: 1.5 },
  mushroom:     { density: 0.02, max: 3000, scale: [0.6, 1.4], wind: 0, shadow: true, spacing: 0.8 },
  mushroom_glow:{ density: 0.025, max: 3000, scale: [0.6, 1.5], wind: 0, shadow: true, spacing: 0.8 },
  rock:         { density: 0.008, max: 1200, scale: [0.6, 1.6], wind: 0, shadow: true, spacing: 2, collider: 'rock' },
  rock_small:   { density: 0.03, max: 4000, scale: [0.5, 1.2], wind: 0, shadow: true, spacing: 0.6 },
  crystal:      { density: 0.006, scale: [0.7, 1.5], wind: 0, shadow: true, spacing: 2, collider: 'rock' },
};
export const foliageKinds = Object.keys(FOLIAGE);
/** generic kinds a game should ask for (each look remaps them, e.g. desert tree_round -> cactus) */
export const FOLIAGE_KINDS = ['grass', 'flowers', 'bush', 'tree_round', 'tree_pine', 'mushroom', 'rock', 'crystal', 'palm', 'cactus', 'tree_dead'];
const partCache = new Map();

function foliageParts(game, kind) {
  const key = kind + ':' + (game.look ? game.look.name : '');
  if (partCache.has(key)) return partCache.get(key);
  const pal = Look.palette(game);
  const N = new SimplexNoise({ random: rng32(kind.length * 977) });
  const col = (k) => new THREE.Color(pal[k] || k);
  const vc = { color: '#ffffff', vertexColors: true };
  let parts;
  const bladeClump = (n, h0, h1, cBase, cTip, w = 0.11) => {
    const gs = [], r = rng32(n * 31 + Math.round(h1 * 10));
    for (let i = 0; i < n; i++) {
      const hgt = h0 + r() * (h1 - h0), a = r() * Math.PI * 2, off = r() * 0.25;
      const lean = 0.25 + r() * 0.35;
      const g = new THREE.BufferGeometry();
      const ww = w * (0.8 + r() * 0.5);
      const v = [-ww, 0, 0, ww, 0, 0, -ww * 0.6, hgt * 0.55, lean * 0.4, ww * 0.6, hgt * 0.55, lean * 0.4, 0, hgt, lean];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
      tr(g, Math.cos(a) * off, 0, Math.sin(a) * off, 0, a, 0);
      const gn = g.toNonIndexed();
      const nrm = new Float32Array(gn.attributes.position.count * 3);
      for (let k = 0; k < nrm.length; k += 3) { nrm[k + 1] = 1; }
      gn.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      paint(gn, (x, y) => new THREE.Color().copy(cBase).lerp(cTip, Math.min(1, y / hgt)));
      gs.push(gn);
    }
    return merge(gs);
  };
  const upNormals = (g) => { const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); return g; };
  switch (kind) {
    case 'grass': parts = [{ geom: bladeClump(6, 0.28, 0.6, col('grass').multiplyScalar(0.55), col('grass2').multiplyScalar(1.1)), mat: { ...vc, side: 'double', rim: 0 } }]; break;
    case 'grass_dry': parts = [{ geom: bladeClump(5, 0.25, 0.55, col('ground2'), col('sand').multiplyScalar(1.1), 0.07), mat: { ...vc, side: 'double', rim: 0 } }]; break;
    case 'grass_snow': parts = [{ geom: bladeClump(5, 0.3, 0.6, col('foliage'), col('snow'), 0.08), mat: { ...vc, side: 'double', rim: 0 } }]; break;
    case 'flowers': case 'flowers_glow': {
      const stems = bladeClump(3, 0.35, 0.55, col('foliage').multiplyScalar(0.6), col('grass2'), 0.05);
      const heads = [];
      const cs = [col('flower'), col('flower2'), new THREE.Color('#ffffff')];
      for (let i = 0; i < 3; i++) {
        const g = new THREE.OctahedronGeometry(0.12, 0); g.scale(1, 0.55, 1);
        const a = i * 2.1;
        tr(g, Math.cos(a) * 0.18, 0.5 + i * 0.07, Math.sin(a) * 0.18, 0, a, 0);
        heads.push(upNormals(paint(g, cs[i])));
      }
      parts = [{ geom: stems, mat: { ...vc, side: 'double', rim: 0 } },
        { geom: merge(heads), mat: kind === 'flowers_glow' ? { ...vc, kind: 'emissive', emissive: pal.flower, emissiveIntensity: 1.1 } : { ...vc, rim: 0.6 } }];
      break;
    }
    case 'bush': case 'bush_snow': {
      const gs = [];
      for (let i = 0; i < 3; i++) {
        const g = blob(0.7 - i * 0.12, 1, N, 0.2, i * 3);
        tr(g, (i - 1) * 0.55, 0.45 + (i === 1 ? 0.2 : 0), (i % 2) * 0.3);
        gs.push(paint(g, (x, y) => kind === 'bush_snow' && y > 0.7 ? col('snow') : col(i === 1 ? 'foliage' : 'foliage').multiplyScalar(0.85 + 0.2 * (y / 1.2))));
      }
      parts = [{ geom: merge(gs), mat: { ...vc, rim: 0.7 } }];
      break;
    }
    case 'tree_round': {
      const trunk = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 7, 3); tr(trunk, 0, 1.6, 0);
      const tp = trunk.attributes.position;
      for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 0.9) * 0.12); }
      trunk.computeVertexNormals();
      const leaves = [];
      const blobs = [[0, 4.0, 0, 1.65], [0.95, 3.45, 0.3, 1.15], [-0.85, 3.55, -0.4, 1.2]];
      blobs.forEach(([x, y, z, r], i) => {
        const g = blob(r, 1, N, 0.18, i * 5);
        tr(g, x, y, z);
        leaves.push(paint(g, (px, py) => col('foliage').lerp(col('foliage2'), THREE.MathUtils.clamp((py - 2.8) / 2.6, 0, 1) * 0.55)));
      });
      parts = [{ geom: merge([paint(trunk, col('trunk'))]), mat: { ...vc, flat: true } }, { geom: merge(leaves), mat: { ...vc, rim: 0.8 } }];
      break;
    }
    case 'tree_pine': case 'tree_pine_snow': {
      const trunk = new THREE.CylinderGeometry(0.16, 0.3, 1.6, 6); tr(trunk, 0, 0.8, 0);
      const cones = [];
      const L = [[1.6, 2.2, 1.2], [1.25, 2.0, 2.4], [0.9, 1.7, 3.5], [0.55, 1.3, 4.5]];
      L.forEach(([r, h, y], i) => {
        const g = new THREE.ConeGeometry(r, h, 8, 1); tr(g, 0, y + h / 2 - 0.3, 0, 0, i * 0.4, 0);
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) if (p.getY(k) < y) { p.setY(k, p.getY(k) - 0.15 * Math.sin(k * 2.7)); }
        g.computeVertexNormals();
        cones.push(paint(g, (x, py) => {
          const c = col('foliage').multiplyScalar(0.75).lerp(col('foliage2'), (py - y) / h * 0.4);
          if (kind === 'tree_pine_snow' && py > y + h * 0.42 - 0.3) return col('snow');
          return c;
        }));
      });
      parts = [{ geom: merge([paint(trunk, col('trunk'))]), mat: { ...vc, flat: true } }, { geom: merge(cones), mat: { ...vc, flat: true, rim: 0.8 } }];
      break;
    }
    case 'tree_dead': {
      const gs = [];
      const t = new THREE.CylinderGeometry(0.14, 0.4, 3.6, 6, 4); tr(t, 0, 1.8, 0);
      const tp = t.attributes.position; for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 1.3) * 0.25); }
      gs.push(t);
      [[0.9, 2.6, 0.9], [-0.8, 3.0, -0.7], [0.4, 3.4, -0.9]].forEach(([x, y, rz], i) => {
        const b = new THREE.CylinderGeometry(0.05, 0.12, 1.6, 5); tr(b, x * 0.5, y, 0, 0, i * 2, rz); gs.push(b);
      });
      parts = [{ geom: merge(gs.map(g => paint(g, col('trunk').multiplyScalar(0.8)))), mat: { ...vc, flat: true, rim: 1 } }];
      break;
    }
    case 'palm': {
      const segs = [];
      for (let i = 0; i < 6; i++) {
        const g = new THREE.CylinderGeometry(0.2, 0.26, 0.85, 7); tr(g, Math.pow(i / 6, 2) * 1.1, 0.42 + i * 0.8, 0, 0, 0, -0.08 * i);
        segs.push(paint(g, col('trunk').multiplyScalar(i % 2 ? 1 : 0.85)));
      }
      const fr = [];
      for (let i = 0; i < 7; i++) {
        const g = new THREE.PlaneGeometry(0.8, 2.8, 1, 4); g.translate(0, 1.4, 0);
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, -y * y * 0.12); p.setX(k, p.getX(k) * (1 - y / 3.2)); }
        tr(g, 1.1, 5.0, 0, -1.1, i / 7 * Math.PI * 2, 0);
        fr.push(paint(g, (x, y) => col('foliage').lerp(col('foliage2'), 0.3)));
      }
      parts = [{ geom: merge(segs), mat: { ...vc, flat: true } }, { geom: merge(fr), mat: { ...vc, side: 'double', rim: 0.5 } }];
      break;
    }
    case 'cactus': {
      const gs = [];
      const body = new THREE.CapsuleGeometry(0.42, 3.0, 4, 8); tr(body, 0, 1.9, 0); gs.push(body);
      const arm = (side, y, h) => {
        const a = new THREE.CapsuleGeometry(0.26, 0.6, 3, 8); tr(a, side * 0.6, y, 0, 0, 0, Math.PI / 2); gs.push(a);
        const b = new THREE.CapsuleGeometry(0.26, h, 3, 8); tr(b, side * 0.95, y + h / 2, 0); gs.push(b);
      };
      arm(1, 1.7, 1.1); arm(-1, 2.3, 0.8);
      parts = [{ geom: merge(gs.map(g => paint(g, (x, y, z) => col('foliage').multiplyScalar(0.85 + 0.3 * Math.abs(Math.sin(Math.atan2(z, x) * 4)))))), mat: { ...vc, rim: 0.6 } }];
      break;
    }
    case 'cactus_small': {
      const b = blob(0.45, 1, N, 0.08, 2, 0.9); tr(b, 0, 0.38, 0);
      const f = new THREE.IcosahedronGeometry(0.13, 0); tr(f, 0, 0.82, 0);
      parts = [{ geom: merge([paint(b, col('foliage2')), paint(f, col('flower'))]), mat: { ...vc, rim: 0.6 } }];
      break;
    }
    case 'mushroom': case 'mushroom_glow': {
      const stem = new THREE.CylinderGeometry(0.12, 0.18, 0.7, 7); tr(stem, 0, 0.35, 0);
      const cap = new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); tr(cap, 0, 0.62, 0, 0, 0, 0, 1, 0.75, 1);
      const spotsC = new THREE.Color('#ffffff');
      const capCol = kind === 'mushroom_glow' ? col('accent') : col('primary');
      const capP = paint(cap, (x, y, z) => (Math.sin(x * 14) * Math.sin(z * 14) > 0.55 ? spotsC : capCol));
      parts = [{ geom: merge([paint(stem, new THREE.Color('#f4ead8'))]), mat: vc },
        { geom: merge([capP]), mat: kind === 'mushroom_glow' ? { ...vc, kind: 'emissive', emissive: pal.accent, emissiveIntensity: 0.9 } : { ...vc, rim: 0.7 } }];
      break;
    }
    case 'rock': case 'rock_small': {
      const g = flatRock(kind === 'rock' ? 1.0 : 0.35, N, 0.3, 3, 0.65); tr(g, 0, kind === 'rock' ? 0.25 : 0.08, 0);
      parts = [{ geom: merge([paint(g, (x, y) => col('stone').lerp(col('cliff2'), THREE.MathUtils.clamp(0.5 - y, 0, 1) * 0.5))]), mat: { ...vc, flat: true, rim: 0.6 } }];
      break;
    }
    case 'crystal': {
      const gs = [];
      [[0, 0, 0, 1.4, 0], [0.45, 0, 0.2, 0.9, 0.4], [-0.35, 0, -0.25, 1.0, -0.35], [0.1, 0, -0.45, 0.7, 0.2]].forEach(([x, y, z, h, lean], i) => {
        const g = new THREE.OctahedronGeometry(0.32, 0); g.scale(1, h * 2.2, 1); tr(g, x, h * 0.6, z, lean, i, lean * 0.6);
        gs.push(g);
      });
      parts = [{ geom: merge(gs.map(g => paint(g, col('accent')))), mat: { ...vc, kind: 'emissive', emissive: pal.accent, emissiveIntensity: 1.2, flat: true } }];
      break;
    }
    default: throw new Error(`World.foliage: unknown kind "${kind}"; kinds: ${Object.keys(FOLIAGE).join(', ')}`);
  }
  partCache.set(key, parts);
  return parts;
}

/**
 * World.foliage(game, { area: {center, radius} | {min:[x,z], max:[x,z]} | island, kinds: ['grass','flowers','bush','tree_round',...]
 *   or {grass: 1, tree_round: 0.5} (relative densities), density=1, avoid: [{position, radius}] | Vector3[] (route; kept clear),
 *   clear=2.2 (clearance around avoid points), seed, minSlope }) -> { meshes, count, trees: [Vector3] }
 * Kinds are remapped per look (desert trees become cacti, snow trees get snow caps), so always ask for the generic kinds.
 */
export function foliage(game, opts = {}) {
  needGame(game, 'foliage');
  let kinds = opts.kinds || ['grass', 'flowers', 'bush', 'tree_round', 'rock'];
  if (Array.isArray(kinds)) kinds = Object.fromEntries(kinds.map(k => [k, 1]));
  const area = opts.area || opts.surface || opts.island;
  if (!area) throw new Error('World.foliage: pass area: {center:[x,y,z], radius} or {min:[x,z], max:[x,z]} or an island from World.island');
  const seed = seedOf(game, opts);
  const rnd = rng32(seed);
  const density = opts.density ?? 1;
  const clear = opts.clear ?? 2.2;
  const avoid = (opts.avoid || []).map(a => a.isVector3 || Array.isArray(a) ? { position: v3(a), radius: clear } : { position: v3(a.position), radius: a.radius ?? clear });
  // also avoid everything previously registered as a no-plant zone (paths, props)
  const zones = game._kitNoPlant || [];
  let inArea, areaSize, sample;
  if (area.kind === 'island') {
    const isl = area;
    inArea = (x, z) => isl.contains(x, z, 0.9);
    areaSize = Math.PI * isl.radius * isl.radius;
    sample = () => { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * isl.radius; return [isl.position.x + Math.cos(a) * r, isl.position.z + Math.sin(a) * r]; };
  } else if (area.radius != null) {
    const c = v3(area.center), r0 = area.inner || 0;
    inArea = (x, z) => { const d = Math.hypot(x - c.x, z - c.z); return d <= area.radius && d >= r0; };
    areaSize = Math.PI * (area.radius * area.radius - r0 * r0);
    sample = () => { const a = rnd() * Math.PI * 2, r = Math.sqrt(r0 * r0 / (area.radius * area.radius) + rnd() * (1 - r0 * r0 / (area.radius * area.radius))) * area.radius; return [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r]; };
  } else if (area.min && area.max) {
    const mn = area.min, mx = area.max;
    const x0 = mn[0] ?? mn.x, z0 = mn.length === 3 ? mn[2] : (mn[1] ?? mn.z), x1 = mx[0] ?? mx.x, z1 = mx.length === 3 ? mx[2] : (mx[1] ?? mx.z);
    inArea = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    areaSize = (x1 - x0) * (z1 - z0);
    sample = () => [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
  } else throw new Error('World.foliage: area must be {center, radius}, {min, max} or an island');
  const hAt = area.kind === 'island' ? (x, z) => area.heightAt(x, z) : (x, z) => heightAt(game, x, z);
  const yMin = opts.minY ?? -Infinity, yMax = opts.maxY ?? Infinity;
  const focus = opts.focus ? opts.focus.filter((_, i) => i % Math.max(1, Math.ceil(opts.focus.length / 120)) === 0).map(p => v3(p)) : null;
  const focusR = opts.focusRadius ?? 45;
  const clusterOn = opts.cluster ?? (areaSize > 900);          // big areas: trees grow in groves with open meadow between
  const CN = new SimplexNoise({ random: rng32(seed + 1) });

  const quality = game.look ? game.look.quality : 'high';
  const out = { meshes: [], count: 0, trees: [] };
  const placedBig = [];
  const dummy = new THREE.Object3D();
  for (const [reqKind, w] of Object.entries(kinds)) {
    const kind = Look.flora(game, reqKind);
    if (!kind) continue;
    const spec = FOLIAGE[kind];
    if (!spec) throw new Error(`World.foliage: unknown kind "${reqKind}"; kinds: ${Object.keys(FOLIAGE).join(', ')}`);
    let n = Math.round(areaSize * spec.density * density * w * (quality === 'low' && spec.spacing === 0 ? 0.4 : 1));
    n = Math.min(n, opts.max ?? spec.max ?? 30000);
    if (n <= 0) continue;
    const mats = [];
    let tries = n * (focus ? 10 : 4);
    while (mats.length < n && tries-- > 0) {
      const [x, z] = sample();
      if (!inArea(x, z)) continue;
      let ok = true;
      for (const a of avoid) if (Math.hypot(x - a.position.x, z - a.position.z) < a.radius) { ok = false; break; }
      const zk = spec.spacing === 0 ? 0.6 : spec.spacing >= 3 ? 2.2 : 1.2;
      if (ok) for (const a of zones) if (Math.hypot(x - a.x, z - a.z) < a.r * zk) { ok = false; break; }
      if (ok && clusterOn && spec.spacing > 0) {
        const cn = CN.noise(x * 0.025, z * 0.025) * 0.7 + CN.noise(x * 0.07, z * 0.07) * 0.3;
        if (cn < (spec.spacing >= 3 ? 0.05 : -0.15)) { if (rnd() > 0.08) ok = false; }
      }
      if (!ok) continue;
      if (spec.spacing > 0) {
        for (const p of placedBig) if (Math.hypot(x - p[0], z - p[1]) < Math.max(spec.spacing, p[2])) { ok = false; break; }
        if (!ok) continue;
      }
      if (focus && spec.spacing < 2) {   // small plants crowd the play area; far hills get a sprinkle
        let fd = Infinity; for (const f of focus) { const d = (f.x - x) ** 2 + (f.z - z) ** 2; if (d < fd) fd = d; }
        if (fd > focusR * focusR && rnd() > 0.2) continue;
      }
      const y = hAt(x, z);
      if (y == null || y < yMin || y > yMax) continue;
      const s = spec.scale[0] + rnd() * (spec.scale[1] - spec.scale[0]);
      dummy.position.set(x, y - (spec.spacing > 0 ? 0.08 : 0.02), z);
      dummy.rotation.set(spec.spacing > 0 ? (rnd() - 0.5) * 0.08 : 0, rnd() * Math.PI * 2, spec.spacing > 0 ? (rnd() - 0.5) * 0.08 : 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mats.push({ m: dummy.matrix.clone(), s, x, y, z });
      if (spec.spacing > 0) placedBig.push([x, z, spec.spacing]);
    }
    if (!mats.length) continue;
    const parts = foliageParts(game, kind);
    const tint = new THREE.Color();
    for (const part of parts) {
      const mat = Look.material(game, { ...part.mat, wind: spec.wind });
      const im = new THREE.InstancedMesh(part.geom, mat, mats.length);
      for (let i = 0; i < mats.length; i++) {
        im.setMatrixAt(i, mats[i].m);
        const v = 0.86 + rng32(i * 7 + seed)() * 0.26;
        tint.setRGB(v, v * (0.97 + 0.06 * Math.sin(i)), v);
        im.setColorAt(i, tint);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = spec.shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = 'kit:foliage:' + kind;
      (opts.parent || game.scene).add(im);
      out.meshes.push(im);
    }
    out.count += mats.length;
    if (spec.collider === 'trunk') {
      for (const t of mats) {
        colliderCylinder(game, new THREE.Vector3(t.x, t.y + 1.5 * t.s, t.z), 1.5 * t.s, 0.38 * t.s, { what: 'tree' });
        out.trees.push(new THREE.Vector3(t.x, t.y, t.z));
      }
    } else if (spec.collider === 'rock') {
      for (const t of mats) colliderBall(game, new THREE.Vector3(t.x, t.y + 0.15 * t.s, t.z), 0.8 * t.s, { what: 'rock' });
    }
  }
  return out;
}

/** World.noPlant(game, points, radius=2.5): keep foliage off these points (paths, props). Level.build marks its route. */
export function noPlant(game, points, radius = 2.5) {
  const z = (game._kitNoPlant = game._kitNoPlant || []);
  for (const p of points) { const q = v3(p); z.push({ x: q.x, z: q.z, r: radius }); }
}

// ------------------------------------------------------------------------------------------------ clouds
/**
 * World.clouds(game, { count=16, height=45, radius=220, center=[0,0,0], scale=1, speed=1.2, below=false }) -> {mesh}
 * Puffy toon clouds drifting slowly. below:true makes a cloud sea under floating islands.
 */
export function clouds(game, opts = {}) {
  needGame(game, 'clouds');
  const pal = Look.palette(game);
  const count = opts.count ?? 16, height = opts.height ?? 45, radius = opts.radius ?? 220;
  const center = v3(opts.center), scale = opts.scale ?? 1, speed = opts.speed ?? 1.2;
  const rnd = rng32(seedOf(game, opts));
  const N = new SimplexNoise({ random: rnd });
  const variants = [];
  for (let v = 0; v < 3; v++) {
    const gs = [];
    const nb = 5 + v * 2;
    for (let i = 0; i < nb; i++) {
      const t = i / (nb - 1) - 0.5;
      const r = (1 - Math.abs(t) * 1.1) * (2.6 + rnd() * 1.6);
      const g = blob(Math.max(r, 1.1), 1, N, 0.18, i * 3 + v);
      tr(g, t * nb * 2.0, Math.max(r, 1.1) * 0.25 + rnd() * 0.6, (rnd() - 0.5) * 2.4);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setY(k, Math.max(p.getY(k), 0.0));     // flat bottoms
      g.computeVertexNormals();
      gs.push(paint(g, (x, y) => new THREE.Color(pal.cloud).multiplyScalar(0.86 + Math.min(y / 4, 1) * 0.18)));
    }
    variants.push(merge(gs));
  }
  const mat = Look.material(game, { color: '#ffffff', vertexColors: true, emissive: pal.cloud, emissiveIntensity: Look.isNight(game) ? 0.06 : 0.16, rim: 0.5 });
  const group = new THREE.Group(); group.name = 'kit:clouds';
  const per = Math.ceil(count / 3);
  const items = [];
  const dummy = new THREE.Object3D();
  variants.forEach((g, vi) => {
    const im = new THREE.InstancedMesh(g, mat, per);
    im.frustumCulled = false;
    for (let i = 0; i < per; i++) {
      const a = rnd() * Math.PI * 2, r = (opts.below ? Math.sqrt(rnd()) : 0.35 + rnd() * 0.65) * radius;
      const s = scale * (0.8 + rnd() * 1.1) * (opts.below ? 1.6 : 1);
      items.push({ im, i, x: center.x + Math.cos(a) * r, y: center.y + height + (rnd() - 0.5) * (opts.below ? 6 : 14), z: center.z + Math.sin(a) * r, s, yaw: rnd() * 6 });
    }
    group.add(im);
  });
  (opts.parent || game.scene).add(group);
  const upd = (dt) => {
    for (const it of items) {
      it.x += speed * dt;
      if (it.x > center.x + radius) it.x -= radius * 2;
      dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.yaw, 0); dummy.scale.set(it.s, it.s * 0.8, it.s);
      dummy.updateMatrix(); it.im.setMatrixAt(it.i, dummy.matrix);
    }
    for (const im of group.children) im.instanceMatrix.needsUpdate = true;
  };
  upd(0);
  game.update(upd, 31);
  return { group, mesh: group };
}

// ------------------------------------------------------------------------------------------------ props
function box(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function cyl(rt, rb, h, seg, x = 0, y = 0, z = 0) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); return g; }

/** helper: one mesh per material from [{g, c (palette key/hex), m (material opts)}] */
function assemble(game, list, group) {
  const by = new Map();
  for (const it of list) {
    const k = JSON.stringify([it.c, it.m || {}]);
    if (!by.has(k)) by.set(k, { c: it.c, m: it.m || {}, gs: [] });
    by.get(k).gs.push(it.g);
  }
  for (const { c, m, gs } of by.values()) {
    const g = mergeGeometries(gs.map(x => strip(x.index ? x.toNonIndexed() : x)).map(x => { x.deleteAttribute('color'); return x; }));
    if (m.flat) g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, Look.material(game, { color: c, ...m }));
    mesh.castShadow = m.kind !== 'glass'; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export const propKinds = ['crate', 'barrel', 'fence', 'lamp', 'house', 'bridge', 'arch', 'crystal', 'sign', 'flag', 'chest',
  'pillar', 'ramp', 'platform_round', 'platform_box', 'spring_pad', 'rock', 'tree', 'wall', 'fountain', 'gate', 'barrier',
  'cone', 'boost_pad', 'tower', 'bench', 'well', 'stall', 'stairs', 'windmill', 'tire_stack', 'ruins'];
export const PROPS = propKinds;
export { FOLIAGE_KINDS as FOLIAGE };

/**
 * World.prop(game, kind, { position=[0,0,0] (base, on the ground), yaw=0 (radians), scale=1, color (main colour),
 *   collider=true, ...kind options }) -> THREE.Group (with .userData.top = standing height)
 * kinds: crate barrel fence(length) lamp house(width, depth, floors) bridge(from, to, width) arch(width, height) crystal sign(text)
 *   flag chest pillar(height) ramp(length, width, height) platform_round(radius, thick) platform_box(size:[w,h,d])
 *   spring_pad rock tree wall(length, height) fountain gate(width) barrier(length) cone boost_pad tower bench well stall stairs windmill tire_stack ruins
 */
export function prop(game, kind, opts = {}) {
  needGame(game, 'prop');
  if (!propKinds.includes(kind)) throw new Error(`World.prop: unknown kind "${kind}"; kinds: ${propKinds.join(', ')}`);
  const pal = Look.palette(game);
  const pos = v3(opts.position);
  const yaw = opts.yaw ?? opts.rotation ?? 0;
  const s = opts.scale ?? 1;
  const main = opts.color;
  const group = new THREE.Group(); group.name = 'kit:prop:' + kind;
  const L = [];          // {g, c, m}
  const cols = [];       // collider boxes in local space: {c:[x,y,z], h:[hx,hy,hz]} | {cyl:[x,y,z], hh, r}
  const rnd = rng32(Math.round(pos.x * 13 + pos.z * 7 + 1));
  const N = new SimplexNoise({ random: rnd });
  const em = (c, i = 2.2) => ({ kind: 'emissive', emissive: c, emissiveIntensity: i });
  let top = 0;
  switch (kind) {
    case 'crate': {
      const w = opts.size ?? 1.6;
      L.push({ g: box(w * 0.9, w * 0.9, w * 0.9, 0, w / 2, 0), c: main || 'wood' });
      for (const [x, z, sx, sz] of [[0, w / 2 - 0.05, 1, 0.1], [0, -w / 2 + 0.05, 1, 0.1], [w / 2 - 0.05, 0, 0.1, 1], [-w / 2 + 0.05, 0, 0.1, 1]]) {
        L.push({ g: box(sx === 1 ? w : 0.14, 0.14, sz === 1 ? w : 0.14, x, w - 0.07, z), c: 'trunk' });
        L.push({ g: box(sx === 1 ? w : 0.14, 0.14, sz === 1 ? w : 0.14, x, 0.07, z), c: 'trunk' });
      }
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) L.push({ g: box(0.14, w, 0.14, x * (w / 2 - 0.07), w / 2, z * (w / 2 - 0.07)), c: 'trunk' });
      cols.push({ c: [0, w / 2, 0], h: [w / 2, w / 2, w / 2] }); top = w;
      break;
    }
    case 'barrel': {
      const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.55 + Math.sin(t * Math.PI) * 0.12, t * 1.4)); }
      L.push({ g: new THREE.LatheGeometry(pts, 12), c: main || 'wood' });
      L.push({ g: new THREE.CircleGeometry(0.56, 12).rotateX(-Math.PI / 2).translate(0, 1.4, 0), c: 'trunk' });
      for (const y of [0.25, 1.15]) L.push({ g: new THREE.TorusGeometry(0.64, 0.05, 4, 16).rotateX(Math.PI / 2).translate(0, y, 0), c: 'metal' });
      cols.push({ cyl: [0, 0.7, 0], hh: 0.7, r: 0.62 }); top = 1.4;
      break;
    }
    case 'fence': {
      const len = opts.length ?? 6, n = Math.max(2, Math.round(len / 2) + 1);
      for (let i = 0; i < n; i++) { const x = -len / 2 + i * len / (n - 1); L.push({ g: box(0.22, 1.3, 0.22, x, 0.65, 0), c: main || 'wood' }); L.push({ g: new THREE.ConeGeometry(0.17, 0.25, 4).rotateY(Math.PI / 4).translate(x, 1.42, 0), c: main || 'wood' }); }
      L.push({ g: box(len, 0.14, 0.1, 0, 0.95, 0), c: 'trunk' }); L.push({ g: box(len, 0.14, 0.1, 0, 0.5, 0), c: 'trunk' });
      cols.push({ c: [0, 0.75, 0], h: [len / 2, 0.75, 0.15] }); top = 1.3;
      break;
    }
    case 'lamp': {
      const h = opts.height ?? 3.6;
      L.push({ g: cyl(0.09, 0.13, h, 6, 0, h / 2, 0), c: 'metal', m: { kind: 'standard', metalness: 0.6, roughness: 0.4 } });
      L.push({ g: cyl(0.28, 0.32, 0.2, 6, 0, 0.1, 0), c: 'metal' });
      L.push({ g: new THREE.OctahedronGeometry(0.3, 0).scale(1, 1.3, 1).translate(0, h + 0.25, 0), c: main || 'glow', m: em(main || pal.glow, 3.0) });
      L.push({ g: new THREE.ConeGeometry(0.42, 0.35, 6).translate(0, h + 0.75, 0), c: 'metal' });
      cols.push({ cyl: [0, h / 2, 0], hh: h / 2, r: 0.18 }); top = h;
      break;
    }
    case 'house': {
      const w = opts.width ?? 6, d = opts.depth ?? 5, floors = opts.floors ?? 1, fh = 3.2, H = floors * fh;
      const wall = main || (Look.isNight(game) ? 'stone' : '#f6efe2');
      L.push({ g: box(w, H, d, 0, H / 2, 0), c: wall });
      L.push({ g: box(w + 0.3, 0.5, d + 0.3, 0, 0.25, 0), c: 'stone', m: { flat: true } });
      for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) L.push({ g: box(0.35, H, 0.35, x, H / 2, z), c: 'wood' });
      // roof prism
      const rh = Math.min(w, d) * 0.55;
      const sh = new THREE.Shape(); sh.moveTo(-w / 2 - 0.6, 0); sh.lineTo(w / 2 + 0.6, 0); sh.lineTo(0, rh); sh.closePath();
      const roof = new THREE.ExtrudeGeometry(sh, { depth: d + 1.0, bevelEnabled: false }); roof.translate(0, H, -d / 2 - 0.5);
      L.push({ g: roof, c: opts.roofColor || 'roof', m: { flat: true } });
      L.push({ g: box(0.9, 1.6, 0.9, w * 0.25, H + rh * 0.65, 0), c: 'stone' });
      L.push({ g: box(1.2, 2.0, 0.15, 0, 1.0, d / 2 + 0.05), c: 'trunk' });
      const winC = Look.isNight(game) ? pal.glow : '#bfe6ff';
      const winM = Look.isNight(game) ? em(pal.glow, 2.4) : { kind: 'toon' };
      for (let f = 0; f < floors; f++) for (const x of [-w * 0.3, w * 0.3]) {
        if (f === 0 && Math.abs(x) < 1) continue;
        L.push({ g: box(1.0, 1.0, 0.12, x, f * fh + 1.7, d / 2 + 0.06), c: winC, m: winM });
        L.push({ g: box(1.25, 0.14, 0.2, x, f * fh + 1.15, d / 2 + 0.1), c: 'wood' });
      }
      for (const z of [-d * 0.2, d * 0.2]) L.push({ g: box(0.12, 1.0, 1.0, w / 2 + 0.06, 1.7, z), c: winC, m: winM });
      cols.push({ c: [0, H / 2, 0], h: [w / 2, H / 2, d / 2] });
      cols.push({ c: [0, H + rh * 0.35, 0], h: [w / 2, rh * 0.35, d / 2] });
      top = H + rh;
      break;
    }
    case 'bridge': {
      // from/to world points (deck level); position ignored
      const a = v3(opts.from || [0, 0, 0]), b = v3(opts.to || [10, 0, 0]);
      const width = opts.width ?? 2.6;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(3, Math.round(len / 0.9));
      const dir = Math.atan2(b.z - a.z, b.x - a.x);
      pos.copy(a); group.position.copy(a);
      group.rotation.y = -dir;
      const sag = opts.sag ?? Math.min(0.9, len * 0.04);
      const dy = b.y - a.y;
      const yAt = (t) => dy * t - sag * 4 * t * (1 - t);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = t * len;
        L.push({ g: box(len / n * 0.86, 0.18, width, x, yAt(t) - 0.09, 0).rotateY(0), c: main || 'wood' });
      }
      for (const z of [-width / 2, width / 2]) {
        for (let i = 0; i <= 4; i++) { const t = i / 4; L.push({ g: box(0.14, 1.1, 0.14, t * len, yAt(t) + 0.45, z), c: 'trunk' }); }
        const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map(t => new THREE.Vector3(t * len, yAt(t) + 1.0, z))), 16, 0.05, 4);
        L.push({ g: rope, c: 'trunk' });
      }
      // colliders: deck segments (world space handled below via group transform)
      const segs = 6;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const y0 = yAt(t0), y1 = yAt(t1);
        cols.push({ c: [(t0 + t1) / 2 * len, (y0 + y1) / 2 - 0.12, 0], h: [len / segs / 2 + 0.05, 0.14, width / 2], rz: Math.atan2(y1 - y0, len / segs) });
      }
      for (const z of [-width / 2 - 0.05, width / 2 + 0.05]) cols.push({ c: [len / 2, yAt(0.5) + 0.7, z], h: [len / 2, 0.7, 0.06] });
      top = 0;
      break;
    }
    case 'arch': {
      const w = opts.width ?? 6, h = opts.height ?? 5;
      for (const x of [-w / 2, w / 2]) { L.push({ g: box(1.0, h, 1.0, x, h / 2, 0), c: main || 'stone', m: { flat: true } }); L.push({ g: box(1.3, 0.4, 1.3, x, 0.2, 0), c: 'cliff2' }); }
      const tor = new THREE.TorusGeometry(w / 2, 0.5, 6, 16, Math.PI); tor.translate(0, h, 0);
      L.push({ g: tor, c: main || 'stone', m: { flat: true } });
      L.push({ g: new THREE.OctahedronGeometry(0.5, 0).translate(0, h + w / 2 + 0.2, 0), c: 'accent', m: em(pal.accent, 2.5) });
      for (const x of [-w / 2, w / 2]) cols.push({ c: [x, h / 2, 0], h: [0.5, h / 2, 0.5] });
      top = h + w / 2;
      break;
    }
    case 'crystal': {
      [[0, 0, 0, 2.2, 0], [0.7, 0, 0.3, 1.4, 0.4], [-0.6, 0, -0.3, 1.6, -0.35], [0.2, 0, -0.7, 1.1, 0.25]].forEach(([x, y, z, h, lean], i) => {
        const g = new THREE.OctahedronGeometry(0.5, 0); g.scale(1, h * 1.8, 1); tr(g, x, h * 0.75, z, lean, i, lean * 0.6);
        L.push({ g, c: main || 'accent', m: { ...em(main || pal.accent, 1.6), flat: true } });
      });
      cols.push({ cyl: [0, 1.5, 0], hh: 1.5, r: 0.9 }); top = 3.5;
      break;
    }
    case 'sign': {
      L.push({ g: box(0.2, 2.2, 0.2, 0, 1.1, 0), c: 'trunk' });
      L.push({ g: box(2.2, 1.0, 0.16, 0, 2.0, 0), c: main || 'wood' });
      L.push({ g: new THREE.ConeGeometry(0.35, 0.5, 3).rotateZ(-Math.PI / 2).translate(0.8, 2.0, 0.1).scale(1, 1, 0.3), c: 'accent' });
      cols.push({ c: [0, 1.1, 0], h: [0.15, 1.1, 0.15] }); top = 2.5;
      break;
    }
    case 'flag': {
      const h = opts.height ?? 5;
      L.push({ g: cyl(0.08, 0.1, h, 6, 0, h / 2, 0), c: 'metal' });
      L.push({ g: new THREE.SphereGeometry(0.18, 8, 6).translate(0, h + 0.1, 0), c: 'accent', m: em(pal.accent, 1.5) });
      const cloth = new THREE.PlaneGeometry(2.0, 1.2, 8, 2); cloth.translate(1.0, h - 0.7, 0);
      const cp = cloth.attributes.position; for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 2.2) * 0.18 * cp.getX(i) / 2);
      cloth.computeVertexNormals();
      L.push({ g: cloth, c: main || 'primary', m: { side: 'double', wind: 0.02 } });
      cols.push({ cyl: [0, h / 2, 0], hh: h / 2, r: 0.12 }); top = h;
      break;
    }
    case 'chest': {
      L.push({ g: box(1.4, 0.8, 0.9, 0, 0.4, 0), c: main || 'wood' });
      const lid = new THREE.CylinderGeometry(0.45, 0.45, 1.4, 10, 1, false, 0, Math.PI); lid.rotateZ(Math.PI / 2); lid.rotateX(Math.PI / 2); lid.translate(0, 0.8, 0);
      L.push({ g: lid, c: main || 'wood' });
      for (const x of [-0.55, 0, 0.55]) L.push({ g: box(0.12, 0.85, 0.95, x, 0.42, 0), c: 'accent' });
      L.push({ g: box(0.25, 0.3, 0.1, 0, 0.7, 0.48), c: 'accent', m: em(pal.accent, 1.2) });
      cols.push({ c: [0, 0.6, 0], h: [0.7, 0.6, 0.45] }); top = 1.25;
      break;
    }
    case 'pillar': {
      const h = opts.height ?? 5;
      L.push({ g: cyl(0.6, 0.6, h, 10, 0, h / 2, 0), c: main || 'stone', m: { flat: true } });
      L.push({ g: box(1.6, 0.5, 1.6, 0, 0.25, 0), c: main || 'stone' });
      L.push({ g: box(1.6, 0.45, 1.6, 0, h - 0.22, 0), c: main || 'stone' });
      cols.push({ cyl: [0, h / 2, 0], hh: h / 2, r: 0.7 }); top = h;
      break;
    }
    case 'ramp': {
      const len = opts.length ?? 6, w = opts.width ?? 4, h = opts.height ?? 2;
      const sh = new THREE.Shape(); sh.moveTo(-len / 2, 0); sh.lineTo(len / 2, 0); sh.lineTo(len / 2, h); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2);
      L.push({ g, c: main || 'wood', m: { flat: true } });
      const ang = Math.atan2(h, len);
      cols.push({ c: [0, h / 2 - Math.cos(ang) * 0.15, 0], h: [Math.hypot(len, h) / 2, 0.15, w / 2], rz: ang });
      cols.push({ c: [len / 2 - 0.15, h / 2, 0], h: [0.15, h / 2, w / 2] });
      top = h;
      break;
    }
    case 'platform_round': {
      const r = opts.radius ?? 2.5, t = opts.thick ?? 0.8;
      L.push({ g: cyl(r, r * 0.92, t, 14, 0, -t / 2, 0), c: main || 'grass' });
      const cone = new THREE.ConeGeometry(r * 0.88, r * 1.3, 9); cone.rotateX(Math.PI); cone.translate(0, -t - r * 0.65, 0);
      const cp = cone.attributes.position; for (let i = 0; i < cp.count; i++) { const k = 1 + 0.18 * N.noise(cp.getX(i), cp.getZ(i) + cp.getY(i)); cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k); }
      L.push({ g: cone, c: 'cliff', m: { flat: true } });
      L.push({ g: cyl(r * 1.0, r * 1.0, 0.22, 14, 0, -t + 0.05, 0), c: 'ground' });
      cols.push({ cyl: [0, -t / 2, 0], hh: t / 2, r }); top = 0;
      break;
    }
    case 'platform_box': {
      const sz = opts.size ? v3(opts.size) : new THREE.Vector3(4, 1, 4);
      // grass-capped rock block: overhanging top slab, dirt band, two-tone strata with chipped corners
      const capH = Math.min(0.45, sz.y * 0.3);
      L.push({ g: box(sz.x + 0.3, capH, sz.z + 0.3, 0, -capH / 2, 0), c: main || 'grass' });
      L.push({ g: box(sz.x + 0.1, 0.22, sz.z + 0.1, 0, -capH - 0.11, 0), c: 'ground' });
      const bodyH = Math.max(0.1, sz.y - capH - 0.22), bands = Math.max(1, Math.round(bodyH / 1.1));
      for (let i = 0; i < bands; i++) {
        const h = bodyH / bands, y = -capH - 0.22 - h * (i + 0.5), inset = 0.06 * ((i % 2) + 1);
        L.push({ g: box(sz.x - inset, h, sz.z - inset, 0, y, 0), c: i % 2 ? 'cliff2' : 'cliff', m: { flat: true } });
      }
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const g = flatRock(0.35, N, 0.3, x + z * 3, 1); tr(g, x * sz.x / 2, -capH - 0.3 - rnd() * bodyH * 0.6, z * sz.z / 2);
        L.push({ g, c: 'cliff2', m: { flat: true } });
      }
      cols.push({ c: [0, -sz.y / 2, 0], h: [sz.x / 2, sz.y / 2, sz.z / 2] }); top = 0;
      break;
    }
    case 'spring_pad': {
      L.push({ g: cyl(1.1, 1.25, 0.35, 14, 0, 0.17, 0), c: 'metal' });
      L.push({ g: cyl(0.9, 0.95, 0.2, 14, 0, 0.45, 0), c: main || 'primary', m: em(main || pal.primary, 1.4) });
      L.push({ g: new THREE.TorusGeometry(0.75, 0.07, 4, 20).rotateX(Math.PI / 2).translate(0, 0.57, 0), c: 'accent', m: em(pal.accent, 2.5) });
      cols.push({ cyl: [0, 0.27, 0], hh: 0.27, r: 1.2 }); top = 0.55;
      break;
    }
    case 'rock': {
      const g = flatRock(1.2 * (opts.size ?? 1), N, 0.3, 3, 0.75); g.translate(0, 0.3, 0);
      L.push({ g, c: main || 'stone', m: { flat: true } });
      cols.push({ ball: [0, 0.35, 0], r: 1.1 * (opts.size ?? 1) }); top = 1;
      break;
    }
    case 'tree': {
      const parts = foliageParts(game, Look.flora(game, opts.variant || 'tree_round') || 'tree_round');
      for (const p of parts) {
        const m = new THREE.Mesh(p.geom, Look.material(game, { ...p.mat, wind: 0.004 }));
        m.castShadow = true; m.receiveShadow = true; group.add(m);
      }
      cols.push({ cyl: [0, 1.5, 0], hh: 1.5, r: 0.38 }); top = 5;
      break;
    }
    case 'wall': {
      const len = opts.length ?? 8, h = opts.height ?? 2.4, n = Math.max(1, Math.round(len / 1.6));
      for (let i = 0; i < n; i++) for (let j = 0; j < Math.round(h / 0.8); j++) {
        const bw = len / n, x = -len / 2 + bw * (i + 0.5) + (j % 2 ? bw * 0.25 : 0);
        if (x > len / 2 - bw * 0.2) continue;
        L.push({ g: box(bw * 0.96, 0.76, 1.0, x, j * 0.8 + 0.38, 0), c: (i + j) % 3 ? (main || 'stone') : 'cliff', m: { flat: true } });
      }
      cols.push({ c: [0, h / 2, 0], h: [len / 2, h / 2, 0.5] }); top = h;
      break;
    }
    case 'fountain': {
      const r = opts.radius ?? 3.5;
      const ring = new THREE.TorusGeometry(r, 0.45, 6, 24); ring.rotateX(Math.PI / 2); ring.translate(0, 0.55, 0);
      L.push({ g: ring, c: 'stone', m: { flat: true } });
      L.push({ g: cyl(r, r, 0.3, 24, 0, 0.15, 0), c: 'stone' });
      L.push({ g: cyl(r - 0.2, r - 0.2, 0.1, 24, 0, 0.75, 0), c: 'water', m: { kind: 'glass', opacity: 0.8, emissive: pal.water, emissiveIntensity: 0.4 } });
      L.push({ g: cyl(0.35, 0.5, 2.2, 10, 0, 1.1, 0), c: 'stone' });
      L.push({ g: cyl(1.3, 0.3, 0.4, 14, 0, 2.2, 0), c: 'stone' });
      L.push({ g: new THREE.SphereGeometry(0.5, 10, 8).scale(1, 1.6, 1).translate(0, 2.8, 0), c: 'foam', m: { kind: 'glass', opacity: 0.6, emissive: pal.water, emissiveIntensity: 0.8 } });
      cols.push({ cyl: [0, 0.5, 0], hh: 0.5, r: r + 0.4 }); cols.push({ cyl: [0, 1.5, 0], hh: 1.5, r: 0.6 }); top = 1.0;
      break;
    }
    case 'gate': {
      const w = opts.width ?? 16, h = opts.height ?? 7;
      for (const x of [-w / 2, w / 2]) L.push({ g: box(0.9, h, 0.9, x, h / 2, 0), c: 'metal', m: { flat: true } });
      L.push({ g: box(w + 1.4, 1.6, 0.8, 0, h, 0), c: main || 'primary' });
      for (let i = 0; i < 8; i++) L.push({ g: box(w / 8 * 0.5, 0.5, 0.1, -w / 2 + (i + 0.5) * w / 8, h, 0.45), c: i % 2 ? '#ffffff' : '#111111' });
      L.push({ g: box(w + 1.4, 0.18, 0.84, 0, h - 0.9, 0), c: 'accent', m: em(pal.accent, 2.0) });
      for (const x of [-w / 2, w / 2]) cols.push({ c: [x, h / 2, 0], h: [0.45, h / 2, 0.45] });
      top = h + 0.8;
      break;
    }
    case 'barrier': {
      const len = opts.length ?? 4;
      L.push({ g: box(len, 0.9, 0.6, 0, 0.45, 0), c: '#ffffff', m: { flat: true } });
      for (let i = 0; i < Math.round(len / 1); i++) L.push({ g: box(0.5, 0.92, 0.62, -len / 2 + 0.25 + i * 1.0, 0.45, 0), c: main || 'primary' });
      cols.push({ c: [0, 0.6, 0], h: [len / 2, 0.6, 0.3] }); top = 0.9;
      break;
    }
    case 'cone': {
      L.push({ g: new THREE.ConeGeometry(0.35, 0.9, 10).translate(0, 0.5, 0), c: main || '#ff7a1a' });
      L.push({ g: box(0.8, 0.1, 0.8, 0, 0.05, 0), c: '#ff7a1a' });
      L.push({ g: cyl(0.21, 0.26, 0.15, 10, 0, 0.55, 0), c: '#ffffff' });
      cols.push({ cyl: [0, 0.45, 0], hh: 0.45, r: 0.3 }); top = 0.9;
      break;
    }
    case 'boost_pad': {
      const w = opts.width ?? 4, len = opts.length ?? 5;
      L.push({ g: box(w, 0.08, len, 0, 0.04, 0), c: '#202030' });
      for (let i = 0; i < 3; i++) {
        const sh = new THREE.Shape(); sh.moveTo(-w * 0.35, 0); sh.lineTo(0, 0.9); sh.lineTo(w * 0.35, 0); sh.lineTo(w * 0.35, -0.5); sh.lineTo(0, 0.4); sh.lineTo(-w * 0.35, -0.5); sh.closePath();
        const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, 0.1, len * 0.3 - i * 1.5);
        L.push({ g, c: main || 'accent', m: em(main || pal.accent, 3.0) });
      }
      top = 0.1;
      break;
    }
    case 'tower': {
      const h = opts.height ?? 10, r = opts.radius ?? 2.2;
      L.push({ g: cyl(r * 0.9, r, h, 10, 0, h / 2, 0), c: main || 'stone', m: { flat: true } });
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; L.push({ g: box(0.8, 0.9, 0.6, Math.cos(a) * r * 0.95, h + 0.45, Math.sin(a) * r * 0.95).rotateY(0), c: main || 'stone' }); }
      L.push({ g: new THREE.ConeGeometry(r * 1.1, r * 1.6, 10).translate(0, h + 1.6, 0), c: 'roof', m: { flat: true } });
      const winM = Look.isNight(game) ? em(pal.glow, 2.4) : {};
      for (let k = 1; k < h / 3; k++) L.push({ g: box(0.7, 1.1, 0.2, 0, k * 3, r * 0.92), c: Look.isNight(game) ? pal.glow : '#2a3048', m: winM });
      cols.push({ cyl: [0, h / 2, 0], hh: h / 2, r }); top = h;
      break;
    }
    case 'bench': {
      L.push({ g: box(2.0, 0.12, 0.6, 0, 0.55, 0), c: main || 'wood' });
      L.push({ g: box(2.0, 0.5, 0.1, 0, 0.9, -0.28), c: main || 'wood' });
      for (const x of [-0.85, 0.85]) L.push({ g: box(0.12, 0.55, 0.6, x, 0.27, 0), c: 'metal' });
      cols.push({ c: [0, 0.5, 0], h: [1.0, 0.5, 0.3] }); top = 0.6;
      break;
    }
    case 'well': {
      L.push({ g: cyl(1.2, 1.3, 1.0, 12, 0, 0.5, 0), c: 'stone', m: { flat: true } });
      L.push({ g: cyl(1.0, 1.0, 0.05, 12, 0, 0.8, 0), c: 'waterDeep' });
      for (const x of [-1.0, 1.0]) L.push({ g: box(0.18, 2.4, 0.18, x, 1.2, 0), c: 'wood' });
      const sh = new THREE.Shape(); sh.moveTo(-1.6, 0); sh.lineTo(1.6, 0); sh.lineTo(0, 1.0); sh.closePath();
      L.push({ g: new THREE.ExtrudeGeometry(sh, { depth: 2.0, bevelEnabled: false }).translate(0, 2.3, -1.0), c: 'roof', m: { flat: true } });
      cols.push({ cyl: [0, 0.6, 0], hh: 0.6, r: 1.3 }); top = 1.0;
      break;
    }
    case 'stall': {
      L.push({ g: box(3.2, 1.0, 1.6, 0, 0.5, 0), c: 'wood' });
      for (const x of [-1.5, 1.5]) for (const z of [-0.7, 0.7]) L.push({ g: box(0.12, 2.6, 0.12, x, 1.3, z), c: 'trunk' });
      for (let i = 0; i < 6; i++) L.push({ g: box(3.4 / 6, 0.12, 2.2, -1.7 + (i + 0.5) * 3.4 / 6, 2.65, 0).rotateX(0.12), c: i % 2 ? '#ffffff' : (main || 'primary') });
      for (let i = 0; i < 5; i++) L.push({ g: new THREE.IcosahedronGeometry(0.2, 0).translate(-1.2 + i * 0.6, 1.15, 0.2), c: ['flower', 'accent', 'good', 'primary', 'flower2'][i] });
      cols.push({ c: [0, 0.5, 0], h: [1.6, 0.5, 0.8] }); top = 1.0;
      break;
    }
    case 'stairs': {
      const steps = opts.steps ?? 6, h = opts.height ?? 3, w = opts.width ?? 3, d = opts.depth ?? 6;
      for (let i = 0; i < steps; i++) {
        const sh = (i + 1) * h / steps;
        L.push({ g: box(w, sh, d / steps, 0, sh / 2, -d / 2 + (i + 0.5) * d / steps), c: i % 2 ? (main || 'stone') : 'cliff', m: { flat: true } });
        cols.push({ c: [0, sh / 2, -d / 2 + (i + 0.5) * d / steps], h: [w / 2, sh / 2, d / steps / 2] });
      }
      top = h;
      break;
    }
    case 'windmill': {
      L.push({ g: cyl(1.4, 2.2, 8, 8, 0, 4, 0), c: main || '#f4ead8', m: { flat: true } });
      L.push({ g: new THREE.ConeGeometry(2.0, 2.4, 8).translate(0, 9.2, 0), c: 'roof', m: { flat: true } });
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(box(0.9, 5.5, 0.1, 0, 3.0, 0), Look.material(game, { color: 'wood' })); b.rotation.z = i * Math.PI / 2; b.castShadow = true; blades.add(b); }
      blades.position.set(0, 7.6, 2.0); group.add(blades);
      game.update(dt => { blades.rotation.z += dt * 0.6; }, 31);
      cols.push({ cyl: [0, 4, 0], hh: 4, r: 2 }); top = 8;
      break;
    }
    case 'tire_stack': {
      for (let i = 0; i < 3; i++) L.push({ g: new THREE.TorusGeometry(0.5, 0.22, 6, 12).rotateX(Math.PI / 2).translate(0, 0.22 + i * 0.42, 0), c: i === 1 ? (main || 'primary') : '#202024' });
      cols.push({ cyl: [0, 0.65, 0], hh: 0.65, r: 0.72 }); top = 1.3;
      break;
    }
    case 'ruins': {
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2, h = 1 + rnd() * 3.5;
        L.push({ g: cyl(0.5, 0.55, h, 8, Math.cos(a) * 3, h / 2, Math.sin(a) * 3), c: main || 'stone', m: { flat: true } });
        cols.push({ cyl: [Math.cos(a) * 3, h / 2, Math.sin(a) * 3], hh: h / 2, r: 0.55 });
      }
      L.push({ g: box(4, 0.6, 1.2, 0, 3.5, 0).rotateZ(0.2), c: main || 'stone' });
      top = 4;
      break;
    }
  }
  if (L.length) assemble(game, L, group);
  if (kind !== 'bridge') { group.position.copy(pos); group.rotation.y = yaw; }
  group.scale.setScalar(s);
  group.userData.top = top * s;
  group.userData.kind = kind;
  (opts.parent || game.scene).add(group);
  group.updateMatrixWorld(true);
  if (opts.collider !== false) {
    const q = group.getWorldQuaternion(new THREE.Quaternion());
    for (const c of cols) {
      if (c.h) {
        const ctr = new THREE.Vector3(...c.c).applyMatrix4(group.matrixWorld);
        const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, c.rz || 0));
        colliderBoxQ(game, ctr, new THREE.Vector3(...c.h).multiplyScalar(s), q.clone().multiply(lq), { what: kind });
      } else if (c.cyl) {
        colliderCylinder(game, new THREE.Vector3(...c.cyl).applyMatrix4(group.matrixWorld), c.hh * s, c.r * s, { what: kind });
      } else if (c.ball) {
        colliderBall(game, new THREE.Vector3(...c.ball).applyMatrix4(group.matrixWorld), c.r * s, { what: kind });
      }
    }
  }
  if (!['bridge', 'platform_round', 'platform_box', 'boost_pad', 'spring_pad'].includes(kind)) {
    (game._kitNoPlant = game._kitNoPlant || []).push({ x: pos.x, z: pos.z, r: Math.max(1.2, (kind === 'house' ? 5 : 1.5) * s) });
  }
  return group;
}

/** World.rocks(game, { area, count=12, size=[0.6,2] }) -> scattered boulders with colliders (uses foliage 'rock') */
export function rocks(game, opts = {}) {
  return foliage(game, { ...opts, kinds: { rock: 1 }, density: (opts.count ?? 12) / Math.max(1, 0.008 * areaOf(opts.area)) });
}
function areaOf(a) {
  if (!a) return 100;
  if (a.kind === 'island') return Math.PI * a.radius * a.radius;
  if (a.radius != null) return Math.PI * a.radius * a.radius;
  if (a.min && a.max) return Math.abs((a.max[0] - a.min[0]) * ((a.max[2] ?? a.max[1]) - (a.min[2] ?? a.min[1])));
  return 100;
}

/** World.reset(game): forget kit surfaces / no-plant zones (Level.build calls this before building) */
export function reset(game) { game._kitSurfaces = []; game._kitNoPlant = []; }
