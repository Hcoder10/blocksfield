// mechanics.js: change and add gameplay mechanics safely. Player tuning, power-ups, interactables (keys, doors,
// switches, plates, teleporters, conveyors, zones, crates, shrines, shops), a declarative trigger -> effect rule
// system with variables, and a sandboxed escape hatch for model-written mechanics. All autopilot-aware.
// See docs/Mechanics.md. Talks to UI / FX / Audio only through events (powerup, powerupEnd, key, keyUsed, door,
// switch, rule, mechanic, prompt).
import * as THREE from 'three';
import * as Physics from './physics.js';
import * as Gameplay from './gameplay.js';

export const POWERUPS = ['speed', 'highjump', 'magnet', 'shield', 'giant', 'tiny', 'glide', 'doublepoints', 'slowmo', 'invincible'];
export const INTERACTABLES = ['key', 'door', 'switch', 'plate', 'platform', 'teleporter', 'bounce', 'conveyor', 'zone', 'crumble', 'shrine', 'crate', 'shop'];
export const TRIGGERS = ['collect', 'enter', 'timer', 'defeat', 'count', 'state', 'interact', 'start'];
export const EFFECTS = ['spawn', 'give', 'tune', 'open', 'close', 'toggle', 'setObjective', 'banner', 'toast', 'fx', 'sfx', 'win', 'lose', 'score', 'teleport', 'set', 'add', 'lava', 'emit'];
export const TUNE_KEYS = ['speed', 'jump', 'gravity', 'airJumps', 'dash', 'glide', 'wallJump', 'size', 'friction'];
export const KEY_COLORS = { red: '#ff4d5e', blue: '#4d8dff', green: '#3ddc84', yellow: '#ffd23f', purple: '#b56bff', orange: '#ff9a3c' };

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const list = (a) => a.join(', ');
const vec = (v, what) => {
  if (v && v.isVector3) return v.clone();
  if (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) return V3(...v);
  if (v && Number.isFinite(v.x) && Number.isFinite(v.z)) return V3(v.x, v.y || 0, v.z);
  throw new Error(`Mechanics: ${what} must be [x, y, z] or a Vector3, got ${JSON.stringify(v)}`);
};
const POWERUP_INFO = {
  speed: { color: '#ffb02e', label: 'Speed!', dur: 8 }, highjump: { color: '#5fd6ff', label: 'High jump!', dur: 10 },
  magnet: { color: '#ff5fa2', label: 'Magnet', dur: 12 }, shield: { color: '#7ff6ff', label: 'Shield', dur: 10 },
  giant: { color: '#ff7a3c', label: 'Giant!', dur: 8 }, tiny: { color: '#b4ff7a', label: 'Tiny', dur: 8 },
  glide: { color: '#c6b2ff', label: 'Glide', dur: 12 }, doublepoints: { color: '#ffd23f', label: 'x2 points', dur: 12 },
  slowmo: { color: '#9aa8ff', label: 'Slow-mo', dur: 6 }, invincible: { color: '#ff4dff', label: 'Invincible!', dur: 7 },
};
const UI_TYPE = { highjump: 'jump', doublepoints: 'double_coins' };   // kit-ui-fx icon names

// ---- shared state per game ----------------------------------------------------------------------------------------

function M(game) {
  if (game.__mech) return game.__mech;
  const m = game.__mech = {
    things: [], byId: new Map(), rules: [], customs: [], vars: {}, active: {}, keys: [], lavaT: 0, seq: 0, root: new THREE.Group(),
    botTarget: (pl, goal) => botTarget(game, pl, goal),
  };
  m.root.name = 'mechanics'; game.scene.add(m.root);
  game.state.vars = m.vars; game.state.keys = m.keys; game.state.powerups = {};
  game.update((dt, t) => tick(game, dt, t), 12);
  // collect / defeat events feed power-ups, keys and rules
  game.on('collect', (it, by) => onCollect(game, it, by));
  game.on('death', (who) => { for (const r of m.rules) if (r.when === 'defeat') r.onDefeat(who); });
  return m;
}
const player0 = (game) => game.__player;
const rulesOf = (game, fn) => {
  if (!game.__rules) throw new Error(`Mechanics.${fn}: call Gameplay.rules(game, {...}) first (Mechanics builds on its pickups, enemies and state)`);
  return game.__rules;
};
function mat(color, glow = 0.35) { return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.45, metalness: 0.1 }); }
function mesh(geo, m) { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; return o; }
function register(game, kind, obj, id) {
  const m = M(game);
  obj.kind = kind; obj.id = id || `${kind}${++m.seq}`;
  if (m.byId.has(obj.id)) throw new Error(`Mechanics: id "${obj.id}" is used twice; ids must be unique`);
  m.byId.set(obj.id, obj); m.things.push(obj);
  return obj;
}
function prompt(game, text, key = 'E') { if (game.__mechPrompt !== text) { game.__mechPrompt = text; game.emit('prompt', text ? { text, key } : null); } }

// ---- 1) player tuning ------------------------------------------------------------------------------------------------

const LIMITS = { speed: [0.3, 3], jump: [0.3, 3], gravity: [0.3, 3], airJumps: [0, 5], size: [0.4, 2.5], friction: [0.05, 2] };
/**
 * Mechanics.tune(player, { speed, jump, gravity, airJumps, dash, glide, wallJump, size, friction }, seconds?)
 * Multipliers relative to the player's defaults (speed: 1.5 = 50% faster); airJumps = extra jumps in the air (1 = double
 * jump); booleans switch dash / glide / wall jump on or off; size scales the character. With seconds it reverts after.
 * Returns a function that reverts the change.
 */
export function tune(player, opts = {}, seconds = 0) {
  if (!player || !player.tuning) throw new Error('Mechanics.tune(player, opts): first argument must be the player from Player.create()');
  for (const k of Object.keys(opts)) if (!TUNE_KEYS.includes(k)) throw new Error(`Mechanics.tune: unknown option "${k}"; options: ${list(TUNE_KEYS)}`);
  const T = player.tuning, base = player.__baseTune || (player.__baseTune = { ...T, size: 1 });
  const before = { ...T, size: player.__size || 1 };
  const num = (k, v) => { const [lo, hi] = LIMITS[k]; if (!Number.isFinite(+v)) throw new Error(`Mechanics.tune: ${k} must be a number (${lo}..${hi})`); return Math.min(hi, Math.max(lo, +v)); };
  if (opts.speed !== undefined) { const k = num('speed', opts.speed); if (base.runSpeed) T.runSpeed = base.runSpeed * k; if (base.maxSpeed) T.maxSpeed = base.maxSpeed * k; if (base.sprintSpeed) T.sprintSpeed = base.sprintSpeed * k; }
  if (opts.jump !== undefined) { const k = num('jump', opts.jump); if (base.jumpHeight) T.jumpHeight = base.jumpHeight * k; if (base.doubleJumpHeight) T.doubleJumpHeight = base.doubleJumpHeight * k; if (base.hop) T.hop = base.hop * k; }
  if (opts.gravity !== undefined) { const k = num('gravity', opts.gravity); for (const g of ['riseGravity', 'fallGravity', 'cutGravity', 'gravity']) if (base[g]) T[g] = base[g] * k; }
  if (opts.airJumps !== undefined) { const n = Math.round(num('airJumps', opts.airJumps)); T.jumps = 1 + n; if (n > 0 && !T.doubleJumpHeight) T.doubleJumpHeight = (base.jumpHeight || 4.5) * 0.7; }
  if (opts.dash !== undefined) T.dash = !!opts.dash;
  if (opts.glide !== undefined) { T.glide = !!opts.glide; T.glideFall = T.glideFall || 3; }
  if (opts.wallJump !== undefined) T.wallJump = !!opts.wallJump;
  if (opts.friction !== undefined) T.friction = num('friction', opts.friction);
  if (opts.size !== undefined) { const s = num('size', opts.size); player.__size = s; if (player.character) player.character.object.scale.setScalar(s * (player.type === 'kart' || player.type === 'boat' ? 0.72 : 1)); }
  const revert = () => { const s = before.size; delete before.size; Object.assign(T, before); player.__size = s; if (player.character) player.character.object.scale.setScalar(s * (player.type === 'kart' || player.type === 'boat' ? 0.72 : 1)); };
  if (seconds > 0) setTimeoutGame(player.__game || null, seconds, revert, player);
  return revert;
}
// timers that follow game time (pause / slow-mo aware)
function setTimeoutGame(game, seconds, fn, player) {
  const g = game || (player && player.__gameRef) || globalThis.__game;
  if (!g) return setTimeout(fn, seconds * 1000);
  const m = M(g); (m.timers || (m.timers = [])).push({ t: seconds, fn });
}

// ---- 2) power-ups -------------------------------------------------------------------------------------------------------

/**
 * Mechanics.powerup(game, { type, position | placements: [pos...] | count (spread along the route), duration })
 * Spawns glowing power-up pickups; touching one gives the effect for duration seconds (HUD chip via the powerup event).
 * Mechanics.give(game, player, type, duration) applies one directly.
 */
export function powerup(game, opts = {}) {
  if (typeof opts === 'string') opts = { type: opts };
  const type = String(opts.type || '').toLowerCase();
  if (!POWERUPS.includes(type)) throw new Error(`Mechanics.powerup: unknown type "${opts.type}"; types: ${list(POWERUPS)}`);
  const R = rulesOf(game, 'powerup'); M(game);
  let spots = [];
  if (opts.position) spots = [vec(opts.position, 'powerup position')];
  else if (opts.placements) spots = opts.placements.map((p, i) => vec(p, `placements[${i}]`));
  else spots = routeSpots(game, opts.count || 3, 0.12 + (POWERUPS.indexOf(type) % 5) * 0.03);
  return spots.map(p => {
    const it = R.addCollectible(p.clone().add(V3(0, p.y === Math.floor(p.y) ? 1.1 : 0, 0)), 'pu_' + type, { color: POWERUP_INFO[type].color, value: 0 });
    it.powerup = type; it.duration = opts.duration || POWERUP_INFO[type].dur; it.radius = 1.3;
    // a little spinning ring so power-ups read differently from coins
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: POWERUP_INFO[type].color, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.userData.noCollide = true; it.object.userData.spin.add(ring);
    return it;
  });
}
function routeSpots(game, n, start = 0.15) {
  const L = game.__level || game.level, route = L && L.route && L.route.length ? L.route : [player0(game).position];
  const out = [];
  for (let i = 0; i < n; i++) { const f = start + (0.9 - start) * (i + 0.5) / n; out.push(route[Math.min(route.length - 1, Math.floor(f * (route.length - 1)))].clone().add(V3(0, 1.1, 0))); }
  return out;
}

export function give(game, player, type, duration) {
  player = player || player0(game);
  type = String(type).toLowerCase();
  if (!POWERUPS.includes(type)) throw new Error(`Mechanics.give: unknown power-up "${type}"; types: ${list(POWERUPS)}`);
  const m = M(game), info = POWERUP_INFO[type], dur = duration || info.dur;
  if (m.active[type]) { m.active[type].t = dur; game.emit('powerup', player, { type: UI_TYPE[type] || type, duration: dur, label: info.label }); return; }
  const vehicle = player.type === 'kart' || player.type === 'boat';
  let end = () => {};
  switch (type) {
    case 'speed': if (vehicle) { player.boost(Math.min(dur, 3), 'powerup'); end = tune(player, { speed: 1.25 }); } else end = tune(player, { speed: 1.6 }); break;
    case 'highjump': end = tune(player, { jump: 1.6 }); break;
    case 'magnet': game.__magnetR = 9; end = () => { game.__magnetR = 0; }; break;
    case 'shield': { player.shield = true; const b = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 16), new THREE.MeshBasicMaterial({ color: '#7ff6ff', transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false })); b.position.y = 0.95; b.userData.noCollide = true; player.object.add(b); end = () => { player.shield = false; player.object.remove(b); }; break; }
    case 'giant': end = tune(player, { size: 1.8, speed: 1.15, jump: 1.2 }); player.invincible = true; { const e2 = end; end = () => { e2(); player.invincible = false; }; } break;
    case 'tiny': end = tune(player, { size: 0.55, speed: 1.1 }); break;
    case 'glide': end = tune(player, { glide: true }); break;
    case 'doublepoints': game.__scoreMul = 2; end = () => { game.__scoreMul = 1; }; break;
    case 'slowmo': { const ts = game.timeScale; game.timeScale = Math.min(ts, 0.6); end = () => { game.timeScale = ts; }; break; }
    case 'invincible': player.invincible = true; end = () => { player.invincible = false; if (player.character) player.character.object.traverse(o => { if (o.isMesh && o.material && o.userData.__c) { o.material.color.copy(o.userData.__c); } }); }; break;
  }
  m.active[type] = { t: dur, end, player };
  game.emit('powerup', player, { type: UI_TYPE[type] || type, duration: dur, label: info.label });
}

// ---- 3) interactables -----------------------------------------------------------------------------------------------

/**
 * Mechanics.add(game, { type, id, position, ... }) -> interactable. Types (Mechanics.INTERACTABLES):
 *  key {color} · door {color | (opened by a switch/rule), yaw, width=4, height=4} · switch {targets:[ids], once}
 *  plate {targets:[ids]} (open while stood on) · platform {size:[x,y,z], solid=false} (toggled by switches / rules)
 *  teleporter {to:[x,y,z]} · bounce {power} · conveyor {size, direction, speed} · zone {size, gravity | lift}
 *  crumble {size} · shrine (checkpoint) · crate {drops:'coin'|power-up, count} · shop {npc, price, sells}
 */
export function add(game, opts = {}) {
  const type = String(opts.type || '').toLowerCase();
  if (!INTERACTABLES.includes(type)) throw new Error(`Mechanics.add: unknown type "${opts.type}"; types: ${list(INTERACTABLES)}`);
  const R = rulesOf(game, 'add'); const m = M(game);
  const p = opts.position ? vec(opts.position, `${type}.position`) : null;
  const need = () => { if (!p) throw new Error(`Mechanics.add: ${type} needs position: [x, y, z]`); return p; };
  switch (type) {
    case 'key': {
      const color = String(opts.color || 'red').toLowerCase();
      if (!KEY_COLORS[color]) throw new Error(`Mechanics.add: key color "${opts.color}"; colors: ${list(Object.keys(KEY_COLORS))}`);
      const it = R.addCollectible(need().clone().add(V3(0, 1.1, 0)), 'key', { color: KEY_COLORS[color], value: 1 });
      it.keyColor = color;
      return register(game, 'key', { item: it, color, position: it.home }, opts.id);
    }
    case 'door': {
      const pos = need(), w = opts.width || 4, h = opts.height || 4, yaw = opts.yaw || 0, color = opts.color ? String(opts.color).toLowerCase() : null;
      if (color && !KEY_COLORS[color]) throw new Error(`Mechanics.add: door color "${opts.color}"; colors: ${list(Object.keys(KEY_COLORS))}`);
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = yaw; m.root.add(g);
      const frameM = mat('#5a4a6a', 0.05), panelM = mat(color ? KEY_COLORS[color] : '#8a7a9a', color ? 0.35 : 0.08);
      for (const s of [-1, 1]) { const post = mesh(new THREE.BoxGeometry(0.5, h + 0.5, 0.7), frameM); post.position.set(s * (w / 2 + 0.25), (h + 0.5) / 2, 0); g.add(post); }
      const lintel = mesh(new THREE.BoxGeometry(w + 1, 0.5, 0.7), frameM); lintel.position.y = h + 0.25; g.add(lintel);
      const panel = mesh(new THREE.BoxGeometry(w, h, 0.35), panelM); panel.position.y = h / 2; g.add(panel);
      if (color) { const lock = mesh(new THREE.TorusGeometry(0.28, 0.08, 8, 20), mat('#ffd23f', 0.6)); lock.position.set(0, h / 2, 0.22); panel.add(lock); }
      g.traverse(o => { o.userData.noCollide = true; });
      const fwd = V3(Math.sin(yaw), 0, Math.cos(yaw)), side = V3(fwd.z, 0, -fwd.x);
      const half = [w / 2, h / 2, 0.4];
      const make = () => Physics.box(game, pos.clone().add(V3(0, h / 2, 0)), half, { yaw });
      const d = register(game, 'door', { group: g, panel, color, open: false, collider: make(), position: pos, yaw, width: w, height: h, slide: 0, side, fwd }, opts.id);
      d.setOpen = (on) => {
        if (on === d.open) return; d.open = on;
        if (on) { Physics.removeColliders(game, [d.collider]); d.collider = null; } else d.collider = make();
        game.emit('door', d, { open: on, color: d.color });
      };
      return d;
    }
    case 'switch': case 'plate': {
      const pos = need(), g = new THREE.Group(); g.position.copy(pos); m.root.add(g);
      let lever = null;
      if (type === 'switch') {
        const base = mesh(new THREE.CylinderGeometry(0.6, 0.75, 0.3, 16), mat('#6b6f80', 0.05)); base.position.y = 0.15; g.add(base);
        lever = new THREE.Group(); lever.position.y = 0.3; g.add(lever);
        const stick = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8), mat('#d7dbe6', 0.05)); stick.position.y = 0.55; lever.add(stick);
        const knob = mesh(new THREE.SphereGeometry(0.2, 12, 10), mat('#ff4d5e', 0.5)); knob.position.y = 1.1; lever.add(knob);
        lever.rotation.z = -0.6;
      } else {
        const pad = mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.18, 24), mat('#ffd23f', 0.3)); pad.position.y = 0.09; g.add(pad); lever = pad;
      }
      g.traverse(o => { o.userData.noCollide = true; });
      const targets = [].concat(opts.targets || opts.target || []);
      const s = register(game, type, { group: g, lever, on: false, targets, position: pos, once: !!opts.once, cool: 0 }, opts.id);
      s.set = (on) => {
        if (on === s.on) return; s.on = on;
        if (s.lever) { if (type === 'switch') s.lever.rotation.z = on ? 0.6 : -0.6; else s.lever.position.y = on ? 0.03 : 0.09; }
        for (const id of s.targets) toggleId(game, id, type === 'plate' ? on : undefined);
        game.emit('switch', s, { on, text: opts.text });
        for (const r of m.rules) if (r.when === 'interact' && (!r.id || r.id === s.id)) r.fire({ on });
      };
      return s;
    }
    case 'platform': {
      const pos = need(), size = opts.size ? (Array.isArray(opts.size) ? opts.size : [opts.size, 0.6, opts.size]) : [4, 0.6, 4];
      const pm = mesh(new THREE.BoxGeometry(...size), mat(opts.color || '#7fd0ff', 0.25)); pm.position.copy(pos); pm.userData.noCollide = true; m.root.add(pm);
      const pl = register(game, 'platform', { mesh: pm, position: pos, size, solid: false, collider: null }, opts.id);
      pl.setOpen = (on) => {
        if (on === pl.solid) return; pl.solid = on;
        if (on) pl.collider = Physics.box(game, pos, [size[0] / 2, size[1] / 2, size[2] / 2]); else { Physics.removeColliders(game, [pl.collider]); pl.collider = null; }
        game.emit('switch', pl, { on });
      };
      pm.material.transparent = true;
      pl.setOpen(opts.solid !== false && opts.visible !== false ? !!opts.solid : false);
      return pl;
    }
    case 'teleporter': {
      const pos = need(), to = vec(opts.to, 'teleporter.to');
      const mk = (at, col) => {
        const g = new THREE.Group(); g.position.copy(at); m.root.add(g);
        const ring = mesh(new THREE.TorusGeometry(1.1, 0.12, 10, 32), mat(col, 0.8)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, toneMapped: false, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.12; g.add(disc);
        g.traverse(o => { o.userData.noCollide = true; }); return g;
      };
      const tp = register(game, 'teleporter', { a: mk(pos, opts.color || '#b56bff'), b: mk(to, opts.color || '#b56bff'), position: pos, to, cool: 0, twoWay: opts.twoWay !== false }, opts.id);
      return tp;
    }
    case 'bounce': return register(game, 'bounce', { position: need(), hazard: addHazardLate(game, { type: 'bounce', position: need(), power: opts.power || 22 }) }, opts.id);
    case 'crumble': return register(game, 'crumble', { position: need(), hazard: addHazardLate(game, { type: 'crumble', position: need(), size: opts.size ? vec(opts.size, 'crumble.size') : undefined }) }, opts.id);
    case 'conveyor': case 'zone': {
      const pos = need(), size = opts.size ? vec(Array.isArray(opts.size) || opts.size.isVector3 ? opts.size : [opts.size, 0.3, opts.size], 'size') : V3(4, type === 'zone' ? 6 : 0.3, 4);
      const color = type === 'conveyor' ? '#ffb02e' : (opts.gravity !== undefined && opts.gravity < 1 ? '#9ad8ff' : '#7ff6ff');
      const vis = new THREE.Mesh(new THREE.BoxGeometry(size.x, type === 'conveyor' ? 0.12 : size.y, size.z), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: type === 'conveyor' ? 0.75 : 0.12, depthWrite: false, toneMapped: false }));
      vis.position.copy(pos).add(V3(0, type === 'conveyor' ? 0.08 : size.y / 2, 0)); vis.userData.noCollide = true; m.root.add(vis);
      const dir = opts.direction ? vec(opts.direction, 'conveyor.direction').setY(0).normalize() : V3(0, 0, 1);
      return register(game, type, { mesh: vis, position: pos, size, dir, speed: opts.speed || 6, gravity: opts.gravity, lift: opts.lift || 0, inside: false }, opts.id);
    }
    case 'shrine': {
      const pos = need();
      R.level.checkpoints.push({ position: pos, radius: 2.5 });
      const g = new THREE.Group(); g.position.copy(pos); m.root.add(g);
      const stone = mesh(new THREE.CylinderGeometry(0.6, 0.9, 1.6, 8), mat('#cfd5e2', 0.05)); stone.position.y = 0.8; g.add(stone);
      const orb = mesh(new THREE.SphereGeometry(0.35, 16, 12), mat('#7dffb0', 0.8)); orb.position.y = 1.9; g.add(orb);
      g.traverse(o => { o.userData.noCollide = true; });
      return register(game, 'shrine', { group: g, orb, position: pos, lit: false }, opts.id);
    }
    case 'crate': {
      const pos = need(), c = mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat('#b07a45', 0.05)); c.position.copy(pos).add(V3(0, 0.7, 0)); m.root.add(c);
      const col = Physics.box(game, c.position, [0.7, 0.7, 0.7]);
      const drops = opts.drops || 'coin';
      if (drops !== 'coin' && !POWERUPS.includes(drops) && !Gameplay.COLLECTIBLES.includes(drops)) throw new Error(`Mechanics.add: crate drops "${drops}"; drops: coin, ${list(POWERUPS)}`);
      return register(game, 'crate', { mesh: c, collider: col, position: pos, drops, count: opts.count || 3, broken: false }, opts.id);
    }
    case 'shop': {
      const sells = String(opts.sells || 'speed').toLowerCase();
      if (!POWERUPS.includes(sells)) throw new Error(`Mechanics.add: shop sells "${opts.sells}"; it can sell: ${list(POWERUPS)}`);
      let npc = null;
      if (typeof Gameplay.npcs === 'function') npc = Gameplay.npcs(game, [{ name: opts.name || 'Shopkeeper', species: opts.species || 'cat', accessory: 'hat', position: need(), lines: [`${POWERUP_INFO[sells].label} for ${opts.price || 10} points!`] }])[0];
      return register(game, 'shop', { npc, position: need(), price: opts.price || 10, sells, cool: 0 }, opts.id);
    }
  }
}
// hazards added after Gameplay.rules ran: go through the rules object
function addHazardLate(game, h) { const R = game.__rules; return R && typeof R.addHazard === 'function' ? R.addHazard(h) : (R.level.hazards.push(h), null); }

function toggleId(game, id, force) {
  const t = M(game).byId.get(id);
  if (!t) throw new Error(`Mechanics: no interactable with id "${id}"; ids: ${list([...M(game).byId.keys()])}`);
  const cur = t.kind === 'door' ? t.open : t.kind === 'platform' ? t.solid : t.on;
  const next = force === undefined ? !cur : force;
  if (t.setOpen) t.setOpen(next); else if (t.set) t.set(next);
}

// ---- 4) rules -------------------------------------------------------------------------------------------------------

/**
 * Mechanics.rule(game, { name, text, when, ...trigger options, do: [effects], once })
 *  when: 'collect' {tag, every} · 'enter' {position, radius | id} · 'timer' {every | after} · 'defeat' {kind, all}
 *        'count' {var, gte | eq} · 'state' {key, gte | lte | eq} · 'interact' {id} · 'start'
 *  do:   [{ spawn: 'coin'|power-up|'enemy:chase', at: [x,y,z] | 'player' | 'route', count }, { give: power-up | 'key:red' | 'life', duration },
 *         { tune: {...}, seconds }, { open | close | toggle: id }, { setObjective: text }, { banner: text }, { toast: text, seconds },
 *         { fx: name }, { sfx: name }, { win: true }, { lose: reason }, { score: n }, { teleport: [x,y,z] },
 *         { set: {var: value} }, { add: {var: n} }, { lava: seconds }, { emit: eventName }]   (each may have delay: s)
 * Example: every 5 coins the floor is lava for 3 s:
 *   Mechanics.rule(game, { name: 'Lava floor', when: 'collect', tag: 'coin', every: 5, do: [{ lava: 3 }] })
 */
export function rule(game, spec = {}) {
  const m = M(game);
  const when = String(spec.when || '').toLowerCase();
  if (!TRIGGERS.includes(when)) throw new Error(`Mechanics.rule: unknown trigger when:"${spec.when}"; triggers: ${list(TRIGGERS)}`);
  const effects = [].concat(spec.do || spec.then || []);
  if (!effects.length) throw new Error('Mechanics.rule: do: [...] needs at least one effect, e.g. do: [{ banner: "Vault open!" }, { open: "vault" }]');
  for (const e of effects) validateEffect(e);
  const r = { ...spec, when, effects, fired: 0, count: 0, t: 0, was: false, done: false };
  r.fire = (ctx = {}) => {
    if (r.done) return;
    r.fired++; if (spec.once) r.done = true;
    // one toast per firing: the rule's own text, unless an effect shows its own (lava / toast)
    if (spec.text && !effects.some(e => 'lava' in e || 'toast' in e)) game.emit('rule', { name: spec.name || 'Rule', text: spec.text, seconds: spec.seconds || 3, silent: !!spec.silent });
    for (const e of effects) runEffect(game, e, ctx);
  };
  if (when === 'collect') r.onCollect = (it) => { if (spec.tag && it.tag !== spec.tag && !(spec.tag === 'powerup' && it.powerup)) return; r.count++; if (!spec.every || r.count % spec.every === 0) r.fire({ item: it }); };
  if (when === 'defeat') r.onDefeat = (who) => {
    if (!who || who === player0(game) || who.kind === undefined) return;
    if (spec.kind && who.kind !== spec.kind) return;
    const R = game.__rules;
    if (spec.all) { const left = R.enemies.filter(e => e.alive && (!spec.kind || e.kind === spec.kind)).length; if (left === 0) r.fire({ enemy: who }); }
    else r.fire({ enemy: who });
  };
  if (when === 'enter') { r.pos = spec.position ? vec(spec.position, 'rule.position') : null; if (!r.pos && !spec.id) throw new Error('Mechanics.rule: when:"enter" needs position: [x,y,z] (and radius) or id of a zone'); }
  if (when === 'count' && !spec.var) throw new Error('Mechanics.rule: when:"count" needs var: "name" and gte / eq');
  if (when === 'state' && !spec.key) throw new Error('Mechanics.rule: when:"state" needs key (a game.state key, e.g. "collected") and gte / lte / eq');
  m.rules.push(r);
  if (when === 'start') setTimeoutGame(game, 0.05, () => r.fire());
  return r;
}
function validateEffect(e) {
  if (!e || typeof e !== 'object') throw new Error(`Mechanics.rule: each effect must be an object like { banner: "Hi" }; effects: ${list(EFFECTS)}`);
  const k = Object.keys(e).filter(x => x !== 'delay' && x !== 'at' && x !== 'count' && x !== 'seconds' && x !== 'duration' && x !== 'to');
  if (!k.length || !EFFECTS.includes(k[0])) throw new Error(`Mechanics.rule: unknown effect ${JSON.stringify(e)}; effects: ${list(EFFECTS)}`);
}
function cmp(v, spec) { return (spec.gte === undefined || v >= spec.gte) && (spec.lte === undefined || v <= spec.lte) && (spec.eq === undefined || v === spec.eq); }

function runEffect(game, e, ctx) {
  if (e.delay) { const d = e.delay; const e2 = { ...e }; delete e2.delay; setTimeoutGame(game, d, () => runEffect(game, e2, ctx)); return; }
  const m = M(game), pl = player0(game), R = game.__rules, S = game.state;
  const at = () => {
    if (!e.at || e.at === 'player') return pl.position.clone().add(V3((Math.random() - 0.5) * 4, 1.1, (Math.random() - 0.5) * 4));
    if (e.at === 'route') return routeSpots(game, 1, 0.2 + Math.random() * 0.6)[0];
    return vec(e.at, 'effect.at');
  };
  if ('spawn' in e) {
    const what = String(e.spawn), n = e.count || 1;
    for (let i = 0; i < n; i++) {
      const p = at();
      if (what.startsWith('enemy')) R.addEnemy(what.split(':')[1] || 'chase', p.setY(p.y - 1.1));
      else if (POWERUPS.includes(what)) powerup(game, { type: what, position: p.setY(p.y - 1.1) });
      else R.addCollectible(p, what);
    }
  }
  if ('give' in e) {
    const g = String(e.give);
    if (g.startsWith('key:')) giveKey(game, pl, g.slice(4));
    else if (g === 'life') { if (Number.isFinite(S.lives)) S.lives++; game.emit('state', S); }
    else give(game, pl, g, e.duration);
  }
  if ('tune' in e) tune(pl, e.tune, e.seconds || 0);
  if ('open' in e) toggleId(game, e.open, true);
  if ('close' in e) toggleId(game, e.close, false);
  if ('toggle' in e) toggleId(game, e.toggle);
  if ('setObjective' in e) { S.objective = String(e.setObjective); game.__objectiveOverride = S.objective; game.emit('state', S); }
  if ('banner' in e) game.emit('mechanic', { name: String(e.banner), text: String(e.banner) });
  if ('toast' in e) game.emit('rule', { name: String(e.toast), text: String(e.toast), seconds: e.seconds || 3 });
  if ('fx' in e) game.emit('fx', String(e.fx), pl.position.clone());
  if ('sfx' in e) game.emit('sfx', String(e.sfx));
  if ('win' in e && e.win) R.win();
  if ('lose' in e && e.lose) R.lose(typeof e.lose === 'string' ? e.lose : 'rule');
  if ('score' in e) { S.score += +e.score || 0; game.emit('state', S); }
  if ('teleport' in e) pl.teleport(vec(e.teleport, 'effect.teleport'));
  if ('set' in e) for (const [k, v] of Object.entries(e.set)) setVar(game, k, v);
  if ('add' in e) for (const [k, v] of Object.entries(e.add)) setVar(game, k, (m.vars[k] || 0) + (+v || 0));
  if ('lava' in e) { m.lavaT = Math.max(m.lavaT, +e.lava || 3); game.emit('rule', { name: 'Floor is lava', text: 'FLOOR IS LAVA!', seconds: m.lavaT }); }
  if ('emit' in e) game.emit(String(e.emit), ctx);
}

/** Mechanics.var(game, name) -> value; Mechanics.var(game, name, value) sets it (game.state.vars mirrors them) */
export function variable(game, name, value) { if (value === undefined) return M(game).vars[name]; setVar(game, name, value); return value; }
export { variable as var };
function setVar(game, k, v) {
  const m = M(game); m.vars[k] = v; game.emit('state', game.state);
  for (const r of m.rules) if (r.when === 'count' && r.var === k) { const ok = cmp(v, r); if (ok && !r.was) r.fire({ var: k, value: v }); r.was = ok; }
}

// ---- 5) custom mechanics (sandboxed) -----------------------------------------------------------------------------------

/**
 * Mechanics.custom(game, { name, text, init(ctx), update(dt, ctx), onEvent: { collect(ctx, item), death(ctx, who), ... } })
 * Model-written code runs inside try/catch: an error is reported once and the mechanic switches itself off after 3 errors,
 * so it can never crash the game. ctx: { game, player, level, state, vars, time, rand(), spawn(type, pos), give(type, s),
 * tune(opts, s), banner(text), toast(text, s), emit(name, ...), win(), lose(reason), V3(x,y,z), dist(a, b), enemies, items }
 */
export function custom(game, spec = {}) {
  if (!spec || (typeof spec.update !== 'function' && typeof spec.init !== 'function' && !spec.onEvent)) throw new Error('Mechanics.custom(game, { name, update(dt, ctx), onEvent: {...} }): give at least update, init or onEvent');
  const m = M(game), R = game.__rules;
  const c = { name: spec.name || 'custom', errors: 0, off: false };
  const ctx = {
    game, get player() { return player0(game); }, get level() { return game.__level || game.level; }, get state() { return game.state; }, vars: m.vars,
    get time() { return game.time; }, rand: () => game.rand(), V3, THREE,
    dist: (a, b) => (a.position || a).distanceTo(b.position || b),
    get enemies() { return R ? R.enemies : []; }, get items() { return R ? R.items : []; },
    spawn: (type, pos) => runEffect(game, { spawn: type, at: pos ? (pos.isVector3 ? pos.toArray() : pos) : 'player' }, {}),
    give: (type, s) => give(game, player0(game), type, s), tune: (o, s) => tune(player0(game), o, s),
    banner: (t) => game.emit('mechanic', { name: String(t), text: String(t) }), toast: (t, s = 3) => game.emit('rule', { name: c.name, text: String(t), seconds: s }),
    emit: (...a) => game.emit(...a), win: () => R && R.win(), lose: (why) => R && R.lose(why || c.name), setVar: (k, v) => setVar(game, k, v),
  };
  const safe = (fn, ...args) => {
    if (c.off) return;
    try { return fn(...args); } catch (err) {
      c.errors++; console.warn(`[kit] Mechanics.custom "${c.name}" error ${c.errors}/3:`, err && err.message);
      if (c.errors >= 3) { c.off = true; console.warn(`[kit] Mechanics.custom "${c.name}" switched off`); }
    }
  };
  if (spec.text || spec.name) game.emit('mechanic', { name: spec.name || 'Mechanic', text: spec.text || spec.name });
  if (spec.init) safe(spec.init, ctx);
  if (spec.update) c.update = (dt) => safe(spec.update, dt, ctx);
  if (spec.onEvent) for (const [ev, fn] of Object.entries(spec.onEvent)) if (typeof fn === 'function') game.on(ev, (...a) => safe(fn, ctx, ...a));
  m.customs.push(c);
  return c;
}

// ---- per-frame ------------------------------------------------------------------------------------------------------

function giveKey(game, pl, color) {
  const m = M(game); m.keys.push(color); game.state.keys = m.keys;
  game.emit('key', pl, { color }); game.emit('state', game.state);
}
function onCollect(game, it, by) {
  const m = M(game);
  if (it.powerup) give(game, by || player0(game), it.powerup, it.duration);
  if (it.keyColor) giveKey(game, by || player0(game), it.keyColor);
  for (const r of m.rules) if (r.when === 'collect' && r.onCollect) r.onCollect(it);
}

function tick(game, dt, t) {
  const m = M(game), pl = player0(game); if (!pl || dt <= 0) return;
  const S = game.state, c = pl.center || pl.position;
  // timers (game time)
  if (m.timers) for (let i = m.timers.length - 1; i >= 0; i--) { const tm = m.timers[i]; tm.t -= dt; if (tm.t <= 0) { m.timers.splice(i, 1); try { tm.fn(); } catch (e) { console.warn('[kit] Mechanics timer', e); } } }
  // power-ups: count down, end, keep game.state.powerups for the HUD
  const pu = {};
  for (const [type, a] of Object.entries(m.active)) {
    a.t -= type === 'slowmo' ? dt / Math.max(0.1, game.timeScale) : dt;
    if (type === 'invincible' && pl.character) { const h = (t * 2) % 1; pl.character.object.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.emissive) { o.material.emissive.setHSL(h, 1, 0.5); o.material.emissiveIntensity = 0.6; } }); }
    if (a.t <= 0) { a.end(); delete m.active[type]; game.emit('powerupEnd', a.player, { type: UI_TYPE[type] || type }); if (type === 'invincible' && pl.character) pl.character.object.traverse(o => { if (o.isMesh && o.material && o.material.emissive) o.material.emissiveIntensity = 0; }); }
    else pu[UI_TYPE[type] || type] = +a.t.toFixed(1);
  }
  S.powerups = pu;
  // lava floor (rule effect): standing on static ground hurts; movers and jumping are safe
  if (m.lavaT > 0) {
    m.lavaT -= dt;
    if (!m.lavaVis) { m.lavaVis = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false })); m.lavaVis.rotation.x = -Math.PI / 2; m.lavaVis.userData.noCollide = true; m.root.add(m.lavaVis); }
    m.lavaVis.visible = true; m.lavaVis.position.set(pl.position.x, (pl.__groundY ?? pl.position.y) + 0.06, pl.position.z); m.lavaVis.material.opacity = 0.3 + 0.15 * Math.sin(t * 10);
    if (pl.grounded) { m.lavaGround = (m.lavaGround || 0) + dt; if (m.lavaGround > 0.25 && game.__rules) { m.lavaGround = 0; game.__rules.hurtPlayer(pl, pl.position.clone().add(V3(0, -1, 0)), 1, { type: 'lava' }); } } else m.lavaGround = 0;
    if (m.lavaT <= 0 && m.lavaVis) m.lavaVis.visible = false;
  }
  if (pl.grounded) pl.__groundY = pl.position.y;
  // interactables
  let promptText = null;
  for (const o of m.things) {
    const d = c.distanceTo(o.position.clone().add(V3(0, 0.9, 0))), dh = Math.hypot(c.x - o.position.x, c.z - o.position.z);
    switch (o.kind) {
      case 'door': {
        o.slide += ((o.open ? 1 : 0) - o.slide) * Math.min(1, dt * 4);
        o.panel.position.y = o.height / 2 + o.slide * (o.height + 0.2); o.panel.visible = o.slide < 0.98;
        if (!o.open && dh < o.width / 2 + 1.6 && Math.abs(c.y - o.position.y - 1) < 3) {
          if (o.color) {
            const k = m.keys.indexOf(o.color);
            if (k >= 0) { m.keys.splice(k, 1); game.emit('keyUsed', pl, { color: o.color }); o.setOpen(true); game.emit('state', S); }
            else { promptText = `Locked: needs the ${o.color} key`; if (!o.toldT || t - o.toldT > 3) { o.toldT = t; game.emit('door', o, { locked: true, color: o.color }); } }
          }
        }
        break;
      }
      case 'switch': {
        o.cool -= dt;
        if (dh < 1.4 && Math.abs(c.y - o.position.y - 0.9) < 1.6 && o.cool <= 0 && !(o.once && o.on)) { o.cool = 1.2; o.set(!o.on); }
        if (dh < 3 && !o.on) promptText = promptText || 'Flip the switch';
        break;
      }
      case 'plate': o.set(dh < 1.2 && Math.abs(pl.position.y - o.position.y) < 0.8); break;
      case 'platform': o.mesh.material.opacity = o.solid ? 1 : 0.25 + 0.1 * Math.sin(t * 4); break;
      case 'teleporter': {
        o.cool -= dt; o.a.rotation.y += dt; o.b.rotation.y -= dt;
        if (o.cool <= 0) {
          const da = Math.hypot(c.x - o.position.x, c.z - o.position.z), db = Math.hypot(c.x - o.to.x, c.z - o.to.z);
          if (da < 1.1 && Math.abs(pl.position.y - o.position.y) < 1.2) { o.cool = 1.2; pl.teleport(o.to.clone().add(V3(0, 0.2, 0))); game.emit('teleport', pl, o); }
          else if (o.twoWay && db < 1.1 && Math.abs(pl.position.y - o.to.y) < 1.2) { o.cool = 1.2; pl.teleport(o.position.clone().add(V3(0, 0.2, 0))); game.emit('teleport', pl, o); }
        }
        break;
      }
      case 'conveyor': case 'zone': {
        const rel = c.clone().sub(o.position), inside = Math.abs(rel.x) < o.size.x / 2 && Math.abs(rel.z) < o.size.z / 2 && rel.y > -0.5 && rel.y < (o.kind === 'zone' ? o.size.y : 2.2);
        if (o.kind === 'conveyor' && inside && pl.grounded) pl.addVelocity({ x: o.dir.x * o.speed * dt * 8, z: o.dir.z * o.speed * dt * 8 });
        if (o.kind === 'zone') {
          if (inside && !o.inside) { o.inside = true; if (o.gravity !== undefined) o.revert = tune(pl, { gravity: o.gravity }); }
          else if (!inside && o.inside) { o.inside = false; if (o.revert) { o.revert(); o.revert = null; } }
          if (inside && o.lift && pl.velocity.y < 10) pl.addVelocity({ y: o.lift * dt });
          for (const r of m.rules) if (r.when === 'enter' && r.id === o.id && inside && !r.was) r.fire({ zone: o });
          for (const r of m.rules) if (r.when === 'enter' && r.id === o.id) r.was = inside;
        }
        break;
      }
      case 'shrine': if (!o.lit && dh < 2.5) { o.lit = true; o.orb.material.emissiveIntensity = 2; game.emit('checkpoint', { position: o.position, shrine: true }); } o.orb.position.y = 1.9 + Math.sin(t * 2) * 0.1; break;
      case 'crate': {
        if (o.broken) break;
        const hit = (dh < 1.6 && (pl.mode === 'dash' || pl.mode === 'pound')) || (dh < 1.3 && pl.velocity.y < -2 && pl.position.y > o.position.y + 1.1);
        if (hit) {
          o.broken = true; Physics.removeColliders(game, [o.collider]); m.root.remove(o.mesh);
          if (game.__rules && game.__rules.burst) game.__rules.burst(o.mesh.position.clone(), '#b07a45', 12, 5);
          for (let i = 0; i < o.count; i++) { const p = o.position.clone().add(V3(Math.cos(i * 2.1) * 1.4, 1.1, Math.sin(i * 2.1) * 1.4)); if (POWERUPS.includes(o.drops)) powerup(game, { type: o.drops, position: p.setY(o.position.y) }); else game.__rules.addCollectible(p, o.drops); }
          if (pl.mode === 'pound' || pl.velocity.y < 0) pl.bounce(12);
          game.emit('crate', o);
        }
        break;
      }
      case 'shop': {
        o.cool -= dt;
        if (dh < 3 && o.cool <= 0) {
          o.cool = 4;
          if (S.score >= o.price) { S.score -= o.price; give(game, pl, o.sells); if (o.npc) o.npc.say(`Pleasure! Enjoy the ${POWERUP_INFO[o.sells].label.toLowerCase()}`, 3); game.emit('state', S); }
          else if (o.npc) o.npc.say(`${POWERUP_INFO[o.sells].label} costs ${o.price} points. Come back richer!`, 3);
        }
        break;
      }
    }
  }
  prompt(game, promptText);
  // rules: timers, enter-by-position, state watches
  for (const r of m.rules) {
    if (r.done) continue;
    if (r.when === 'timer') { r.t += dt; if (r.after && !r.fired && r.t >= r.after) r.fire(); if (r.every && r.t >= r.every) { r.t = 0; r.fire(); } }
    else if (r.when === 'enter' && r.pos) { const inside = c.distanceTo(r.pos) < (r.radius || 2.5); if (inside && !r.was) r.fire(); r.was = inside; }
    else if (r.when === 'state') { const ok = cmp(S[r.key], r); if (ok && !r.was) r.fire({ key: r.key }); r.was = ok; }
  }
  if (game.__objectiveOverride) S.objective = game.__objectiveOverride;
  for (const cst of m.customs) if (cst.update) cst.update(dt);
}

// ---- 6) autopilot: keys before doors, switches before switch-doors -----------------------------------------------------

function botTarget(game, pl, goal) {
  const m = M(game);
  if (!goal) return null;
  // the closed door nearest the bot's path to its goal
  const doors = m.things.filter(o => o.kind === 'door' && !o.open);
  if (!doors.length) return null;
  const p = pl.position;
  const blocking = doors.filter(d => segDist2D(d.position, p, goal) < d.width / 2 + 4 || d.position.distanceTo(goal) < p.distanceTo(goal) + 2)
    .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
  if (!blocking) return null;
  if (blocking.color) {
    if (m.keys.includes(blocking.color)) return blocking.position.clone().addScaledVector(blocking.fwd.clone().multiplyScalar(Math.sign(p.clone().sub(blocking.position).dot(blocking.fwd)) || 1), 1.2);
    const key = m.things.find(o => o.kind === 'key' && o.color === blocking.color && !o.item.collected);
    return key ? key.item.home : null;
  }
  // a switch (or plate) that opens it
  const sw = m.things.find(o => (o.kind === 'switch' || o.kind === 'plate') && o.targets.includes(blocking.id) && !o.on);
  return sw ? sw.position.clone() : null;
}
function segDist2D(pt, a, b) {
  const ab = V3(b.x - a.x, 0, b.z - a.z), t = THREE.MathUtils.clamp(V3(pt.x - a.x, 0, pt.z - a.z).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
  return Math.hypot(pt.x - (a.x + ab.x * t), pt.z - (a.z + ab.z * t));
}

/** Everything placed so far by id (doors, switches, keys, ...) */
export function get(game, id) { return M(game).byId.get(id) || null; }
