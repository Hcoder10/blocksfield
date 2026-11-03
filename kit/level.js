// level.js: Level.build(game, kind, opts) -> a whole dressed, playable level in one call. See CONTRACT.md and docs/Level.md.
// Every jump on level.route is sized for the kit platformer: jump apex ~4.5 u, run ~12 u/s, double jump.
// Route rules used by every kind: gaps between standing surfaces <= MAX_GAP, rises per jump <= MAX_RISE.
import * as THREE from 'three';
import * as Look from './look.js';
import * as World from './world.js';

export const MAX_GAP = 5.0;       // horizontal edge-to-edge gap on the route (single jump covers ~12; double jump ~18)
export const MAX_RISE = 2.5;      // height gained in one route jump (apex is 4.5)
export const JUMP_HEIGHT = 4.5, RUN_SPEED = 12;
export const kinds = ['sky_islands', 'meadow_course', 'arena', 'town', 'race_track', 'lagoon', 'canyon'];
export const KINDS = kinds;
export const SIZES_LIST = ['small', 'medium', 'large'];
const SIZES = { small: 0.7, medium: 1, large: 1.45 };

function rng32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mixSeed(seed, salt) {
  let h = (Number(seed) | 0) ^ 0x9e3779b9;
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 1000003;
}
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);   // yaw 0 faces +Z

/**
 * Level.build(game, kind, { size='medium'|'small'|'large', seed=1, collectibles=30, theme }) -> level (see CONTRACT.md)
 * kinds: sky_islands, meadow_course, arena, town, race_track
 */
export function build(game, kind, opts = {}) {
  if (!game || !game.scene) throw new Error('Level.build(game, kind, opts): first argument must be the game from createGame()');
  if (!kinds.includes(kind)) throw new Error(`Level.build: unknown kind "${kind}"; kinds: ${kinds.join(', ')}`);
  const size = opts.size || 'medium';
  if (!SIZES[size]) throw new Error(`Level.build: unknown size "${size}"; sizes: small, medium, large`);
  if (!game.look) Look.apply(game, 'toon_bright');
  World.reset(game);
  // the game's title is mixed into the seed: two games asking for the same kind (and seed) never share a layout
  const seed = mixSeed(opts.seed ?? 1, opts.unique === false ? '' : (game.title || (typeof document !== 'undefined' ? document.title : '')));
  const group = new THREE.Group(); group.name = 'kit:level:' + kind;
  game.scene.add(group);
  const level = {
    kind, size, seed, spawn: V(0, 2, 0), spawnYaw: 0, bounds: new THREE.Box3(), route: [], checkpoints: [], collectibles: [],
    hazards: [], movers: [], goal: null, track: null, group, colliders: [], killY: -40, water: null,
  };
  const prev = World._collect(level.colliders);
  try {
    const ctx = { game, level, group, opts, S: SIZES[size], rnd: rng32(seed * 9973 + 17), seed, n: opts.collectibles ?? 30 };
    BUILDERS[kind](ctx);
  } finally { World._collect(prev); }
  group.updateMatrixWorld(true);
  if (level.bounds.isEmpty()) level.bounds.setFromObject(group);
  // no pickup right in front of the camera at the start: none within 4 u of spawn, and on tracks none in the first 15 u
  {
    const clear = (level.track || level.trackWidth) ? 15 : 4;
    level.collectibles = level.collectibles.filter(c => Math.hypot(c.position.x - level.spawn.x, c.position.z - level.spawn.z) > clear
      || Math.abs(c.position.y - level.spawn.y) > 6);
  }
  // batch static props per material: hundreds of prop meshes -> a few dozen draws (opts.bake === false to skip)
  if (opts.bake !== false) {
    try { level.batching = World.bake(game, group, { keep: level.movers.map(m => m.mesh) }); }
    catch (e) { console.warn('[kit] Level.build: batching failed, keeping separate meshes', e); }
  }
  Look.fit(game, level.bounds);
  game.level = level;
  return level;
}

// ------------------------------------------------------------------------------------------------ shared helpers
const P = (ctx) => ({ parent: ctx.group });

function routeLength(route) { let L = 0; for (let i = 1; i < route.length; i++) L += route[i].distanceTo(route[i - 1]); return L; }
/** evenly spaced points along a polyline (by arc length) */
function alongRoute(route, n, from = 0.03, to = 0.97) {
  const L = routeLength(route), out = [];
  if (route.length < 2 || n <= 0) return out;
  for (let k = 0; k < n; k++) {
    const target = L * (from + (to - from) * (n === 1 ? 0.5 : k / (n - 1)));
    let acc = 0;
    for (let i = 1; i < route.length; i++) {
      const d = route[i].distanceTo(route[i - 1]);
      if (acc + d >= target) { out.push(route[i - 1].clone().lerp(route[i], (target - acc) / Math.max(d, 1e-6))); break; }
      acc += d;
    }
  }
  return out;
}
function densify(points, step = 2) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
  }
  out.push(points[points.length - 1].clone());
  return out;
}
/** low fences around an island rim, leaving the side toward `exitP` open (spawn safety) */
function guardRails(ctx, isl, exitP, open = 0.75) {
  const { game } = ctx;
  const ex = Math.atan2(exitP.z - isl.position.z, exitP.x - isl.position.x);
  const n = Math.max(8, Math.round(isl.radius * 1.3));
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) / n * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - ex), Math.cos(a - ex))) < open) continue;
    const p = isl.edgePoint(a, 0.9);
    const len = 2 * Math.PI * (isl.radiusAt(a) - 0.9) / n * 0.92;
    World.prop(game, 'fence', { ...P(ctx), position: p.add(V(0, -0.08, 0)), yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), length: Math.max(2, len) });
  }
}

/** the walkable surface nearest a reference height (stacked pieces: a pillar top far above must not win) */
function heightNear(game, x, z, yRef) {
  let best = null;
  for (const s of (game._kitSurfaces || [])) {
    const h = s.heightAt(x, z);
    if (h == null || h > yRef + 3) continue;
    if (best == null || Math.abs(h - yRef) < Math.abs(best - yRef)) best = h;
  }
  return best;
}

function boundsOf(points, pad = 10) {
  const b = new THREE.Box3().setFromPoints(points);
  b.expandByVector(V(pad, pad, pad));
  return b;
}

// ------------------------------------------------------------------------------------------------ sky_islands
function skyIslands(ctx) {
  const { game, level, rnd, S } = ctx;
  const count = Math.max(4, Math.round((6 + rnd() * 2.6) * S));
  const islands = [];
  const conns = [];      // {type, a, b, platforms}
  const route = [];
  let dir = rnd() * Math.PI * 2;
  let pos = V(0, 0, 0);
  // per-seed variety: the arrangement (wander / zig-zag / spiral / climb) and a shuffled crossing mix
  const mode = ['wander', 'zigzag', 'spiral', 'climb'][Math.floor(rnd() * 4)];
  const turn = rnd() < 0.5 ? -1 : 1;
  const types = ['hop', 'bridge', 'platforms', 'hop', 'platforms', 'bridge', rnd() < 0.5 ? 'hop' : 'bridge'];
  for (let k = types.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [types[k], types[j]] = [types[j], types[k]]; }
  level.layout = mode;
  // start island
  islands.push(World.island(game, { ...P(ctx), position: pos, radius: 12, depth: 11, seed: ctx.seed * 31 + 1 }));
  for (let i = 1; i < count; i++) {
    const last = i === count - 1;
    // the first crossing is always an easy, obvious one: a short bridge (naive players must not die in the first 15 u)
    const type = i === 1 ? 'first' : last ? 'bridge' : types[(i - 2) % types.length];
    const r = last ? 13 : 7 + rnd() * 4.5;
    if (i > 1) dir += mode === 'zigzag' ? turn * (i % 2 ? 1 : -1) * (0.55 + rnd() * 0.35)
      : mode === 'spiral' ? turn * (0.42 + rnd() * 0.22) : (rnd() - 0.5) * 1.3;
    const A = islands[i - 1];
    let gap, rise;
    if (type === 'first') { gap = 6 + rnd() * 2; rise = 0; }
    else if (type === 'hop') { gap = 3 + rnd() * 1.5; rise = (mode === 'climb' ? rnd() : rnd() - 0.2) * MAX_RISE * 0.8; }
    else if (type === 'bridge') { gap = 9 + rnd() * 5; rise = (rnd() - 0.5) * 2.0; }
    else { gap = 13 + rnd() * 6; rise = (mode === 'climb' ? 2.5 : 1.5) + rnd() * 2.5; }
    const d = A.radius + r + gap;
    const np = V(A.position.x + Math.cos(dir) * d, A.position.y + rise, A.position.z + Math.sin(dir) * d);
    const B = World.island(game, { ...P(ctx), position: np, radius: r, depth: r * (0.8 + rnd() * 0.5), seed: ctx.seed * 31 + 1 + i,
      waterfall: !last && i % 3 === 1 });
    islands.push(B);
    conns.push({ type: type === 'first' ? 'bridge' : type, a: A, b: B, first: type === 'first' });
  }
  // connections: measure the real rim gap and build what crosses it
  const goalI = islands[islands.length - 1];
  route.push(islands[0].surfacePoint(islands[0].position.x, islands[0].position.z));
  const jumps = [];      // [{from, to}] for coin arcs
  for (const c of conns) {
    const { a, b } = c;
    const ang = Math.atan2(b.position.z - a.position.z, b.position.x - a.position.x);
    const ea = a.edgePoint(ang, 1.0), eb = b.edgePoint(ang + Math.PI, 1.0);
    const rimGap = ea.distanceTo(eb) - 0; // approx with 1u inset each side
    const dy = eb.y - ea.y;
    if (c.type === 'bridge' && Math.abs(dy) <= 2.2) {
      const ba = a.edgePoint(ang, 1.6), bb = b.edgePoint(ang + Math.PI, 1.6);
      World.prop(game, 'bridge', { ...P(ctx), from: ba, to: bb, width: 2.8 });
      for (const t of [0.0, 1.0]) {
        const p = ba.clone().lerp(bb, t), side = V(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(2.2);
        for (const sgn of [-1, 1]) World.prop(game, 'lamp', { ...P(ctx), position: p.clone().addScaledVector(side, sgn).add(V(0, 0, 0)).setY(p.y), height: 2.6 });
      }
      route.push(ba, bb);
      World.noPlant(game, [ba, bb], 2.6);
    } else if (rimGap - 2 <= MAX_GAP && dy <= MAX_RISE) {
      route.push(ea, eb);
      jumps.push({ from: ea, to: eb });
    } else {
      // stepping platforms (round mini islands): n platforms so every gap <= MAX_GAP and every rise <= MAX_RISE
      const pr = 2.4;
      let n = 1;
      while (n < 8 && ((rimGap - n * 2 * pr) / (n + 1) > MAX_GAP - 0.8 || dy / (n + 1) > MAX_RISE - 0.3)) n++;
      let prevP = ea;
      route.push(ea);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const p = ea.clone().lerp(eb, t);
        p.y = ea.y + dy * t + (k % 2 ? 0.6 : -0.3);
        const side = V(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar((k % 2 ? 1 : -1) * 1.2);
        p.add(side);
        World.prop(game, 'platform_round', { ...P(ctx), position: p, radius: pr, thick: 0.9 });
        route.push(p.clone());
        jumps.push({ from: prevP, to: p.clone() });
        prevP = p.clone();
      }
      route.push(eb);
      jumps.push({ from: prevP, to: eb });
    }
    // walk across island b toward its exit (or centre for the goal)
    route.push(b.surfacePoint(b.position.x, b.position.z));
  }
  // dedupe tiny steps
  level.route = route.filter((p, i) => i === 0 || p.distanceTo(route[i - 1]) > 0.5);

  // spawn + goal
  const s0 = islands[0];
  const first = level.route[1] || V(1, 0, 0);
  level.spawn = s0.surfacePoint(s0.position.x, s0.position.z).add(V(0, 1.0, 0));
  level.spawnYaw = yawTo(level.spawn, first);
  const gp = goalI.surfacePoint(goalI.position.x, goalI.position.z);
  level.goal = { position: gp.clone().add(V(0, 0.5, 0)), radius: 3 };
  {
    const back = Math.atan2(gp.x - islands[islands.length - 2].position.x, gp.z - islands[islands.length - 2].position.z);
    World.prop(game, 'arch', { ...P(ctx), position: gp.clone().add(V(Math.sin(back) * 3.5, -0.2, Math.cos(back) * 3.5)), yaw: back, width: 6.5, height: 4.5 });
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      World.prop(game, k % 2 ? 'crystal' : 'pillar', { ...P(ctx), position: goalI.edgePoint(a, 2.2).add(V(0, -0.1, 0)), scale: k % 2 ? 0.8 : 0.6, height: 3 });
    }
    World.prop(game, 'flag', { ...P(ctx), position: gp.clone().add(V(-Math.cos(back) * 3, -0.1, Math.sin(back) * 3)), height: 6 });
  }
  World.noPlant(game, [level.goal.position], 4.5);
  World.noPlant(game, [level.spawn], 4);
  World.noPlant(game, [level.spawn.clone().add(V(-Math.sin(level.spawnYaw) * 7, 0, -Math.cos(level.spawnYaw) * 7))], 3.5);

  // checkpoints on every second island
  for (let i = 2; i < islands.length - 1; i += 2) {
    const isl = islands[i];
    level.checkpoints.push({ position: isl.surfacePoint(isl.position.x, isl.position.z).add(V(0, 0.1, 0)), radius: 3 });
  }

  // hazards (Gameplay draws them): spike patches beside the path, a spinner on the widest middle island
  for (let i = 2; i < islands.length - 1; i++) {
    const isl = islands[i];
    if (i % 2 === 0 && isl.radius > 8) {
      const c = isl.surfacePoint(isl.position.x, isl.position.z), a = rnd() * Math.PI * 2;
      const sp = isl.surfacePoint(c.x + Math.cos(a) * isl.radius * 0.5, c.z + Math.sin(a) * isl.radius * 0.5);
      if (level.route.every(r => r.distanceTo(sp) > 3.2)) { level.hazards.push({ type: 'spikes', position: sp, size: V(2, 0.7, 2) }); World.noPlant(game, [sp], 1.8); }
    }
  }
  {
    const mids = islands.slice(2, -1).sort((a, b) => b.radius - a.radius);
    if (mids[0] && mids[0].radius > 9.5) { const isl = mids[0]; const c = isl.surfacePoint(isl.position.x, isl.position.z); level.hazards.push({ type: 'spinner', position: c, length: Math.min(9, isl.radius * 0.9), speed: 1.2, height: 0.9 }); World.noPlant(game, [c], 4.8); }
  }
  // collectibles: coin trail along the route + arcs over every jump
  const coins = [];
  for (const j of jumps) {
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, p = j.from.clone().lerp(j.to, t);
      p.y += 1.2 + Math.sin(t * Math.PI) * 2.6;
      coins.push(p);
    }
  }
  const trail = alongRoute(level.route, Math.max(0, ctx.n - coins.length), 0.04, 0.96).map(p => p.add(V(0, 1.2, 0)));
  for (const p of [...coins, ...trail].slice(0, ctx.n)) level.collectibles.push({ position: p, tag: 'coin' });

  // decoration: props + foliage on every island (route kept clear)
  const dense = densify(level.route, 1.5);
  World.noPlant(game, dense, 1.8);
  islands.forEach((isl, i) => {
    const big = isl.radius > 9;
    if (i > 0 && i < islands.length - 1) {
      const a = rnd() * Math.PI * 2;
      if (big) World.prop(game, rnd() < 0.5 ? 'crate' : 'barrel', { ...P(ctx), position: isl.edgePoint(a, 2.5).add(V(0, -0.05, 0)), yaw: a });
      if (rnd() < 0.5) World.prop(game, 'rock', { ...P(ctx), position: isl.edgePoint(a + 2, 2.0), size: 0.8 + rnd() * 0.6 });
    }
    World.foliage(game, { ...P(ctx), area: isl, kinds: { grass: 1, flowers: 1, bush: 1, tree_round: big ? 1 : 0.6, tree_pine: 0.5, mushroom: 0.6, rock: 0.5 },
      seed: ctx.seed * 101 + i });
  });
  if (islands[0]) guardRails(ctx, islands[0], level.route[1] || islands[1].position);
  if (islands[0]) {
    const f = V(Math.sin(level.spawnYaw), 0, Math.cos(level.spawnYaw)), sd = V(f.z, 0, -f.x);
    const sp = level.spawn.clone().addScaledVector(f, 3 + rnd() * 3).addScaledVector(sd, (rnd() < 0.5 ? -1 : 1) * 3.4);
    World.prop(game, 'sign', { ...P(ctx), position: islands[0].surfacePoint(sp.x, sp.z), yaw: level.spawnYaw + Math.PI + 0.4 });
  }

  // a bonus side island reached by a moving platform (off the main route)
  {
    const mid = islands[Math.floor(islands.length / 2)];
    const prevI = islands[Math.floor(islands.length / 2) - 1];
    const pathDir = Math.atan2(mid.position.z - prevI.position.z, mid.position.x - prevI.position.x);
    const side = pathDir + Math.PI / 2 * (rnd() < 0.5 ? 1 : -1);
    const bonusR = 6;
    const bp = V(mid.position.x + Math.cos(side) * (mid.radius + bonusR + 14), mid.position.y + 3, mid.position.z + Math.sin(side) * (mid.radius + bonusR + 14));
    const bonus = World.island(game, { ...P(ctx), position: bp, radius: bonusR, depth: 7, seed: ctx.seed * 7 + 99 });
    World.prop(game, 'chest', { ...P(ctx), position: bonus.surfacePoint(bp.x, bp.z), yaw: side + Math.PI });
    World.foliage(game, { ...P(ctx), area: bonus, kinds: { grass: 1, flowers: 1.5, mushroom: 1 }, avoid: [{ position: bp, radius: 2.5 }], seed: 4242 + ctx.seed });
    const a = mid.edgePoint(side, 3.0), b = bonus.edgePoint(side + Math.PI, 3.0);
    const mesh = World.prop(game, 'platform_round', { ...P(ctx), position: a, radius: 2.2, thick: 0.7, collider: false });
    level.movers.push({ mesh, path: [a.clone(), b.clone()], period: 6, type: 'platform', size: [4.4, 0.7, 4.4] });
    for (let k = 0; k < 5; k++) {
      const q = bonus.edgePoint(k / 5 * Math.PI * 2, 2.2).add(V(0, 1.2, 0));
      level.collectibles.push({ position: q, tag: 'gem' });
    }
  }

  // sky dressing: cloud sea below, clouds around, distant decorative islands for depth
  let minY = Infinity; for (const isl of islands) minY = Math.min(minY, isl.position.y);
  const ctr = new THREE.Box3().setFromPoints(islands.map(i => i.position)).getCenter(V(0, 0, 0));
  const span = islands.reduce((m, i) => Math.max(m, i.position.distanceTo(ctr) + i.radius), 0);
  World.clouds(game, { ...P(ctx), count: 60, height: minY - 30 - ctr.y, center: ctr, radius: span + 150, below: true, speed: 1.0, seed: ctx.seed + 5 });
  World.clouds(game, { ...P(ctx), count: 14, height: 30, center: ctr, radius: span + 160, speed: 1.6, seed: ctx.seed + 6 });
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + rnd(), d = span + 70 + rnd() * 110;
    const p = V(ctr.x + Math.cos(a) * d, ctr.y - 8 + rnd() * 30, ctr.z + Math.sin(a) * d);
    const isl = World.island(game, { ...P(ctx), position: p, radius: 8 + rnd() * 14, seed: 500 + k + ctx.seed, collider: false, waterfall: k % 3 === 0 });
    World.foliage(game, { ...P(ctx), area: isl, kinds: { tree_round: 1.5, tree_pine: 1, bush: 1, grass: 0.25 }, seed: 900 + k });
  }
  level.killY = minY - 25;
  level.hazards.push({ type: 'void', y: level.killY, position: V(ctr.x, level.killY, ctr.z) });
  level.islands = islands;
  level.bounds = boundsOf(islands.flatMap(i => [i.position.clone().add(V(i.radius, 6, i.radius)), i.position.clone().add(V(-i.radius, -i.depth, -i.radius))]), 4);
}

// ------------------------------------------------------------------------------------------------ meadow_course
function meadowCourse(ctx) {
  const { game, level, rnd, S } = ctx;
  const L = 170 * S;                                      // course length along x
  const amp = 16 * S;
  // centre line of the course (xz), start at -L/2, goal at +L/2
  const ctrl = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    ctrl.push(V(-L / 2 + t * L, 0, Math.sin(t * Math.PI * 2.1 + ctx.seed) * amp * (i === 0 || i === 8 ? 0.3 : 1)));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const samples = curve.getSpacedPoints(400);
  const distToPath = (x, z) => { let m = Infinity; for (let i = 0; i < samples.length; i += 2) { const s = samples[i]; const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < m) m = d; } return Math.sqrt(m); };
  // a river crosses the course at ~38% of its length
  const riverT = 0.38, rp = curve.getPointAt(riverT), rtan = curve.getTangentAt(riverT);
  const riverHalf = 4.5;
  const riverDist = (x, z) => {        // distance across the river; it meanders away from the crossing
    const u = (x - rp.x) * -rtan.z + (z - rp.z) * rtan.x;
    const off = (7 * Math.sin(u * 0.045 + 1.3) + 3 * Math.sin(u * 0.11)) * THREE.MathUtils.smoothstep(Math.abs(u), 10, 40);
    return Math.abs((x - rp.x) * rtan.x + (z - rp.z) * rtan.z - off);
  };
  const pal = Look.palette(game);
  const dirt = new THREE.Color(pal.ground).lerp(new THREE.Color(pal.sand), 0.35);
  const size = L + 140;
  const ground = World.ground(game, {
    ...P(ctx), size, center: V(0, 0, 0), flat: L * 0.5, hills: 16, bumps: 0.35, seed: ctx.seed + 3,
    flatAt: (x, z) => { const d = distToPath(x, z); return THREE.MathUtils.smoothstep(14 - d, 0, 8); },
    height: (x, z, y) => {
      const rd = riverDist(x, z);
      if (rd < riverHalf + 3) { const k = THREE.MathUtils.smoothstep(riverHalf + 3 - rd, 0, 3.5); return y * (1 - k) - 2.2 * k; }
      return y;
    },
    paint: (x, z, c) => {
      const d = distToPath(x, z);
      const k = THREE.MathUtils.smoothstep(3.6 - d + Math.sin(x * 0.7) * 0.4, 0, 1.2);
      if (k > 0) c.lerp(dirt, k * 0.85);
      const rd = riverDist(x, z);
      if (rd < riverHalf + 2.5) c.lerp(new THREE.Color(pal.sand), THREE.MathUtils.smoothstep(riverHalf + 2.5 - rd, 0, 1.5) * 0.8);
    },
  });
  World.water(game, { ...P(ctx), level: -0.7, size: size, center: V(0, 0, 0), seed: ctx.seed });
  level.water = { y: -0.7 };
  const gy = (x, z) => ground.heightAt(x, z) ?? 0;
  const route = [];
  const on = (t, lift = 0) => { const p = curve.getPointAt(t); p.y = gy(p.x, p.z) + lift; return p; };
  const yawAt = (t) => { const tg = curve.getTangentAt(t); return Math.atan2(tg.x, tg.z); };
  const jumps = [];
  // obstacle sections along the course
  const sections = [
    { t: 0.14, type: 'hurdle' }, { t: 0.24, type: 'crates' }, { t: riverT, type: 'river' }, { t: 0.52, type: 'steps' },
    { t: 0.66, type: 'hurdle' }, { t: 0.76, type: 'platforms' }, { t: 0.88, type: 'hurdle' },
  ];
  let tPrev = 0.0;
  route.push(on(0.01));
  const pushPath = (t0, t1) => { const n = Math.max(1, Math.round((t1 - t0) * L / 6)); for (let k = 1; k <= n; k++) route.push(on(t0 + (t1 - t0) * k / n)); };
  for (const sec of sections) {
    const t = sec.t, p = on(t), yaw = yawAt(t);
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
    const side = V(fwd.z, 0, -fwd.x);
    const dt = 1 / L;                               // 1 unit of course length in t
    if (sec.type === 'hurdle') {
      pushPath(tPrev, t - 3 * dt);
      World.prop(game, 'fence', { ...P(ctx), position: p.clone().setY(gy(p.x, p.z) - 0.1), yaw, length: 7, scale: 1 });
      const a = on(t - 3 * dt), b = on(t + 3 * dt);
      jumps.push({ from: a, to: b, h: 2.4 });
      route.push(b); tPrev = t + 3 * dt;
    } else if (sec.type === 'crates') {
      pushPath(tPrev, t - 3 * dt);
      const c1 = p.clone().addScaledVector(fwd, -0.8);
      World.prop(game, 'crate', { ...P(ctx), position: c1.setY(gy(c1.x, c1.z) - 0.05), yaw, size: 1.6 });
      const c2 = p.clone().addScaledVector(fwd, 1.0).addScaledVector(side, 1.7);
      World.prop(game, 'crate', { ...P(ctx), position: c2.setY(gy(c2.x, c2.z) - 0.05), yaw: yaw + 0.3, size: 1.6 });
      const c3 = p.clone().addScaledVector(fwd, 0.3).addScaledVector(side, 1.0);
      World.prop(game, 'crate', { ...P(ctx), position: c3.setY(gy(c3.x, c3.z) + 1.55), yaw: yaw + 0.1, size: 1.4 });
      World.prop(game, 'barrel', { ...P(ctx), position: p.clone().addScaledVector(side, -2.4).setY(gy(p.x, p.z)) });
      const top = c1.clone().setY(c1.y + 1.65);
      route.push(top); jumps.push({ from: on(t - 3 * dt), to: top, h: 2.6 });
      const b = on(t + 4 * dt); route.push(b); tPrev = t + 4 * dt;
    } else if (sec.type === 'river') {
      // stepping stones across the river, every gap <= MAX_GAP
      const a = on(t - (riverHalf + 2.5) * dt), b = on(t + (riverHalf + 2.5) * dt);
      pushPath(tPrev, t - (riverHalf + 2.5) * dt);
      const n = 3;
      let prevP = a;
      for (let k = 1; k <= n; k++) {
        const q = a.clone().lerp(b, k / (n + 1)).addScaledVector(side, (k % 2 ? 0.7 : -0.7));
        q.y = 0.15;
        World.prop(game, 'platform_round', { ...P(ctx), position: q, radius: 1.3, thick: 3.0, color: 'stone' });
        route.push(q.clone()); jumps.push({ from: prevP, to: q.clone(), h: 1.6 }); prevP = q.clone();
      }
      route.push(b); jumps.push({ from: prevP, to: b, h: 1.6 }); tPrev = t + (riverHalf + 2.5) * dt;
      // a bridge further along the river for looks (off route)
      const nrm = V(-rtan.z, 0, rtan.x), along = V(rtan.x, 0, rtan.z).normalize(), u0 = -34;
      const off0 = 7 * Math.sin(u0 * 0.045 + 1.3) + 3 * Math.sin(u0 * 0.11);
      const bp = rp.clone().addScaledVector(nrm.normalize(), u0).addScaledVector(along, off0);
      const e1 = bp.clone().addScaledVector(along, riverHalf + 4), e2 = bp.clone().addScaledVector(along, -(riverHalf + 4));
      e1.y = gy(e1.x, e1.z) + 0.1; e2.y = gy(e2.x, e2.z) + 0.1;
      World.prop(game, 'bridge', { ...P(ctx), from: e1, to: e2, width: 3 });
    } else if (sec.type === 'steps') {
      // three rising blocks then a drop
      pushPath(tPrev, t - 6 * dt);
      let prevP = on(t - 6 * dt);
      const base = gy(p.x, p.z);
      for (let k = 0; k < 3; k++) {
        const q = on(t - 3 * dt + k * 4.2 * dt); const hgt = 1.6 * (k + 1);
        q.y = base + hgt;
        World.prop(game, 'platform_box', { ...P(ctx), position: q, size: [3.6, hgt + 2, 3.6] });
        route.push(q.clone()); jumps.push({ from: prevP, to: q.clone(), h: 1.5 }); prevP = q.clone();
      }
      const b = on(t + 13 * dt); route.push(b); tPrev = t + 13 * dt;
    } else if (sec.type === 'platforms') {
      // floating stepping platforms in a zig-zag, low enough that a miss is not a death
      pushPath(tPrev, t - 6 * dt);
      let prevP = on(t - 6 * dt);
      for (let k = 0; k < 4; k++) {
        const q = on(t - 2 * dt + k * 4.5 * dt).addScaledVector(side, k % 2 ? 1.8 : -1.8);
        q.y = gy(q.x, q.z) + 1.2 + k * 0.9;
        World.prop(game, 'platform_round', { ...P(ctx), position: q, radius: 1.8, thick: 0.6 });
        route.push(q.clone()); jumps.push({ from: prevP, to: q.clone(), h: 1.4 }); prevP = q.clone();
      }
      const b = on(t + 18 * dt); route.push(b); jumps.push({ from: prevP, to: b, h: 1 }); tPrev = t + 18 * dt;
    }
  }
  pushPath(tPrev, 0.985);
  for (const t of [0.2, 0.46, 0.71, 0.93]) {
    const p = on(t), yaw = yawAt(t), sd = (t * 10 | 0) % 2 ? 1 : -1;
    const q = p.clone().add(V(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(3.4 * sd)); q.y = gy(q.x, q.z);
    level.hazards.push({ type: 'spikes', position: q, size: V(1.6, 0.6, 1.6) });
  }
  level.route = route.filter((p, i) => i === 0 || p.distanceTo(route[i - 1]) > 0.5);
  level.spawn = on(0.01, 1.0);
  level.spawnYaw = yawAt(0.02);
  const gp = on(0.985);
  level.goal = { position: gp.clone().add(V(0, 0.5, 0)), radius: 3 };
  World.prop(game, 'arch', { ...P(ctx), position: on(0.965).add(V(0, -0.1, 0)), yaw: yawAt(0.965), width: 7, height: 5 });
  World.prop(game, 'flag', { ...P(ctx), position: gp.clone().add(V(0, -0.1, 3.2)), height: 6 });
  World.prop(game, 'flag', { ...P(ctx), position: gp.clone().add(V(0, -0.1, -3.2)), height: 6, color: 'secondary' });
  World.prop(game, 'sign', { ...P(ctx), position: on(0.03).add(V(0, 0, 4)), yaw: yawAt(0.03) });
  for (const t of [0.3, 0.6, 0.82]) level.checkpoints.push({ position: on(t, 0.1), radius: 3.5 });

  // collectibles: arcs over every jump + trail along the path
  const coins = [];
  for (const j of jumps) for (let k = 1; k <= 2; k++) { const t = k / 3; const q = j.from.clone().lerp(j.to, t); q.y += 1.3 + Math.sin(t * Math.PI) * (j.h || 2); coins.push(q); }
  const trail = alongRoute(level.route, Math.max(0, ctx.n - coins.length)).map(q => q.add(V(0, 1.2, 0)));
  for (const q of [...coins, ...trail].slice(0, ctx.n)) level.collectibles.push({ position: q, tag: 'coin' });

  // dressing: lamps + fences along the path, a farm, trees and meadow everywhere else
  const dense = densify(level.route, 1.5);
  World.noPlant(game, dense, 2.6);
  World.noPlant(game, samples.filter((_, i) => i % 3 === 0), 3.2);
  for (let k = 1; k < 12; k++) {
    const t = k / 12 + 0.02; if (sections.some(s => Math.abs(s.t - t) < 0.05)) continue;
    const p = on(t), yaw = yawAt(t), side = V(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(k % 2 ? 4.6 : -4.6);
    const q = p.clone().add(side); q.y = gy(q.x, q.z) - 0.05;
    World.prop(game, k % 3 === 0 ? 'lamp' : 'fence', { ...P(ctx), position: q, yaw: yaw + Math.PI / 2, length: 6 });
  }
  const farm = curve.getPointAt(0.45).add(V(0, 0, -amp - 22));
  farm.y = gy(farm.x, farm.z);
  World.prop(game, 'windmill', { ...P(ctx), position: farm.clone().add(V(-10, 0, -6)).setY(gy(farm.x - 10, farm.z - 6) - 0.2) });
  World.prop(game, 'house', { ...P(ctx), position: farm.clone().setY(farm.y - 0.1), yaw: 0.3, width: 7, depth: 5.5 });
  World.prop(game, 'well', { ...P(ctx), position: farm.clone().add(V(8, 0, 3)).setY(gy(farm.x + 8, farm.z + 3) - 0.1) });
  const farm2 = curve.getPointAt(0.8).add(V(0, 0, amp + 24)); farm2.y = gy(farm2.x, farm2.z);
  World.prop(game, 'house', { ...P(ctx), position: farm2.setY(farm2.y - 0.1), yaw: Math.PI + 0.2, width: 6, depth: 5, floors: 2, roofColor: 'secondary' });
  World.foliage(game, { ...P(ctx), area: { min: [-size / 2 + 4, -size / 2 + 4], max: [size / 2 - 4, size / 2 - 4] },
    kinds: { grass: 1.1, flowers: 1.4, bush: 1, tree_round: 1.2, tree_pine: 0.8, rock: 0.6, mushroom: 0.3 }, density: 0.85, minY: -0.35, seed: ctx.seed + 77, focus: samples, focusRadius: 40 });
  World.clouds(game, { ...P(ctx), count: 18, height: 55, radius: size * 0.8, seed: ctx.seed + 9 });
  level.killY = -12;
  level.hazards.push({ type: 'void', y: level.killY, position: V(0, level.killY, 0) });
  level.ground = ground;
  level.bounds = boundsOf(samples, 14);
}

// ------------------------------------------------------------------------------------------------ arena
function arena(ctx) {
  const { game, level, rnd, S } = ctx;
  const R = 34 * S;
  const ground = World.ground(game, { ...P(ctx), size: R * 2 + 160, flat: R + 8, hills: 18, bumps: 0.15, seed: ctx.seed + 3, style: 'grass',
    height: (x, z, y) => y * THREE.MathUtils.smoothstep(Math.hypot(x, z), R + 1, R + 8),
    paint: (x, z, c) => { const d = Math.hypot(x, z); if (d < R + 4) c.lerp(new THREE.Color(Look.palette(game).ground), THREE.MathUtils.smoothstep(R + 4 - d, 0, 2) * 0.5); },
  });
  const floor = World.plaza(game, { ...P(ctx), center: V(0, 0, 0), radius: R, trimAt: 0.62, seed: ctx.seed });
  const gy = (x, z) => World.heightAt(game, x, z) ?? 0;
  // ring wall with 4 gates
  const segs = Math.round(R * 0.55);
  for (let i = 0; i < segs; i++) {
    const a = (i + 0.5) / segs * Math.PI * 2;
    const gate = [0, 0.25, 0.5, 0.75].some(g => Math.abs(((a / (Math.PI * 2) - g + 1.5) % 1) - 0.5) < 0.5 / segs * 1.2);
    const p = V(Math.cos(a) * (R + 1), 0, Math.sin(a) * (R + 1)); p.y = gy(p.x, p.z) - 0.1;
    if (gate) {
      World.prop(game, 'arch', { ...P(ctx), position: p, yaw: -a + Math.PI / 2, width: 5.5, height: 4.2 });
      continue;
    }
    World.prop(game, 'wall', { ...P(ctx), position: p, yaw: -a + Math.PI / 2, length: (Math.PI * 2 * (R + 1)) / segs + 0.3, height: 2.4 });
    if (i % 3 === 0) World.prop(game, 'pillar', { ...P(ctx), position: p.clone().multiplyScalar(1.0), height: 4.2, scale: 0.9 });
  }
  // cover: symmetric crates, pillars, low walls; four raised platforms with ramps
  const cover = ['crate', 'pillar', 'wall', 'barrel', 'rock'];
  for (let q = 0; q < 4; q++) {
    const base = q * Math.PI / 2 + Math.PI / 4;
    // raised platform
    const pp = V(Math.cos(base) * R * 0.62, 0, Math.sin(base) * R * 0.62);
    const ph = 2.2;
    World.prop(game, 'platform_box', { ...P(ctx), position: pp.clone().setY(gy(pp.x, pp.z) + ph), size: [7, ph + 1, 7], color: 'stone' });
    const rampDir = base + Math.PI;           // ramp toward the centre
    const rp = pp.clone().add(V(Math.cos(rampDir) * 6.5, 0, Math.sin(rampDir) * 6.5)); rp.y = gy(rp.x, rp.z);
    World.prop(game, 'ramp', { ...P(ctx), position: rp, yaw: -rampDir + Math.PI, length: 6, width: 3.6, height: ph });
    World.prop(game, 'crystal', { ...P(ctx), position: pp.clone().setY(gy(pp.x, pp.z) + ph).add(V(Math.cos(base) * 2.2, 0, Math.sin(base) * 2.2)), scale: 0.7 });
    for (let k = 0; k < 3; k++) {
      const a = base + (k - 1) * 0.42, d = R * (k === 1 ? 0.33 : 0.42);
      const cp = V(Math.cos(a) * d, 0, Math.sin(a) * d); cp.y = gy(cp.x, cp.z) - 0.05;
      const kind = cover[(q + k) % cover.length];
      World.prop(game, kind, { ...P(ctx), position: cp, yaw: -a, length: 4, height: 1.6, size: 1.6 });
    }
    level.collectibles.push({ position: pp.clone().setY(gy(pp.x, pp.z) + ph + 1.2), tag: 'gem' });
  }
  World.prop(game, 'fountain', { ...P(ctx), position: V(0, gy(0, 0) - 0.05, 0), radius: 3.2 });
  for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2; const p = V(Math.cos(a) * R * 0.5, 0, Math.sin(a) * R * 0.5); p.y = gy(p.x, p.z); level.hazards.push({ type: 'bounce', position: p, power: 22, radius: 1.3 }); }
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.2; const p = V(Math.cos(a) * (R - 2.5), 0, Math.sin(a) * (R - 2.5)); p.y = gy(p.x, p.z); World.prop(game, 'lamp', { ...P(ctx), position: p, height: 3.4 }); }
  // route: a loop around the arena
  const route = [];
  const loopR = R * 0.8;
  for (let k = 0; k <= 16; k++) { const a = -Math.PI / 2 + k / 16 * Math.PI * 2; const p = V(Math.cos(a) * loopR, 0, Math.sin(a) * loopR); p.y = gy(p.x, p.z); route.push(p); }
  level.route = route;
  level.spawn = V(0, gy(0, -R * 0.8) + 1, -R * 0.8);
  level.spawn.set(route[0].x, route[0].y + 1, route[0].z);
  level.spawnYaw = yawTo(route[0], route[1]);
  level.goal = null;
  level.checkpoints.push({ position: V(0, gy(0, -6) + 0.1, -6), radius: 3 });
  // collectibles: rings and lines inside the arena
  const n = Math.max(0, ctx.n - level.collectibles.length);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 * 2.0, d = R * (0.2 + 0.6 * ((i * 0.618) % 1));
    const p = V(Math.cos(a) * d, 0, Math.sin(a) * d); p.y = gy(p.x, p.z) + 1.2;
    level.collectibles.push({ position: p, tag: 'coin' });
  }
  level.hazards.push({ type: 'void', y: -20, position: V(0, -20, 0) });
  // spawn points for enemies / bots around the ring
  level.spawnPoints = [0, 1, 2, 3].map(q => { const a = q * Math.PI / 2; const p = V(Math.cos(a) * R * 0.75, 0, Math.sin(a) * R * 0.75); p.y = gy(p.x, p.z) + 1; return p; });
  World.noPlant(game, [V(0, 0, 0)], R + 3);
  const night = Look.isNight(game);
  World.foliage(game, { ...P(ctx), area: { center: V(0, 0, 0), radius: R + 75, inner: R + 3 },
    // at night the outside stays calm: fewer, cleaner silhouettes, so the lit arena is the focus
    kinds: night ? { tree_round: 0.7, tree_pine: 0.7, crystal: 0.25 } : { grass: 1, flowers: 1, tree_round: 1.4, tree_pine: 1.4, bush: 1, rock: 1 },
    density: night ? 0.55 : 1, seed: ctx.seed + 2, focus: [V(0, 0, 0)], focusRadius: R + 30 });
  if (game.look && game.look.name === 'neon_night') {
    // neon: magenta and cyan key lights across the arena, a glowing rim on the wall
    const pal = Look.palette(game);
    for (const [c, a] of [[pal.secondary, 0.6], [pal.primary, 0.6 + Math.PI]]) {
      const l = new THREE.PointLight(c, 380, R * 2.6, 1.6);
      l.position.set(Math.cos(a) * R * 0.9, 14, Math.sin(a) * R * 0.9);
      ctx.group.add(l);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 1, 0.12, 6, 160).rotateX(Math.PI / 2),
      Look.material(game, { kind: 'emissive', color: pal.primary, emissive: pal.primary, emissiveIntensity: 2.2 }));
    ring.position.y = 2.5; ctx.group.add(ring);
  }
  World.clouds(game, { ...P(ctx), count: 16, height: 50, radius: R + 160, seed: ctx.seed });
  level.ground = ground;
  level.bounds = new THREE.Box3(V(-R - 3, -1, -R - 3), V(R + 3, 10, R + 3));
}

// ------------------------------------------------------------------------------------------------ town
function town(ctx) {
  // A cozy village grown along a curving main street: south gate, a stream with a stone bridge, a round plaza with a
  // fountain and market, side alleys ending in small courtyards (nooks), and the town hall on a gentle rise to the north.
  const { game, level, rnd, S } = ctx;
  const pal = Look.palette(game);
  const L = 120 * S;                      // main street length
  const W = 6.5;                          // main street width
  const AW = 3.6;                         // alley width
  const PR = 12;                          // plaza radius
  const rise = 2.2, riseZ = L * 0.3;      // the north end climbs to the town hall terrace

  // main street through the plaza at the origin
  const main = new THREE.CatmullRomCurve3([
    V(-6, 0, -L / 2), V(7, 0, -L * 0.3), V(-2, 0, -L * 0.12), V(0, 0, 0), V(5, 0, L * 0.14), V(-6, 0, L * 0.32), V(0, 0, L / 2),
  ], false, 'centripetal');
  const mainPts = main.getSpacedPoints(160);
  // stream: an east-west curve south of the plaza
  const zS = -L * 0.26, SH = 3.0;            // centre z, half width of the water
  const streamZ = (x) => zS + 5 * Math.sin(x * 0.045 + 1.1);
  const streamD = (x, z) => Math.abs(z - streamZ(x));
  // alleys: from points on the main street out to a nook
  const alleys = [];
  const alleyDefs = [[0.2, 1, 26], [0.43, -1, 24], [0.62, 1, 28], [0.8, -1, 22]];
  for (const [t, side, len] of alleyDefs) {
    const p = main.getPointAt(t), tg = main.getTangentAt(t), n = V(tg.z, 0, -tg.x).multiplyScalar(side);
    const bend = V(tg.x, 0, tg.z).multiplyScalar((rnd() - 0.5) * 10);
    const a = p.clone().addScaledVector(n, W / 2), m = p.clone().addScaledVector(n, len * 0.55).add(bend), e = p.clone().addScaledVector(n, len).add(bend.clone().multiplyScalar(1.6));
    const c = new THREE.CatmullRomCurve3([a, m, e]);
    alleys.push({ t, side, curve: c, pts: c.getSpacedPoints(40), nook: e.clone(), dir: n });
  }
  const streets = [{ pts: mainPts, hw: W / 2 }, ...alleys.map(a => ({ pts: a.pts, hw: AW / 2 }))];
  // distance to the nearest street (grid-accelerated)
  const CELL = 8, grid = new Map();
  streets.forEach((st, si) => st.pts.forEach((p, i) => { const k = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL); (grid.get(k) || grid.set(k, []).get(k)).push([si, i]); }));
  const streetD = (x, z) => {   // -> signed distance to the street edge (<0 inside), and which street
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); let best = Infinity, bs = -1;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const [si, i] of grid.get((cx + dx) + ',' + (cz + dz)) || []) {
      const p = streets[si].pts[i], d = Math.hypot(p.x - x, p.z - z) - streets[si].hw;
      if (d < best) { best = d; bs = si; }
    }
    return { d: best, s: bs };
  };
  const nookR = 5;
  const inNook = (x, z, pad = 0) => alleys.some(a => Math.hypot(a.nook.x - x, a.nook.z - z) < nookR + pad);
  const terrace = (z) => rise * THREE.MathUtils.smoothstep(z, riseZ, riseZ + 14);

  const size = L + 150;
  const cob = new THREE.Color(pal.stone), cob2 = new THREE.Color(pal.stone).lerp(new THREE.Color(pal.ground), 0.35);
  const ground = World.ground(game, { ...P(ctx), size, flat: L * 0.5 + 20, hills: 22, bumps: 0.18, seed: ctx.seed + 3,
    flatAt: (x, z) => THREE.MathUtils.smoothstep(Math.max(0, 40 - Math.abs(x)), 0, 20) * THREE.MathUtils.smoothstep(L / 2 + 20 - Math.abs(z), 0, 20),
    height: (x, z, y) => {
      let h = y + terrace(z);
      const sd = streamD(x, z);
      if (Math.abs(x) < L) { const k = THREE.MathUtils.smoothstep(SH + 2.5 - sd, 0, 2.5); h = THREE.MathUtils.lerp(h, -1.8, k); }
      return h;
    },
    paint: (x, z, c) => {
      const { d } = streetD(x, z);
      const onPlaza = Math.hypot(x, z) < PR + 1;
      if ((d < 0 || inNook(x, z)) && !onPlaza && streamD(x, z) > SH + 0.6) {
        const cx = Math.floor(x / 0.9), cz = Math.floor(z / 0.9);
        const tile = ((cx * 7 + cz * 13) & 3) / 3;
        c.copy(cob).lerp(cob2, ((cx * 5 + cz * 3) & 7) / 14).multiplyScalar(0.84 + tile * 0.16);
        if (d > -0.5) c.multiplyScalar(0.82);               // kerb line
      } else if (d < 1.4 && !onPlaza) c.lerp(new THREE.Color(pal.ground), 0.45);
      const sd = streamD(x, z);
      if (sd < SH + 2.4 && sd > SH - 0.3) c.lerp(new THREE.Color(pal.stone).multiplyScalar(0.8), 0.7);   // stone banks
    },
  });
  const gy = (x, z) => ground.heightAt(x, z) ?? 0;
  World.water(game, { ...P(ctx), level: -0.7, size, center: V(0, 0, 0), waves: 0.12 });
  level.water = { y: -0.7 };
  World.plaza(game, { ...P(ctx), center: V(0, gy(0, 0), 0), radius: PR, trim: 'roof', emblem: 'stone', trimAt: 0.7, seed: ctx.seed });
  const py = gy(0, 0) + 0.1;

  // bridge where the main street crosses the stream
  let ti = 0, tb = Infinity;
  for (let i = 0; i < mainPts.length; i++) { const d = streamD(mainPts[i].x, mainPts[i].z); if (d < tb) { tb = d; ti = i; } }
  const span = Math.ceil((SH + 3.2) / (L / 160));
  const bA = mainPts[Math.max(0, ti - span)].clone(), bB = mainPts[Math.min(mainPts.length - 1, ti + span)].clone();
  bA.y = gy(bA.x, bA.z) + 0.05; bB.y = gy(bB.x, bB.z) + 0.05;
  World.prop(game, 'bridge', { ...P(ctx), from: bA, to: bB, width: W - 1.5, sag: -0.9 });
  const bridgeY = (p) => {          // deck height along the bridge (an arch, matching World.prop bridge with sag -0.9)
    const ab = bB.clone().sub(bA).setY(0), lenAB = ab.length(); ab.normalize();
    const u = THREE.MathUtils.clamp(p.clone().sub(bA).setY(0).dot(ab) / lenAB, 0, 1);
    return bA.y + (bB.y - bA.y) * u + 0.9 * 4 * u * (1 - u);
  };
  const onBridge = (i) => i > ti - span && i < ti + span;
  // a second, small footbridge further along the stream (dressing) and planters on the banks
  for (const x of [-34, 30]) {
    const z0 = streamZ(x);
    const a = V(x, 0, z0 - SH - 2.2), b = V(x, 0, z0 + SH + 2.2); a.y = gy(a.x, a.z) + 0.05; b.y = gy(b.x, b.z) + 0.05;
    World.prop(game, 'bridge', { ...P(ctx), from: a, to: b, width: 2.4, sag: -0.5 });
  }

  // plaza: fountain, market stalls, benches, lantern posts, two trees
  World.prop(game, 'fountain', { ...P(ctx), position: V(0, py - 0.15, 0), radius: 3.6 });
  const stallCols = ['primary', 'secondary', 'accent', 'roof'];
  const mainTanIn = main.getTangentAt(0.5);
  const avoidA = Math.atan2(mainTanIn.z, mainTanIn.x);
  let si = 0;
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2 + 0.31;
    const da = Math.min(Math.abs(Math.atan2(Math.sin(a - avoidA), Math.cos(a - avoidA))), Math.abs(Math.atan2(Math.sin(a - avoidA - Math.PI), Math.cos(a - avoidA - Math.PI))));
    if (da < 0.45) continue;                                     // keep the street openings clear
    if (alleys.some(al => { const p = al.pts[0]; return Math.abs(Math.atan2(Math.sin(Math.atan2(p.z, p.x) - a), Math.cos(Math.atan2(p.z, p.x) - a))) < 0.35 && Math.hypot(p.x, p.z) < PR + 6; })) continue;
    const r = PR - 1.6, p = V(Math.cos(a) * r, py, Math.sin(a) * r);
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
    if (k % 3 === 0) World.prop(game, 'stall', { ...P(ctx), position: p, yaw, color: stallCols[si++ % 4] });
    else if (k % 3 === 1) World.prop(game, 'bench', { ...P(ctx), position: p.clone().multiplyScalar(0.92).setY(py), yaw });
    else World.prop(game, 'lantern_post', { ...P(ctx), position: p.clone().setY(py), yaw: yaw + Math.PI / 2 });
  }
  for (const a of [avoidA + Math.PI / 2, avoidA - Math.PI / 2]) World.prop(game, 'tree', { ...P(ctx), position: V(Math.cos(a) * 7.2, py, Math.sin(a) * 7.2) });

  // town hall on the terrace at the north end, south gate arch
  const endP = mainPts[mainPts.length - 1], endT = main.getTangentAt(1);
  const hallP = endP.clone().addScaledVector(V(endT.x, 0, endT.z).normalize(), 9);
  World.prop(game, 'tower', { ...P(ctx), position: hallP.clone().setY(gy(hallP.x, hallP.z) - 0.1), height: 13, radius: 3.2 });
  const gateP = mainPts[0];
  World.prop(game, 'arch', { ...P(ctx), position: gateP.clone().setY(gy(gateP.x, gateP.z) - 0.1), yaw: Math.atan2(main.getTangentAt(0).x, main.getTangentAt(0).z), width: W + 2.5, height: 5 });

  // nooks: little courtyards at the end of each alley, each with something to find
  const nookProps = [['well', 'bench', 'barrel'], ['planter', 'crate', 'bench'], ['stall', 'lantern_post', 'planter'], ['well', 'crate', 'barrel']];
  alleys.forEach((a, k) => {
    const c = a.nook, cy = gy(c.x, c.z);
    World.plaza(game, { ...P(ctx), center: V(c.x, cy - 0.06, c.z), radius: nookR - 0.6, trim: 'secondary', emblem: 'accent', seed: k + 9, collider: false });
    const back = Math.atan2(a.dir.x, a.dir.z);
    nookProps[k % 4].forEach((kind, j) => {
      const ang = back + (j - 1) * 0.9;
      const q = c.clone().add(V(Math.sin(ang) * (nookR - 1.4), 0, Math.cos(ang) * (nookR - 1.4))); q.y = gy(q.x, q.z);
      World.prop(game, kind, { ...P(ctx), position: q, yaw: ang + Math.PI, width: 2.0 });
    });
    level.collectibles.push({ position: c.clone().setY(cy + 1.3), tag: 'gem' });
  });

  // houses along every street, facing it; varied size, floors, wall and roof colours
  const walls = ['#f6efe2', '#f3dcc8', '#e8eef2', '#f2e2b6', '#e9d6e4', '#dfe9d2'];
  const roofs = ['roof', 'secondary', 'primary', '#7a5a8a', '#4a7a6a', 'wood'];
  const houses = [];               // footprints {x, z, r}
  const free = (x, z, r) => houses.every(h => Math.hypot(h.x - x, h.z - z) > h.r + r) && Math.hypot(x, z) > PR + r + 1.5
    && streamD(x, z) > SH + r + 1.0 && !inNook(x, z, r + 0.8) && Math.hypot(hallP.x - x, hallP.z - z) > 6 + r
    && streetD(x, z).d > r * 0.7 + 0.4 && Math.abs(x) < size / 2 - 20;
  const gardens = [];
  let hk = 0;
  streets.forEach((st, sidx) => {
    const pts = st.pts, step = sidx === 0 ? 3 : 3;
    for (let i = 2; i < pts.length - 2; i += step) {
      const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)];
      const tg = q.clone().sub(p).setY(0).normalize(), nrm = V(tg.z, 0, -tg.x);
      for (const sd of [-1, 1]) {
        if (rnd() < 0.1) continue;
        const w = 5 + rnd() * 3, d = 4.5 + rnd() * 1.8, r = Math.max(w, d) * 0.55;
        const c = p.clone().addScaledVector(nrm, sd * (st.hw + d / 2 + 1.3));
        if (!free(c.x, c.z, r)) continue;
        const yaw = Math.atan2(-nrm.x * sd, -nrm.z * sd);     // door (+Z) faces the street
        const floors = rnd() < 0.35 ? 2 : 1;
        World.prop(game, 'house', { ...P(ctx), position: c.clone().setY(gy(c.x, c.z) - 0.15), yaw, width: w, depth: d, floors,
          color: walls[hk % walls.length], roofColor: roofs[(hk * 7 + 3) % roofs.length] });
        houses.push({ x: c.x, z: c.z, r });
        hk++;
        // a garden beside some houses: fence on the street side, flowers inside, maybe a washing line
        if (rnd() < 0.45) {
          const gc = c.clone().addScaledVector(tg, (w / 2 + 2.6) * (rnd() < 0.5 ? 1 : -1));
          if (free(gc.x, gc.z, 2.4)) {
            gc.y = gy(gc.x, gc.z);
            const fp = gc.clone().addScaledVector(nrm, -sd * 2.1); fp.y = gy(fp.x, fp.z) - 0.05;
            World.prop(game, 'fence', { ...P(ctx), position: fp, yaw: Math.atan2(tg.x, tg.z) + Math.PI / 2, length: 4.4 });
            if (rnd() < 0.5) World.prop(game, 'washing_line', { ...P(ctx), position: gc.clone().addScaledVector(nrm, sd * 0.8), yaw: Math.atan2(tg.x, tg.z) + Math.PI / 2, length: 4 });
            gardens.push(gc);
            houses.push({ x: gc.x, z: gc.z, r: 2.4 });
          }
        } else if (rnd() < 0.5) {
          const pp = c.clone().addScaledVector(nrm, -sd * (d / 2 + 0.6)).addScaledVector(tg, w * 0.25); pp.y = gy(pp.x, pp.z);
          World.prop(game, rnd() < 0.5 ? 'planter' : 'barrel', { ...P(ctx), position: pp, yaw: Math.atan2(tg.x, tg.z) + Math.PI / 2, width: 1.8 });
        }
      }
    }
  });
  for (const g of gardens) World.foliage(game, { ...P(ctx), area: { center: g, radius: 2.0 }, kinds: { flowers: 9, bush: 6, grass: 2 }, seed: Math.round(g.x * 13 + g.z), cluster: false });
  // lamps along the main street, alternating sides
  for (let i = 8, k = 0; i < mainPts.length - 4; i += 9, k++) {
    if (onBridge(i) || Math.hypot(mainPts[i].x, mainPts[i].z) < PR + 2) continue;
    const p = mainPts[i], tg = main.getTangentAt(i / (mainPts.length - 1)), nrm = V(tg.z, 0, -tg.x).multiplyScalar(k % 2 ? 1 : -1);
    const q = p.clone().addScaledVector(nrm, W / 2 + 0.4); q.y = gy(q.x, q.z);
    World.prop(game, 'lamp', { ...P(ctx), position: q, height: 3.4 });
  }

  // route: gate -> main street (over the bridge) -> around the fountain -> into the first northern alley's nook and back
  // -> up the main street to the town hall
  const routeY = (p, i) => (i != null && onBridge(i)) ? bridgeY(p) : gy(p.x, p.z);
  const route = [];
  const iPlazaIn = mainPts.findIndex(p => Math.hypot(p.x, p.z) < PR - 1);
  for (let i = 6; i < iPlazaIn; i += 3) route.push(mainPts[i].clone().setY(routeY(mainPts[i], i)));
  const aIn = Math.atan2(mainPts[iPlazaIn].z, mainPts[iPlazaIn].x);
  for (let k = 0; k <= 6; k++) { const a = aIn + k / 6 * Math.PI; route.push(V(Math.cos(a) * 7.5, py, Math.sin(a) * 7.5)); }
  const nookAlley = alleys.find(a => a.t > 0.55) || alleys[0];
  const iAlley = Math.round(nookAlley.t * (mainPts.length - 1));
  const iPlazaOut = mainPts.length - 1 - [...mainPts].reverse().findIndex(p => Math.hypot(p.x, p.z) < PR - 1);
  for (let i = iPlazaOut; i <= iAlley; i += 3) route.push(mainPts[i].clone().setY(routeY(mainPts[i])));
  for (let k = 0; k < nookAlley.pts.length; k += 6) { const p = nookAlley.pts[k]; route.push(p.clone().setY(gy(p.x, p.z))); }
  route.push(nookAlley.nook.clone().setY(gy(nookAlley.nook.x, nookAlley.nook.z)));
  for (let k = nookAlley.pts.length - 1; k >= 0; k -= 8) { const p = nookAlley.pts[k]; route.push(p.clone().setY(gy(p.x, p.z))); }
  for (let i = iAlley; i < mainPts.length; i += 3) route.push(mainPts[i].clone().setY(routeY(mainPts[i])));
  level.route = route.filter((p, i) => i === 0 || p.distanceTo(route[i - 1]) > 0.8);
  level.spawn = level.route[0].clone().add(V(0, 1, 0));
  level.spawnYaw = yawTo(level.route[0], level.route[2] || level.route[1]);
  const gp = endP.clone(); gp.y = gy(gp.x, gp.z);
  level.goal = { position: gp.clone().add(V(0, 0.5, 0)), radius: 3 };
  level.checkpoints.push({ position: V(0, py, 0).add(V(Math.cos(aIn) * 9, 0, Math.sin(aIn) * 9)), radius: 3.5 });
  const trail = alongRoute(level.route, Math.max(0, ctx.n - level.collectibles.length)).map(p => p.add(V(0, 1.2, 0)));
  for (const p of trail) level.collectibles.push({ position: p, tag: 'coin' });

  // keep foliage off streets, plaza, houses; meadows and orchards around the village
  for (const st of streets) World.noPlant(game, st.pts.filter((_, i) => i % 2 === 0), (st.hw + 0.6) / 0.6);
  World.noPlant(game, [V(0, 0, 0)], PR + 2);
  World.noPlant(game, alleys.map(a => a.nook), nookR + 1);
  for (const h of houses) World.noPlant(game, [V(h.x, 0, h.z)], h.r + 0.6);
  const outer = size / 2 - 6;
  World.foliage(game, { ...P(ctx), area: { min: [-outer, -outer], max: [outer, outer] }, kinds: { grass: 1, flowers: 1.2, bush: 1, tree_round: 1.3, tree_pine: 0.6, rock: 0.3 },
    density: 0.75, minY: -0.3, seed: ctx.seed + 5, focus: level.route, focusRadius: 28 });
  World.clouds(game, { ...P(ctx), count: 16, height: 55, radius: outer + 80, seed: ctx.seed });
  level.ground = ground;
  const bb = new THREE.Box3().setFromPoints([...mainPts, ...alleys.map(a => a.nook)]);
  bb.expandByVector(V(14, 0, 14)); bb.min.y = -2; bb.max.y = 16;
  level.bounds = bb;
  level.killY = -20;
  level.hazards.push({ type: 'void', y: -20, position: V(0, -20, 0) });
}

// ------------------------------------------------------------------------------------------------ race_track
function raceTrack(ctx) {
  const { game, level, rnd, S } = ctx;
  const pal = Look.palette(game);
  const R = 95 * S;
  const W = opts(ctx).width ?? 14;
  const ctrl = [];
  const K = 12;
  for (let i = 0; i < K; i++) {
    const a = i / K * Math.PI * 2;
    const r = R * (0.75 + 0.35 * Math.sin(a * 2 + ctx.seed) * (0.6 + rnd() * 0.4) + (rnd() - 0.5) * 0.12);
    ctrl.push(V(Math.cos(a) * r * 1.25, 0, Math.sin(a) * r * 0.85));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const lenT = curve.getLength();
  const N = Math.max(300, Math.round(lenT / 1.5));
  const hNoise = (t) => 2.6 * Math.sin(t * Math.PI * 2 * 2 + ctx.seed) + 1.4 * Math.sin(t * Math.PI * 2 * 3 + 1.3);
  const pts = [], tans = [], sides = [], banks = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPointAt(t % 1); p.y = 0.25 + hNoise(t) + 4.4;
    pts.push(p);
    const tg = curve.getTangentAt(t % 1); tans.push(tg);
  }
  // banking from signed curvature
  for (let i = 0; i <= N; i++) {
    const a = tans[(i - 3 + N) % N], b = tans[(i + 3) % N];
    const turn = a.x * b.z - a.z * b.x;
    banks.push(THREE.MathUtils.clamp(turn * 3.5, -0.22, 0.22));
  }
  for (let i = 0; i <= N; i++) { // smooth banks
    let s = 0; for (let k = -6; k <= 6; k++) s += banks[(i + k + N + 1) % (N + 1)]; banks[i] = s / 13;
  }
  const trackCurve = new THREE.CatmullRomCurve3(pts.slice(0, N), true, 'centripetal');
  level.track = trackCurve;
  // road ribbon: hard-edged colour bands (curb | asphalt | centre line | asphalt | curb), banked
  const asphalt = new THREE.Color(Look.isNight(game) ? '#34324a' : '#62646f'), line = new THREE.Color('#f4f4f4');
  const curbA = new THREE.Color(pal.danger), curbB = new THREE.Color('#ffffff'), black = new THREE.Color('#15151a');
  const lanes = [-W / 2 - 1.4, -W / 2, -W / 2 + 0.5, -W / 2 + 0.75, -0.18, 0.18, W / 2 - 0.75, W / 2 - 0.5, W / 2, W / 2 + 1.4];
  const bandColor = (b, i) => {
    const d = i * lenT / N;
    if (b === 0 || b === lanes.length - 2) return Math.floor(d / 2.5) % 2 ? curbA : curbB;
    if (b === 2 || b === lanes.length - 4) return line;                    // white edge lines
    if (b === 4) return Math.floor(d / 4) % 2 ? line : asphalt;             // dashed centre
    if (i < 4 && b > 0 && b < lanes.length - 2) return (b + i) % 2 ? line : black;   // start/finish checker
    return asphalt;
  };
  const edges = [];
  const surf = [];      // per sample: lane points + normal
  for (let i = 0; i <= N; i++) {
    const p = pts[i], tg = tans[i];
    const side = V(tg.z, 0, -tg.x).normalize();
    sides.push(side);
    const bank = banks[i];
    const across = side.clone().multiplyScalar(Math.cos(bank)).add(V(0, Math.sin(bank), 0));
    const nrm = new THREE.Vector3().crossVectors(tg, across).normalize(); if (nrm.y < 0) nrm.negate();
    surf.push({ q: lanes.map(o => p.clone().addScaledVector(across, o).add(V(0, Math.abs(o) > W / 2 + 0.1 ? 0.04 : 0, 0))), nrm });
    edges.push({ l: p.clone().addScaledVector(across, -W / 2 - 1.4), r: p.clone().addScaledVector(across, W / 2 + 1.4), p, side, bank });
  }
  {
    const vtx = [], col = [], nr = [];
    for (let i = 0; i < N; i++) for (let b = 0; b < lanes.length - 1; b++) {
      const A = surf[i].q[b], B = surf[i].q[b + 1], Cc = surf[i + 1].q[b], D = surf[i + 1].q[b + 1];
      const c = bandColor(b, i), sh = 0.96 + 0.04 * Math.sin(i * 1.7 + b);
      for (const [v, n] of [[A, surf[i].nrm], [Cc, surf[i + 1].nrm], [B, surf[i].nrm], [B, surf[i].nrm], [Cc, surf[i + 1].nrm], [D, surf[i + 1].nrm]]) {
        vtx.push(v.x, v.y, v.z); nr.push(n.x, n.y, n.z); col.push(c.r * sh, c.g * sh, c.b * sh);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(vtx, 3));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(nr, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // keep winding facing up
    const road = new THREE.Mesh(rg, Look.material(game, { color: '#ffffff', vertexColors: true, rim: 0, side: 'double', emissive: '#16161c', emissiveIntensity: 1 }));
    road.receiveShadow = true; road.name = 'kit:road';
    ctx.group.add(road);
    // collider: a simple indexed strip over the full width
    const cv = [], ci = [];
    for (let i = 0; i <= N; i++) { const a = edges[i].l, b = edges[i].p, c = edges[i].r; cv.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
    for (let i = 0; i < N; i++) { const a = i * 3; ci.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cv, 3)); cg.setIndex(ci);
    World.colliderTrimesh(game, cg, null, { what: 'road' });
  }
  // barriers: continuous low walls on both sides, collider boxes per segment
  {
    const bv = [], bc = [], bi = [];
    const cA = new THREE.Color(pal.primary), cB = new THREE.Color('#ffffff');
    const step = 3;
    let vi = 0;
    for (let i = 0; i < N; i += step) {
      const j = Math.min(i + step, N);
      for (const sgn of [-1, 1]) {
        const e0 = edges[i], e1 = edges[j];
        const q0 = (sgn < 0 ? e0.l : e0.r).clone().addScaledVector(e0.side, sgn * 1.4), q1 = (sgn < 0 ? e1.l : e1.r).clone().addScaledVector(e1.side, sgn * 1.4);
        const h = 1.1, th = 0.5;
        const n0 = e0.side.clone().multiplyScalar(sgn * th), n1 = e1.side.clone().multiplyScalar(sgn * th);
        const quad = [q0, q1, q1.clone().add(V(0, h, 0)), q0.clone().add(V(0, h, 0)), q0.clone().add(n0).add(V(0, h, 0)), q1.clone().add(n1).add(V(0, h, 0))];
        const c = (Math.floor(i / step) % 2) ? cA : cB;
        for (const q of quad) { bv.push(q.x, q.y, q.z); bc.push(c.r, c.g, c.b); }
        bi.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3, vi + 3, vi + 2, vi + 5, vi + 3, vi + 5, vi + 4);
        if (sgn > 0) { /* winding flip for the right side */ const L = bi.length; for (let k = L - 12; k < L; k += 3) { const t = bi[k]; bi[k] = bi[k + 1]; bi[k + 1] = t; } }
        vi += 6;
        const mid = q0.clone().lerp(q1, 0.5).add(V(0, h / 2, 0)).addScaledVector(e0.side, sgn * th / 2);
        const len = q0.distanceTo(q1);
        const yaw = Math.atan2(q1.x - q0.x, q1.z - q0.z) + Math.PI / 2;
        World.colliderBox(game, mid, V(len / 2 + 0.1, h / 2 + 0.6, th / 2 + 0.1), yaw, { what: 'barrier' });
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    g.setIndex(bi); g.computeVertexNormals();
    const m = new THREE.Mesh(g, Look.material(game, { color: '#ffffff', vertexColors: true, side: 'double', flat: true }));
    m.castShadow = true; m.receiveShadow = true; ctx.group.add(m);
  }
  // ground: flat meadow under and around the track, hills framing it
  const ext = R * 1.25 + 110;
  const CELL = 12, grid = new Map();
  for (let i = 0; i < N; i += 2) { const k = Math.floor(pts[i].x / CELL) + ',' + Math.floor(pts[i].z / CELL); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  const nearest = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); let bd = Infinity, bi = -1;
    for (let r = 0; r <= 3 && bi < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const i of grid.get((cx + dx) + ',' + (cz + dz)) || []) { const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    }
    return bi < 0 ? null : { d: Math.sqrt(bd), i: bi };
  };
  const dc = (nearest(0, 0) || { d: 0 }).d;
  const lakeR = dc > 36 ? Math.min(dc - 24, 34) : 0;
  const ground = World.ground(game, { ...P(ctx), size: ext * 2, flat: R * 1.25 + 30, hills: 26, bumps: 0.5, seed: ctx.seed + 3,
    height: (x, z, y) => {
      if (lakeR > 0) { const dl = Math.hypot(x, z); if (dl < lakeR + 6) y = THREE.MathUtils.lerp(y, -2.4, THREE.MathUtils.smoothstep(lakeR + 6 - dl, 0, 8)); }
      const n = nearest(x, z); if (!n) return y;
      const ty = pts[n.i].y - 0.3 - Math.min(n.d, W / 2 + 2) * Math.abs(Math.sin(banks[n.i])) - (n.d < W / 2 + 2 ? 0.2 : 0);
      const k = THREE.MathUtils.smoothstep(W / 2 + 18 - n.d, 0, 14);
      return THREE.MathUtils.lerp(y, ty, k);
    },
    paint: (x, z, c) => { const n = nearest(x, z); if (n && n.d < W / 2 + 4.5) c.lerp(new THREE.Color(pal.ground), 0.55); },
  });
  // gameplay placements
  const yawAtI = (i) => Math.atan2(tans[i].x, tans[i].z);
  level.route = [];
  for (let i = 0; i < N; i += 4) level.route.push(pts[i].clone());
  level.spawn = pts[N - 6].clone().add(V(0, 1.0, 0));
  level.spawnYaw = yawAtI(N - 6);
  level.goal = { position: pts[0].clone().add(V(0, 0.5, 0)), radius: W / 2 + 1, finishLine: true };
  for (let k = 1; k < 6; k++) { const i = Math.round(N * k / 6); level.checkpoints.push({ position: pts[i].clone().add(V(0, 0.5, 0)), radius: W / 2 + 2, yaw: yawAtI(i), index: k }); }
  level.laps = 3;
  level.trackWidth = W;
  // start/finish gantry + boost pads on the straightest stretches
  World.prop(game, 'gate', { ...P(ctx), position: pts[1].clone().add(V(0, -0.05, 0)), yaw: yawAtI(1), width: W + 3, height: 7 });
  const straight = [];
  for (let i = 20; i < N - 20; i++) straight.push([Math.abs(banks[i]), i]);
  straight.sort((a, b) => a[0] - b[0]);
  const boostI = [];
  for (const [, i] of straight) { if (boostI.every(j => Math.abs(j - i) > N / 6)) boostI.push(i); if (boostI.length >= 3) break; }
  for (const i of boostI) level.hazards.push({ type: 'boost', position: pts[i].clone().add(V(0, 0.1, 0)), direction: tans[i].clone(), width: 4, length: 5, yaw: yawAtI(i) });
  // collectibles: short lines of coins in alternating lanes
  const n = ctx.n;
  for (let k = 0; k < n; k++) {
    const i = Math.round(((Math.floor(k / 5) * 5 / n) * N + (k % 5) * 6 + N * 0.05)) % N;
    const lane = (Math.floor(k / 5) % 3 - 1) * W * 0.28;
    const p = pts[i].clone().addScaledVector(sides[i], lane * Math.cos(banks[i])); p.y += lane * Math.sin(banks[i]) + 1.2;
    level.collectibles.push({ position: p, tag: 'coin' });
  }
  // dressing: tire stacks + cones on the outside of corners, flags, trees and rocks, a lake in the infield
  for (let i = 0; i < N; i += 9) {
    const b = banks[i]; if (Math.abs(b) < 0.08) continue;
    const sgn = b > 0 ? -1 : 1;
    const e = edges[i], q = (sgn < 0 ? e.l : e.r).clone().addScaledVector(e.side, sgn * 3.2); q.y = ground.heightAt(q.x, q.z) ?? 0;
    World.prop(game, i % 2 ? 'tire_stack' : 'cone', { ...P(ctx), position: q, collider: false });
  }
  for (let i = 8; i < N - 8; i += Math.round(N / 22)) {
    const e = edges[i], q = e.l.clone().addScaledVector(e.side, -3.0); q.y = ground.heightAt(q.x, q.z) ?? 0;
    World.prop(game, 'lamp', { ...P(ctx), position: q, height: 5, collider: false });
  }
  for (let i = 0; i < N; i += Math.round(N / 14)) {
    const e = edges[i], q = e.r.clone().addScaledVector(e.side, 6); q.y = ground.heightAt(q.x, q.z) ?? 0;
    World.prop(game, 'flag', { ...P(ctx), position: q, color: i % 2 ? 'primary' : 'secondary', height: 6 });
  }
  const noPlant = [];
  for (let i = 0; i < N; i += 2) noPlant.push(pts[i]);
  World.noPlant(game, noPlant, W / 2 + 7);
  if (lakeR > 0) { World.water(game, { ...P(ctx), level: -0.6, size: (lakeR + 10) * 2, center: V(0, 0, 0) }); level.water = { y: -0.6, center: V(0, -0.6, 0), radius: lakeR }; }
  World.foliage(game, { ...P(ctx), area: { center: V(0, 0, 0), radius: ext - 10 }, kinds: { grass: 0.8, flowers: 1, bush: 1, tree_round: 1.3, tree_pine: 1.3, rock: 0.8 }, density: 0.8, seed: ctx.seed + 8, focus: level.route, focusRadius: 30 });
  World.clouds(game, { ...P(ctx), count: 20, height: 60, radius: ext, seed: ctx.seed });
  level.ground = ground;
  level.bounds = boundsOf(pts, 12);
  level.hazards.push({ type: 'void', y: -20, position: V(0, -20, 0) });
}

// ------------------------------------------------------------------------------------------------ lagoon (boat race)
function lagoon(ctx) {
  const { game, level, rnd, S } = ctx;
  const R = 90 * S, W = opts(ctx).width ?? 20, WY = 0;
  const ctrl = [];
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    const r = R * (0.8 + 0.28 * Math.sin(a * 3 + ctx.seed) * (0.6 + rnd() * 0.4));
    ctrl.push(V(Math.cos(a) * r * 1.2, WY, Math.sin(a) * r * 0.9));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const lenT = curve.getLength(), N = Math.max(240, Math.round(lenT / 2));
  const pts = [], tans = [];
  for (let i = 0; i <= N; i++) { const t = (i / N) % 1; const p = curve.getPointAt(t); p.y = WY; pts.push(p); tans.push(curve.getTangentAt(t)); }
  level.track = new THREE.CatmullRomCurve3(pts.slice(0, N), true, 'centripetal');
  const CELL = 12, grid = new Map();
  for (let i = 0; i < N; i++) { const k = Math.floor(pts[i].x / CELL) + ',' + Math.floor(pts[i].z / CELL); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  const nearest = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); let bd = Infinity, bi = -1;
    for (let r = 0; r <= 4 && bi < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const i of grid.get((cx + dx) + ',' + (cz + dz)) || []) { const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    }
    return bi < 0 ? null : { d: Math.sqrt(bd), i: bi };
  };
  const ext = R * 1.2 + 120;
  // land everywhere, carved into a channel along the course (seabed 3.5 below the water), sandy beaches at the edges
  const pal = Look.palette(game);
  const ground = World.ground(game, { ...P(ctx), size: ext * 2, flat: R * 1.2 + 40, hills: 22, bumps: 0.6, seed: ctx.seed + 3,
    height: (x, z, y) => {
      const n = nearest(x, z); const land = y + 1.3;
      if (!n) return land;
      const k = THREE.MathUtils.smoothstep(W / 2 + 13 - n.d, 0, 9);
      return THREE.MathUtils.lerp(land, WY - 3.5, k);
    },
    paint: (x, z, c) => { const n = nearest(x, z); if (n && n.d < W / 2 + 15) c.lerp(new THREE.Color(pal.sand), THREE.MathUtils.smoothstep(W / 2 + 15 - n.d, 0, 4)); },
  });
  World.water(game, { ...P(ctx), level: WY, size: ext * 2, center: V(0, 0, 0), waves: 0.18 });
  level.water = { y: WY };
  level.trackWidth = W;
  const yawAtI = (i) => Math.atan2(tans[i].x, tans[i].z);
  const side = (i) => V(tans[i].z, 0, -tans[i].x).normalize();
  // buoy lines on both edges (red/white), colliders keep boats in the lane
  {
    const buoys = [];
    const step = Math.max(2, Math.round(7 / (lenT / N)));
    for (let i = 0, k = 0; i < N; i += step, k++) for (const sg of [-1, 1]) {
      const q = pts[i].clone().addScaledVector(side(i), sg * (W / 2 + 1)); q.y = WY;
      buoys.push({ q, red: k % 2 === 0 });
      World.colliderBall(game, q.clone().setY(WY + 0.2), 0.7, { what: 'buoy' });
    }
    const g = new THREE.SphereGeometry(0.6, 10, 8);
    for (const red of [true, false]) {
      const list = buoys.filter(b => b.red === red);
      const im = new THREE.InstancedMesh(g, Look.material(game, red ? { color: 'danger', emissive: 'danger', emissiveIntensity: Look.isNight(game) ? 1.4 : 0.15 } : { color: '#ffffff' }), list.length);
      const m4 = new THREE.Matrix4();
      im.castShadow = true; im.name = 'kit:buoys'; im.frustumCulled = false; ctx.group.add(im);
      const bob = (dt, t) => { list.forEach((b, i) => { im.setMatrixAt(i, m4.makeScale(1, 0.85, 1).setPosition(b.q.x, WY + 0.15 + Math.sin(t * 2 + b.q.x * 0.3) * 0.12, b.q.z)); }); im.instanceMatrix.needsUpdate = true; };
      bob(0, 0);
      game.update(bob, 31);
    }
  }
  // placements
  level.route = [];
  for (let i = 0; i < N; i += 3) level.route.push(pts[i].clone());
  level.spawn = pts[N - 5].clone().add(V(0, 0.6, 0));
  level.spawnYaw = yawAtI(N - 5);
  level.goal = { position: pts[0].clone().add(V(0, 0.5, 0)), radius: W / 2 + 1, finishLine: true };
  for (let k = 1; k < 6; k++) { const i = Math.round(N * k / 6); level.checkpoints.push({ position: pts[i].clone().add(V(0, 0.5, 0)), radius: W / 2 + 2, yaw: yawAtI(i), index: k }); }
  level.laps = 3;
  World.prop(game, 'gate', { ...P(ctx), position: pts[1].clone().add(V(0, -1.5, 0)), yaw: yawAtI(1), width: W + 4, height: 8.5 });
  // straightest stretches: boost pads and one jump ramp
  const turn = (i) => { const a = tans[(i - 4 + N) % N], b = tans[(i + 4) % N]; return Math.abs(a.x * b.z - a.z * b.x); };
  const straight = []; for (let i = 15; i < N - 15; i++) straight.push([turn(i), i]); straight.sort((a, b) => a[0] - b[0]);
  const picks = []; for (const [, i] of straight) { if (picks.every(j => Math.abs(j - i) > N / 7)) picks.push(i); if (picks.length >= 4) break; }
  picks.slice(0, 3).forEach(i => level.hazards.push({ type: 'boost', position: pts[i].clone().add(V(0, 0.1, 0)), direction: tans[i].clone(), width: 4, length: 5, yaw: yawAtI(i) }));
  if (picks[3] != null) { const i = picks[3]; World.prop(game, 'ramp', { ...P(ctx), position: pts[i].clone().setY(WY - 0.9), yaw: yawAtI(i) - Math.PI / 2, length: 8, width: 6, height: 2.1, color: 'wood' }); }
  for (let k = 0; k < ctx.n; k++) {
    const i = Math.round(((Math.floor(k / 5) * 5 / ctx.n) * N + (k % 5) * 4 + N * 0.06)) % N;
    const lane = (Math.floor(k / 5) % 3 - 1) * W * 0.25;
    level.collectibles.push({ position: pts[i].clone().addScaledVector(side(i), lane).setY(WY + 1.2), tag: 'coin' });
  }
  // dressing: lighthouse on the infield, houses on the shores, rocks poking out of the water beside the lane
  const dc = (nearest(0, 0) || { d: 0 }).d;
  if (dc > W / 2 + 20) {
    World.prop(game, 'tower', { ...P(ctx), position: V(0, ground.heightAt(0, 0) ?? 1, 0), height: 14, radius: 2.6 });
    World.prop(game, 'house', { ...P(ctx), position: V(9, (ground.heightAt(9, 6) ?? 1) - 0.1, 6), yaw: -0.6, roofColor: 'secondary' });
  }
  for (let k = 0; k < 10; k++) {
    const i = Math.floor(rnd() * N), sg = rnd() < 0.5 ? -1 : 1;
    const q = pts[i].clone().addScaledVector(side(i), sg * (W / 2 + 4 + rnd() * 3)); q.y = WY - 0.6;
    World.prop(game, 'rock', { ...P(ctx), position: q, size: 1.2 + rnd() });
  }
  for (let k = 0; k < 5; k++) {
    const i = Math.floor(N * (k + 0.5) / 5), q = pts[i].clone().addScaledVector(side(i), W / 2 + 22); q.y = ground.heightAt(q.x, q.z) ?? 1;
    if (q.y > WY + 0.5) World.prop(game, 'house', { ...P(ctx), position: q.add(V(0, -0.1, 0)), yaw: yawAtI(i) + Math.PI, roofColor: k % 2 ? 'roof' : 'primary' });
  }
  const np = []; for (let i = 0; i < N; i += 2) np.push(pts[i]);
  World.noPlant(game, np, W / 2 + 8);
  World.foliage(game, { ...P(ctx), area: { center: V(0, 0, 0), radius: ext - 10 }, kinds: { grass: 0.45, flowers: 0.6, bush: 0.6, palm: 1.4, tree_round: 0.6, rock: 0.5 }, minY: WY + 0.35, density: 0.7, seed: ctx.seed + 8, focus: level.route, focusRadius: 30 });
  World.clouds(game, { ...P(ctx), count: 20, height: 60, radius: ext, seed: ctx.seed });
  level.ground = ground;
  level.bounds = boundsOf(pts, 14);
  level.killY = WY - 15;
  level.hazards.push({ type: 'void', y: level.killY, position: V(0, level.killY, 0) });
}

// ------------------------------------------------------------------------------------------------ canyon
// A red-rock desert canyon: a winding loop of packed-dirt floor between terraced, banded sandstone walls, with mesas and
// buttes beyond, natural arches spanning the canyon, hoodoos, cacti, dry scrub and bleached bones. level.track is the
// loop (karts/boats race it); level.route runs from the start to a sunlit arch three quarters of the way round
// (platformers). Ramps and boost pads on the straights, saw blades on the shoulders.
function canyon(ctx) {
  const { game, level, rnd, S } = ctx;
  const pal = Look.palette(game);
  const R = 74 * S, W = opts(ctx).width ?? 15, HW = W / 2 + 5;          // track width, half-width of the canyon floor
  const ctrl = [];
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2;
    const r = R * (0.78 + 0.26 * Math.sin(a * 3 + ctx.seed) * (0.7 + rnd() * 0.3) + (rnd() - 0.5) * 0.1);
    ctrl.push(V(Math.cos(a) * r * 1.2, 0, Math.sin(a) * r * 0.9));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const lenT = curve.getLength(), N = Math.max(260, Math.round(lenT / 1.6));
  const pts = [], tans = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) % 1, p = curve.getPointAt(t);
    p.y = 1.1 * Math.sin(t * Math.PI * 4 + ctx.seed) + 0.7 * Math.sin(t * Math.PI * 6 + 1.7);
    pts.push(p); tans.push(curve.getTangentAt(t));
  }
  level.track = new THREE.CatmullRomCurve3(pts.slice(0, N), true, 'centripetal');
  level.trackWidth = W;
  level.laps = 3;
  const side = (i) => V(tans[i].z, 0, -tans[i].x).normalize();
  const yawAtI = (i) => Math.atan2(tans[i].x, tans[i].z);
  // nearest track sample (grid accelerated)
  const CELL = 12, grid = new Map();
  for (let i = 0; i < N; i++) { const k = Math.floor(pts[i].x / CELL) + ',' + Math.floor(pts[i].z / CELL); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  const nearest = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); let bd = Infinity, bi = -1;
    for (let r = 0; r <= 5 && bi < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const i of grid.get((cx + dx) + ',' + (cz + dz)) || []) { const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    }
    return bi < 0 ? null : { d: Math.sqrt(bd), i: bi };
  };
  // cheap smooth noise (sum of sines) for mesas, buttes and wall wobble
  const s0 = ctx.seed * 1.37;
  const nz = (x, z, f) => Math.sin(x * f + s0) * Math.cos(z * f * 1.13 + s0 * 2) * 0.6 + Math.sin((x * 0.7 - z) * f * 1.9 + s0 * 3) * 0.4;
  const terrace = (v, step = 3.4) => { const t = v / step, f = t - Math.floor(t); return (Math.floor(t) + THREE.MathUtils.smoothstep(f, 0.55, 1)) * step; };
  const ext = R * 1.3 + 110;
  const heightFn = (x, z) => {
    const n = nearest(x, z);
    const d = n ? n.d : 999, floorY = n ? pts[n.i].y : 0;
    // the canyon is cut into a high plateau; past its rim the land falls to low desert with free-standing buttes
    const dc = Math.hypot(x / 1.2, z / 0.9), rim = R * 1.5 + 12 * nz(x, z, 0.02);
    const plateau = 28 + 3 * nz(x, z, 0.03) + 9 * THREE.MathUtils.smoothstep(nz(x - 20, z + 60, 0.035), 0.25, 0.35);   // stepped mesas on top
    const b = nz(x + 90, z - 40, 0.026);
    const desert = 1 + 24 * THREE.MathUtils.smoothstep(b, 0.42, 0.5) + 10 * THREE.MathUtils.smoothstep(b, 0.62, 0.7);
    const H = THREE.MathUtils.lerp(plateau, desert, THREE.MathUtils.smoothstep(dc, rim, rim + 16));
    const wall = HW + 1.5 * nz(x, z, 0.09) + 1.0;
    const k = THREE.MathUtils.smoothstep(d, wall, wall + 11);
    const floor = floorY - 0.25 + 0.25 * nz(x, z, 0.25) * THREE.MathUtils.smoothstep(d, W / 2, HW);
    return floor * (1 - k) + terrace(Math.max(0, H) * k, 4.2);     // terraces in absolute height: no seams between canyon arms
  };
  const ground = World.ground(game, { ...P(ctx), size: ext * 2, flat: ext, hills: 0, bumps: 0, seed: ctx.seed + 3, style: 'sand',
    segments: 330, height: (x, z) => heightFn(x, z) });
  // colours: banded red-rock strata by height, pale ledges and mesa tops, sand floor with a packed-dirt racing line
  const BAND = ['#8e3420', '#c4562f', '#e38d55', '#a8402a', '#f1b679', '#b9502c', '#d97a44', '#f6d0a0'].map(c => new THREE.Color(c));
  const sand = new THREE.Color(pal.sand).lerp(new THREE.Color('#e9b77a'), 0.5), dirt = new THREE.Color(pal.ground2).lerp(new THREE.Color('#a8583a'), 0.35);
  const topC = new THREE.Color(pal.sand).lerp(new THREE.Color('#e7a86e'), 0.45), cc = new THREE.Color();
  const rockColor = (x, y, z, ny, out) => {
    const n = nearest(x, z), d = n ? n.d : 999, fy = n ? pts[n.i].y : 0, rise = y - fy;
    const wob = 0.5 * Math.sin(x * 0.11 + z * 0.07) + 0.25 * Math.sin(x * 0.37 - z * 0.29);
    const t = (y + wob) / 2.3, b = Math.floor(t), f = t - b;
    out.copy(BAND[((b % BAND.length) + BAND.length) % BAND.length]);
    if (f < 0.12) out.multiplyScalar(0.8);                                  // dark seam under each band
    else if (f > 0.85) out.lerp(BAND[7], 0.18);                             // pale lip on top
    if (ny > 0.88 && rise > 2.5) out.lerp(topC, 0.8 * THREE.MathUtils.smoothstep(ny, 0.88, 0.97));
    if (rise < 1.0) {                                                       // canyon floor
      cc.copy(sand).multiplyScalar(0.93 + 0.08 * Math.sin(x * 0.9) * Math.sin(z * 0.8));
      if (d < W / 2 + 0.6) cc.lerp(dirt, 0.6 * THREE.MathUtils.smoothstep(W / 2 + 0.6 - d, 0, 1.6));
      out.lerp(cc, THREE.MathUtils.smoothstep(1.0 - rise, 0, 0.7));
    }
    return out;
  };
  {
    // vertex colours carry the floor / ledge tints; a per-vertex 'rock' amount says where the walls are, and the
    // strata themselves are drawn per pixel from world height (a heightfield is far too coarse for crisp bands)
    const g = ground.mesh.geometry, pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, c = new THREE.Color();
    const rockA = new Float32Array(pa.count);
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), ny = na.getY(i);
      const n = nearest(x, z), fy = n ? pts[n.i].y : 0, rise = y - fy;
      rockColor(x, y, z, ny, c); ca.setXYZ(i, c.r, c.g, c.b);
      const floorM = THREE.MathUtils.smoothstep(1.0 - rise, 0, 0.7), topM = rise > 2.5 ? 0.85 * THREE.MathUtils.smoothstep(ny, 0.9, 0.975) : 0;
      rockA[i] = (1 - floorM) * (1 - topM);
    }
    ca.needsUpdate = true;
    g.setAttribute('rock', new THREE.BufferAttribute(rockA, 1));
    const m = Look.material(game, { color: '#ffffff', vertexColors: true, rim: 0.151 }).clone();   // own copy: strata shader
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uBand = { value: BAND.map(c => c.clone()) };
      sh.vertexShader = `attribute float rock;
varying float vRock;
varying vec3 vWPos;
` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vRock = rock; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = `uniform vec3 uBand[8];
varying float vRock;
varying vec3 vWPos;
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float wob = 0.5 * sin(vWPos.x * 0.11 + vWPos.z * 0.07) + 0.25 * sin(vWPos.x * 0.37 - vWPos.z * 0.29);
          float t = (vWPos.y + wob) / 2.3, f = fract(t);
          int bi = int(mod(floor(t), 7.0));
          vec3 bc = uBand[0];
          for (int k = 1; k < 7; k++) if (k == bi) bc = uBand[k];
          if (f < 0.12) bc *= 0.78; else if (f > 0.86) bc = mix(bc, uBand[7], 0.22);
          bc *= 0.93 + 0.07 * sin(vWPos.y * 7.0 + 2.0 * sin(vWPos.x * 0.4 + vWPos.z * 0.3));
          diffuseColor.rgb = mix(diffuseColor.rgb, bc, clamp(vRock, 0.0, 1.0));
        }`);
    };
    m.customProgramCacheKey = () => prevKey + '-canyon-strata';
    ground.mesh.material = m;
  }
  const gy = (x, z) => ground.heightAt(x, z) ?? 0;

  // race dressing (road, curbs, chevrons) vs ruin dressing (sand path, broken columns, ruin walls): both are built and
  // one is shown. opts.dress = 'race' | 'ruins' | 'auto' (default): auto decides on the first frame, once
  // Gameplay.rules has run: a kart / boat player or a lap count means it is raced.
  const raceDress = new THREE.Group(); raceDress.name = 'kit:canyon:race'; raceDress.userData.dynamic = true; ctx.group.add(raceDress);
  const ruinDress = new THREE.Group(); ruinDress.name = 'kit:canyon:ruins'; ruinDress.userData.dynamic = true; ctx.group.add(ruinDress);
  // ---- the racing line: a packed-dirt road ribbon draped on the floor, red/white curbs, white edge lines, darker
  // tyre tracks, and chevron boards on the outside of every real bend, so the line reads at speed against the sand
  {
    const L = [-W / 2 - 1.1, -W / 2, -W / 2 + 0.35, -W * 0.34 - 0.35, -W * 0.34 + 0.35, -W * 0.14 - 0.3, -W * 0.14 + 0.3,
      W * 0.14 - 0.3, W * 0.14 + 0.3, W * 0.34 - 0.35, W * 0.34 + 0.35, W / 2 - 0.35, W / 2, W / 2 + 1.1];
    const dirtC = new THREE.Color('#8a4a2c'), dirt2 = new THREE.Color('#7a3f24'), track = new THREE.Color('#5e2f1c'), line = new THREE.Color('#f4efe6');
    const curbA = new THREE.Color('#e0362f'), curbB = new THREE.Color('#ffffff');
    const vtx = [], col = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const sd = side(i % N);
      for (const o of L) {
        const x = pts[i].x + sd.x * o, z = pts[i].z + sd.z * o;
        vtx.push(x, heightFn(x, z) + 0.05, z);
      }
    }
    // per-quad colours (non-indexed so bands stay crisp)
    const pos = [], cl = [], C = L.length;
    const bandC = (b, i) => {
      const d = i * lenT / N;
      if (b === 0 || b === C - 2) return Math.floor(d / 2.5) % 2 ? curbA : curbB;
      if (b === 1 || b === C - 3) return line;
      if (b === 3 || b === 5 || b === 7 || b === 9) return track;                  // tyre tracks
      return Math.floor(d / 6) % 2 ? dirtC : dirt2;
    };
    const P3 = (i, b) => [vtx[(i * C + b) * 3], vtx[(i * C + b) * 3 + 1], vtx[(i * C + b) * 3 + 2]];
    for (let i = 0; i < N; i++) for (let b = 0; b < C - 1; b++) {
      const c = bandC(b, i), sh = 0.95 + 0.05 * Math.sin(i * 1.3 + b);
      for (const [ii, bb] of [[i, b], [i + 1, b], [i, b + 1], [i, b + 1], [i + 1, b], [i + 1, b + 1]]) { pos.push(...P3(ii, bb)); cl.push(c.r * sh, c.g * sh, c.b * sh); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.computeVertexNormals();
    const rm = Look.material(game, { color: '#ffffff', vertexColors: true, rim: 0.131, side: 'double' });
    rm.polygonOffset = true; rm.polygonOffsetFactor = -2; rm.polygonOffsetUnits = -4;
    const road = new THREE.Mesh(g, rm); road.name = 'kit:canyon:road'; road.receiveShadow = true;
    raceDress.add(road);

    // chevron boards: red with white arrows, on posts outside each sharp bend, pointing the way
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#d42a24'; c2.fillRect(0, 0, 256, 128); c2.strokeStyle = '#1a0d08'; c2.lineWidth = 10; c2.strokeRect(5, 5, 246, 118);
    c2.fillStyle = '#ffffff';
    for (const x0 of [40, 110, 180]) { c2.beginPath(); c2.moveTo(x0, 22); c2.lineTo(x0 + 44, 64); c2.lineTo(x0, 106); c2.lineTo(x0 + 22, 106); c2.lineTo(x0 + 66, 64); c2.lineTo(x0 + 22, 22); c2.closePath(); c2.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const boardM = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
    const postM = Look.material(game, { color: '#3a2a22' });
    const boardG = new THREE.PlaneGeometry(3.2, 1.6), postG = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6);
    const turnAt = (i) => { const a = tans[(i - 6 + N) % N], b = tans[(i + 6) % N]; return a.x * b.z - a.z * b.x; };
    let lastI = -999;
    for (let i = 0; i < N; i += 3) {
      const tr = turnAt(i);
      if (Math.abs(tr) < 0.22 || i - lastI < 14) continue;
      lastI = i;
      const out = tr > 0 ? 1 : -1;                     // outside of the bend
      for (const k of [-4, 0, 4]) {
        const j = (i + k + N) % N, sd = side(j);
        const q = pts[j].clone().addScaledVector(sd, out * (W / 2 + 2.2)); q.y = heightFn(q.x, q.z);
        const grp = new THREE.Group(); grp.position.copy(q); grp.userData.dynamic = true;   // keep out of World.bake (textured)
        const post = new THREE.Mesh(postG, postM); post.position.y = 1.1; grp.add(post);
        const board = new THREE.Mesh(boardG, boardM); board.position.y = 2.6; grp.add(board);
        const th = Math.atan2(-out * sd.x, -out * sd.z);   // board faces the road
        grp.rotation.y = th;
        const lx = Math.cos(th), lz = -Math.sin(th);       // the board's +X (arrow direction) in world space
        board.scale.x = lx * tans[j].x + lz * tans[j].z >= 0 ? 1 : -1;   // arrows point the way the road runs
        grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
        raceDress.add(grp);
      }
    }
  }

  // ---- placements: start, route (platformers) to the goal arch, checkpoints, laps (races)
  const goalI = Math.round(N * 0.78);
  level.spawn = pts[N - 6].clone().add(V(0, 1.0, 0));
  level.spawnYaw = yawAtI(N - 6);
  level.route = [pts[N - 6].clone()];
  for (let i = 0; i <= goalI; i += 3) level.route.push(pts[i].clone());
  level.goal = { position: pts[goalI].clone().add(V(0, 0.5, 0)), radius: 4 };
  level.route.push(level.goal.position.clone());
  for (let k = 1; k < 6; k++) { const i = Math.round(N * k / 6); level.checkpoints.push({ position: pts[i].clone().add(V(0, 0.5, 0)), radius: W / 2 + 2, yaw: yawAtI(i), index: k }); }
  // straightest stretches: boost pads and two jump ramps (kept clear of the goal)
  const turn = (i) => { const a = tans[(i - 5 + N) % N], b = tans[(i + 5) % N]; return Math.abs(a.x * b.z - a.z * b.x); };
  const straight = []; for (let i = 20; i < N - 20; i++) if (Math.abs(i - goalI) > 25) straight.push([turn(i), i]);
  straight.sort((a, b) => a[0] - b[0]);
  const picks = []; for (const [, i] of straight) { if (picks.every(j => Math.abs(j - i) > N / 8)) picks.push(i); if (picks.length >= 5) break; }
  const ramps = picks.slice(3, 5), boosts = picks.slice(0, 3);
  for (const i of boosts) level.hazards.push({ type: 'boost', position: pts[i].clone().add(V(0, 0.1, 0)), direction: tans[i].clone(), width: 4, length: 5, yaw: yawAtI(i) });
  for (const i of ramps) {
    World.prop(game, 'ramp', { ...P(ctx), position: pts[i].clone().add(V(0, -0.15, 0)), yaw: yawAtI(i) - Math.PI / 2, length: 8, width: 6.5, height: 1.7, color: 'wood' });
    for (let k = 0; k < 4; k++) {   // a coin arc over the jump
      const t = (k + 1) / 5, q = pts[(i + Math.round(4 + t * 10)) % N].clone(); q.y += 2.2 + Math.sin(t * Math.PI) * 2.6;
      level.collectibles.push({ position: q, tag: 'coin' });
    }
  }
  // collectibles: short coin lines in alternating lanes
  for (let k = level.collectibles.length; k < ctx.n; k++) {
    const i = Math.round(((Math.floor(k / 5) * 5 / ctx.n) * N + (k % 5) * 4 + N * 0.04)) % N;
    const lane = (Math.floor(k / 5) % 3 - 1) * W * 0.26;
    level.collectibles.push({ position: pts[i].clone().addScaledVector(side(i), lane).add(V(0, 1.2, 0)), tag: 'coin' });
  }
  // hazards: saw blades sliding along the shoulders (off the racing line), a boulder field, cliffs are void
  for (const frac of [0.22, 0.47, 0.64]) {
    const i = Math.round(N * frac), sg = frac === 0.47 ? -1 : 1, off = W / 2 + 2.2;
    const a = pts[(i - 5 + N) % N].clone().addScaledVector(side((i - 5 + N) % N), sg * off), b = pts[(i + 5) % N].clone().addScaledVector(side((i + 5) % N), sg * off);
    a.y = gy(a.x, a.z); b.y = gy(b.x, b.z);
    level.hazards.push({ type: 'saw', position: a.clone().lerp(b, 0.5), path: [a, b], period: 3.2, radius: 1.2 });
  }
  level.killY = -25;
  level.hazards.push({ type: 'void', y: level.killY, position: V(0, level.killY, 0) });

  // ---- rock dressing, merged into a few draw calls: natural arches, hoodoos, bones
  const rockGeos = [], boneGeos = [];
  const tint = (geo, fn) => {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), c); col.set([c.r, c.g, c.b], i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  const strata = (gy0) => (x, y, z, c) => {
    const b = Math.floor((y - gy0 + 0.4 * Math.sin(x * 0.3 + z * 0.2)) / 1.4);
    c.copy(BAND[((b % 7) + 7) % 7]);
  };
  const lumpy = (geo, amp, f) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const w = amp * (Math.sin(x * f + y * 0.7) * Math.cos(z * f - y * 0.5)); p.setXYZ(i, x + w, y + w * 0.4, z - w); }
    geo.computeVertexNormals();
    return geo;
  };
  // natural arches: a thick lumpy stone band spanning the canyon, feet buried in the walls
  const archAt = (i, rise) => {
    const c = pts[i], sd = side(i), span = HW + 4;
    const pathPts = [];
    for (let k = 0; k <= 24; k++) {
      const a = Math.PI * k / 24, x = -Math.cos(a) * span, y = Math.sin(a) * rise;
      pathPts.push(c.clone().addScaledVector(sd, x).add(V(0, y - 2.5, 0)));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pathPts), 48, 3.2, 9, false);
    tube.scale(1, 1, 1);
    lumpy(tube, 0.8, 0.35);
    rockGeos.push(tint(tube, strata(c.y)));
    World.colliderTrimesh(game, tube, null, { what: 'arch' });
  };
  archAt(goalI, 25);                                         // the goal arch, framing the finish against the sun
  archAt(Math.round(N * 0.36), 23);
  // a free-standing mesa arch out in the desert for the skyline
  {
    const c = V(-R * 1.55, 0, R * 0.9); c.y = gy(c.x, c.z);
    const g = new THREE.TorusGeometry(14, 4, 8, 24, Math.PI); g.translate(c.x, c.y - 1, c.z);
    rockGeos.push(tint(lumpy(g, 1.2, 0.2), strata(c.y)));
  }
  // hoodoos: banded spires with a dark cap rock, on the floor's edges and the ledges above
  const hoodoo = (x, z, h, r) => {
    const prof = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10; prof.push(new THREE.Vector2(r * (0.95 - 0.35 * t + 0.18 * Math.sin(t * Math.PI * 3.2)), t * h)); }
    prof.push(new THREE.Vector2(r * 0.95, h * 1.02), new THREE.Vector2(r * 0.9, h * 1.12), new THREE.Vector2(0, h * 1.14));
    const y0 = gy(x, z) - 0.6;
    const geo = new THREE.LatheGeometry(prof, 9).translate(x, y0, z);
    rockGeos.push(tint(geo, (px, py, pz, c) => { if (py > y0 + h * 1.01) c.set(pal.cliff2).multiplyScalar(0.7); else strata(y0)(px, py, pz, c); }));
    World.colliderCylinder(game, V(x, y0 + h / 2, z), h / 2, r * 0.8, { what: 'hoodoo' });
  };
  for (let k = 0, placed = 0; k < 120 && placed < 26; k++) {
    const i = Math.floor(rnd() * N), sg = rnd() < 0.5 ? -1 : 1;
    const q = pts[i].clone().addScaledVector(side(i), sg * (HW + 0.5 + rnd() * 3));
    if (Math.abs(i - goalI) < 12 || (nearest(q.x, q.z) || { d: 0 }).d < W / 2 + 3.5) continue;
    hoodoo(q.x, q.z, 4 + rnd() * 6, 0.9 + rnd() * 0.7); placed++;
  }
  for (let k = 0; k < 14; k++) {   // tall ones on the mesas around
    const a = rnd() * Math.PI * 2, d = R * (0.4 + rnd() * 1.3), x = Math.cos(a) * d * 1.2, z = Math.sin(a) * d;
    if ((nearest(x, z) || { d: 99 }).d < HW + 6) continue;
    hoodoo(x, z, 7 + rnd() * 9, 1.4 + rnd());
  }
  // bones: bleached rib cages and horned skulls half-buried in the sand beside the track
  for (let k = 0; k < 9; k++) {
    const i = Math.floor(rnd() * N), sg = rnd() < 0.5 ? -1 : 1;
    const q = pts[i].clone().addScaledVector(side(i), sg * (W / 2 + 1.5 + rnd() * 2)); q.y = gy(q.x, q.z);
    const yaw = rnd() * Math.PI * 2, M = new THREE.Matrix4().makeRotationY(yaw).setPosition(q);
    if (k % 2) {
      for (let r = 0; r < 5; r++) boneGeos.push(new THREE.TorusGeometry(0.75 - r * 0.06, 0.07, 5, 10, Math.PI).rotateY(Math.PI / 2).translate(r * 0.32 - 0.6, -0.05, 0).applyMatrix4(M));
      boneGeos.push(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 5).rotateZ(Math.PI / 2).translate(0, 0.72, 0).applyMatrix4(M));
    } else {
      boneGeos.push(new THREE.SphereGeometry(0.42, 8, 6).scale(1, 0.75, 1.35).translate(0, 0.25, 0).applyMatrix4(M));
      for (const s of [-1, 1]) boneGeos.push(new THREE.ConeGeometry(0.1, 0.9, 6).rotateZ(-s * 1.1).translate(s * 0.55, 0.55, -0.2).applyMatrix4(M));
    }
  }
  const merged = (geos, mat, name, shadow = true) => {
    if (!geos.length) return;
    const nonIdx = geos.map(g => (g.index ? g.toNonIndexed() : g));
    for (const g of nonIdx) { if (!g.attributes.color) tint(g, (x, y, z, c) => c.set('#ffffff')); if (g.attributes.uv) g.deleteAttribute('uv'); }
    const keep = ['position', 'normal', 'color'];
    for (const g of nonIdx) for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    const out = new THREE.BufferGeometry();
    for (const k of keep) {
      const total = nonIdx.reduce((a, g) => a + g.attributes[k].array.length, 0), arr = new Float32Array(total);
      let o = 0; for (const g of nonIdx) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
      out.setAttribute(k, new THREE.BufferAttribute(arr, 3));
    }
    const m = new THREE.Mesh(out, mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true;
    ctx.group.add(m);
  };
  merged(rockGeos, Look.material(game, { color: '#ffffff', vertexColors: true, flat: true }), 'kit:canyon:rocks');
  merged(boneGeos, Look.material(game, { color: '#f4ecd8' }), 'kit:canyon:bones', false);

  // ---- props + foliage: start sign, flags at the goal, boulders on the floor edges, cacti and dry scrub
  World.prop(game, 'sign', { ...P(ctx), position: pts[N - 10].clone().addScaledVector(side(N - 10), W / 2 + 2).setY(gy(pts[N - 10].x, pts[N - 10].z)), yaw: yawAtI(N - 10) });
  for (const sg of [-1, 1]) {
    const q = pts[goalI].clone().addScaledVector(side(goalI), sg * (W / 2 + 1)); q.y = gy(q.x, q.z) - 0.1;
    World.prop(game, 'flag', { ...P(ctx), position: q, height: 6, color: sg < 0 ? 'primary' : 'accent' });
  }
  for (let k = 0; k < 16; k++) {
    const i = Math.floor(rnd() * N), sg = rnd() < 0.5 ? -1 : 1;
    const q = pts[i].clone().addScaledVector(side(i), sg * (W / 2 + 2.8 + rnd() * 2)); q.y = gy(q.x, q.z) - 0.3;
    if (Math.abs(i - goalI) < 6) continue;
    World.prop(game, 'rock', { ...P(ctx), position: q, size: 1.0 + rnd() * 1.4 });
  }
  const np = []; for (let i = 0; i < N; i += 2) np.push(pts[i]);
  World.noPlant(game, np, W / 2 + 2.2);
  // plants only on the canyon floor and the low desert: never on the terraced walls or ledges, where they float
  World.foliage(game, { ...P(ctx), area: { center: V(0, 0, 0), radius: ext - 12 }, kinds: { tree_round: 0.9, bush: 1.2, grass: 0.7, tree_dead: 0.5, rock: 0.6 },
    density: 0.7, seed: ctx.seed + 8, focus: level.route, focusRadius: 26, maxY: 2.6 });
  World.clouds(game, { ...P(ctx), count: 10, height: 75, radius: ext, seed: ctx.seed });
  // ---- ruin dressing (non-race games): a pale sand path with stone edging, broken columns and ruin walls
  const ruinColliders = [];
  {
    const L = [-W * 0.32 - 0.5, -W * 0.32, W * 0.32, W * 0.32 + 0.5];
    const edge = new THREE.Color('#b89a74'), sandP = new THREE.Color('#f0d6a8'), sandP2 = new THREE.Color('#e8c992');
    const pos = [], cl = [];
    const P3 = (i, o) => { const sd = side(i % N), x = pts[i].x + sd.x * o, z = pts[i].z + sd.z * o; return [x, heightFn(x, z) + 0.05, z]; };
    for (let i = 0; i < N; i++) for (let b = 0; b < L.length - 1; b++) {
      const c = b === 1 ? (Math.floor(i / 5) % 2 ? sandP : sandP2) : edge;
      for (const [ii, oo] of [[i, L[b]], [i + 1, L[b]], [i, L[b + 1]], [i, L[b + 1]], [i + 1, L[b]], [i + 1, L[b + 1]]]) { pos.push(...P3(ii, oo)); cl.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3)); g.computeVertexNormals();
    const pm = Look.material(game, { color: '#ffffff', vertexColors: true, rim: 0.121, side: 'double' });
    pm.polygonOffset = true; pm.polygonOffsetFactor = -2; pm.polygonOffsetUnits = -4;
    const path = new THREE.Mesh(g, pm); path.receiveShadow = true; path.name = 'kit:canyon:path'; ruinDress.add(path);
    // columns (some broken, some fallen) and low ruin walls along the floor edges, kept off the path and the goal
    const stone = Look.material(game, { color: '#e2c49a' }), stoneD = Look.material(game, { color: '#c9a479' });
    const colG = new THREE.CylinderGeometry(0.7, 0.8, 1, 10), capG = new THREE.BoxGeometry(2.0, 0.5, 2.0), blockG = new THREE.BoxGeometry(1, 1, 1);
    const rr = rng32(ctx.seed * 31 + 7);
    for (let i = 8, k = 0; i < N; i += 9 + Math.floor(rr() * 6), k++) {
      if (Math.abs(i - goalI) < 10 || i > N - 14) continue;
      const sg = k % 2 ? 1 : -1, sd = side(i);
      const q = pts[i].clone().addScaledVector(sd, sg * (W / 2 + 2.5 + rr() * 2.5)); q.y = heightFn(q.x, q.z);
      const yaw = Math.atan2(tans[i].x, tans[i].z);
      const kind = rr();
      if (kind < 0.45) {                                   // standing column, maybe broken
        const hgt = 2.5 + rr() * 4.5;
        const col = new THREE.Mesh(colG, stone); col.scale.set(1, hgt, 1); col.position.set(q.x, q.y + hgt / 2 - 0.2, q.z); col.rotation.z = (rr() - 0.5) * 0.12;
        ruinDress.add(col);
        if (hgt > 5) { const cap = new THREE.Mesh(capG, stoneD); cap.position.set(q.x, q.y + hgt, q.z); cap.rotation.y = rr(); ruinDress.add(cap); }
        ruinColliders.push(['cyl', V(q.x, q.y + hgt / 2, q.z), hgt / 2, 0.8]);
      } else if (kind < 0.7) {                             // fallen column
        const len = 4 + rr() * 3;
        const col = new THREE.Mesh(colG, stone); col.scale.set(1, len, 1); col.rotation.z = Math.PI / 2; col.rotation.y = yaw + (rr() - 0.5);
        col.position.set(q.x, q.y + 0.55, q.z); ruinDress.add(col);
        ruinColliders.push(['box', V(q.x, q.y + 0.55, q.z), V(len / 2, 0.75, 0.8), col.rotation.y + Math.PI / 2]);
      } else {                                             // ruin wall with a broken top, along the canyon
        const len = 5 + rr() * 4, hgt = 1.6 + rr() * 1.8;
        const n = Math.ceil(len / 1.2);
        for (let b = 0; b < n; b++) {
          const hb = hgt * (0.55 + 0.45 * Math.sin(b * 1.7 + k) ** 2);
          const blk = new THREE.Mesh(blockG, b % 2 ? stone : stoneD);
          blk.scale.set(1.2, hb, 0.9);
          const off = (b - (n - 1) / 2) * 1.2;
          blk.position.set(q.x + Math.sin(yaw) * off, q.y + hb / 2 - 0.1, q.z + Math.cos(yaw) * off); blk.rotation.y = yaw;
          ruinDress.add(blk);
        }
        ruinColliders.push(['box', V(q.x, q.y + hgt / 2, q.z), V(0.5, hgt / 2, len / 2), yaw]);
      }
    }
    ruinDress.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  let dressed = null;
  const dress = (raced) => {
    if (dressed !== null) return;
    dressed = raced ? 'race' : 'ruins';
    raceDress.visible = raced; ruinDress.visible = !raced;
    if (!raced) for (const c of ruinColliders) {
      if (c[0] === 'cyl') World.colliderCylinder(game, c[1], c[2], c[3], { what: 'ruin' });
      else World.colliderBox(game, c[1], c[2], c[3], { what: 'ruin' });
    }
    level.dress = dressed;
  };
  const want = opts(ctx).dress || 'auto';
  if (want === 'race' || want === 'ruins') dress(want === 'race');
  else {
    raceDress.visible = ruinDress.visible = false;
    const decide = () => {
      game.removeUpdate(decide);
      const p = game.__player, st = game.state || {};
      dress(!!((p && (p.type === 'kart' || p.type === 'boat')) || (Number.isFinite(st.laps) && st.laps > 0)));
    };
    game.lateUpdate(decide, -200);
  }
  level.ground = ground;
  level.bounds = boundsOf(pts, 16);
}

function opts(ctx) { return ctx.opts || {}; }

const BUILDERS = { sky_islands: skyIslands, meadow_course: meadowCourse, arena, town, race_track: raceTrack, lagoon, canyon };

/** Level.validate(level) -> list of route problems (gaps > MAX_GAP+margin or rises > MAX_RISE+margin). [] means reachable. */
export function validate(level) {
  const issues = [];
  const r = level.route || [];
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i];
    const rise = b.y - a.y;
    if (rise > JUMP_HEIGHT - 0.8) issues.push(`route[${i}] rises ${rise.toFixed(1)} (> ${JUMP_HEIGHT - 0.8})`);
  }
  return issues;
}

// ------------------------------------------------------------------------------------------------ compose (custom levels)
export const PIECES = ['island', 'platform', 'cliff', 'pillar', 'ramp', 'stairs', 'bridge', 'wall', 'arch', 'tower', 'mover', 'water'];
const ON_ROUTE = new Set(['island', 'platform', 'cliff', 'pillar', 'ramp', 'stairs', 'bridge', 'mover']);
export const MOTIONS = ['pingpong', 'loop', 'rotate', 'raft'];
const HAZARD_TYPES = ['void', 'spikes', 'spinner', 'saw', 'lava', 'killzone', 'bounce', 'boost', 'crumble', 'enemy', 'wind'];

function vecOf(v, what) {
  if (v == null) return null;
  if (v.isVector3) return v.clone();
  if (Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && isFinite(n))) return V(v[0], v[1], v[2]);
  if (typeof v === 'object' && isFinite(v.x) && isFinite(v.y) && isFinite(v.z)) return V(v.x, v.y, v.z);
  throw new Error(`Level.compose: ${what} must be [x, y, z] (numbers), got ${JSON.stringify(v)}`);
}
const circleSurf = (c, r) => ({ heightAt: (x, z) => Math.hypot(x - c.x, z - c.z) <= r ? c.y : null });
function stripSurf(a, b, halfW) {         // a straight walkway from a to b (ramp, stairs, bridge deck)
  const d = V(b.x - a.x, 0, b.z - a.z), L = d.length() || 1e-6; d.divideScalar(L);
  return { heightAt(x, z) {
    const px = x - a.x, pz = z - a.z, t = px * d.x + pz * d.z, s = Math.abs(-px * d.z + pz * d.x);
    if (t < -0.3 || t > L + 0.3 || s > halfW) return null;
    return a.y + (b.y - a.y) * THREE.MathUtils.clamp(t / L, 0, 1);
  } };
}
function boxSurf(c, hw, hd, yaw) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { heightAt(x, z) {
    const px = x - c.x, pz = z - c.z, lx = px * cs - pz * sn, lz = px * sn + pz * cs;
    return Math.abs(lx) <= hw && Math.abs(lz) <= hd ? c.y : null;
  } };
}

/** walk a route segment over the real surfaces: the longest unsupported run (a jump) and how far up the jump goes */
function probeSegment(game, a, b) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.ceil(L / 0.4));
  const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
  let gap = 0, run = 0, worst = { gap: 0, rise: 0, from: a.clone(), to: b.clone() }, lastSup = a.clone(), runStart = null;
  let ledge = 0;
  let prevH = a.y;
  for (let k = 1; k <= n; k++) {
    const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const h = heightNear(game, x, z, a.y + (b.y - a.y) * t + 1.0);
    const sup = h != null && h >= lo - 1.2 && h <= hi + 1.2;
    if (!sup) {
      if (run === 0) runStart = lastSup.clone();
      run += L / n;
    } else {
      const here = V(x, h, z);
      if (run > 0) {
        if (run > worst.gap) worst = { gap: run, rise: h - runStart.y, from: runStart, to: here.clone() };
        run = 0;
      } else if (h - prevH > ledge) ledge = h - prevH;
      lastSup = here; prevH = h;
    }
  }
  if (run > worst.gap) worst = { gap: run, rise: b.y - (runStart ? runStart.y : a.y), from: runStart || a.clone(), to: b.clone() };
  worst.ledge = ledge;
  return worst;
}

/**
 * Level.compose(game, spec) -> level (same object as Level.build, plus level.issues)
 * spec: { ground: {style, size, y, hills} | null (null/absent = floating level over a cloud sea),
 *   pieces: [{type, position, size, rotationY, from, to, style, color, route}], route: [[x,y,z], ...] (optional),
 *   spawn: [x,y,z], goal: [x,y,z] | true (= last route point) | false, collectibles: 'along_route' | number | [[x,y,z],...],
 *   hazards: [{type, position, ...}], dressing: 'auto' | 'none', autofix: true, seed }
 * See docs/Level.md "Compose your own level" for every piece type.
 */
export function compose(game, spec = {}) {
  if (!game || !game.scene) throw new Error('Level.compose(game, spec): first argument must be the game from createGame()');
  if (!spec || !Array.isArray(spec.pieces) || !spec.pieces.length)
    throw new Error('Level.compose: spec.pieces must be a non-empty array, e.g. [{ type: "island", position: [0, 0, 0], size: 10 }]');
  if (!game.look) Look.apply(game, 'toon_bright');
  World.reset(game);
  const seed = spec.seed ?? 1, rnd = rng32(seed * 7919 + 3);
  const group = new THREE.Group(); group.name = 'kit:level:custom';
  game.scene.add(group);
  const level = {
    kind: 'custom', size: 'custom', seed, spawn: V(0, 2, 0), spawnYaw: 0, bounds: new THREE.Box3(), route: [], checkpoints: [],
    collectibles: [], hazards: [], movers: [], goal: null, track: null, group, colliders: [], killY: -40, water: null, issues: [],
    pieces: [],
  };
  const ctx = { group, game };
  const issue = (severity, piece, message) => level.issues.push({ severity, piece, message });
  const dressing = spec.dressing ?? 'auto';
  const prev = World._collect(level.colliders);
  try {
    // ground
    let ground = null, gy0 = null;
    if (spec.ground) {
      const g = spec.ground === true ? {} : spec.ground;
      const STY = ['grass', 'sand', 'snow', 'dirt', 'cobble'];
      if (g.style && !STY.includes(g.style)) throw new Error(`Level.compose: ground.style "${g.style}" is not a style; styles: ${STY.join(', ')}`);
      gy0 = g.y ?? 0;
      ground = World.ground(game, { ...P(ctx), size: g.size ?? 260, center: V(0, gy0, 0), style: g.style || 'grass', flat: (g.size ?? 260) * 0.36,
        hills: g.hills ?? 14, bumps: 0.25, seed: seed + 3 });
      level.ground = ground;
    }
    const floorAt = (x, z) => ground ? (ground.heightAt(x, z) ?? gy0) : null;
    // pieces
    const anchors = [];      // route anchors in piece order: {p, piece}
    const waterPieces = [];
    const docks = [];          // mover dock points {p, r}
    spec.pieces.forEach((pc, i) => {
      if (!pc || typeof pc !== 'object') throw new Error(`Level.compose: pieces[${i}] must be an object like { type: "platform", position: [x, y, z] }`);
      const type = pc.type;
      if (!PIECES.includes(type)) throw new Error(`Level.compose: pieces[${i}].type "${type}" is not a piece type; types: ${PIECES.join(', ')}`);
      const need = (k) => { const v = vecOf(pc[k], `pieces[${i}].${k} (${type})`); if (!v) throw new Error(`Level.compose: pieces[${i}] (${type}) needs ${k}: [x, y, z]`); return v; };
      const yaw = pc.rotationY ?? pc.yaw ?? 0;
      const rec = { i, type, top: null, surf: null };
      const onRoute = pc.route ?? ON_ROUTE.has(type);
      const add = (p) => { if (onRoute) anchors.push({ p, piece: i, type }); };
      switch (type) {
        case 'island': case 'cliff': {
          const p = need('position'), r = Math.max(2.5, typeof pc.size === 'number' ? pc.size : (type === 'cliff' ? 8 : 9));
          const fl = floorAt(p.x, p.z);
          const depth = type === 'cliff' || fl != null ? Math.max(2, p.y - (fl ?? p.y - r) + 1.5) : (pc.depth ?? r * 0.9);
          const isl = World.island(game, { ...P(ctx), position: p, radius: r, depth, style: type === 'cliff' || fl != null ? 'ground' : 'floating',
            waterfall: !!pc.waterfall, seed: seed * 31 + i, irregular: type === 'cliff' ? 0.2 : 0.14 });
          rec.island = isl; rec.top = isl.surfacePoint(p.x, p.z); rec.r = isl.minRadius;
          add(rec.top);
          break;
        }
        case 'platform': {
          const p = need('position');
          if (Array.isArray(pc.size) || pc.style === 'box') {
            const sz = Array.isArray(pc.size) ? pc.size : [4, 1, 4];
            World.prop(game, 'platform_box', { ...P(ctx), position: p, size: [sz[0], sz[1] ?? 1, sz[2] ?? sz[0]], yaw, color: pc.color });
            World.addSurface(game, boxSurf(p, sz[0] / 2, (sz[2] ?? sz[0]) / 2, yaw)); rec.r = Math.min(sz[0], sz[2] ?? sz[0]) / 2;
          } else {
            const r = Math.max(1.2, pc.size ?? 2.2);
            World.prop(game, 'platform_round', { ...P(ctx), position: p, radius: r, thick: 0.8, color: pc.color });
            World.addSurface(game, circleSurf(p, r)); rec.r = r;
          }
          rec.top = p; add(p);
          break;
        }
        case 'pillar': {
          const p = need('position'), r = Math.max(1.2, pc.size ?? 1.8);
          const base = floorAt(p.x, p.z) ?? (p.y - (pc.height ?? 7));
          const h = Math.max(1, p.y - base - 0.4);
          World.prop(game, 'pillar', { ...P(ctx), position: V(p.x, base, p.z), height: h, scale: 1, color: pc.color });
          World.prop(game, 'platform_round', { ...P(ctx), position: p, radius: r, thick: 0.5, color: pc.color || 'stone' });
          World.addSurface(game, circleSurf(p, r)); rec.top = p; rec.r = r; add(p);
          break;
        }
        case 'ramp': case 'stairs': case 'bridge': {
          let a = need('from'), b = need('to');
          const w = pc.width ?? (type === 'bridge' ? 2.8 : 3.6);
          const Lh = Math.hypot(b.x - a.x, b.z - a.z);
          if (Lh < 1) throw new Error(`Level.compose: pieces[${i}] (${type}) from and to are only ${Lh.toFixed(1)} u apart; make them at least 2 u apart`);
          if (type === 'bridge') {
            World.prop(game, 'bridge', { ...P(ctx), from: a, to: b, width: w, sag: pc.sag ?? Math.min(0.6, Lh * 0.03) });
          } else {
            const lowA = a.y <= b.y, lo = lowA ? a : b, hiP = lowA ? b : a, h = hiP.y - lo.y;
            if (h / Lh > 1.1) issue('warning', i, `piece ${i} (${type}) is very steep (${h.toFixed(1)} up over ${Lh.toFixed(1)} across); make it longer`);
            const mid = lo.clone().lerp(hiP, 0.5).setY(lo.y);
            if (h < 0.25) World.prop(game, 'platform_box', { ...P(ctx), position: mid.setY(lo.y), size: [w, 0.6, Lh], yaw: Math.atan2(hiP.x - lo.x, hiP.z - lo.z), color: pc.color });
            else if (type === 'ramp') World.prop(game, 'ramp', { ...P(ctx), position: mid, yaw: Math.atan2(-(hiP.z - lo.z), hiP.x - lo.x), length: Lh, width: w, height: h, color: pc.color });
            else World.prop(game, 'stairs', { ...P(ctx), position: mid, yaw: Math.atan2(hiP.x - lo.x, hiP.z - lo.z), depth: Lh, width: w, height: h, steps: Math.max(3, Math.round(h / 0.5)), color: pc.color });
          }
          World.addSurface(game, stripSurf(a, b, w / 2));
          rec.from = a; rec.to = b; rec.top = a.clone().lerp(b, 0.5); rec.r = w / 2;
          if (onRoute) anchors.push({ p: a, piece: i, type, pair: b });
          break;
        }
        case 'wall': {
          const p = need('position');
          World.prop(game, 'wall', { ...P(ctx), position: p, yaw, length: pc.length ?? (typeof pc.size === 'number' ? pc.size : 8), height: pc.height ?? 2.4, color: pc.color });
          rec.top = p; break;
        }
        case 'arch': { const p = need('position'); World.prop(game, 'arch', { ...P(ctx), position: p, yaw, width: pc.width ?? 6, height: pc.height ?? 5, color: pc.color }); rec.top = p; break; }
        case 'tower': { const p = need('position'); World.prop(game, 'tower', { ...P(ctx), position: p, height: pc.height ?? (typeof pc.size === 'number' ? pc.size : 12), radius: pc.radius ?? 2.6, color: pc.color }); rec.top = p; break; }
        case 'mover': {
          const motion = pc.motion || 'pingpong';
          if (!MOTIONS.includes(motion)) throw new Error(`Level.compose: pieces[${i}].motion "${motion}" is not a motion; motions: ${MOTIONS.join(', ')}`);
          const hasPath = Array.isArray(pc.path) && pc.path.length >= 2;
          const p = hasPath ? vecOf(pc.path[0], `pieces[${i}].path[0]`) : need('position');
          let path;
          if (hasPath) path = pc.path.map((q, k) => vecOf(q, `pieces[${i}].path[${k}]`));
          else if (motion === 'rotate') path = [p.clone()];
          else path = [p.clone(), need('to')];
          if (motion === 'raft') {
            const wp = spec.pieces.find(x => x && x.type === 'water');
            if (!wp) throw new Error(`Level.compose: pieces[${i}] is a raft but there is no 'water' piece; add { type: "water", position: [x, waterLevel, z] }`);
            const wy = vecOf(wp.position, 'water.position').y + 0.25;
            for (const q of path) q.y = wy;
          }
          const shape = pc.shape || (motion === 'rotate' ? 'beam' : motion === 'raft' ? 'raft' : 'round');
          let mesh, size, r;
          if (shape === 'beam') {
            const len = pc.length ?? 9, w = pc.width ?? 2.4;
            mesh = World.prop(game, 'platform_box', { ...P(ctx), position: path[0], size: [len, 0.6, w], collider: false, color: pc.color || 'primary' });
            size = [len, 0.6, w]; r = w / 2 + 0.3;
          } else if (shape === 'raft') {
            const w = pc.size ?? 3.6;
            mesh = World.prop(game, 'platform_box', { ...P(ctx), position: path[0], size: [w, 0.5, w], collider: false, color: pc.color || 'wood' });
            size = [w, 0.5, w]; r = w / 2;
          } else {
            r = Math.max(1.4, pc.size ?? 2.2);
            mesh = World.prop(game, 'platform_round', { ...P(ctx), position: path[0], radius: r, thick: 0.7, collider: false, color: pc.color });
            size = [2 * r, 0.7, 2 * r];
          }
          mesh.userData.dynamic = true;
          level.movers.push({ mesh, path: path.map(q => q.clone()), period: pc.period ?? 5, wait: pc.wait ?? 0.6, speed: pc.speed ?? 0.8,
            type: motion === 'rotate' ? 'spin' : motion === 'raft' ? 'raft' : 'platform', pingpong: motion !== 'loop', size, piece: i });
          rec.top = path[0]; rec.r = r; rec.mover = true;
          // where it docks: temporary surfaces so the route legs onto / off it validate (removed after validation)
          docks.push({ p: path[0], r }, ...(path.length > 1 ? [{ p: path[path.length - 1], r }] : []));
          if (onRoute) {
            if (motion === 'rotate') anchors.push({ p: path[0].clone(), piece: i, type });
            else anchors.push({ p: path[0].clone(), pair: path[path.length - 1].clone(), piece: i, type, mover: true });
          }
          break;
        }
        case 'water': {
          const p = need('position');
          waterPieces.push({ p, size: typeof pc.size === 'number' ? pc.size : 200 });
          rec.top = p; break;
        }
      }
      level.pieces.push(rec);
    });

    // route: explicit points, or the anchors in piece order (ramps/stairs/bridges walked from the end nearest the previous point)
    let route = [];
    const routePiece = [];
    const ridden = [];       // ridden[k]: the leg into route[k] is carried by a mover (no jump check)
    if (Array.isArray(spec.route) && spec.route.length >= 2) {
      spec.route.forEach((q, k) => {
        const p = vecOf(q, `route[${k}]`);
        const h = World.heightAt(game, p.x, p.z);
        if (h != null && Math.abs(h - p.y) < 1.5) p.y = h;
        route.push(p); routePiece.push(null); ridden.push(false);
      });
    } else {
      for (const an of anchors) {
        if (an.pair) {
          const last = route[route.length - 1];
          const [s, e] = !last || last.distanceTo(an.p) <= last.distanceTo(an.pair) ? [an.p, an.pair] : [an.pair, an.p];
          route.push(s.clone(), e.clone()); routePiece.push(an.piece, an.piece); ridden.push(false, !!an.mover);
        } else { route.push(an.p.clone()); routePiece.push(an.piece); ridden.push(false); }
      }
    }
    if (route.length < 2) throw new Error('Level.compose: the route needs at least 2 points: add 2+ standable pieces (island, platform, cliff, pillar, ramp, stairs, bridge) or give spec.route');
    if (spec.spawn) { route.unshift(vecOf(spec.spawn, 'spawn')); routePiece.unshift(null); ridden.unshift(false); }
    let goalP = null;
    if (spec.goal !== false) {
      goalP = spec.goal && spec.goal !== true ? vecOf(spec.goal, 'goal') : route[route.length - 1].clone();
      if (route[route.length - 1].distanceTo(goalP) > 0.5) { route.push(goalP.clone()); routePiece.push(null); ridden.push(false); }
    }
    // validate every leg on the real geometry; auto-fix with stepping platforms; add take-off / landing points
    const label = (k) => routePiece[k] == null ? `route point ${k}` : `piece ${routePiece[k]} (${spec.pieces[routePiece[k]].type})`;
    const out = [route[0].clone()];
    const jumps = [];
    const autofix = spec.autofix !== false;
    let firstJump = true;
    const dockSurfs = docks.map(d => World.addSurface(game, circleSurf(d.p, d.r)));
    for (let k = 1; k < route.length; k++) {
      const a = out[out.length - 1], b = route[k];
      if (ridden[k]) { out.push(b.clone()); continue; }                       // carried by a mover: board at a, get off at b
      let pr = probeSegment(game, a, b);
      const easyFirst = firstJump && pr.gap > 3 && autofix;          // the first jump of the level: at most 3 u
      if (pr.gap > 0.3) firstJump = false;
      const bad = () => easyFirst || pr.gap > MAX_GAP || (pr.gap > 0.3 && pr.rise > MAX_RISE) || pr.ledge > MAX_RISE;
      if (bad()) {
        const what = pr.gap > 0.3 ? `${pr.gap.toFixed(1)} u across${pr.rise > 0.3 ? ` and ${pr.rise.toFixed(1)} u up` : ''}` : `a ${pr.ledge.toFixed(1)} u ledge`;
        const msg = `${label(k)} is ${what} from ${label(k - 1)}: the max jump is ${MAX_GAP} u across and ${MAX_RISE} u up; move it closer, lower it, or add a 'bridge', 'ramp' or 'stairs' piece between them`;
        const from = pr.gap > 0.3 ? pr.from : a, to = pr.gap > 0.3 ? pr.to : b;
        const dx = Math.hypot(to.x - from.x, to.z - from.z), dy = to.y - from.y;
        let n = 1;
        const pr2 = 1.8;
        const maxGap = easyFirst ? 2.8 : MAX_GAP - 1.0;
        while (n <= 8 && ((dx - n * 2 * pr2) / (n + 1) > maxGap || dy / (n + 1) > MAX_RISE - 0.4)) n++;
        if (autofix && n <= 8) {
          let prevP = from.clone();
          const dir = V(to.x - from.x, 0, to.z - from.z).normalize(), side = V(dir.z, 0, -dir.x);
          for (let s = 1; s <= n; s++) {
            const t = s / (n + 1);
            const q = from.clone().lerp(to, t);
            q.y = from.y + dy * t;
            if (dx < 2 * pr2 * n + 2) q.addScaledVector(side, (s % 2 ? 1 : -1) * 2.6);     // tall climb, little room: zig-zag
            World.prop(game, 'platform_round', { ...P(ctx), position: q, radius: pr2, thick: 0.6 });
            World.addSurface(game, circleSurf(q, pr2));
            out.push(q.clone()); jumps.push({ from: prevP, to: q.clone() }); prevP = q.clone();
          }
          jumps.push({ from: prevP, to: to.clone() });
          if (!(easyFirst && pr.gap <= MAX_GAP && pr.rise <= MAX_RISE))
            issue('fixed', routePiece[k], msg.replace(/; move it closer.*/, `; added ${n} stepping platform${n > 1 ? 's' : ''} between them`));
          out.push(b.clone());
          continue;
        }
        issue('error', routePiece[k], msg);
      } else if (pr.gap > 0.3) {
        // a real jump: route through the take-off and landing edges so the autopilot jumps at the right place
        const dir = V(pr.to.x - pr.from.x, 0, pr.to.z - pr.from.z).normalize();
        const t0 = pr.from.clone().addScaledVector(dir, -0.6), t1 = pr.to.clone().addScaledVector(dir, 0.8);
        const h0 = heightNear(game, t0.x, t0.z, pr.from.y + 0.5), h1 = heightNear(game, t1.x, t1.z, pr.to.y + 0.5);
        if (h0 != null) t0.y = h0; if (h1 != null) t1.y = h1;
        if (t0.distanceTo(a) > 0.8) out.push(t0);
        out.push(t1); jumps.push({ from: t0, to: t1 });
      } else {
        // a walk: route points every ~4 u so the autopilot follows the surface (spiral stairs, long ramps, ground paths)
        const c = out[out.length - 1], L = Math.hypot(b.x - c.x, b.z - c.z);
        for (let s = 1, n = Math.floor(L / 4); s <= n && L > 5; s++) {
          const q = c.clone().lerp(b, s / (n + 1)), h = heightNear(game, q.x, q.z, q.y + 0.5);
          if (h != null) q.y = h;
          out.push(q);
        }
      }
      if (out[out.length - 1].distanceTo(b) > 0.5) out.push(b.clone());
    }
    game._kitSurfaces = (game._kitSurfaces || []).filter(x => !dockSurfs.includes(x));
    level.route = out;
    { // spawn safety: rails on the first island facing the void, if the level floats
      const first = level.pieces.find(p => p.island && Math.hypot(p.top.x - out[0].x, p.top.z - out[0].z) < p.r + 0.5);
      if (first && !ground && dressing !== 'none' && out[1]) guardRails(ctx, first.island, out.find(q => !first.island.contains(q.x, q.z, 0.3)) || out[1]);
    }
    level.spawn = (spec.spawn ? vecOf(spec.spawn, 'spawn') : out[0].clone()).add(V(0, 1, 0));
    level.spawnYaw = yawTo(out[0], out[Math.min(2, out.length - 1)]);
    if (goalP) level.goal = { position: goalP.clone().add(V(0, 0.5, 0)), radius: 3 };
    // checkpoints: every ~40 u of route
    { let acc = 0; for (let k = 1; k < out.length - 1; k++) { acc += out[k].distanceTo(out[k - 1]); if (acc > 40) { level.checkpoints.push({ position: out[k].clone().add(V(0, 0.1, 0)), radius: 3 }); acc = 0; } } }
    // collectibles
    const cs = spec.collectibles ?? 'along_route';
    if (Array.isArray(cs)) cs.forEach((c, k) => level.collectibles.push(c && c.position ? { position: vecOf(c.position, `collectibles[${k}].position`), tag: c.tag || 'coin' } : { position: vecOf(c, `collectibles[${k}]`), tag: 'coin' }));
    else {
      const n = typeof cs === 'number' ? cs : (spec.collectibleCount ?? 30);
      const arcs = [];
      for (const j of jumps) for (let s = 1; s <= 2; s++) { const t = s / 3, q = j.from.clone().lerp(j.to, t); q.y += 1.3 + Math.sin(t * Math.PI) * 2.2; arcs.push(q); }
      const trail = alongRoute(out, Math.max(0, n - arcs.length)).map(q => q.add(V(0, 1.2, 0)));
      for (const q of [...arcs, ...trail].slice(0, n)) level.collectibles.push({ position: q, tag: 'coin' });
    }
    // hazards
    for (const [k, h] of (spec.hazards || []).entries()) {
      if (!h || !HAZARD_TYPES.includes(h.type)) { issue('warning', null, `hazards[${k}].type "${h && h.type}" is not a hazard type (dropped); types: ${HAZARD_TYPES.join(', ')}`); continue; }
      const hp = { ...h, position: vecOf(h.position ?? [0, 0, 0], `hazards[${k}].position`) };
      if (h.type !== 'void') {
        let acc = 0, nearStart = false;
        for (let q = 0; q < out.length && acc < 15; q++) { if (q) acc += out[q].distanceTo(out[q - 1]); if (out[q].distanceTo(hp.position) < 4) nearStart = true; }
        if (nearStart) { issue('warning', null, `hazards[${k}] (${h.type}) is within the first 15 u of the route (dropped: the start must be safe); move it further along`); continue; }
      }
      if (h.type !== 'void' && out.some(r => Math.hypot(r.x - hp.position.x, r.z - hp.position.z) < 1.2 && Math.abs(r.y - hp.position.y) < 2))
        issue('warning', null, `hazards[${k}] (${h.type}) sits right on the route; the player must jump it (fine for spikes/saw, move it 3 u aside otherwise)`);
      level.hazards.push(hp);
    }
    // water after the geometry (its foam reads the surfaces)
    for (const w of waterPieces) { World.water(game, { ...P(ctx), level: w.p.y, size: w.size, center: V(w.p.x, 0, w.p.z) }); level.water = { y: w.p.y }; }
    // bounds, fall plane
    const pts = [...out, ...level.pieces.map(p => p.top).filter(Boolean)];
    level.bounds = boundsOf(pts, 10);
    level.killY = ground ? gy0 - 15 : Math.min(...level.pieces.map(p => p.top ? p.top.y : 0)) - 25;
    level.hazards.push({ type: 'void', y: level.killY, position: V(0, level.killY, 0) });

    // dressing in the look's style
    if (dressing !== 'none') {
      const dense = densify(out, 1.5);
      World.noPlant(game, dense, 1.9);
      if (goalP) {
        World.noPlant(game, [goalP], 4);
        const back = yawTo(out[Math.max(0, out.length - 3)], goalP);
        const ah = World.heightAt(game, goalP.x, goalP.z) ?? goalP.y;
        World.prop(game, 'arch', { ...P(ctx), position: V(goalP.x + Math.sin(back) * 3, ah - 0.1, goalP.z + Math.cos(back) * 3), yaw: back, width: 6, height: 4.5 });
        const fp = V(goalP.x - Math.cos(back) * 2.8, 0, goalP.z + Math.sin(back) * 2.8); fp.y = (World.heightAt(game, fp.x, fp.z) ?? goalP.y) - 0.1;
        World.prop(game, 'flag', { ...P(ctx), position: fp, height: 5.5 });
      }
      for (const pc of level.pieces) {
        if (pc.island) {
          World.foliage(game, { ...P(ctx), area: pc.island, kinds: pc.type === 'cliff' ? { grass: 0.6, bush: 1, rock: 1.2, tree_pine: 0.6 } : { grass: 1, flowers: 1, bush: 1, tree_round: 0.8, tree_pine: 0.4, mushroom: 0.5, rock: 0.4 }, seed: seed + pc.i * 13 });
          if (pc.r > 7 && rnd() < 0.6) {
            const a = rnd() * Math.PI * 2, q = pc.island.edgePoint(a, 2.4);
            if (out.every(r => r.distanceTo(q) > 3)) World.prop(game, ['crate', 'barrel', 'rock', 'chest'][Math.floor(rnd() * 4)], { ...P(ctx), position: q.add(V(0, -0.05, 0)), yaw: a });
          }
        }
        if (pc.type === 'bridge') for (const e of [pc.from, pc.to]) {
          const d = V(pc.to.x - pc.from.x, 0, pc.to.z - pc.from.z).normalize(), sd = V(d.z, 0, -d.x).multiplyScalar(pc.r + 0.6);
          for (const sg of [-1, 1]) { const q = e.clone().addScaledVector(sd, sg); const h = World.heightAt(game, q.x, q.z); if (h != null) World.prop(game, 'lamp', { ...P(ctx), position: q.setY(h), height: 2.6 }); }
        }
      }
      const ctr = level.bounds.getCenter(V(0, 0, 0)), span = level.bounds.getSize(V(0, 0, 0)).length() / 2;
      if (ground) {
        World.foliage(game, { ...P(ctx), area: { center: ctr, radius: span + 70 }, kinds: { grass: 1, flowers: 1, bush: 1, tree_round: 1.2, tree_pine: 0.8, rock: 0.6 }, density: 0.8,
          minY: (level.water ? level.water.y : -1e9) + 0.3, seed: seed + 9, focus: out, focusRadius: 35 });
        World.clouds(game, { ...P(ctx), count: 16, height: 55, center: ctr, radius: span + 140, seed });
      } else {
        let minY = Infinity; for (const p of level.pieces) if (p.top) minY = Math.min(minY, p.top.y);
        World.clouds(game, { ...P(ctx), count: 60, height: minY - 30 - ctr.y, center: ctr, radius: span + 150, below: true, speed: 1.0, seed: seed + 5 });
        World.clouds(game, { ...P(ctx), count: 14, height: 30, center: ctr, radius: span + 160, speed: 1.6, seed: seed + 6 });
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * Math.PI * 2 + rnd(), d = span + 70 + rnd() * 100;
          const isl = World.island(game, { ...P(ctx), position: V(ctr.x + Math.cos(a) * d, ctr.y - 6 + rnd() * 26, ctr.z + Math.sin(a) * d), radius: 8 + rnd() * 12, seed: 700 + k + seed, collider: false, waterfall: k % 3 === 0 });
          World.foliage(game, { ...P(ctx), area: isl, kinds: { tree_round: 1.5, tree_pine: 1, bush: 1, grass: 0.25 }, seed: 1900 + k });
        }
      }
    }
  } finally { World._collect(prev); }
  group.updateMatrixWorld(true);
  if (spec.bake !== false) {
    try { level.batching = World.bake(game, group, { keep: level.movers.map(m => m.mesh) }); }
    catch (e) { console.warn('[kit] Level.compose: batching failed, keeping separate meshes', e); }
  }
  Look.fit(game, level.bounds);
  game.level = level;
  level.issueText = level.issues.map(x => `${x.severity}: ${x.message}`);
  for (const x of level.issues) (x.severity === 'error' ? console.warn : console.info)(`[kit] Level.compose ${x.severity}: ${x.message}`);
  if (spec.strict && level.issues.some(x => x.severity === 'error')) throw new Error('Level.compose: ' + level.issues.filter(x => x.severity === 'error').map(x => x.message).join(' | '));
  return level;
}
