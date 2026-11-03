// gameplay.js: Gameplay.rules (collectibles, checkpoints, hazards, movers, enemies, goal, timer, lives, race) and
// Gameplay.autopilot (a bot that plays the level along level.route). Writes game.state, emits CONTRACT events.
// See docs/Gameplay.md.
import * as THREE from 'three';
import * as Physics from './physics.js';
import * as Look from './look.js';
import * as Player from './player.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const angWrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const vec = (v, name) => {
  if (v && v.isVector3) return v;
  if (Array.isArray(v) && v.length === 3) return V3(...v);
  if (v && typeof v.x === 'number') return V3(v.x, v.y || 0, v.z || 0);
  throw new Error(`Gameplay.rules: ${name} must be a THREE.Vector3 or [x,y,z], got ${JSON.stringify(v)}`);
};

function mat(game, color, kind = 'toon', extra = {}) {
  // Look.material is cached and shared: never mutate what it returns (use own() for that)
  if (kind === 'glow') return new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: extra.opacity ?? 1, depthWrite: extra.depthWrite ?? true });
  if (typeof Look.material === 'function') {
    try {
      const o = kind === 'pickup' ? { color, kind: 'emissive', emissive: color, emissiveIntensity: extra.glow ?? 0.9, flat: extra.flat }
        : { color, kind, flat: extra.flat, side: extra.side === THREE.DoubleSide ? 'double' : undefined };
      const m = Look.material(game, o); if (m) return m;
    } catch (e) { /* fallback */ }
  }
  if (kind === 'pickup' || kind === 'emissive')
    return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: extra.glow ?? 0.55, roughness: 0.25, metalness: extra.metal ?? 0.35, flatShading: !!extra.flat });
  return Player.material(game, color, kind, extra.side ? { side: extra.side } : {});
}
const own = (m) => m.clone();
function mesh(geo, m, cast = true) { const o = new THREE.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = true; o.userData.noCollide = true; return o; }

let glowTex = null;
function glowSprite(color, size = 2) {
  if (!glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  s.scale.setScalar(size); s.userData.noCollide = true; return s;
}

// ---- collectibles --------------------------------------------------------------------------------------------------

export const COLLECTIBLE_DEFS = {
  coin: { color: '#ffc928', value: 1, radius: 1.1 },
  star: { color: '#ffe14d', value: 10, radius: 1.4 },
  gem: { color: '#3ee0ff', value: 5, radius: 1.2 },
  seed: { color: '#8ee05a', value: 2, radius: 1.1 },
  heart: { color: '#ff5c8a', value: 0, radius: 1.2 },
  orb: { color: '#c58bff', value: 1, radius: 1.1 },
};

export const COLLECTIBLES = Object.keys(COLLECTIBLE_DEFS);   // tags with a built-in look; any other tag is a glowing orb

function starShape(outer = 0.6, inner = 0.27, n = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i <= n * 2; i++) {
    const r = i % 2 ? inner : outer, a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  return s;
}

/** Build a collectible's look. tag: coin|star|gem|seed|heart|orb|any (any = orb in opts.color). */
export function makeCollectible(game, tag = 'coin', opts = {}) {
  const def = COLLECTIBLE_DEFS[tag] || { ...COLLECTIBLE_DEFS.orb, color: opts.color || COLLECTIBLE_DEFS.orb.color };
  const color = opts.color || def.color;
  const g = new THREE.Group(); g.name = 'collectible_' + tag;
  const spin = new THREE.Group(); g.add(spin);
  if (tag === 'coin') {
    const geo = new THREE.CylinderGeometry(0.48, 0.48, 0.13, 28); geo.rotateX(Math.PI / 2);
    spin.add(mesh(geo, mat(game, color, 'pickup', { metal: 0.6, glow: 0.45 })));
    const rim = mesh(new THREE.TorusGeometry(0.48, 0.05, 8, 28), mat(game, '#ffe68a', 'pickup', { glow: 0.6 })); spin.add(rim);
    const st = mesh(new THREE.ExtrudeGeometry(starShape(0.22, 0.1), { depth: 0.06, bevelEnabled: false }), mat(game, '#fff2b0', 'pickup', { glow: 0.8 }), false);
    st.position.z = 0.04; spin.add(st);
    const st2 = st.clone(); st2.rotation.y = Math.PI; st2.position.z = -0.04; spin.add(st2);
  } else if (tag === 'star') {
    const geo = new THREE.ExtrudeGeometry(starShape(0.62, 0.28), { depth: 0.18, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
    geo.center();
    spin.add(mesh(geo, mat(game, color, 'pickup', { glow: 0.7, metal: 0.2 })));
    for (const s of [-1, 1]) { const e = mesh(new THREE.CapsuleGeometry(0.04, 0.1, 2, 6), mat(game, '#2a2340')); e.position.set(0.11 * s, 0.05, 0.2); spin.add(e); }
  } else if (tag === 'gem') {
    const geo = new THREE.OctahedronGeometry(0.45, 0); geo.scale(1, 1.45, 1);
    spin.add(mesh(geo, mat(game, color, 'pickup', { glow: 0.5, flat: true, metal: 0.1 })));
  } else if (tag === 'seed') {
    const body = mesh(new THREE.SphereGeometry(0.34, 16, 12), mat(game, '#d9a25a', 'pickup', { glow: 0.25, metal: 0.1 })); body.scale.set(1, 1.25, 1); spin.add(body);
    const cap = mesh(new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(game, '#8a5a2b')); cap.position.y = 0.16; spin.add(cap);
    const leaf = mesh(new THREE.SphereGeometry(0.2, 10, 6), mat(game, color, 'pickup', { glow: 0.4 })); leaf.scale.set(1.3, 0.25, 0.6); leaf.position.set(0.15, 0.55, 0); leaf.rotation.z = 0.5; spin.add(leaf);
  } else if (tag === 'heart') {
    const s = new THREE.Shape(); s.moveTo(0, -0.45); s.bezierCurveTo(0.6, -0.05, 0.45, 0.45, 0, 0.2); s.bezierCurveTo(-0.45, 0.45, -0.6, -0.05, 0, -0.45);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06 }); geo.center();
    spin.add(mesh(geo, mat(game, color, 'pickup', { glow: 0.6 })));
  } else {
    spin.add(mesh(new THREE.IcosahedronGeometry(0.42, 1), mat(game, color, 'pickup', { glow: 0.7, flat: true })));
  }
  const glow = glowSprite(color, tag === 'star' ? 3.2 : 2.2); glow.material.opacity = 0.55; g.add(glow);
  g.userData.spin = spin; g.userData.glow = glow;
  return { group: g, def: { ...def, color } };
}

// ---- small builders ------------------------------------------------------------------------------------------------

function makeFlag(game, color) {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 10), mat(game, '#f4f1ea')); pole.position.y = 1.7; g.add(pole);
  const knob = mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(game, '#ffd23f', 'pickup')); knob.position.y = 3.45; g.add(knob);
  const base = mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.25, 24), mat(game, '#8d93a8')); base.position.y = 0.12; g.add(base);
  const ring = mesh(new THREE.TorusGeometry(1.25, 0.06, 6, 40), mat(game, color, 'glow'), false); ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; g.add(ring);
  const fgeo = new THREE.PlaneGeometry(1.3, 0.8, 10, 4); fgeo.translate(0.65, 0, 0);
  const flag = mesh(fgeo, own(mat(game, '#b8bcc8', 'toon', { side: THREE.DoubleSide }))); flag.material.side = THREE.DoubleSide;
  flag.position.set(0.08, 0.6, 0); g.add(flag);
  const orig = fgeo.attributes.position.array.slice();
  return {
    group: g, flag, ring, raise: 0,
    wave(t, active) {
      const p = fgeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = orig[i * 3];
        p.setZ(i, Math.sin(x * 4 - t * (active ? 8 : 3)) * 0.12 * x);
      }
      p.needsUpdate = true; fgeo.computeVertexNormals();
    },
  };
}

function makeEyes(game, parent, y, z, spread = 0.22, size = 0.12) {
  for (const s of [-1, 1]) {
    const w = mesh(new THREE.SphereGeometry(size, 12, 10), mat(game, '#ffffff')); w.scale.set(1, 1.2, 0.6); w.position.set(spread * s, y, z); parent.add(w);
    const p = mesh(new THREE.SphereGeometry(size * 0.55, 10, 8), mat(game, '#1d1b2e')); p.position.set(0, 0, size * 0.55); w.add(p);
    const brow = mesh(new THREE.BoxGeometry(size * 1.6, size * 0.35, size * 0.3), mat(game, '#1d1b2e')); brow.position.set(spread * s, y + size * 1.4, z + 0.02); brow.rotation.z = -0.45 * s; parent.add(brow);
  }
}

function makeEnemy(game, kind, color) {
  const g = new THREE.Group(); g.name = 'enemy_' + kind;
  const body = new THREE.Group(); g.add(body);
  let radius = 0.8, height = 1.2;
  if (kind === 'chase') {
    const c = color || '#7a5cff';
    const ball = mesh(new THREE.SphereGeometry(0.75, 20, 14), mat(game, c)); ball.position.y = 0.8; body.add(ball);
    const spikeM = mat(game, '#f4f1ea');
    const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position;
    const seen = new Set();
    for (let i = 0; i < ico.count; i++) {
      const d = V3(ico.getX(i), ico.getY(i), ico.getZ(i)).normalize(); const key = d.toArray().map(v => v.toFixed(2)).join();
      if (seen.has(key)) continue; seen.add(key);
      const sp = mesh(new THREE.ConeGeometry(0.16, 0.45, 8), spikeM); sp.position.copy(d).multiplyScalar(0.8); sp.position.y += 0.8;
      sp.quaternion.setFromUnitVectors(UP, d); ball.parent.add(sp);
    }
    makeEyes(game, body, 1.0, 0.62, 0.24, 0.14);
    radius = 0.95; height = 1.6;
  } else if (kind === 'turret') {
    const c = color || '#ff5d5d';
    const base = mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.8, 16), mat(game, '#6b6f80')); base.position.y = 0.4; g.add(base);
    const head = mesh(new THREE.SphereGeometry(0.75, 18, 14), mat(game, c)); head.position.y = 1.35; body.add(head);
    const barrel = mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.1, 12), mat(game, '#2a2733')); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.35, 0.8); body.add(barrel);
    const muzzle = mesh(new THREE.TorusGeometry(0.24, 0.07, 6, 14), mat(game, '#ffd23f', 'pickup')); muzzle.position.set(0, 1.35, 1.35); body.add(muzzle);
    makeEyes(game, body, 1.55, 0.6, 0.25, 0.12);
    radius = 1.0; height = 2.0;
  } else {
    // patrol slime
    const c = color || '#5fd16a';
    const blob = mesh(new THREE.SphereGeometry(0.8, 22, 16), mat(game, c)); blob.scale.set(1, 0.8, 1); blob.position.y = 0.64; body.add(blob);
    const shine = mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 })); shine.position.set(-0.3, 1.0, 0.45); shine.scale.set(1, 0.6, 0.5); body.add(shine);
    makeEyes(game, body, 0.8, 0.62, 0.24, 0.13);
    const mouth = mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 12, Math.PI), mat(game, '#1d1b2e')); mouth.position.set(0, 0.48, 0.74); mouth.rotation.z = Math.PI; body.add(mouth);
    radius = 0.85; height = 1.3;
  }
  const blob = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob);
  g.traverse(o => { o.userData.noCollide = true; });
  return { group: g, body, radius, height };
}

// ---- rules ---------------------------------------------------------------------------------------------------------

const HAZARD_TYPES = ['spinner', 'saw', 'spikes', 'lava', 'killzone', 'bounce', 'boost', 'crumble', 'enemy', 'wind', 'void'];
export const HAZARDS = HAZARD_TYPES;
export const ENEMIES = ['patrol', 'chase', 'turret'];

/**
 * Gameplay.rules(game, { level, player, collect: {tag, target} | true, goal: true, timer: true | seconds,
 *   lives: 3, hp: 3, enemies: number | [{kind, position}], race: {laps: 3, opponents: 3}, onWin, onLose, scoreToWin })
 * Spawns everything from the level placements, writes game.state and emits the CONTRACT events. Returns the rules object.
 */
export function rules(game, opts = {}) {
  if (!game || !game.world) throw new Error('Gameplay.rules(game, opts): first argument must be the game from createGame()');
  const level = opts.level || game.level || game.__level, player = opts.player || game.__player;
  // forgiving shorthands: collect: 'coin' | 30, timer: '60'
  if (typeof opts.collect === 'string') opts = { ...opts, collect: { tag: opts.collect } };
  else if (typeof opts.collect === 'number') opts = { ...opts, collect: { target: opts.collect } };
  if (typeof opts.timer === 'string' && isFinite(+opts.timer)) opts = { ...opts, timer: +opts.timer };
  if (!level || typeof level !== 'object') throw new Error('Gameplay.rules: opts.level is missing; pass the object Level.build() returned');
  if (!player || !player.position) throw new Error('Gameplay.rules: opts.player is missing; pass the object Player.create() returned');
  for (const k of ['collectibles', 'checkpoints', 'hazards', 'movers', 'route']) if (!Array.isArray(level[k])) level[k] = [];
  game.__level = level; game.__player = player;
  const vehicle = player.type === 'kart' || player.type === 'boat';
  // vehicles on a track race by default; race: true means default settings
  if (opts.race === undefined && vehicle && level.track) opts = { ...opts, race: {} };
  if (opts.race === true) opts = { ...opts, race: {} };
  if (opts.race && !level.track) { console.warn('Gameplay.rules: race needs level.track; ignoring race (use a race kind such as "race_track")'); opts = { ...opts, race: null }; }
  const root = new THREE.Group(); root.name = 'gameplay'; game.scene.add(root);

  // collect config
  let collect = opts.collect === true ? {} : (opts.collect || null);
  const tagCounts = {};
  for (const c of level.collectibles) tagCounts[c.tag || 'coin'] = (tagCounts[c.tag || 'coin'] || 0) + 1;
  if (collect) {
    if (!collect.tag) collect.tag = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a])[0] || 'coin';
    const avail = level.collectibles.filter(c => (c.tag || 'coin') === collect.tag).length;
    if (!collect.target || collect.target > avail) {
      if (collect.target > avail) console.warn(`Gameplay.rules: collect.target ${collect.target} > ${avail} "${collect.tag}" in the level; using ${avail}`);
      collect.target = avail;
    }
  }
  const lives = opts.lives === undefined ? (opts.race ? false : 3) : opts.lives;   // races: endless respawns            // Infinity / false = endless
  const maxHp = opts.hp ?? (player.type === 'platformer' || player.type === 'topdown' || player.type === 'fps' ? 3 : 1);
  const countdown = typeof opts.timer === 'number' ? opts.timer : null;
  const S = Object.assign(game.state, {
    score: 0, collected: 0, target: collect ? collect.target : 0, collectTag: collect ? collect.tag : null,
    lives: lives === false ? Infinity : lives, hp: maxHp, maxHp, health: maxHp, maxHealth: maxHp, time: 0, phase: 'playing', objective: '', timeLeft: countdown, won: false, lost: false,
    lap: 0, laps: 0, position: 0, racers: 0, checkpoint: 0, checkpoints: level.checkpoints.length, enemiesLeft: 0, goalOpen: true,
  });
  // CONTRACT: keys are absent when their rule is off (the HUD shows what exists)
  if (!collect) { delete S.target; delete S.collectTag; }
  if (!isFinite(S.lives)) delete S.lives;
  if (countdown === null) delete S.timeLeft;
  if (!opts.race) { delete S.lap; delete S.laps; delete S.position; delete S.racers; }
  let dirty = true;
  const changed = () => { dirty = true; };
  player.killY = level.killY ?? (level.bounds && isFinite(level.bounds.min.y) ? level.bounds.min.y - 8 : player.killY);
  if (level.water && player.type === 'boat' && player.waterLevel === null) player.waterLevel = level.water.y ?? level.water;

  const R = { state: S, level, player, items: [], checkpoints: [], hazards: [], enemies: [], movers: [], goal: null, racers: [], root };

  // ---- collectibles
  function addCollectible(position, tag = 'coin', extra = {}) {
    const { group, def } = makeCollectible(game, tag, extra);
    const p = vec(position, 'collectible position');
    group.position.copy(p); root.add(group);
    const it = { position: p.clone(), home: p.clone(), tag, value: extra.value ?? def.value, radius: def.radius, object: group, collected: false, t: 0, phase: game.rand() * 6.28 };
    R.items.push(it);
    return it;
  }
  for (const c of level.collectibles) addCollectible(c.position, c.tag || 'coin', c);
  R.addCollectible = addCollectible;

  // ---- checkpoints
  if (!opts.race) {
    level.checkpoints.forEach((c, i) => {
      const p = vec(c.position, `level.checkpoints[${i}].position`);
      const f = makeFlag(game, '#ffd23f');
      f.group.position.copy(p); root.add(f.group);
      // face the next route point
      R.checkpoints.push({ position: p.clone(), radius: c.radius || 2.5, index: i, active: false, flag: f, yaw: c.yaw });
    });
  }

  // ---- goal
  if (opts.goal !== false && level.goal && !opts.race) {
    const gp = vec(level.goal.position, 'level.goal.position');
    const g = new THREE.Group(); g.position.copy(gp); root.add(g);
    const ring = mesh(new THREE.TorusGeometry(1.6, 0.22, 12, 48), own(mat(game, '#ffd23f', 'pickup', { glow: 0.8 }))); ring.position.y = 2; g.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 40), new THREE.MeshBasicMaterial({ color: '#9ff3ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    disc.position.y = 2; g.add(disc);
    const beamGeo = new THREE.CylinderGeometry(0.9, 1.4, 40, 24, 1, true); beamGeo.translate(0, 20, 0);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    g.add(beam);
    const pad = mesh(new THREE.CylinderGeometry(2, 2.3, 0.35, 32), mat(game, '#f4f1ea')); pad.position.y = 0.17; g.add(pad);
    const glow = glowSprite('#fff3a0', 6); glow.position.y = 2; g.add(glow);
    const stars = [];
    for (let i = 0; i < 8; i++) { const s = glowSprite('#ffffff', 0.5); g.add(s); stars.push(s); }
    g.traverse(o => { o.userData.noCollide = true; });
    R.goal = { position: gp.clone(), radius: level.goal.radius || 2, object: g, ring, disc, beam, glow, stars, reached: false };
  }
  const goalLocked = () => !!(collect && R.goal && S.collected < S.target);

  // ---- movers
  for (const m of level.movers) {
    if (!m || !m.mesh) continue;
    const k = Physics.addKinematic(game, m.mesh);
    const path = (m.path || []).map((p, i) => vec(p, `level.movers.path[${i}]`));
    R.movers.push({ ...m, k, path, period: m.period || 4, t0: game.rand() * 0 });
  }

  // ---- hazards
  function hurtPlayer(pl, from, amount = 1, source = null) {
    if (!pl.alive || S.won || S.lost) return;
    if (!pl.hurt(from, vehicle ? 6 : 11)) return;
    if (pl !== player) return;
    S.hp -= amount; changed();
    game.emit('damage', pl, amount, source);
    if (S.hp <= 0) pl.die('hit');
  }
  R.hurtPlayer = hurtPlayer;

  function addHazard(h) {
    const type = h.type;
    if (!HAZARD_TYPES.includes(type)) { console.warn(`Gameplay.rules: unknown hazard type "${type}"; types: ${HAZARD_TYPES.join(', ')}`); return null; }
    const p = vec(h.position, `hazard(${type}).position`);
    const H = { ...h, position: p.clone(), object: null, t: 0 };
    const g = new THREE.Group(); g.position.copy(p); root.add(g); H.object = g;
    if (type === 'enemy') { root.remove(g); addEnemy(h.kind || 'patrol', p, h); return null; }
    if (type === 'void') { root.remove(g); const y = h.y ?? p.y; for (const pl of Player.all(game)) pl.killY = y; player.killY = y; return null; }
    if (type === 'spinner') {
      H.length = h.length || 7; H.speed = h.speed ?? 1.5; H.height = h.height ?? 0.9;
      const post = mesh(new THREE.CylinderGeometry(0.35, 0.45, H.height + 0.4, 12), mat(game, '#6b6f80')); post.position.y = (H.height + 0.4) / 2; g.add(post);
      const arm = new THREE.Group(); arm.position.y = H.height; g.add(arm);
      const segs = 8;
      for (let i = 0; i < segs; i++) {
        const s = mesh(new THREE.CylinderGeometry(0.22, 0.22, H.length / segs, 10), mat(game, i % 2 ? '#ffffff' : '#ff4d5e'));
        s.rotation.z = Math.PI / 2; s.position.x = -H.length / 2 + (i + 0.5) * (H.length / segs); arm.add(s);
      }
      for (const s of [-1, 1]) { const b = mesh(new THREE.SphereGeometry(0.34, 12, 10), mat(game, '#ffd23f', 'pickup')); b.position.x = s * H.length / 2; arm.add(b); }
      H.arm = arm;
    } else if (type === 'saw') {
      H.radius = h.radius || 1.1;
      const path = (h.path || [p.clone().add(V3(-3, 0, 0)), p.clone().add(V3(3, 0, 0))]).map(v => vec(v, 'saw.path'));
      H.path = path; H.period = h.period || 3;
      const disc = new THREE.Group(); disc.position.y = H.radius * 0.7; g.add(disc);
      const blade = mesh(new THREE.CylinderGeometry(H.radius, H.radius, 0.12, 24), mat(game, '#dfe3ee')); blade.rotation.x = Math.PI / 2; disc.add(blade);
      for (let i = 0; i < 12; i++) { const t = mesh(new THREE.ConeGeometry(0.14, 0.35, 4), mat(game, '#dfe3ee')); const a = i / 12 * Math.PI * 2; t.position.set(Math.cos(a) * H.radius, Math.sin(a) * H.radius, 0); t.rotation.z = a - Math.PI / 2; disc.add(t); }
      const hub = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), mat(game, '#ff4d5e')); hub.rotation.x = Math.PI / 2; disc.add(hub);
      H.disc = disc;
    } else if (type === 'spikes') {
      H.size = h.size ? vec(h.size, 'spikes.size') : V3(2, 0.7, 2);
      const base = mesh(new THREE.BoxGeometry(H.size.x, 0.15, H.size.z), mat(game, '#6b6f80')); base.position.y = 0.07; g.add(base);
      const nx = Math.max(1, Math.round(H.size.x / 0.5)), nz = Math.max(1, Math.round(H.size.z / 0.5));
      const cg = new THREE.ConeGeometry(0.2, H.size.y, 6), cm = mat(game, '#eef1f8');
      const inst = new THREE.InstancedMesh(cg, cm, nx * nz); inst.castShadow = true; inst.userData.noCollide = true;
      const m4 = new THREE.Matrix4(); let k = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { m4.makeTranslation(-H.size.x / 2 + (i + 0.5) * H.size.x / nx, H.size.y / 2 + 0.1, -H.size.z / 2 + (j + 0.5) * H.size.z / nz); inst.setMatrixAt(k++, m4); }
      g.add(inst);
    } else if (type === 'lava' || type === 'killzone') {
      H.size = h.size ? vec(h.size, 'lava.size') : V3(4, 0.5, 4);
      const m = new THREE.Mesh(new THREE.BoxGeometry(H.size.x, H.size.y, H.size.z), new THREE.MeshStandardMaterial({ color: '#ff5a1f', emissive: '#ff3d00', emissiveIntensity: 1.2, roughness: 0.6 }));
      m.position.y = H.size.y / 2 - 0.2; m.userData.noCollide = true; g.add(m); H.mesh = m;
      if (type === 'killzone') m.visible = h.visible === true;
    } else if (type === 'bounce') {
      H.power = h.power || 22; H.radius = h.radius || 1.3;
      const base = mesh(new THREE.CylinderGeometry(H.radius, H.radius * 1.1, 0.3, 24), mat(game, '#6b6f80')); base.position.y = 0.15; g.add(base);
      const top = mesh(new THREE.SphereGeometry(H.radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(game, '#ff5fa2')); top.scale.y = 0.45; top.position.y = 0.3; g.add(top);
      for (let i = 0; i < 5; i++) { const d = mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(game, '#fff4e6')); const a = i / 5 * Math.PI * 2; d.position.set(Math.cos(a) * H.radius * 0.55, 0.62, Math.sin(a) * H.radius * 0.55); top.add(d); d.position.y = 0.9; }
      H.top = top; H.squash = 0;
      // pads sit on the floor: a low static collider so you can stand on the rim
    } else if (type === 'boost') {
      H.yaw = h.yaw ?? (h.direction ? Math.atan2(h.direction.x, h.direction.z) : 0); H.size = h.size ? vec(h.size, 'boost.size') : V3(h.width || 4, 0.2, h.length || 5);
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const x = c.getContext('2d'); x.fillStyle = '#ff9a1f'; x.fillRect(0, 0, 64, 128);
      x.fillStyle = '#fff6a8'; for (let i = 0; i < 2; i++) { x.beginPath(); const y0 = i * 64 + 10; x.moveTo(8, y0 + 40); x.lineTo(32, y0 + 8); x.lineTo(56, y0 + 40); x.lineTo(56, y0 + 54); x.lineTo(32, y0 + 22); x.lineTo(8, y0 + 54); x.fill(); }
      const tex = new THREE.CanvasTexture(c); tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1.5); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(H.size.x, H.size.z), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, opacity: 0.95 }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.userData.noCollide = true;
      const holder = new THREE.Group(); holder.rotation.y = H.yaw; holder.add(m); g.add(holder);
      H.tex = tex; H.cool = new Map();
    } else if (type === 'crumble') {
      H.size = h.size ? vec(h.size, 'crumble.size') : V3(4, 0.8, 4);
      const m = h.mesh || mesh(new THREE.BoxGeometry(H.size.x, H.size.y, H.size.z), mat(game, '#c9a46a'));
      if (!h.mesh) { m.position.copy(p); root.add(m); root.remove(g); H.object = m; }
      m.userData.noCollide = false; H.mesh = m; H.home = m.position.clone(); H.k = Physics.addKinematic(game, m); H.state = 'idle'; H.timer = 0;
    } else if (type === 'wind') {
      H.size = h.size ? vec(h.size, 'wind.size') : V3(3, 8, 3); H.power = h.power || 90;
      const fan = mesh(new THREE.CylinderGeometry(H.size.x * 0.45, H.size.x * 0.5, 0.3, 20), mat(game, '#6b6f80')); fan.position.y = 0.15; g.add(fan);
      const grill = mesh(new THREE.TorusGeometry(H.size.x * 0.4, 0.06, 6, 24), mat(game, '#7ff6ff', 'glow'), false); grill.rotation.x = Math.PI / 2; grill.position.y = 0.32; g.add(grill);
      H.streaks = [];
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.2), new THREE.MeshBasicMaterial({ color: '#e8fdff', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        s.userData.noCollide = true; s.userData.ph = Math.random(); s.position.set((Math.random() - 0.5) * H.size.x * 0.8, 0, (Math.random() - 0.5) * H.size.z * 0.8); s.rotation.y = Math.random() * 3;
        g.add(s); H.streaks.push(s);
      }
    }
    R.hazards.push(H);
    return H;
  }

  // ---- enemies
  function addEnemy(kind, position, extra = {}) {
    if (!['patrol', 'chase', 'turret'].includes(kind)) { console.warn(`Gameplay: unknown enemy kind "${kind}"; kinds: patrol, chase, turret`); kind = 'patrol'; }
    const p = vec(position, 'enemy position');
    const e = makeEnemy(game, kind, extra.color);
    e.group.position.copy(p); root.add(e.group);
    const E = { kind, position: e.group.position, home: p.clone(), object: e.group, body: e.body, radius: e.radius, height: e.height,
      alive: true, hp: extra.hp || (kind === 'turret' ? 3 : 2), dir: 1, yaw: game.rand() * 6.28, t: game.rand() * 3, cool: 1 + game.rand(), squash: 0,
      range: extra.range || (kind === 'patrol' ? 4 : 14), speed: extra.speed || (kind === 'chase' ? 6 : 2.5), vy: 0, deadT: 0 };
    R.enemies.push(E); S.enemiesLeft++; changed();
    return E;
  }
  R.addEnemy = addEnemy;

  for (const h of level.hazards) addHazard(h);
  if (opts.enemies) {
    const list = Array.isArray(opts.enemies) ? opts.enemies : [];
    for (const e of list) addEnemy(e.kind || 'patrol', e.position, e);
    if (typeof opts.enemies === 'number' && level.spawnPoints && level.spawnPoints.length) {
      // farthest spawn points from the player first: nobody should get jumped at the start line
      const pts = [...level.spawnPoints].sort((a, b) => b.distanceTo(player.position) - a.distanceTo(player.position));
      for (let i = 0; i < opts.enemies; i++) addEnemy(['chase', 'patrol', 'turret', 'chase'][i % 4], pts[i % pts.length].clone().add(V3((i >= pts.length ? 2.5 : 0), 0, 0)));
    } else if (typeof opts.enemies === 'number' && level.route.length > 3) {
      // spread them along the route, away from spawn and goal
      for (let i = 0; i < opts.enemies; i++) {
        const idx = Math.floor(((i + 1) / (opts.enemies + 1)) * (level.route.length - 1));
        const at = level.route[idx].clone();
        const gy = Physics.groundAt(game, at.x, at.z, at.y + 5, 20);
        if (gy !== null) at.y = gy;
        addEnemy(['patrol', 'chase', 'patrol', 'turret'][i % 4], at);
      }
    }
  }
  const shots = [];
  const shotGeo = new THREE.SphereGeometry(0.28, 12, 10), shotMat = new THREE.MeshBasicMaterial({ color: '#ff7a3c', toneMapped: false });

  // FPS / topdown shooting: player.js emits 'shoot'(player, origin, dir)
  const tracers = [];
  game.on('shoot', (pl, origin, dir) => {
    if (pl !== player) return;
    let best = null, bestT = 60;
    for (const e of R.enemies) {
      if (!e.alive) continue;
      const c = e.position.clone().add(V3(0, e.height * 0.5, 0));
      const t = c.clone().sub(origin).dot(dir); if (t < 0 || t > bestT) continue;
      const d = origin.clone().addScaledVector(dir, t).distanceTo(c);
      if (d < e.radius + 0.25) { best = e; bestT = t; }
    }
    const wall = Physics.raycast(game, origin, dir, bestT, { excludeCollider: pl.collider });
    const end = wall ? wall.point : origin.clone().addScaledVector(dir, bestT);
    if (best && !wall) damageEnemy(best, 1, pl);
    const g = new THREE.BufferGeometry().setFromPoints([origin.clone().addScaledVector(dir, 0.6).add(V3(0, -0.15, 0)), end]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#fff3a0', transparent: true, toneMapped: false }));
    root.add(line); tracers.push({ line, t: 0.08 });
  });

  function damageEnemy(e, amount, by) {
    if (!e.alive) return;
    e.hp -= amount; e.squash = 1;
    game.emit('damage', e, amount, by);
    if (e.hp <= 0) {
      e.alive = false; e.deadT = 0; S.enemiesLeft--; S.score += 5; changed();
      game.emit('death', e);
    }
  }
  R.damageEnemy = damageEnemy;

  // ---- race
  let race = null;
  if (opts.race) {
    const track = level.track;
    if (!track || !track.getPointAt) throw new Error('Gameplay.rules: race needs level.track (a CatmullRomCurve3); build a race kind, e.g. Level.build(game, "race_track")');
    const N = 600, samples = [];
    for (let i = 0; i < N; i++) samples.push(track.getPointAt(i / N));
    race = { track, N, samples, laps: opts.race.laps || level.laps || 3, width: level.trackWidth || 12, started: false, countdown: opts.race.countdown ?? 3, cdT: 0, lastCd: null, finishOrder: [] };
    S.laps = race.laps; S.lap = 1;
    // a boat race on a dry track (no water course in this level): boats hover over the road instead of beaching
    if (player.type === 'boat') {
      let dry = 0;
      for (let i = 0; i < 12; i++) { const q = track.getPointAt(i / 12); const gy = Physics.groundAt(game, q.x, q.z, q.y + 10, 30); if (gy !== null && (player.waterLevel === null || gy > player.waterLevel + 0.15)) dry++; }
      race.hover = dry > 6;
      if (race.hover) { Object.assign(player.tuning, { landDrag: 0, grip: 6, driftGrip: 1.8 }); console.info('Gameplay.rules: boat race on a dry track -> hover boats'); }
    }
    const nearest = (p, hint) => {
      let best = hint, bd = Infinity;
      const scan = hint === null || hint === undefined ? N : 40;
      const start = hint ?? 0;
      for (let k = -scan; k <= scan; k++) {
        const i = ((start + k) % N + N) % N, s = samples[i];
        const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    race.nearest = nearest;
    const mk = (pl, isPlayer) => ({ player: pl, isPlayer, idx: nearest(pl.position, null), lap: 1, half: false, finished: false, progress: 0, lane: 0 });
    R.racers.push(mk(player, true));
    // AI opponents
    const nOpp = opts.race.opponents ?? 3;
    const palette = ['#5b8cff', '#ffd23f', '#b56bff', '#3ddc97', '#ff5fa2', '#ff9a3c'];
    const t0 = track.getTangentAt(0), side = V3(t0.z, 0, -t0.x).normalize();
    const startP = player.position.clone();
    for (let i = 0; i < nOpp; i++) {
      // grid: the player starts at the back, opponents ahead in staggered pairs
      const row = Math.floor(i / 2), lane = (i % 2 ? 1 : -1) * Math.min(3.5, race.width * 0.25);
      const at = startP.clone().addScaledVector(t0, 6 + row * 6 + (i % 2) * 2).addScaledVector(side, lane);
      const gy = Physics.groundAt(game, at.x, at.z, at.y + 5, 20);
      if (gy !== null && player.type !== 'boat') at.y = gy + 0.05;
      const bot = Player.create(game, { type: player.type, spawn: at, yaw: player.yaw, name: 'racer' + (i + 1),
        colors: { body: palette[i % palette.length], kart: palette[i % palette.length], boat: palette[i % palette.length], accent: '#ffffff' }, waterLevel: player.waterLevel,
        tuning: { maxSpeed: player.tuning.maxSpeed * (opts.race.aiSpeed ?? 0.94) * (0.97 + 0.03 * game.rand()), ...(race.hover ? { landDrag: 0, grip: 6, driftGrip: 1.8 } : {}) } });
      bot.ai = { skill: 0.85 + 0.15 * game.rand(), lane: (game.rand() - 0.5) * race.width * 0.5, drift: false };
      game.__player = player;
      const r = mk(bot, false); r.lane = bot.ai.lane; R.racers.push(r);
    }
    S.racers = R.racers.length;
    // boost pads along the track if the level placed none
    if (!R.hazards.some(h => h.type === 'boost')) {
      for (const u of [0.18, 0.52, 0.8]) { const t = track.getTangentAt(u); addHazard({ type: 'boost', position: track.getPointAt(u).add(V3(0, 0.03, 0)), yaw: Math.atan2(t.x, t.z) }); }
    }
    // a start/finish arch
    const p0 = track.getPointAt(0).addScaledVector(t0, 3), arch = new THREE.Group();
    if (level.goal && level.goal.finishLine) arch.visible = false;      // the level brings its own gantry arch.position.copy(p0); arch.rotation.y = Math.atan2(t0.x, t0.z); root.add(arch);
    const w = race.width / 2 + 1.5;
    for (const s of [-1, 1]) { const post = mesh(new THREE.CylinderGeometry(0.35, 0.4, 6, 12), mat(game, '#f4f1ea')); post.position.set(s * w, 3, 0); arch.add(post); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 32; const x = c.getContext('2d');
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 8, j * 8, 8, 8); }
    const ct = new THREE.CanvasTexture(c); ct.colorSpace = THREE.SRGBColorSpace;
    const banner = mesh(new THREE.BoxGeometry(w * 2 + 0.8, 1.1, 0.25), new THREE.MeshBasicMaterial({ map: ct })); banner.position.y = 6; arch.add(banner);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(race.width, 1.2), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.9 }));
    line.rotation.x = -Math.PI / 2; line.position.y = player.type === 'boat' ? 0.05 : 0.07; arch.add(line);
    if (race.countdown > 0) for (const r of R.racers) r.player.controls.enabled = false;
  }

  // ---- respawn bookkeeping
  game.on('death', (who) => {
    if (who !== player) return;
    if (isFinite(S.lives)) { S.lives--; changed(); }
    if (S.lives <= 0 && isFinite(S.lives)) lose('lives');
  });
  game.on('respawn', (who) => { if (who === player) { S.hp = maxHp; changed(); } });

  function win() {
    if (S.won || S.lost) return;
    S.won = true; changed(); player.character.setEmote('win', 99);
    if (!vehicle) { const c = game.camera.position; player.yaw = Math.atan2(c.x - player.position.x, c.z - player.position.z); player.setInput(0, 0, false, false); }
    game.emit('win'); opts.onWin && opts.onWin(S);
  }
  function lose(reason = 'lose') {
    if (S.won || S.lost) return;
    S.lost = true; S.loseReason = reason; changed(); player.character.setEmote('sad', 99);
    game.emit('lose', reason); opts.onLose && opts.onLose(reason, S);
  }
  R.win = win; R.lose = lose;

  function doCollect(it, by) {
    it.collected = true; it.t = 0;
    if (!collect || it.tag === collect.tag) S.collected += collect ? 1 : 0;
    S.score += it.value;
    if (it.tag === 'heart' && S.hp < maxHp) S.hp++;
    changed();
    game.emit('collect', it, by);
    if (collect && S.collected >= S.target && S.target > 0) {
      if (!R.goal && !race) win();
      else if (R.goal && !S.goalOpen) { S.goalOpen = true; game.emit('goalOpen', R.goal); }
    }
    if (opts.scoreToWin && S.score >= opts.scoreToWin) win();
  }

  const tmp = V3(), tmp2 = V3();
  function segDist(p, a, b) { // distance from p to segment ab
    const ab = tmp.subVectors(b, a), t = THREE.MathUtils.clamp(tmp2.subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
    return p.distanceTo(tmp2.copy(a).addScaledVector(ab, t));
  }

  const update = (dt, t) => {
    const playing = !S.won && !S.lost;
    const pc = player.center || player.position;
    if (playing && player.controls.enabled && player.alive) {
      S.time += dt;
      if (countdown !== null) { S.timeLeft = Math.max(0, countdown - S.time); if (S.timeLeft <= 0) lose('time'); }
    }
    S.goalOpen = !goalLocked();
    S.health = S.hp; S.maxHealth = maxHp;
    const phase = S.won ? 'won' : S.lost ? 'lost' : race && !race.started ? 'countdown' : !player.controls.enabled ? 'title' : 'playing';
    if (phase !== S.phase) { S.phase = phase; changed(); }
    const obj = objective();
    if (obj !== S.objective) { S.objective = obj; changed(); }
    // collectibles: bob, spin, magnet, pickup, pop
    for (const it of R.items) {
      const o = it.object;
      if (it.collected) {
        if (!o.parent) continue;
        it.t += dt;
        const k = it.t / 0.35;
        o.position.y += dt * 6; o.scale.setScalar(Math.max(0.001, (1 + k * 0.8) * (1 - k)));
        o.userData.spin.rotation.y += dt * 30;
        if (k >= 1) root.remove(o);
        continue;
      }
      o.userData.spin.rotation.y = t * (it.tag === 'coin' ? 3 : 1.6) + it.phase;
      o.position.y = it.home.y + Math.sin(t * 2.4 + it.phase) * 0.18;
      o.userData.glow.material.opacity = 0.4 + Math.sin(t * 3 + it.phase) * 0.12;
      if (!playing) continue;
      for (const pl of collectors()) {
        if (!pl.alive) continue;
        const c = pl.center || pl.position;
        const d = c.distanceTo(o.position);
        if (pl === player && d < (vehicle ? 4.5 : 3.0) && d > 0.01) {                 // magnet
          o.position.lerp(c, Math.min(1, dt * (vehicle ? 10 : 6)));
          it.home.lerp(c, Math.min(1, dt * (vehicle ? 10 : 6)));
        }
        if (d < it.radius + (pl.radius || 0.5) * (vehicle ? 1.6 : 1)) { doCollect(it, pl); break; }
      }
    }
    // checkpoints
    for (const cp of R.checkpoints) {
      const f = cp.flag;
      f.raise += ((cp.active ? 1 : 0) - f.raise) * Math.min(1, dt * 5);
      f.flag.position.y = 0.6 + f.raise * 2.3;
      f.wave(t, cp.active);
      if (!cp.active && playing && player.alive) {
        const dx = pc.x - cp.position.x, dz = pc.z - cp.position.z, dy = player.position.y - cp.position.y;
        if (dx * dx + dz * dz < (cp.radius + 0.6) ** 2 && dy > -1.5 && dy < 4) {
          cp.active = true;
          f.flag.material.color.set('#ffd23f'); if (f.flag.material.emissive) f.flag.material.emissive.set('#553300');
          f.ring.material.color.set('#7dffb0');
          player.respawnPoint.copy(cp.position).add(V3(0, 0.3, 0));
          const next = level.route.find(r => r.distanceTo(cp.position) > 3 && level.route.indexOf(r) > nearestRoute(cp.position));
          player.respawnYaw = cp.yaw ?? (next ? Math.atan2(next.x - cp.position.x, next.z - cp.position.z) : player.yaw);
          S.checkpoint = Math.max(S.checkpoint, cp.index + 1); changed();
          game.emit('checkpoint', cp);
        }
      }
    }
    // goal
    if (R.goal) {
      const G = R.goal, locked = goalLocked();
      G.ring.rotation.y = t * 0.8; G.ring.rotation.z = Math.sin(t) * 0.1;
      G.disc.rotation.z = -t * 2; G.disc.material.opacity = locked ? 0.15 : 0.5 + Math.sin(t * 4) * 0.1;
      G.beam.material.opacity = locked ? 0.03 : 0.09 + Math.sin(t * 2.5) * 0.03;
      G.ring.material.color && G.ring.material.color.set(locked ? '#9aa0b4' : '#ffd23f');
      if (G.ring.material.emissive) G.ring.material.emissive.set(locked ? '#202230' : '#ffb300');
      G.glow.material.opacity = locked ? 0.15 : 0.7;
      G.stars.forEach((s, i) => { const a = t * 1.5 + i / 8 * Math.PI * 2; s.position.set(Math.cos(a) * 2.2, 2 + Math.sin(t * 2 + i) * 1.5, Math.sin(a) * 2.2); s.visible = !locked; });
      if (playing && player.alive && !G.reached) {
        const d = Math.hypot(pc.x - G.position.x, pc.z - G.position.z), dy = player.position.y - G.position.y;
        if (d < G.radius + 0.8 && dy > -1.5 && dy < 5) {
          if (locked) { if (!G.lockedNote || t - G.lockedNote > 2) { G.lockedNote = t; game.emit('goalLocked', G, S.target - S.collected); } }
          else { G.reached = true; game.emit('goal', player); win(); }
        }
      }
    }
    // movers
    for (const m of R.movers) {
      if (m.type === 'spin') { m.mesh.rotation.y += (m.speed || 0.8) * dt; continue; }
      if (m.path.length < 2) continue;
      const n = m.path.length, ph = ((t / m.period) % 1 + 1) % 1;
      if (n === 2 || m.pingpong !== false) {
        // ease back and forth along the path
        const u = (1 - Math.cos(ph * Math.PI * 2)) / 2 * (n - 1);
        const i = Math.min(n - 2, Math.floor(u)), f = u - i;
        m.mesh.position.lerpVectors(m.path[i], m.path[i + 1], f);
      } else {
        const u = ph * n, i = Math.floor(u) % n, f = u - Math.floor(u);
        const e = f * f * (3 - 2 * f);
        m.mesh.position.lerpVectors(m.path[i], m.path[(i + 1) % n], e);
      }
    }
    // hazards
    for (const H of R.hazards) {
      H.t += dt;
      switch (H.type) {
        case 'spinner': {
          H.arm.rotation.y += H.speed * dt;
          if (!playing || !player.alive) break;
          const a = H.arm.rotation.y, half = H.length / 2;
          const c = H.position.clone().add(V3(0, H.height, 0));
          const dir = V3(Math.cos(a), 0, -Math.sin(a));
          const A = c.clone().addScaledVector(dir, -half), B = c.clone().addScaledVector(dir, half);
          if (segDist(pc, A, B) < 0.22 + (player.radius || 0.45) + 0.1) {
            const pt = tmp2.clone(); const away = pc.clone().sub(pt); away.y = 0;
            hurtPlayer(player, pc.clone().sub(away.lengthSq() > 0.01 ? away : V3(1, 0, 0)), 1, H);
          }
          break;
        }
        case 'saw': {
          const ph = (1 - Math.cos((H.t / H.period) * Math.PI * 2)) / 2;
          H.object.position.lerpVectors(H.path[0], H.path[H.path.length - 1], ph);
          H.disc.rotation.z -= dt * 12;
          if (playing && player.alive && pc.distanceTo(tmp.copy(H.object.position).add(V3(0, H.radius * 0.7, 0))) < H.radius + 0.4) hurtPlayer(player, H.object.position, 1, H);
          break;
        }
        case 'spikes': {
          if (!playing || !player.alive) break;
          const d = pc.clone().sub(H.position);
          if (Math.abs(d.x) < H.size.x / 2 + 0.3 && Math.abs(d.z) < H.size.z / 2 + 0.3 && player.position.y - H.position.y < H.size.y + 0.2 && d.y > -1) hurtPlayer(player, H.position, 1, H);
          break;
        }
        case 'lava': case 'killzone': {
          if (H.mesh && H.mesh.material.emissiveIntensity !== undefined) H.mesh.material.emissiveIntensity = 1 + Math.sin(H.t * 3) * 0.3;
          if (!playing || !player.alive) break;
          const d = player.position.clone().sub(H.position);
          if (Math.abs(d.x) < H.size.x / 2 && Math.abs(d.z) < H.size.z / 2 && d.y < H.size.y + 0.1 && d.y > -2) player.die(H.type);
          break;
        }
        case 'bounce': {
          H.squash *= Math.exp(-dt * 8);
          H.top.scale.set(1 + H.squash * 0.25, 0.45 * (1 - H.squash * 0.6), 1 + H.squash * 0.25);
          for (const pl of Player.all(game)) {
            if (!pl.alive) continue;
            const dx = pl.position.x - H.position.x, dz = pl.position.z - H.position.z, dy = pl.position.y - H.position.y;
            if (dx * dx + dz * dz < H.radius * H.radius && dy < 1.0 && dy > -0.5 && pl.velocity.y <= 0.5 && t - (H.last || -9) > 0.25) { H.last = t; pl.bounce(H.power); H.squash = 1; game.emit('bounce', pl, H); }
          }
          break;
        }
        case 'boost': {
          H.tex.offset.y -= dt * 2;
          for (const pl of Player.all(game)) {
            if (!pl.alive) continue;
            const d = pl.position.clone().sub(H.position).applyAxisAngle(UP, -H.yaw);
            const last = H.cool.get(pl) || -9;
            if (Math.abs(d.x) < H.size.x / 2 + 0.5 && Math.abs(d.z) < H.size.z / 2 + 0.5 && Math.abs(d.y) < 2 && t - last > 1) { H.cool.set(pl, t); pl.boost(1.1, 'pad'); }
          }
          break;
        }
        case 'crumble': {
          const on = player.groundObject === H.mesh;
          if (H.state === 'idle' && on) { H.state = 'shake'; H.timer = 0; }
          H.timer += dt;
          if (H.state === 'shake') {
            H.mesh.position.copy(H.home).add(V3((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.12));
            if (H.timer > 0.6) { H.state = 'fall'; H.timer = 0; H.vy = 0; }
          } else if (H.state === 'fall') {
            H.vy -= 30 * dt; H.mesh.position.y += H.vy * dt;
            if (H.timer > 1.5) { H.state = 'gone'; H.timer = 0; H.mesh.visible = false; H.mesh.position.y = H.home.y - 200; }
          } else if (H.state === 'gone' && H.timer > 2.5) {
            H.state = 'idle'; H.mesh.visible = true; H.mesh.position.copy(H.home); H.mesh.scale.setScalar(0.01); H.grow = 0;
          } else if (H.state === 'idle' && H.mesh.scale.x < 1) H.mesh.scale.setScalar(Math.min(1, H.mesh.scale.x + dt * 3));
          break;
        }
        case 'wind': {
          for (const s of H.streaks) { const u = (s.userData.ph + H.t * 0.6) % 1; s.position.y = 0.5 + u * H.size.y; s.material.opacity = Math.sin(u * Math.PI) * 0.55; }
          const d = pc.clone().sub(H.position);
          if (Math.abs(d.x) < H.size.x / 2 && Math.abs(d.z) < H.size.z / 2 && d.y > -0.5 && d.y < H.size.y && player.velocity.y < 16) player.addVelocity({ y: player.grounded ? 7 - player.velocity.y : Math.min(H.power * dt + (player.velocity.y < 0 ? -player.velocity.y * 0.15 : 0), 16 - player.velocity.y) });
          break;
        }
      }
    }
    // enemies
    const grace = S.time < 2;
    for (const e of R.enemies) {
      e.t += dt;
      if (grace && e.alive) { e.body.position.y = Math.abs(Math.sin(e.t * 3)) * 0.1; continue; }
      if (!e.alive) {
        e.deadT += dt;
        e.object.scale.set(1 + e.deadT * 2, Math.max(0.05, 1 - e.deadT * 6), 1 + e.deadT * 2);
        if (e.deadT > 0.45 && e.object.parent) root.remove(e.object);
        continue;
      }
      e.squash *= Math.exp(-dt * 10);
      const toP = pc.clone().sub(e.position); toP.y = 0;
      const dist = toP.length();
      if (e.kind === 'patrol') {
        // walk back and forth around home; turn at edges and walls
        const f = V3(Math.sin(e.yaw), 0, Math.cos(e.yaw));
        const ahead = e.position.clone().addScaledVector(f, e.radius + 0.4).add(V3(0, 1, 0));
        const g = Physics.raycast(game, ahead, V3(0, -1, 0), 2.5);
        const wall = Physics.raycast(game, e.position.clone().add(V3(0, 0.5, 0)), f, e.radius + 0.3);
        if (!g || wall || e.position.distanceTo(e.home) > e.range && f.dot(e.home.clone().sub(e.position)) < 0) e.yaw += Math.PI * (0.8 + game.rand() * 0.4);
        else e.position.addScaledVector(f, e.speed * dt);
        const hop = Math.abs(Math.sin(e.t * 6));
        e.body.position.y = hop * 0.25; e.body.scale.set(1 + (1 - hop) * 0.12, 1 - (1 - hop) * 0.15 - e.squash * 0.4, 1 + (1 - hop) * 0.12);
        e.object.rotation.y += angWrap(e.yaw - e.object.rotation.y) * Math.min(1, dt * 8);
      } else if (e.kind === 'chase') {
        const homeD = e.position.distanceTo(e.home);
        const target = dist < e.range && player.alive && homeD < e.range * 2 ? pc : e.home;
        const to = target.clone().sub(e.position); to.y = 0;
        if (to.length() > 0.3) {
          to.normalize();
          const next = e.position.clone().addScaledVector(to, e.speed * dt * (target === pc ? 1 : 0.6));
          const g = Physics.raycast(game, next.clone().add(V3(0, 1.5, 0)), V3(0, -1, 0), 4);
          if (g && Math.abs(g.point.y - e.position.y) < 1.2) { e.position.copy(next); e.position.y = g.point.y; }
          e.yaw = Math.atan2(to.x, to.z);
        }
        e.object.rotation.y += angWrap(e.yaw - e.object.rotation.y) * Math.min(1, dt * 6);
        e.body.rotation.x += dt * e.speed * 1.2 * (dist < e.range ? 1 : 0.3);
        e.body.scale.setScalar(1 - e.squash * 0.3);
      } else if (e.kind === 'turret') {
        if (dist < 26 && player.alive) {
          const want = Math.atan2(toP.x, toP.z);
          e.body.rotation.y += angWrap(want - e.body.rotation.y) * Math.min(1, dt * 3);
          e.cool -= dt;
          if (e.cool <= 0 && playing && Math.abs(angWrap(want - e.body.rotation.y)) < 0.25) {
            e.cool = 2.2; e.squash = 1;
            const m = new THREE.Mesh(shotGeo, shotMat); const y = e.body.rotation.y;
            m.position.copy(e.position).add(V3(Math.sin(y) * 1.4, 1.35, Math.cos(y) * 1.4));
            const glow = glowSprite('#ff7a3c', 1.4); m.add(glow);
            root.add(m);
            const aim = pc.clone().sub(m.position).normalize();
            shots.push({ mesh: m, vel: aim.multiplyScalar(11), life: 4 });
            game.emit('shot', e, m.position.clone());
          }
        }
        e.body.scale.setScalar(1 + e.squash * 0.15);
      }
      // contact with the player
      if (!playing || !player.alive) continue;
      const ec = e.position.clone().add(V3(0, e.height * 0.5, 0));
      const d3 = pc.distanceTo(ec);
      const attacking = player.mode === 'dash' || player.mode === 'pound' || player.boostT > 0;
      if (d3 < e.radius + (player.radius || 0.5) + 0.15 + (attacking && !vehicle ? 1.1 : 0)) {
        const above = player.position.y > e.position.y + e.height * 0.55;
        if ((player.type === 'platformer' || player.type === 'fps') && above && player.velocity.y < 1 && e.kind !== 'turret' || (player.type === 'platformer' && above && e.kind === 'turret' && player.velocity.y < 1)) {
          damageEnemy(e, e.hp, player); player.bounce(15); game.emit('stomp', player, e);
        } else if (attacking) {
          damageEnemy(e, e.hp, player);
        } else hurtPlayer(player, ec, 1, e);
      }
    }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; s.life -= dt; s.mesh.position.addScaledVector(s.vel, dt);
      let dead = s.life <= 0;
      if (!dead && playing && player.alive && s.mesh.position.distanceTo(pc) < 0.9) { hurtPlayer(player, s.mesh.position, 1, s); dead = true; }
      if (!dead && Physics.raycast(game, s.mesh.position, s.vel, s.vel.length() * dt + 0.2)) dead = true;
      if (dead) { root.remove(s.mesh); shots.splice(i, 1); }
    }
    for (let i = tracers.length - 1; i >= 0; i--) { const tr = tracers[i]; tr.t -= dt; tr.line.material.opacity = Math.max(0, tr.t / 0.08); if (tr.t <= 0) { root.remove(tr.line); tracers.splice(i, 1); } }
    // race
    if (race) raceStep(dt, t);
    if (opts.killEnemiesToWin && S.enemiesLeft <= 0 && R.enemies.length) win();
    if (dirty) { dirty = false; game.emit('state', S); }
  };

  function objective() {
    const noun = (n) => { const t = S.collectTag || 'coin'; return n === 1 ? t : t + (/[sxz]$|[^aeiou]y$/.test(t) ? 'es' : 's'); };
    if (S.won) return race ? `Finished ${ordinal(S.position)}!` : 'You win!';
    if (S.lost) return S.loseReason === 'time' ? 'Out of time' : 'Game over';
    if (race) return `Finish ${race.laps} lap${race.laps > 1 ? 's' : ''}`;
    if (collect && S.collected < S.target) return R.goal ? `Collect ${S.target} ${noun(S.target)}, then reach the goal` : `Collect ${S.target} ${noun(S.target)}`;
    if (R.goal) return 'Reach the goal!';
    if (opts.killEnemiesToWin) return 'Defeat every enemy';
    return '';
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  function collectors() { return race ? [player] : Player.all(game).filter(p => !p.ai); }
  function nearestRoute(p) {
    let bi = 0, bd = Infinity;
    level.route.forEach((r, i) => { const d = r.distanceToSquared(p); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  function raceStep(dt, t) {
    if (!race.started) {
      if (!player.controls.enabled && race.countdown <= 0) return;
      race.cdT += dt;
      const left = Math.ceil(race.countdown - race.cdT);
      if (race.countdown > 0 && left !== race.lastCd && left >= 0) { race.lastCd = left; game.emit('countdown', left); }
      if (race.cdT >= race.countdown) { race.started = true; for (const r of R.racers) r.player.controls.enabled = true; game.emit('raceStart'); }
      else return;
    }
    for (const r of R.racers) {
      const prev = r.idx;
      r.idx = race.nearest(r.player.position, r.idx);
      const u = r.idx / race.N, pu = prev / race.N;
      if (u > 0.4 && u < 0.6) r.half = true;
      if (pu > 0.85 && u < 0.15 && r.half && !r.finished) {
        r.half = false; r.lap++;
        if (r.lap > race.laps) {
          r.finished = true; r.place = race.finishOrder.push(r);
          if (r.isPlayer) { S.position = r.place; S.lap = race.laps; changed(); game.emit('lap', player, race.laps + 1); win(); }
        } else if (r.isPlayer) { S.lap = r.lap; changed(); game.emit('lap', player, r.lap); }
      } else if (pu < 0.15 && u > 0.85) { /* went backwards over the line */ }
      r.progress = r.finished ? 1e6 - r.place : r.lap + u;
      // respawn on the track where you fell off, facing along it
      if (r.player.grounded && r.player.alive && (r.idx - (r.cpIdx ?? -99) + race.N) % race.N > 8) {
        const a = race.samples[r.idx], b = race.samples[(r.idx + 3) % race.N];
        if (Math.hypot(r.player.position.x - a.x, r.player.position.z - a.z) < race.width * 0.6) {
          r.cpIdx = r.idx; r.player.respawnPoint.set(a.x, r.player.position.y + 0.3, a.z); r.player.respawnYaw = Math.atan2(b.x - a.x, b.z - a.z);
        }
      }
      if (!r.isPlayer) driveAI(r, dt);
    }
    const sorted = [...R.racers].sort((a, b) => b.progress - a.progress);
    const pos = sorted.findIndex(r => r.isPlayer) + 1;
    if (pos !== S.position && !S.won) { S.position = pos; changed(); }
  }

  function driveAI(r, dt) {
    const me = R.racers[0];
    let scale = r.player.ai.skill;
    if (r.progress > me.progress + 0.15) scale *= 0.85;               // rubber band
    if (r.progress < me.progress - 0.1) scale = 1;
    if (!r.drive) r.drive = {};
    r.drive.width = race.width; r.drive.lane = r.lane + Math.sin(game.time * 0.3 + r.player.ai.skill * 10) * race.width * 0.15;
    if (r.finished) { r.player.setInput(0, 0.3, false, false); return; }
    driveTrack(game, r.player, race.samples, r.idx, race.track.getLength(), r.drive, dt, scale);
  }

  game.update(update, 10);
  R.dispose = () => { game.removeUpdate(update); game.scene.remove(root); };
  game.__rules = R;
  game.emit('state', S);
  return R;
}

// ---- autopilot -----------------------------------------------------------------------------------------------------

/**
 * Gameplay.autopilot(game, { level, player, on=true }) or Gameplay.autopilot(game, false) to stop.
 * A bot that plays the level along level.route: steers, jumps gaps, collects nearby items, reaches the goal,
 * drives laps on race tracks. Uses only setInput (plus a small "stuck" teleport assist). Returns {on, status, stop()}.
 */
export function autopilot(game, opts = {}) {
  if (opts === false || opts === true) opts = { on: opts };
  const on = opts.on !== false;
  if (game.__autopilot) { if (on && !opts.level && !opts.player) return game.__autopilot; game.__autopilot.stop(); }
  if (!on) return { on: false, enabled: false, start: () => autopilot(game, {}), stop() {} };
  game.state.autopilotDone = false; game.state.autopilotStuck = false;
  const level = opts.level || game.__level;
  const player = opts.player || game.__player;
  if (!level || !player) throw new Error('Gameplay.autopilot(game, {level, player}): no level/player (call Gameplay.rules or pass them)');
  const route = (level.route && level.route.length ? level.route : (level.track ? Array.from({ length: 40 }, (_, i) => level.track.getPointAt(i / 40)) : [level.spawn])).map(v => v.clone());
  if (level.goal && !level.track) route.push(level.goal.position.clone());
  const T = player.tuning;
  const vehicle = player.type === 'kart' || player.type === 'boat';
  const st = { idx: 0, target: null, item: null, itemT: 0, stuckT: 0, lastProg: 0, lastPos: player.position.clone(), assists: 0, jumpHold: 0, plan: null, wantDouble: false, waitT: 0, lap: 0 };
  const A = {
    on: true, enabled: true, status: st,
    stop() { if (!A.on) return A; game.removeUpdate(step); player.setInput(null); A.on = A.enabled = false; if (game.__autopilot === A) game.__autopilot = null; return A; },
    start() { if (A.on) return A; if (game.__autopilot && game.__autopilot !== A) game.__autopilot.stop(); A.on = A.enabled = true; st.idx = nearestIdx(); st.noProg = 0; game.update(step, -5); game.__autopilot = A; return A; },
  };
  const jumpV = Math.sqrt(2 * (T.riseGravity || 34) * (T.jumpHeight || 4.5));
  const dblV = T.doubleJumpHeight ? Math.sqrt(2 * T.riseGravity * T.doubleJumpHeight) : 0;
  const nearestIdx = () => {
    let bi = st.idx, bd = Infinity;
    for (let i = 0; i < route.length; i++) { const d = route[i].distanceToSquared(player.position) + (i < st.idx ? 50 : 0); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };
  st.idx = nearestIdx();
  game.on('respawn', (p) => { if (p === player && A.on) { st.idx = nearestIdx(); st.plan = null; st.item = null; } });

  // simulate a jump arc from p with horizontal velocity hv: returns landing point on ground or null
  // simulate the jump the controller would really do: start from the current horizontal velocity, air-accelerate
  // toward `want` (desired horizontal velocity). Returns the landing point on solid ground or null.
  function arcLands(p, want, v0, double) {
    const pos = p.clone(); let vy = v0, used2 = !double; const dt = 1 / 30;
    const hv = V3(player.velocity.x, 0, player.velocity.z), acc = (T.airAccel || 30) * dt;
    for (let i = 0; i < 90; i++) {
      vy -= (vy > 0 ? T.riseGravity : T.fallGravity) * dt;
      if (!used2 && vy < 2) { vy = dblV; used2 = true; }
      const dv = want.clone().sub(hv); if (dv.length() > acc) dv.setLength(acc); hv.add(dv);
      pos.addScaledVector(hv, dt); pos.y += vy * dt;
      if (vy < 0) {
        const g = Physics.raycast(game, pos.clone().add(V3(0, 1.2, 0)), V3(0, -1, 0), 1.5 + Math.abs(vy) * dt, { excludeCollider: player.collider });
        if (g && g.normal.y > 0.6 && !hazardAt(g.point)) { g.point.kinematic = !!g.kinematic; g.point.t = (i + 1) * dt; return g.point; }
      }
      if (pos.y < p.y - 12) return null;
    }
    return null;
  }
  function hazardAt(pt) {
    const R = game.__rules; if (!R) return false;
    return R.hazards.some(h => (h.type === 'lava' || h.type === 'killzone' || h.type === 'spikes') && Math.abs(pt.x - h.position.x) < (h.size ? h.size.x / 2 + 0.6 : 1) && Math.abs(pt.z - h.position.z) < (h.size ? h.size.z / 2 + 0.6 : 1));
  }
  // would a spinner bar sweep over `pt` around time t (s from now)? landing into the bar costs a heart
  function spinnerSafe(pt, t) {
    const R = game.__rules; if (!R) return true;
    for (const h of R.hazards) {
      if (h.type !== 'spinner' || !h.arm) continue;
      const dx = pt.x - h.position.x, dz = pt.z - h.position.z;
      if (Math.hypot(dx, dz) > h.length / 2 + 0.9 || Math.abs(pt.y - h.position.y) > 2) continue;
      const w = Math.abs(h.speed) || 1, period = Math.PI / w;
      let delta = h.speed >= 0 ? Math.atan2(-dz, dx) - h.arm.rotation.y : h.arm.rotation.y - Math.atan2(-dz, dx);
      delta = ((delta % Math.PI) + Math.PI) % Math.PI;
      const halfW = Math.asin(Math.min(1, 0.85 / Math.max(Math.hypot(dx, dz), 0.01))) / w;
      for (let pass = delta / w - period; pass < t + 1; pass += period) if (pass + halfW > t - 0.25 && pass - halfW < t + 0.5) return false;
    }
    return true;
  }
  function nearRoute(pt, r) {
    for (let i = Math.max(0, st.idx - 1); i < Math.min(route.length - 1, st.idx + 3); i++) {
      const a = route[i], b = route[i + 1], ab = b.clone().sub(a), t = THREE.MathUtils.clamp(pt.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
      if (pt.distanceTo(a.clone().addScaledVector(ab, t)) < r) return true;
    }
    return false;
  }
  function moverNear(pt) {
    const R = game.__rules; if (!R) return false;
    return R.movers.some(m => m.path.length > 1 && m.path.some((a, i) => {
      const b = m.path[(i + 1) % m.path.length]; const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(pt.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
      return Math.hypot(pt.x - (a.x + ab.x * t), pt.z - (a.z + ab.z * t)) < 4 && Math.abs(pt.y - a.y) < 4;
    }));
  }
  function supported(pt) {
    const g = Physics.raycast(game, pt.clone().add(V3(0, 1.5, 0)), V3(0, -1, 0), 4, { excludeCollider: player.collider });
    return g && !g.kinematic ? g : null;
  }
  function groundAhead(p, dir, d) {
    const at = p.clone().addScaledVector(dir, d).add(V3(0, 1.0, 0));
    const g = Physics.raycast(game, at, V3(0, -1, 0), 4.5, { excludeCollider: player.collider });
    return g && !hazardAt(g.point) ? g : null;
  }

  function step(dt) {
    if (!player.alive || dt <= 0) return;
    const S = game.state;
    const p = player.position;
    if (S.won || S.lost) { if (S.won) S.autopilotDone = true; player.setInput(0, 0, false, false); return; }
    // progress watchdog (contract: autopilotStuck after 8 s without progress)
    const progKey = vehicle ? (st.ti ?? 0) : st.idx * 1000 + (S.collected || 0);
    if (progKey !== st.progKey) { st.progKey = progKey; st.noProg = 0; S.autopilotStuck = false; }
    else { st.noProg = (st.noProg || 0) + dt; if (st.noProg > 8) S.autopilotStuck = true; }
    if (vehicle || player.type === 'kart' || player.type === 'boat') return vehicleBot(dt);
    // moving platforms: ride them instead of aiming at waypoints that hang over the gap
    const gObj = player.grounded ? player.groundObject : null;
    const onMover = !!(gObj && gObj.userData && gObj.userData.kinematic);
    if (onMover) while (st.idx < route.length - 1 && !supported(route[st.idx])) st.idx++;
    // advance route
    while (player.grounded && st.idx < route.length - 1) {
      const w = route[st.idx], n = route[st.idx + 1];
      const dh = Math.hypot(w.x - p.x, w.z - p.z);
      const toNext = Math.hypot(n.x - p.x, n.z - p.z), seg = Math.hypot(n.x - w.x, n.z - w.z);
      if ((dh < 1.6 && Math.abs(w.y - p.y) < 2.5) || (toNext < seg && Math.abs(n.y - p.y) < 1.5 && player.grounded)) st.idx++;
      else break;
    }
    // detour for nearby collectibles (reachable: roughly level, not far off the route)
    const R = game.__rules;
    if (R && player.grounded && (!st.item || st.item.collected || st.itemT > 3)) {
      st.item = null; st.itemT = 0;
      let best = null, bd = 7.5;
      for (const it of R.items) {
        if (it.collected || it.skip) continue;
        const dy = it.home.y - p.y, dh = Math.hypot(it.home.x - p.x, it.home.z - p.z);
        if (dh < bd && dy < 3.8 && dy > -1.5) {
          // only items we can walk to: solid ground under the item AND along the way (no gap jumps for a detour)
          const g = Physics.raycast(game, it.home, V3(0, -1, 0), 4);
          if (!g || g.kinematic || hazardAt(g.point) || Math.abs(g.point.y - p.y) > 2.6) continue;
          let walk = true;
          for (const f of [0.33, 0.66]) { const q = p.clone().lerp(it.home, f); const gq = Physics.raycast(game, V3(q.x, Math.max(p.y, g.point.y) + 1.5, q.z), V3(0, -1, 0), 4.5, { excludeCollider: player.collider }); if (!gq || gq.kinematic || hazardAt(gq.point)) { walk = false; break; } }
          if (walk || nearRoute(it.home, 2.2)) { best = it; bd = dh; }
        }
      }
      st.item = best;
    }
    if (st.item) st.itemT += dt;
    if (st.item && st.itemT > 3) st.item.skip = true;
    // end of the route but the collect goal isn't met (locked portal, or no goal at all): roam to the nearest target item
    const needMore = R && game.state.target > 0 && game.state.collected < game.state.target;
    let goalP = route[st.idx];
    if (needMore && st.idx >= route.length - 1 && !st.item) {
      // roam to the nearest uncollected target item
      const left = R.items.filter(i => !i.collected && i.tag === game.state.collectTag);
      left.sort((a, b) => a.home.distanceTo(p) - b.home.distanceTo(p));
      if (left[0]) { goalP = left[0].home; left[0].skip = false; st.item = left[0]; }
    }
    const tgt = st.item ? st.item.home : goalP;
    const to = V3(tgt.x - p.x, 0, tgt.z - p.z); const dist = to.length();
    const dir = dist > 0.01 ? to.clone().divideScalar(dist) : V3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    let mx = dir.x, mz = dir.z, jump = false, action = false;
    if (dist < 0.4) { mx = 0; mz = 0; }
    // slow down near a target on a small platform
    if (dist < 2 && !st.item) { mx *= dist / 2; mz *= dist / 2; }
    const tgtSupported = !!supported(tgt);
    const sp = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.grounded) {
      st.plan = null; st.wantDouble = false; st.hopInPlace = false; st.waiting = false;
      const dy = tgt.y - p.y;
      const g1 = groundAhead(p, dir, 1.1), g2 = groundAhead(p, dir, 0.6);
      const edge = !g1 || g1.point.y < p.y - 1.4;
      const hv = dir.clone().multiplyScalar(Math.max(sp, T.runSpeed * 0.95));
      if (onMover && dist > 1.5) {
        // riding: stay near the platform centre until a jump to the next solid waypoint lands
        const hvR = dir.clone().multiplyScalar(T.runSpeed * 0.95);
        const land = arcLands(p, hvR, jumpV, false) || (dblV ? arcLands(p, hvR, jumpV, true) : null);
        if (edge && land && !land.kinematic && Math.hypot(land.x - tgt.x, land.z - tgt.z) < dist) { jump = true; st.plan = land; st.wantDouble = !arcLands(p, hvR, jumpV, false); }
        else if (!edge) { /* keep walking toward the edge */ }
        else { const c = gObj.getWorldPosition(V3()); const tc = V3(c.x - p.x, 0, c.z - p.z); mx = tc.x * 0.4; mz = tc.z * 0.4; }
      } else if (edge && dist > 1.5) {
        // gap or drop: walk off if the target is below and there is ground under the drop, else jump if an arc lands
        const dropOk = g1 && dy < -0.8;
        if (!dropOk) {
          const ok = (l) => l && l.y > p.y - 6 && (!l.kinematic || Math.hypot(l.x - p.x, l.z - p.z) < 4.5) && spinnerSafe(l, l.t);
          const land = arcLands(p, hv, jumpV, false);
          if (ok(land)) { jump = true; st.plan = land; }
          else if (dblV) { const land2 = arcLands(p, hv, jumpV, true); if (ok(land2)) { jump = true; st.wantDouble = true; st.plan = land2; } }
          // nothing to land on yet: if a moving platform serves this gap, wait for it (we walk on when it docks)
          const moverGap = moverNear(p.clone().addScaledVector(dir, 3.5));
          if (!jump) { if (!g2) { mx = -dir.x * 0.4; mz = -dir.z * 0.4; } else { mx = 0; mz = 0; } st.waiting = true; st.waitT += dt; if (st.waitT > (moverGap ? 12 : tgtSupported ? 1.5 : 7)) { jump = true; st.wantDouble = !!dblV; st.waitT = 0; mx = dir.x; mz = dir.z; } }
        }
      } else st.waitT = 0;
      // ledge above: jump when close
      if (!jump && dy > 1.0 && dist < (dy > 3.2 ? 7 : 5.5)) { jump = true; st.wantDouble = dy > 3.6 && !!dblV; }
      // enemies: stomp; spinner bars: hop over
      if (!jump && R) {
        for (const e of R.enemies) if (e.alive && e.kind !== 'turret' && e.position.distanceTo(p) < 3.2 && Math.abs(e.position.y - p.y) < 1.5) { jump = true; break; }
        for (const h of R.hazards) {
          if (h.type === 'spinner' && h.arm) {
            // time until the bar sweeps over us; hop just before it arrives
            const c = h.position, dx = p.x - c.x, dz = p.z - c.z, r = Math.hypot(dx, dz);
            if (r > h.length / 2 + 1.2 || Math.abs(c.y + h.height - p.y - 0.9) > 1.5) continue;
            const phi = Math.atan2(-dz, dx), a = h.arm.rotation.y, w = Math.abs(h.speed) || 1;
            let delta = h.speed >= 0 ? phi - a : a - phi;
            delta = ((delta % Math.PI) + Math.PI) % Math.PI;
            // the bar is thick: its edge reaches us halfW radians before its centre line
            const halfW = Math.asin(Math.min(1, 0.85 / Math.max(r, 0.01)));
            const tEdge = (delta - halfW) / w;
            if (tEdge < 0.3 || delta > Math.PI - halfW) { jump = true; st.jumpHold = 0.45; break; }
          } else if ((h.type === 'spikes' || h.type === 'lava' || h.type === 'saw') && !jump) {
            // hop over a hazard right ahead on our path
            const ahead = p.clone().addScaledVector(dir, 1.6);
            const hs = h.size ? Math.max(h.size.x, h.size.z) / 2 + 0.5 : (h.radius || 1) + 0.6;
            const hp = h.type === 'saw' ? h.object.position : h.position;
            if (Math.hypot(ahead.x - hp.x, ahead.z - hp.z) < hs && Math.abs(hp.y - p.y) < 2) { jump = true; st.jumpHold = 0.45; break; }
          }
        }
      }
      // stuck against something: hop
      if (!jump && sp < 1.5 && dist > 2 && (Math.abs(mx) + Math.abs(mz)) > 0.5) { st.stuckT += dt; if (st.stuckT > 0.35) { jump = true; st.stuckT = 0; } }
      if (jump) {
        st.jumpHold = 0.45; st.jumpDir = dir.clone();
        // hops that aren't gap jumps (enemy, spinner, stuck) at a ledge go straight up and land where they started
        st.hopInPlace = !st.plan && !st.wantDouble && edge && !(onMover && st.plan);
        if (st.hopInPlace) { mx = 0; mz = 0; }
      }
    } else {
      // air: hold jump for full height, double-jump at apex if planned or if falling short of the target ledge
      if (st.hopInPlace) { mx = 0; mz = 0; }
      if (st.jumpHold > 0) { st.jumpHold -= dt; jump = true; }
      if (st.wantDouble && player.velocity.y < 2) { jump = false; st.wantDouble = false; st.dblNext = true; }
      else if (st.dblNext) { jump = true; st.dblNext = false; st.jumpHold = 0.3; }
      else if (dblV && player.velocity.y < -2 && tgt.y > p.y - 0.5 && !st.usedEmergency && dist > 1) {
        const below = Physics.raycast(game, p.clone().add(V3(0, 0.5, 0)), V3(0, -1, 0), 6, { excludeCollider: player.collider });
        if (!below) { st.usedEmergency = true; jump = false; st.dblNext = true; }
      }
      // coming down into a spinner's sweep: spend the double jump
      if (R && dblV && !st.dblNext && player.velocity.y < 0 && !st.spinDbl) for (const h of R.hazards) if (h.type === 'spinner' && h.arm) {
        const c = h.position, dx = p.x - c.x, dz = p.z - c.z;
        if (Math.hypot(dx, dz) > h.length / 2 + 1 || p.y - c.y > 1.6 || p.y < c.y - 0.5) continue;
        let delta = h.speed >= 0 ? Math.atan2(-dz, dx) - h.arm.rotation.y : h.arm.rotation.y - Math.atan2(-dz, dx);
        delta = ((delta % Math.PI) + Math.PI) % Math.PI;
        const halfW = Math.asin(Math.min(1, 0.85 / Math.max(Math.hypot(dx, dz), 0.01)));
        if ((delta - halfW) / (Math.abs(h.speed) || 1) < 0.35) { st.dblNext = true; st.spinDbl = true; jump = false; }
      }
      if (st.plan) {
        // steer onto the planned landing; once we have flown past it (too high), keep going forward, never turn back
        const pd = V3(st.plan.x - p.x, 0, st.plan.z - p.z);
        if (st.jumpDir && pd.dot(st.jumpDir) < 0) st.plan = null;
        else if (pd.length() > 0.5) { pd.normalize(); mx = pd.x; mz = pd.z; }
      }
      else if (st.lastGround && !Physics.raycast(game, p.clone().add(V3(0, 0.5, 0)), V3(0, -1, 0), 10, { excludeCollider: player.collider }) && !supported(tgt)) {
        // nothing under us and the target hangs in the air: head back to where we last stood
        const pd = V3(st.lastGround.x - p.x, 0, st.lastGround.z - p.z); if (pd.length() > 0.3) { pd.normalize(); mx = pd.x; mz = pd.z; }
      }
    }
    if (player.grounded) { st.usedEmergency = false; st.spinDbl = false; if (!onMover) st.lastGround = p.clone(); }
    // stuck far from progress: assist teleport onto the current waypoint
    const prog = st.idx + (st.item ? 0.5 : 0) - dist * 0.01;
    if (prog > st.lastProg + 0.05) { st.lastProg = prog; st.stuckClock = 0; }
    st.stuckClock = (st.stuckClock || 0) + dt;
    if (st.stuckClock > 6) {
      st.stuckClock = 0; st.assists++;
      if (st.item) st.item.skip = true; else { const w = route[Math.min(st.idx, route.length - 1)]; player.teleport(w.clone().add(V3(0, 0.5, 0)), player.yaw); }
    }
    if (game.__apTrace) game.__apTrace.push([+game.time.toFixed(2), p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(1), st.idx, player.grounded ? 'G' : 'A', jump ? 'J' : '', st.item ? 'item' : '', st.plan ? 'plan' : '', (+mx).toFixed(2) + ',' + (+mz).toFixed(2)]);
    player.setInput(mx, mz, jump, action, { world: true });
    if (player.type === 'fps' && player._bot) {
      const want = Math.atan2(mx, mz);
      if (Math.abs(mx) + Math.abs(mz) > 0.1) player._bot.lookYaw = player.lookYaw + angWrap(want - player.lookYaw) * Math.min(1, dt * 5);
      // aim and shoot enemies in range
      if (R) for (const e of R.enemies) if (e.alive && e.position.distanceTo(p) < 18) {
        const a = Math.atan2(e.position.x - p.x, e.position.z - p.z); player._bot.lookYaw = player.lookYaw + angWrap(a - player.lookYaw) * Math.min(1, dt * 8);
        if (Math.abs(angWrap(a - player.lookYaw)) < 0.08) player._bot.action = (game.frame % 12) < 2;
        break;
      }
    }
    if (player.type === 'topdown' && R) {
      // dash is an edge-triggered press: tap it (press / release) while an enemy is in reach
      for (const e of R.enemies) if (e.alive && e.position.distanceTo(p) < 4.5) { const d = e.position.clone().sub(p).setY(0).normalize(); st.tap = !st.tap; player.setInput(d.x, d.z, false, st.tap, { world: true }); break; }
    }
  }

  let samples = null, trackLen = 0;
  function vehicleBot(dt) {
    const p = player.position, track = level.track;
    if (!track) {
      while (st.idx < route.length - 1 && route[st.idx].distanceTo(p) < 8) st.idx++;
      const target = route[st.idx], d = angWrap(Math.atan2(target.x - p.x, target.z - p.z) - player.yaw);
      player.setInput(THREE.MathUtils.clamp(-d * 2, -1, 1), Math.abs(d) > 1.2 ? 0.6 : 1, false, false);
      return;
    }
    if (!samples) { samples = Array.from({ length: 600 }, (_, i) => track.getPointAt(i / 600)); trackLen = track.getLength(); st.ti = null; }
    // nearest sample (local search after the first frame)
    let bi = st.ti ?? 0, bd = Infinity;
    const scan = st.ti === null ? 600 : 40;
    for (let k = -scan; k <= scan; k++) { const i = (((st.ti ?? 0) + k) % 600 + 600) % 600, q = samples[i]; const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    st.ti = bi; st.width = level.trackWidth || 12;
    driveTrack(game, player, samples, bi, trackLen, st, dt, 1);
    if (st.assistNow) { st.assistNow = false; st.assists++; }
  }

  game.update(step, -5);
  game.__autopilot = A;
  return A;
}

/** Spawn helpers for games that want gameplay objects without a level placement. */
export function spawnEnemy(game, kind, position, opts = {}) {
  if (!game.__rules) throw new Error('Gameplay.spawnEnemy: call Gameplay.rules(game, {...}) first');
  return game.__rules.addEnemy(kind, position, opts);
}
export function spawnCollectible(game, position, tag = 'coin', opts = {}) {
  if (!game.__rules) throw new Error('Gameplay.spawnCollectible: call Gameplay.rules(game, {...}) first');
  return game.__rules.addCollectible(position, tag, opts);
}

// Pure-pursuit driving along a sampled closed track with corner drifts and wall recovery (AI racers + autopilot).
function driveTrack(game, pl, samples, idx, length, st, dt, throttleScale = 1) {
  const N = samples.length, p = pl.position, sp = pl.speed;
  const ahead = Math.max(3, Math.round((7 + sp * 0.32) / (length / N)));
  const a = samples[(idx + ahead) % N], b = samples[(idx + ahead + 8) % N], far = samples[(idx + ahead * 2 + 8) % N];
  const tan = V3(b.x - a.x, 0, b.z - a.z).normalize(), tan2 = V3(far.x - b.x, 0, far.z - b.z).normalize();
  const bend = Math.acos(THREE.MathUtils.clamp(tan.dot(tan2), -1, 1));
  const side = V3(tan.z, 0, -tan.x);
  const target = a.clone().addScaledVector(side, st.lane || 0);
  const want = Math.atan2(target.x - p.x, target.z - p.z);
  const d = angWrap(want - pl.yaw);
  let throttle = throttleScale;
  if (bend > 0.45 && sp > 20) throttle *= 0.65;
  if (Math.abs(d) > 1.0) throttle *= 0.6;
  // drift through bends at speed, release on the exit for the boost
  if (!st.drift && bend > 0.3 && sp > 17 && Math.abs(d) > 0.08) { st.drift = true; st.driftT = 0; }
  if (st.drift) { st.driftT = (st.driftT || 0) + dt; if ((bend < 0.12 && st.driftT > 0.7) || st.driftT > 3 || sp < 10) st.drift = false; }
  // stuck on a wall: back off with opposite lock, then go again
  st.stuckT = st.stuckT || 0; st.revT = st.revT || 0;
  if (st.revT > 0) {
    st.revT -= dt;
    pl.setInput(THREE.MathUtils.clamp(d * 2, -1, 1), -1, false, false);
    return;
  }
  if (sp < 3 && pl.controls.enabled) { st.stuckT += dt; if (st.stuckT > 0.6) { st.revT = 0.7; st.stuckT = 0; st.stuckCount = (st.stuckCount || 0) + 1; } }
  else { st.stuckT = 0; if (sp > 10) st.stuckCount = 0; }
  const nearD = Math.hypot(samples[idx].x - p.x, samples[idx].z - p.z);
  st.offT = nearD > (st.width || 12) / 2 + 5 ? (st.offT || 0) + dt : 0;
  if (st.offT > 2.5) { st.offT = 0; st.stuckCount = 4; }
  if ((st.stuckCount || 0) >= 4) {
    st.stuckCount = 0; st.assistNow = true;
    const q = samples[(idx + 6) % N].clone(); pl.teleport(q.setY(q.y + 0.6), Math.atan2(tan.x, tan.z));
  }
  pl.setInput(THREE.MathUtils.clamp(-d * 2.2, -1, 1), throttle, !!st.drift, false);
}
