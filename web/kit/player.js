// player.js: Player.create(game, opts) -> controllers (platformer, kart, boat, topdown, fps) + procedural character.
// See CONTRACT.md and docs/Player.md. Numbers: units are metres-ish, the character is 1.8 tall.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as Physics from './physics.js';
import * as Look from './look.js';

export const TYPES = ['platformer', 'kart', 'boat', 'topdown', 'fps'];

// Feel presets. Speeds u/s, accelerations u/s^2, times s. Every key can be overridden: Player.create(game, {tuning: {...}}).
export const TUNING = {
  platformer: {
    runSpeed: 12, accel: 70, turnAccel: 140, decel: 60, airAccel: 32, airDecel: 6,
    jumpHeight: 4.5, doubleJumpHeight: 3.2, jumps: 2, riseGravity: 34, fallGravity: 58, cutGravity: 80, maxFall: 45,
    coyote: 0.12, buffer: 0.14, dash: true, dashSpeed: 24, dashTime: 0.18, dashCooldown: 0.45,
    longJump: { speed: 21, up: 12 }, groundPound: true, turnRate: 16, stepHeight: 0.55, maxSlope: 50,
  },
  topdown: {
    runSpeed: 10, accel: 90, turnAccel: 160, decel: 90, airAccel: 40, airDecel: 10,
    jumpHeight: 2.2, doubleJumpHeight: 0, jumps: 1, riseGravity: 40, fallGravity: 60, cutGravity: 80, maxFall: 45,
    coyote: 0.1, buffer: 0.12, dash: true, dashSpeed: 30, dashTime: 0.16, dashCooldown: 0.5,
    longJump: null, groundPound: false, turnRate: 20, stepHeight: 0.55, maxSlope: 50,
  },
  fps: {
    runSpeed: 9, sprintSpeed: 14, accel: 80, turnAccel: 120, decel: 70, airAccel: 22, airDecel: 2,
    jumpHeight: 1.8, doubleJumpHeight: 0, jumps: 1, riseGravity: 30, fallGravity: 44, cutGravity: 60, maxFall: 45,
    coyote: 0.1, buffer: 0.12, dash: false, longJump: null, groundPound: false, turnRate: 0, stepHeight: 0.5, maxSlope: 50,
    lookSpeed: 0.0022, keyTurn: 2.4,
  },
  kart: {
    maxSpeed: 32, accel: 34, brake: 55, reverse: 10, coast: 0.25, grip: 9, driftGrip: 2.0,
    steerLow: 2.7, steerHigh: 1.7, steerFull: 8, steerResponse: 10, airSteer: 0.4, gravity: 42, hop: 6.5,
    drift: { minSpeed: 12, steerMin: 0.35, steerMax: 1.3, tiers: [0.6, 1.3, 2.2], boosts: [0.55, 1.0, 1.6],
      colors: ['#6fd3ff', '#ff9a3c', '#d07cff'] },
    boost: { speed: 1.4, accel: 60 }, wallBounce: 0.45, radius: 0.75,
  },
  boat: {
    maxSpeed: 30, accel: 22, brake: 30, reverse: 8, coast: 0.25, grip: 3.2, driftGrip: 1.0,
    steerLow: 2.4, steerHigh: 1.6, steerFull: 6, steerResponse: 6, airSteer: 0.6, gravity: 34, hop: 7,
    drift: { minSpeed: 10, steerMin: 0.4, steerMax: 1.35, tiers: [0.7, 1.5, 2.4], boosts: [0.6, 1.0, 1.5],
      colors: ['#6fffe9', '#ff6fd8', '#ffffff'] },
    boost: { speed: 1.35, accel: 50 }, wallBounce: 0.5, radius: 0.9, float: 0.25, buoyancy: 60, landDrag: 2.5,
  },
};

// ---- input ---------------------------------------------------------------------------------------------------------

const KEYS = new Set();
let inputInstalled = false;
const mouse = { dx: 0, dy: 0, down: false, locked: false, clicked: false };
function installInput(game) {
  if (inputInstalled) return;
  inputInstalled = true;
  const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  window.addEventListener('keydown', e => { KEYS.add(e.code); if (block.has(e.code)) e.preventDefault(); });
  window.addEventListener('keyup', e => KEYS.delete(e.code));
  window.addEventListener('blur', () => KEYS.clear());
  const el = game.renderer.domElement;
  el.addEventListener('mousedown', () => { mouse.down = true; mouse.clicked = true; });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  window.addEventListener('mousemove', e => {
    if (mouse.locked || mouse.down) { mouse.dx += e.movementX || 0; mouse.dy += e.movementY || 0; }
  });
  document.addEventListener('pointerlockchange', () => { mouse.locked = document.pointerLockElement === el; });
}
const any = (...codes) => codes.some(c => KEYS.has(c));
function pad() {
  try { const g = navigator.getGamepads && navigator.getGamepads(); return g && [...g].find(x => x && x.connected) || null; } catch (e) { return null; }
}
function dz(v) { return Math.abs(v) < 0.18 ? 0 : v; }
export function readKeys() {
  let x = (any('KeyD', 'ArrowRight') ? 1 : 0) - (any('KeyA', 'ArrowLeft') ? 1 : 0);
  let y = (any('KeyW', 'ArrowUp') ? 1 : 0) - (any('KeyS', 'ArrowDown') ? 1 : 0);
  let jump = any('Space'), action = any('ShiftLeft', 'ShiftRight', 'KeyE', 'KeyJ'), pound = any('KeyC', 'ControlLeft', 'KeyK');
  const gp = pad();
  let lookX = 0, lookY = 0;
  if (gp) {
    const ax = dz(gp.axes[0] || 0), ay = dz(gp.axes[1] || 0);
    if (Math.abs(ax) > Math.abs(x)) x = ax;
    if (Math.abs(ay) > Math.abs(y)) y = -ay;
    const b = i => gp.buttons[i] && gp.buttons[i].pressed;
    jump = jump || b(0); action = action || b(2) || b(5) || b(7); pound = pound || b(1) || b(6);
    lookX = dz(gp.axes[2] || 0); lookY = dz(gp.axes[3] || 0);
  }
  return { x, y, jump, action, pound, lookX, lookY };
}
export function keyDown(code) { return KEYS.has(code); }
export { mouse as _mouse };

// ---- materials -----------------------------------------------------------------------------------------------------

let gradient = null;
function toonGradient() {
  if (gradient) return gradient;
  const d = new Uint8Array([90, 170, 255]);
  gradient = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}
export function material(game, color, kind = 'toon', extra = {}) {
  if (kind === 'glow' || kind === 'emissive') return new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
  if (typeof Look.material === 'function') {
    try { const m = Look.material(game, { color, kind, side: extra.side === THREE.DoubleSide ? 'double' : undefined }); if (m) return extra.own ? m.clone() : m; } catch (e) { /* fall back */ }
  }
  if (kind === 'glass') return new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0 });
  if (kind === 'metal') return new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.3 });
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
  if (extra.side) m.side = extra.side;
  return m;
}

function shade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }

function mesh(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; }

// ---- the chibi character -----------------------------------------------------------------------------------------

const DEFAULT_COLORS = { body: '#ff7a59', skin: '#ffe0c2', accent: '#ffd23f', eyes: '#1d1b2e', limbs: null, belly: null };

/** A charming procedural character. Returns { object, setColors(colors), setEmote(name), animate(dt, state) } */
export function makeCharacter(game, colors = {}) {
  const c = { ...DEFAULT_COLORS, ...colors };
  const mats = {};
  const mk = (key, col, kind) => (mats[key] = material(game, col, kind, { own: true }));
  mk('body', c.body); mk('skin', c.skin); mk('accent', c.accent); mk('limbs', c.limbs || shade(c.body, 0.78));
  mk('belly', c.belly || '#fff4e6'); mk('eye', c.eyes, 'toon');
  mats.white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  mats.cheek = new THREE.MeshBasicMaterial({ color: '#ff8fa3', transparent: true, opacity: 0.75 });
  const root = new THREE.Group(); root.name = 'character';
  const rig = new THREE.Group(); root.add(rig);                 // squash & stretch pivot at the feet
  const body = new THREE.Group(); rig.add(body);
  const sph = (r, ws = 20, hs = 14) => new THREE.SphereGeometry(r, ws, hs);
  const torso = mesh(sph(0.4), mats.body); torso.scale.set(1, 0.92, 0.88); torso.position.y = 0.72; body.add(torso);
  const belly = mesh(sph(0.3), mats.belly, false); belly.scale.set(0.95, 0.85, 0.5); belly.position.set(0, 0.68, 0.22); body.add(belly);
  const head = new THREE.Group(); head.position.y = 1.32; body.add(head);
  const skull = mesh(sph(0.47, 28, 20), mats.skin); skull.scale.set(1.05, 0.95, 1); head.add(skull);
  // hair / cap in body colour with a little brim
  const cap = mesh(new THREE.SphereGeometry(0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), mats.body);
  cap.position.y = 0.04; cap.rotation.x = -0.18; cap.scale.set(1.06, 1, 1.04); head.add(cap);
  const brim = mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.05, 20, 1, false, -Math.PI / 2, Math.PI), mats.accent);
  brim.position.set(0, 0.17, 0.3); brim.rotation.x = 0.25; brim.scale.z = 0.9; head.add(brim);
  const eyes = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.Group(); eg.position.set(0.165 * s, 0.0, 0.41); eg.rotation.y = 0.32 * s; head.add(eg);
    const e = mesh(sph(0.075, 14, 10), mats.eye, false); e.scale.set(0.9, 1.35, 0.6); eg.add(e);
    const hl = mesh(sph(0.026, 8, 6), mats.white, false); hl.position.set(0.025, 0.04, 0.04); eg.add(hl);
    eyes.push(eg);
    const ch = mesh(sph(0.07, 12, 8), mats.cheek, false); ch.scale.set(1.2, 0.7, 0.4); ch.position.set(0.28 * s, -0.12, 0.36); ch.rotation.y = 0.6 * s; head.add(ch);
  }
  const mouth = mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 14, Math.PI), mats.eye, false);
  mouth.position.set(0, -0.13, 0.445); mouth.rotation.z = Math.PI; head.add(mouth);
  // sprout antenna with a bouncy tip (secondary motion)
  const sprout = new THREE.Group(); sprout.position.set(0, 0.42, -0.05); head.add(sprout);
  const stem = mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.26, 6), mats.limbs); stem.position.y = 0.13; sprout.add(stem);
  const tip = mesh(sph(0.085, 12, 10), mats.accent); tip.position.y = 0.28; sprout.add(tip);
  const limb = (r, len, mat) => {
    const g = new THREE.Group();
    const m = mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.position.y = -len / 2 - r * 0.3; g.add(m);
    return g;
  };
  const arms = [], legs = [], hands = [], feet = [];
  for (const s of [-1, 1]) {
    const a = limb(0.085, 0.26, mats.body); a.position.set(0.38 * s, 0.93, 0); a.rotation.z = 0.35 * s; body.add(a); arms.push(a);
    const h = mesh(sph(0.1, 12, 10), mats.skin); h.position.y = -0.4; a.add(h); hands.push(h);
    const l = limb(0.1, 0.16, mats.limbs); l.position.set(0.17 * s, 0.4, 0); body.add(l); legs.push(l);
    const f = mesh(sph(0.14, 14, 10), mats.accent); f.scale.set(0.9, 0.6, 1.35); f.position.set(0, -0.32, 0.05); l.add(f); feet.push(f);
  }
  const shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }));
  shadowBlob.rotation.x = -Math.PI / 2; shadowBlob.position.y = 0.02; shadowBlob.renderOrder = 1; root.add(shadowBlob);

  const st = { phase: 0, blinkT: 2, blink: 0, emote: 'none', emoteT: 0, squash: new THREE.Vector3(1, 1, 1), squashV: new THREE.Vector3(),
    tipV: new THREE.Vector2(), tipA: new THREE.Vector2(), lastVel: new THREE.Vector3(), lean: 0, airPose: 0, flip: 0 };
  const ch = {
    object: root, rig, body, head, arms, legs, eyes, sprout, mats, shadowBlob,
    setColors(cols = {}) {
      const set = (k, v) => { if (v && mats[k] && mats[k].color) mats[k].color.set(v); };
      set('body', cols.body); set('skin', cols.skin); set('accent', cols.accent); set('eye', cols.eyes); set('belly', cols.belly);
      set('limbs', cols.limbs || (cols.body && shade(cols.body, 0.78)));
    },
    setEmote(name = 'none', seconds = 2) { st.emote = name; st.emoteT = seconds; },
    squash(sy) { // sy < 1 squash, > 1 stretch; volume-preserving
      st.squash.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    },
    flip() { st.flip = 1; },
    // s: {speed, vy, grounded, mode, dt, vel (world), drive}
    animate(dt, s) {
      const t = game.time;
      // squash spring back to 1
      for (const k of ['x', 'y', 'z']) {
        const f = (1 - st.squash[k]) * 260 - st.squashV[k] * 16;
        st.squashV[k] += f * dt; st.squash[k] += st.squashV[k] * dt;
      }
      rig.scale.copy(st.squash);
      // blink
      st.blinkT -= dt;
      if (st.blinkT < 0) { st.blink = 0.14; st.blinkT = 1.8 + Math.random() * 3; }
      st.blink = Math.max(0, st.blink - dt);
      let eyeY = st.blink > 0 ? 0.12 : 1;
      if (st.emote === 'happy' || st.emote === 'win') eyeY = 0.35;
      if (s.mode === 'hurt' || s.mode === 'dead') eyeY = 0.25;
      for (const e of eyes) e.scale.y += (eyeY - e.scale.y) * Math.min(1, dt * 30);
      st.emoteT -= dt; if (st.emoteT <= 0 && st.emote !== 'none') st.emote = 'none';
      const sp = s.speed || 0, run = Math.min(1, sp / 12);
      const L = (a, b, k) => a + (b - a) * Math.min(1, dt * k);
      let legA = [0, 0], armX = [0, 0], armZ = [0.35, 0.35], bob = 0, lean = 0, headX = 0, bodyY = 0;
      if (s.mode === 'drive') {
        legA = [-1.45, -1.45]; armX = [-1.15, -1.15]; armZ = [0.2, 0.2]; lean = -0.05; headX = -0.05;
        bob = Math.sin(t * 9) * 0.01 * Math.min(1, sp / 10);
      } else if (!s.grounded && s.mode !== 'dead') {
        const rising = (s.vy || 0) > 1;
        st.airPose = L(st.airPose, rising ? 1 : -1, 8);
        legA = [-0.7, 0.45]; armX = [rising ? -2.6 : -0.6, rising ? -2.6 : -0.6];
        armZ = rising ? [0.25, 0.25] : [1.2 + Math.sin(t * 22) * 0.2, 1.2 + Math.sin(t * 22 + 1) * 0.2];
        lean = s.mode === 'dash' ? 0.9 : 0.15; headX = rising ? -0.15 : 0.1;
        if (s.mode === 'pound') { legA = [-1.6, -1.6]; armX = [-1.4, -1.4]; armZ = [0.5, 0.5]; lean = 0.3; }
        if (s.mode === 'dash') { armX = [1.2, 1.2]; armZ = [0.5, 0.5]; legA = [0.5, 0.7]; }
      } else if (sp > 0.5) {
        st.phase += dt * (4 + sp * 0.95);
        const ph = st.phase, amp = 0.35 + 0.65 * run;
        legA = [Math.sin(ph) * 1.0 * amp, -Math.sin(ph) * 1.0 * amp];
        armX = [-Math.sin(ph) * 1.1 * amp, Math.sin(ph) * 1.1 * amp];
        armZ = [0.25 + run * 0.15, 0.25 + run * 0.15];
        bob = Math.abs(Math.sin(ph)) * 0.09 * amp; lean = 0.08 + run * 0.22; headX = -run * 0.12;
        if (s.mode === 'dash') { lean = 0.75; armX = [1.3, 1.3]; }
      } else {
        // idle: breathe, sway, look around
        const br = Math.sin(t * 2.2);
        armZ = [0.3 + br * 0.05, 0.3 + br * 0.05]; bob = br * 0.012; headX = Math.sin(t * 0.7) * 0.05;
        bodyY = Math.sin(t * 0.45) * 0.12;
      }
      if (st.emote === 'wave') { armX[1] = -2.7; armZ[1] = -0.3 + Math.sin(t * 14) * 0.35; }
      if (st.emote === 'happy' || st.emote === 'win') { armX = [-2.8, -2.8]; armZ = [-0.2 + Math.sin(t * 12) * 0.2, -0.2 - Math.sin(t * 12) * 0.2]; bob += Math.abs(Math.sin(t * 9)) * 0.25; }
      if (st.emote === 'sad') { headX = 0.35; armZ = [0.1, 0.1]; }
      for (let i = 0; i < 2; i++) {
        const sgn = i === 0 ? -1 : 1;
        legs[i].rotation.x = L(legs[i].rotation.x, legA[i], 18);
        arms[i].rotation.x = L(arms[i].rotation.x, armX[i], 16);
        arms[i].rotation.z = L(arms[i].rotation.z, armZ[i] * sgn, 16);
      }
      st.lean = L(st.lean, lean, 10);
      body.rotation.x = st.lean;
      body.position.y = bob;
      head.rotation.x = L(head.rotation.x, headX, 8);
      head.rotation.y = L(head.rotation.y, bodyY, 4);
      // front flip on double jump
      if (st.flip > 0) { st.flip = Math.max(0, st.flip - dt * 2.6); body.rotation.x += (1 - st.flip) * Math.PI * 2; if (st.flip === 0) body.rotation.x = st.lean; }
      // sprout tip lags behind accelerations
      if (s.vel) {
        const ax = (s.vel.x - st.lastVel.x) / Math.max(dt, 1e-3), ay = (s.vel.y - st.lastVel.y) / Math.max(dt, 1e-3);
        st.lastVel.copy(s.vel);
        st.tipA.x += (-ay * 0.004 - st.tipA.x * 90 - st.tipV.x * 7) * dt * 0 ; // keep vertical simple
        const target = THREE.MathUtils.clamp(-ay * 0.006, -0.6, 0.6) + THREE.MathUtils.clamp(sp * 0.02, 0, 0.35);
        st.tipV.x += ((target - sprout.rotation.x) * 180 - st.tipV.x * 9) * dt;
        sprout.rotation.x += st.tipV.x * dt;
        void ax;
      }
      // blob shadow shrinks with height above ground
      const h = s.heightAbove || 0;
      shadowBlob.position.y = 0.02 - h; shadowBlob.scale.setScalar(Math.max(0.3, 1 - h * 0.08));
      shadowBlob.material.opacity = 0.22 * Math.max(0.2, 1 - h * 0.1);
    },
  };
  return ch;
}

// ---- vehicle models ----------------------------------------------------------------------------------------------

function makeKart(game, c) {
  const g = new THREE.Group(); g.name = 'kart';
  const body = material(game, c.kart || c.body), dark = material(game, '#2a2733'), trim = material(game, c.accent), metal = material(game, '#c9ccd6', 'metal');
  const chassis = mesh(new RoundedBoxGeometry(1.5, 0.42, 2.3, 3, 0.16), body); chassis.position.y = 0.42; g.add(chassis);
  const nose = mesh(new RoundedBoxGeometry(1.1, 0.3, 0.8, 3, 0.13), body); nose.position.set(0, 0.5, 1.15); nose.rotation.x = 0.12; g.add(nose);
  const bumper = mesh(new RoundedBoxGeometry(1.6, 0.2, 0.3, 2, 0.08), dark); bumper.position.set(0, 0.33, 1.5); g.add(bumper);
  const stripe = mesh(new THREE.BoxGeometry(0.28, 0.02, 2.2), trim, false); stripe.position.set(0, 0.64, 0.05); g.add(stripe);
  const seat = mesh(new RoundedBoxGeometry(0.8, 0.5, 0.25, 2, 0.1), dark); seat.position.set(0, 0.85, -0.55); seat.rotation.x = -0.25; g.add(seat);
  const sw = mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 16), dark); sw.position.set(0, 0.98, 0.45); sw.rotation.x = -0.9; g.add(sw);
  const spoiler = mesh(new RoundedBoxGeometry(1.5, 0.08, 0.38, 2, 0.03), trim); spoiler.position.set(0, 1.05, -1.1); g.add(spoiler);
  for (const s of [-1, 1]) { const st = mesh(new THREE.BoxGeometry(0.06, 0.4, 0.12), dark); st.position.set(0.5 * s, 0.85, -1.05); g.add(st); }
  const flames = [];
  for (const s of [-1, 1]) {
    const pipe = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 10), metal); pipe.rotation.x = Math.PI / 2; pipe.position.set(0.32 * s, 0.5, -1.25); g.add(pipe);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 10), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, toneMapped: false }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(0.32 * s, 0.5, -1.75); fl.visible = false; g.add(fl); flames.push(fl);
  }
  const wheels = [], steerers = [];
  const wgeo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 18); wgeo.rotateZ(Math.PI / 2);
  const hgeo = new THREE.CylinderGeometry(0.16, 0.16, 0.32, 10); hgeo.rotateZ(Math.PI / 2);
  for (const [x, z, front] of [[-0.82, 0.8, 1], [0.82, 0.8, 1], [-0.82, -0.8, 0], [0.82, -0.8, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.34, z); g.add(pivot);
    const w = new THREE.Group(); pivot.add(w);
    w.add(mesh(wgeo, dark)); w.add(mesh(hgeo, trim, false));
    wheels.push(w); if (front) steerers.push(pivot);
  }
  return { group: g, wheels, steerers, flames, seat: new THREE.Vector3(0, 0.62, -0.38), wheelR: 0.34 };
}

function makeBoat(game, c) {
  const g = new THREE.Group(); g.name = 'boat';
  const geo = new THREE.BoxGeometry(1.6, 0.6, 3.2, 6, 3, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (z + 1.6) / 3.2;                       // 0 stern .. 1 bow
    if (t > 0.45) x *= 1 - Math.pow((t - 0.45) / 0.55, 1.6) * 0.92;
    if (y < 0) { x *= 0.62; y += Math.pow(t, 3) * 0.45; }
    if (y > 0 && t > 0.6) y -= (t - 0.6) * 0.25;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const hull = mesh(geo, material(game, c.boat || c.body)); hull.position.y = 0.3; g.add(hull);
  const deck = mesh(new RoundedBoxGeometry(1.1, 0.12, 1.6, 2, 0.05), material(game, '#fff4e6')); deck.position.set(0, 0.62, -0.5); g.add(deck);
  const stripe = mesh(new THREE.BoxGeometry(1.62, 0.1, 1.8), material(game, c.accent), false); stripe.position.set(0, 0.42, -0.6); g.add(stripe);
  const shield = mesh(new THREE.SphereGeometry(0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), material(game, '#9fe8ff', 'glass'), false);
  shield.scale.set(0.9, 0.55, 0.6); shield.position.set(0, 0.62, 0.45); shield.rotation.x = 0.35; g.add(shield);
  const engine = mesh(new RoundedBoxGeometry(0.7, 0.45, 0.45, 2, 0.1), material(game, '#2a2733')); engine.position.set(0, 0.7, -1.55); g.add(engine);
  const flames = [];
  const fl = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 10), new THREE.MeshBasicMaterial({ color: '#7ff6ff', transparent: true, opacity: 0.85, toneMapped: false }));
  fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0.55, -2.1); fl.visible = false; g.add(fl); flames.push(fl);
  return { group: g, wheels: [], steerers: [], flames, seat: new THREE.Vector3(0, 0.6, -0.55), wheelR: 1 };
}

// ---- sparks / wake (tiny self-contained particles so vehicles feel alive without fx.js) --------------------------

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c); return dotTex;
}
function particlePool(game, n, size) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, sizeAttenuation: true, map: dotTexture(), alphaTest: 0.05 });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; game.scene.add(pts);
  const life = new Float32Array(n), vel = new Float32Array(n * 3); let next = 0;
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -9999;
  return {
    points: pts,
    emit(p, v, color, l = 0.4) {
      const i = next; next = (next + 1) % n;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z; life[i] = l;
      tmp.set(color); col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    },
    update(dt, grav = -14) {
      for (let i = 0; i < n; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -9999; continue; }
        vel[i * 3 + 1] += grav * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}

// ---- create --------------------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const angWrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Player.create(game, { type='platformer', spawn: Vector3 (feet), yaw=0, colors: {body, skin, accent, eyes, kart, boat},
 *   tuning: {...override TUNING[type]}, waterLevel (boat; default level.water.y or 0), killY, name='player', model=true })
 */
export function create(game, opts = {}) {
  if (!game || !game.world) throw new Error('Player.create(game, opts): first argument must be the game from createGame()');
  const type = opts.type || 'platformer';
  if (!TYPES.includes(type)) throw new Error(`Player.create: unknown type "${type}"; types: ${TYPES.join(', ')}`);
  installInput(game);
  const R = game.RAPIER, world = game.world;
  const tune = { ...TUNING[type], ...(opts.tuning || {}) };
  if (opts.tuning && opts.tuning.drift) tune.drift = { ...TUNING[type].drift, ...opts.tuning.drift };
  const vehicle = type === 'kart' || type === 'boat';
  const spawn = (opts.spawn && opts.spawn.isVector3) ? opts.spawn.clone() : new THREE.Vector3(...(opts.spawn || [0, 2, 0]));
  const colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) };

  // collider: capsule for characters, ball for vehicles. pos = collider centre.
  const radius = vehicle ? tune.radius : 0.42, half = vehicle ? 0 : 0.48;
  const centerH = radius + half;                         // feet -> centre
  const pos = spawn.clone().add(new THREE.Vector3(0, centerH + 0.05, 0));
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
  const collider = world.createCollider((vehicle ? R.ColliderDesc.ball(radius) : R.ColliderDesc.capsule(half, radius))
    .setCollisionGroups(Physics.GROUPS.player).setFriction(0), body);
  const kcc = world.createCharacterController(0.03);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.setMaxSlopeClimbAngle(((vehicle ? 60 : tune.maxSlope) * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle(((vehicle ? 70 : tune.maxSlope + 8) * Math.PI) / 180);
  if (!vehicle) kcc.enableAutostep(tune.stepHeight, 0.25, true);
  kcc.enableSnapToGround(vehicle ? 0.5 : 0.35);
  kcc.setSlideEnabled(true);
  try { kcc.setApplyImpulsesToDynamicBodies(true); } catch (e) { /* older rapier */ }
  const filterGroups = Physics.GROUPS.solidOnly;

  // visuals
  const object = new THREE.Group(); object.name = 'player';
  game.scene.add(object);
  const character = makeCharacter(game, colors);
  let car = null;
  if (vehicle) {
    car = type === 'kart' ? makeKart(game, colors) : makeBoat(game, colors);
    object.add(car.group);
    car.group.add(character.object);
    character.object.position.copy(car.seat);
    character.object.scale.setScalar(0.72);
    character.shadowBlob.visible = false;
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.scale.set(0.8, 1.25, 1); object.add(blob); car.blob = blob;
  } else object.add(character.object);
  if (type === 'fps' || opts.model === false) character.object.visible = false;
  object.traverse(o => { if (o.isMesh) o.userData.noCollide = true; });

  const sparks = vehicle ? particlePool(game, 260, type === 'boat' ? 0.55 : 0.32) : null;

  const p = {
    type, object, character, collider, body, controller: kcc, tuning: tune,
    position: spawn.clone(),           // feet position (live)
    center: pos,                        // collider centre (live)
    velocity: new THREE.Vector3(), yaw: opts.yaw ?? opts.spawnYaw ?? 0, grounded: false, speed: 0, alive: true,
    radius, height: centerH * 2, name: opts.name || 'player',
    controls: { enabled: true }, respawnPoint: spawn.clone(), respawnYaw: opts.yaw ?? 0,
    killY: opts.killY ?? spawn.y - 60, respawnDelay: 1.1, invulnerable: 0, boostT: 0, drifting: false, driftTier: 0,
    lookYaw: opts.yaw ?? 0, lookPitch: 0, groundNormal: new THREE.Vector3(0, 1, 0), onWater: false,
    waterLevel: opts.waterLevel ?? null, mode: 'idle', heightAbove: 0,
    _bot: null,
    setInput(x, y, jump = false, action = false, extra = {}) {
      if (x === null || x === undefined) { p._bot = null; return; }
      p._bot = { x: +x || 0, y: +y || 0, jump: !!jump, action: !!action, pound: !!extra.pound, world: !!extra.world };
    },
    teleport(at, yaw) {
      const v = at.isVector3 ? at : new THREE.Vector3(...at);
      p.position.copy(v); pos.copy(v).add(_a.set(0, centerH + 0.05, 0));
      body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      p.velocity.set(0, 0, 0); vy = 0; hv.set(0, 0, 0); skipMove = 2;
      if (yaw !== undefined && yaw !== null) { p.yaw = yaw; p.lookYaw = yaw; }
      syncVisual(0);
    },
    respawn() {
      p.alive = true; p.invulnerable = 1.2; dashT = 0; poundT = 0; p.boostT = 0; p.drifting = false;
      p.teleport(p.respawnPoint, p.respawnYaw);
      object.visible = true; object.scale.setScalar(1); character.squash(1.4);
      game.emit('respawn', p);
    },
    die(reason = 'hit') {
      if (!p.alive) return;
      p.alive = false; p.mode = 'dead'; p.deathReason = reason;
      game.emit('death', p, reason);
      deadT = 0;
    },
    // knockback + invulnerability; gameplay decides if it becomes a death
    hurt(from, power = 10) {
      if (p.invulnerable > 0 || !p.alive) return false;
      p.invulnerable = 1.2;
      const d = _a.copy(p.position).sub(from || p.position); d.y = 0; if (d.lengthSq() < 1e-4) d.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      d.normalize();
      hv.copy(d).multiplyScalar(power); vy = power * 0.9; p.grounded = false; skipGround = 0.15; character.setEmote('sad', 0.8);
      return true;
    },
    addVelocity(v) { hv.x += v.x || 0; hv.z += v.z || 0; vy += v.y || 0; if ((v.y || 0) > 0) { p.grounded = false; skipGround = 0.05; } },
    bounce(power = 18) { vy = power; jumpsUsed = 1; canDash = true; p.grounded = false; skipGround = 0.12; character.squash(1.35); },
    boost(seconds = 1, kind = 'pad') {
      p.boostT = Math.max(p.boostT, seconds);
      if (vehicle) { const f = _a.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)); const vF = hv.dot(f); if (vF < tune.maxSpeed) hv.addScaledVector(f, tune.maxSpeed * 1.1 - vF); }
      else { const f = _a.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)); hv.copy(f).multiplyScalar(tune.runSpeed * 2); }
      game.emit('boost', p, kind);
    },
    dispose() {
      game.removeUpdate(tick); game.scene.remove(object); world.removeCollider(collider, false); world.removeRigidBody(body);
      if (sparks) game.scene.remove(sparks.points);
      const a = Physics.actors(game); const i = a.indexOf(p); if (i >= 0) a.splice(i, 1);
    },
  };
  p.object.rotation.y = p.yaw;
  if (vehicle && p.waterLevel === null && game.__level && game.__level.water) p.waterLevel = game.__level.water.y ?? game.__level.water;
  if (type === 'boat' && p.waterLevel === null) p.waterLevel = 0;
  Physics.actors(game).push(p);
  if (!game.__player) game.__player = p;
  (game.__players = game.__players || []).push(p);

  // controller state
  const hv = new THREE.Vector3();      // horizontal (platformer) / full planar (vehicle) velocity
  let vy = 0, coyote = 0, buffer = 0, jumpsUsed = 0, jumpHeld = false, prevJump = false, prevAction = false, prevPound = false;
  let dashT = 0, dashCd = 0, canDash = true, poundT = 0, skipMove = 0, skipGround = 0, deadT = 0, airT = 0, cut = false;
  let steerS = 0, driftDir = 0, driftCharge = 0, hopT = 0, lastTier = 0, wallCd = 0;
  let platform = null, fallStartY = pos.y;
  const carry = new THREE.Vector3();
  let shootClick = false;

  function readInput() {
    if (!p.controls.enabled || !p.alive) return { x: 0, y: 0, jump: false, action: false, pound: false, world: false };
    if (p._bot) return p._bot;
    return (p._read || readKeys)();
  }

  // camera-relative basis on XZ
  function camBasis() {
    const f = _b; game.camera.getWorldDirection(f); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)).negate();
    f.normalize();
    const r = _c.crossVectors(f, UP).normalize();
    return [f, r];
  }

  function moveCollider(desired, dt) {
    const cx = carry.x, cy = carry.y, cz = carry.z;
    desired.x += cx; desired.y += cy; desired.z += cz; carry.set(0, 0, 0);
    kcc.computeColliderMovement(collider, desired, R.QueryFilterFlags.EXCLUDE_SENSORS, filterGroups);
    const mv = kcc.computedMovement();
    const grounded = kcc.computedGrounded();
    let wallN = null, ceiling = false;
    for (let i = 0; i < kcc.numComputedCollisions(); i++) {
      const col = kcc.computedCollision(i);
      if (!col) continue;
      const n = col.normal1 || col.normal2; if (!n) continue;
      if (Math.abs(n.y) < 0.5) wallN = new THREE.Vector3(n.x, 0, n.z).normalize();
      else if (n.y < -0.5) ceiling = true;
    }
    pos.x += mv.x; pos.y += mv.y; pos.z += mv.z;
    body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    return { mv: { x: mv.x - cx, y: mv.y - cy, z: mv.z - cz }, grounded, wallN, ceiling };
  }

  function groundProbe() {
    return Physics.raycast(game, _a.copy(pos), _b.set(0, -1, 0), 40, { excludeCollider: collider });
  }

  function carryOnPlatform() {
    // move with the kinematic platform we stood on last frame
    if (!platform) return;
    const before = _a.copy(pos);
    const after = platform.carry(before);
    const d = after.sub(before);
    if (d.lengthSq() > 4) return;    // teleporting mover: don't fling the player
    carry.copy(d);
    p.yaw += platform.yawDelta(); p.lookYaw += type === 'fps' ? platform.yawDelta() : 0;
    skipMove = Math.max(skipMove, 0);
  }

  // --- character controllers (platformer, topdown, fps) ---
  function charStep(dt, inp) {
    const T = tune;
    const jumpPressed = inp.jump && !prevJump, actionPressed = inp.action && !prevAction, poundPressed = inp.pound && !prevPound;
    prevJump = inp.jump; prevAction = inp.action; prevPound = inp.pound; jumpHeld = inp.jump;
    // wish direction
    let wish = new THREE.Vector3();
    if (type === 'fps') {
      const f = _b.set(Math.sin(p.lookYaw), 0, Math.cos(p.lookYaw)), r = _c.crossVectors(f, UP);
      if (inp.world) wish.set(inp.x, 0, inp.y); else wish.copy(f).multiplyScalar(inp.y).addScaledVector(r, inp.x);
    } else if (inp.world) wish.set(inp.x, 0, inp.y);
    else { const [f, r] = camBasis(); wish.copy(f).multiplyScalar(inp.y).addScaledVector(r, inp.x); }
    if (wish.lengthSq() > 1) wish.normalize();
    const wl = wish.length();
    let maxS = T.runSpeed;
    if (type === 'fps' && inp.sprint) maxS = T.sprintSpeed;
    if (type === 'fps' && (actionPressed || shootClick)) {
      shootClick = false;
      const dir = new THREE.Vector3(Math.sin(p.lookYaw) * Math.cos(p.lookPitch), Math.sin(p.lookPitch), Math.cos(p.lookYaw) * Math.cos(p.lookPitch));
      game.emit('shoot', p, p.position.clone().add(new THREE.Vector3(0, 1.55, 0)), dir);
    }
    if (p.boostT > 0) maxS *= 1.5;

    coyote = p.grounded ? T.coyote : coyote - dt;
    buffer = jumpPressed ? T.buffer : buffer - dt;
    dashCd -= dt;

    if (poundT > 0) {
      // ground pound: brief hang, then slam
      poundT -= dt; hv.multiplyScalar(Math.exp(-20 * dt));
      vy = poundT > 0.1 ? 0 : -42;
    } else if (dashT > 0) {
      dashT -= dt;
      vy = Math.max(vy - 10 * dt, -2);
    } else {
      // horizontal accel
      const target = _a.copy(wish).multiplyScalar(maxS);
      const ground = p.grounded;
      let rate;
      if (wl > 0.05) rate = ground ? (hv.dot(target) < 0 ? T.turnAccel : T.accel) : T.airAccel;
      else rate = ground ? T.decel : T.airDecel;
      if (!ground && wl < 0.05) target.copy(hv);        // keep momentum in the air
      const dv = target.sub(hv); const dl = dv.length(), step = rate * dt;
      if (dl > step) dv.multiplyScalar(step / dl);
      hv.add(dv);
      // overspeed (long jump / boost) bleeds off gently, not instantly
      const hs = hv.length(); if (hs > maxS && wl > 0.05 && ground) hv.multiplyScalar(Math.max(maxS / hs, Math.exp(-6 * dt)));
      // gravity + variable jump
      let g = vy > 0 ? (jumpHeld && !cut ? T.riseGravity : T.cutGravity) : T.fallGravity;
      if (vy > 0 && !jumpHeld) cut = true;
      if (!p.grounded) vy = Math.max(vy - g * dt, -T.maxFall);
    }
    // jumps
    if (buffer > 0 && poundT <= 0) {
      if (p.grounded || coyote > 0) {
        vy = Math.sqrt(2 * T.riseGravity * T.jumpHeight); jumpsUsed = 1; buffer = 0; coyote = 0; cut = false;
        p.grounded = false; skipGround = 0.1; character.squash(1.3); game.emit('jump', p, 'jump');
      } else if (jumpsUsed < T.jumps && T.doubleJumpHeight > 0) {
        vy = Math.sqrt(2 * T.riseGravity * T.doubleJumpHeight); jumpsUsed = Math.max(2, jumpsUsed + 1); buffer = 0; cut = false; dashT = 0;
        if (wl > 0.05) { const s = Math.max(hv.length(), T.runSpeed * 0.8); hv.copy(wish).normalize().multiplyScalar(s); }
        character.squash(1.25); character.flip(); game.emit('jump', p, 'double');
      }
    }
    // dash / long jump
    if (actionPressed && T.dash && dashCd <= 0 && canDash && poundT <= 0 && type !== 'fps') {
      const f = wl > 0.05 ? wish.clone().normalize() : new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      if (p.grounded && T.longJump && hv.length() > T.runSpeed * 0.5) {
        hv.copy(f).multiplyScalar(T.longJump.speed); vy = T.longJump.up; p.grounded = false; skipGround = 0.1; jumpsUsed = T.jumps; cut = false;
        character.squash(0.8); game.emit('jump', p, 'long');
      } else {
        hv.copy(f).multiplyScalar(T.dashSpeed); dashT = T.dashTime; vy = Math.max(vy, p.grounded ? 0 : 3);
        if (!p.grounded) canDash = false;
        game.emit('dash', p);
      }
      dashCd = T.dashCooldown; p.yaw = Math.atan2(f.x, f.z);
    }
    if (poundPressed && T.groundPound && !p.grounded && poundT <= 0) { poundT = 0.28; dashT = 0; character.flip(); game.emit('pound', p); }

    // move
    if (p.grounded && vy <= 0) vy = -1.5;
    const desired = { x: hv.x * dt, y: vy * dt, z: hv.z * dt };
    const wasGrounded = p.grounded, vyBefore = vy;
    const res = moveCollider(desired, dt);
    skipGround -= dt;
    p.grounded = res.grounded && skipGround <= 0 && vy <= 0.5;
    if (res.ceiling && vy > 0) vy = 0;
    // hitting walls kills the speed into them (no sticky build-up)
    if (dt > 0) {
      const ax = res.mv.x / dt, az = res.mv.z / dt;
      if (Math.abs(ax) < Math.abs(hv.x) * 0.98) hv.x = ax;
      if (Math.abs(az) < Math.abs(hv.z) * 0.98) hv.z = az;
      if (!p.grounded && vy < 0 && res.mv.y > desired.y * 0.2 && desired.y < -0.001 && res.grounded) vy = 0;
    }
    if (!wasGrounded && p.grounded) {
      const impact = Math.max(0, -vyBefore);
      jumpsUsed = 0; canDash = true; cut = false;
      character.squash(Math.max(0.6, 1 - impact * 0.012));
      if (poundT > 0 || impact > 35) { poundT = 0; game.emit('land', p, Math.max(impact, 40), 'pound'); }
      else game.emit('land', p, impact);
      if (airT > 0.15 && fallStartY - pos.y > 25) { /* long fall: still alive, just a big land */ }
      airT = 0;
    }
    if (!p.grounded) airT += dt; else fallStartY = pos.y;
    // face movement
    if (type === 'fps') p.yaw = p.lookYaw;
    else if (hv.lengthSq() > 0.6 && (wl > 0.05 || dashT > 0)) {
      const want = Math.atan2(hv.x, hv.z);
      p.yaw += angWrap(want - p.yaw) * Math.min(1, dt * T.turnRate);
    }
    p.mode = poundT > 0 ? 'pound' : dashT > 0 ? 'dash' : p.grounded ? (hv.length() > 0.5 ? 'run' : 'idle') : 'air';
    p.velocity.set(hv.x, vy, hv.z);
  }

  // --- vehicles (kart, boat) ---
  function vehicleStep(dt, inp) {
    const T = tune;
    const driftHeld = inp.jump || inp.action;
    const driftPressed = driftHeld && !prevJump; prevJump = driftHeld;
    let throttle = inp.y, steerIn = -inp.x;            // steer + = left (yaw increases toward +x?): see below
    if (inp.world) { // world-space wish: steer toward it
      const want = Math.atan2(inp.x, inp.y), d = angWrap(want - p.yaw);
      steerIn = THREE.MathUtils.clamp(d * 2.2, -1, 1); throttle = Math.hypot(inp.x, inp.y) > 0.1 ? 1 : 0;
    }
    steerS += (steerIn - steerS) * Math.min(1, dt * T.steerResponse);
    const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    let vF = hv.dot(f), vR = hv.dot(r);
    const speed = Math.abs(vF);
    const water = type === 'boat' && p.waterLevel !== null;
    const onSurface = p.grounded || p.onWater;
    // drift: press while steering at speed -> hop, then slide with charge tiers; release to boost
    const D = T.drift;
    if (driftPressed && onSurface && hopT <= 0) {
      vy = T.hop; hopT = 0.3; p.grounded = false; p.onWater = false; skipGround = 0.12; character.squash(1.15);
      driftDir = Math.abs(steerIn) > 0.2 && speed > D.minSpeed ? Math.sign(steerIn) : 0; driftCharge = 0; lastTier = 0;
      game.emit('jump', p, 'hop');
    }
    hopT -= dt;
    if (driftHeld && driftDir === 0 && onSurface && hopT > 0.0 && Math.abs(steerIn) > 0.2 && speed > D.minSpeed) driftDir = Math.sign(steerIn);
    p.drifting = driftDir !== 0 && driftHeld && speed > D.minSpeed * 0.6;
    if (!p.drifting && driftDir !== 0) {
      // release: boost by tier
      const tier = p.driftTier;
      if (tier > 0 && driftHeld === false) p.boost(D.boosts[tier - 1], 'drift' + tier);
      driftDir = 0; driftCharge = 0; p.driftTier = 0;
    }
    let steer;
    if (p.drifting) {
      const k = (steerIn * driftDir + 1) / 2;   // 0 = counter-steer, 1 = full into the drift
      steer = driftDir * THREE.MathUtils.lerp(D.steerMin, D.steerMax, k);
      if (onSurface) driftCharge += dt * (0.6 + 0.6 * k);
      const tier = D.tiers.filter(t => driftCharge >= t).length;
      if (tier !== lastTier && tier > 0) { game.emit('drift', p, tier); lastTier = tier; }
      p.driftTier = tier;
    } else steer = steerS;
    const sf = Math.min(1, speed / T.steerFull);
    const rate = THREE.MathUtils.lerp(T.steerLow, T.steerHigh, Math.min(1, speed / T.maxSpeed)) * sf * (onSurface ? 1 : T.airSteer);
    p.yaw += steer * rate * dt * (vF >= -0.5 ? 1 : -1);
    // re-project velocity onto the new heading (this is what makes the slide)
    f.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)); r.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    vF = hv.dot(f); vR = hv.dot(r);
    const boosting = p.boostT > 0; p.boostT = Math.max(0, p.boostT - dt);
    const maxS = T.maxSpeed * (boosting ? T.boost.speed : 1);
    if (onSurface) {
      if (throttle > 0.05) {
        if (vF < maxS) { const frac = Math.max(0, vF) / maxS; vF += T.accel * (1 - frac * frac) * throttle * dt * (vF < 0 ? 2.5 : 1); }
      } else if (throttle < -0.05) {
        if (vF > 0.5) vF -= T.brake * -throttle * dt; else if (vF > -T.reverse) vF -= T.accel * 0.6 * -throttle * dt;
      }
      vF -= vF * T.coast * dt * (Math.abs(throttle) < 0.05 ? 2.2 : 1);
      if (boosting && vF < maxS) vF = Math.min(maxS, vF + T.boost.accel * dt);
      if (vF > maxS) vF += (maxS - vF) * Math.min(1, dt * 1.5);
      vR *= Math.exp(-(p.drifting ? T.driftGrip : T.grip) * dt);
      if (water && !p.onWater && p.grounded) vF -= vF * T.landDrag * dt;    // a beached boat crawls
    }
    hv.copy(f).multiplyScalar(vF).addScaledVector(r, vR);
    // vertical: ground tangent velocity so ramps launch you
    let probe = groundProbe();
    const gy = probe ? probe.point.y : -Infinity;
    if (water) {
      const wl = p.waterLevel + (typeof opts.waterHeight === 'function' ? opts.waterHeight(pos.x, pos.z, game.time) : 0);
      const floatY = wl + T.float + radius * 0.2;
      if (pos.y < floatY + 0.15 && gy < wl + 0.05) {
        p.onWater = vy < 4;
        vy += (floatY - pos.y) * T.buoyancy * dt; vy *= Math.exp(-6 * dt);
        if (!p.onWater) vy -= T.gravity * dt;
      } else { p.onWater = false; if (!p.grounded) vy -= T.gravity * dt; }
    } else if (!p.grounded) vy -= T.gravity * dt;
    if (p.grounded && probe && probe.normal.y > 0.3) {
      const n = probe.normal;
      const tangentVy = -(n.x * hv.x + n.z * hv.z) / n.y;
      vy = hopT > 0 ? vy : Math.min(tangentVy, tangentVy) - 0.5;
    }
    vy = Math.max(vy, -50);
    const desired = { x: hv.x * dt, y: vy * dt, z: hv.z * dt };
    const wasAir = !p.grounded && !p.onWater, vyBefore = vy;
    const res = moveCollider(desired, dt);
    skipGround -= dt;
    p.grounded = res.grounded && skipGround <= 0;
    if (p.grounded && vy > 0 && hopT <= 0) vy = 0;
    wallCd -= dt;
    if (res.wallN && wallCd <= 0) {
      const into = hv.dot(res.wallN);
      if (into < -2) {
        const sp0 = hv.length();
        if (-into < sp0 * 0.55) {
          // glancing hit: slide along the wall and turn the nose with it (keeps most of the speed)
          hv.addScaledVector(res.wallN, -into * (1 + T.wallBounce * 0.5)); hv.multiplyScalar(0.92);
          const along = Math.atan2(hv.x, hv.z); if (vF > 0) p.yaw += angWrap(along - p.yaw) * 0.6;
        } else { hv.addScaledVector(res.wallN, -into * (1 + T.wallBounce)); hv.multiplyScalar(0.7); }
        wallCd = 0.15;
        game.emit('bump', p, -into);
        p.drifting = false; driftDir = 0; p.driftTier = 0;
      }
    }
    if (wasAir && (p.grounded || p.onWater) && hopT <= 0.15) {
      character.squash(Math.max(0.7, 1 - Math.max(0, -vyBefore) * 0.015));
      if (-vyBefore > 6) game.emit('land', p, -vyBefore);
      landBump = Math.min(0.25, -vyBefore * 0.012);
    }
    if (probe) p.groundNormal.lerp(p.grounded ? probe.normal : UP, Math.min(1, dt * 10));
    p.speed = Math.abs(vF);
    p.mode = 'drive';
    p.velocity.set(hv.x, vy, hv.z);
    p._steerVis = p.drifting ? driftDir : steerS;
    p._vF = vF;
  }

  let landBump = 0, visRoll = 0, visPitch = 0, driftVis = 0, wheelSpin = 0;
  const qN = new THREE.Quaternion(), qY = new THREE.Quaternion(), qTilt = new THREE.Quaternion();
  function syncVisual(dt) {
    p.center.copy(pos);
    p.position.copy(pos).sub(_a.set(0, centerH, 0));
    object.position.copy(p.position);
    if (!vehicle) {
      object.rotation.set(0, p.yaw, 0);
      const g = probeCache;
      p.heightAbove = g ? Math.max(0, p.position.y - g) : 0;
      character.animate(dt, { speed: Math.hypot(p.velocity.x, p.velocity.z), vy: p.velocity.y, grounded: p.grounded, mode: p.alive ? p.mode : 'dead', vel: p.velocity, heightAbove: p.heightAbove });
      // invulnerability blink
      character.object.visible = type !== 'fps' && opts.model !== false && (p.invulnerable <= 0 || Math.floor(game.time * 20) % 2 === 0);
      return;
    }
    // vehicle: align to ground normal, roll into turns, pitch with accel, drift yaw offset, bob on water
    const dtc = Math.min(1, dt * 8);
    driftVis += ((p.drifting ? (p._steerVis || 0) * 0.42 : 0) - driftVis) * Math.min(1, dt * 6);
    qY.setFromAxisAngle(UP, p.yaw + driftVis);
    const n = p.onWater ? UP : p.groundNormal;
    qN.setFromUnitVectors(UP, n);
    const roll = -(p._steerVis || 0) * Math.min(1, p.speed / 20) * (type === 'boat' ? 0.28 : 0.1);
    visRoll += (roll - visRoll) * dtc;
    const accelPitch = (p.boostT > 0 ? -0.08 : 0) + (type === 'boat' ? -Math.min(1, p.speed / tune.maxSpeed) * 0.12 : 0);
    visPitch += (accelPitch - visPitch) * dtc;
    let bob = 0, bobRoll = 0, bobPitch = 0;
    if (type === 'boat' && p.onWater) { const t = game.time; bob = Math.sin(t * 2.3) * 0.06; bobRoll = Math.sin(t * 1.7) * 0.04; bobPitch = Math.sin(t * 2.9 + 1) * 0.03; }
    landBump *= Math.exp(-dt * 10);
    qTilt.setFromEuler(new THREE.Euler(visPitch + bobPitch - landBump * 0.5, 0, visRoll + bobRoll, 'XYZ'));
    car.group.quaternion.copy(qN).multiply(qY).multiply(qTilt);
    car.group.position.set(0, bob - landBump * 0.4 + (type === 'boat' ? 0.4 : 0), 0);
    object.rotation.set(0, 0, 0);
    wheelSpin += (p._vF || 0) * dt / car.wheelR;
    for (const w of car.wheels) w.rotation.x = wheelSpin;
    for (const s of car.steerers) s.rotation.y = (p._steerVis || 0) * 0.45;
    for (const fl of car.flames) { fl.visible = p.boostT > 0; fl.scale.set(1, 0.8 + Math.random() * 0.6, 1); }
    if (car.blob) { const g = probeCache; const h = g !== null ? Math.max(0, p.position.y - g) : 0; car.blob.position.y = 0.03 - h; car.blob.visible = !p.onWater && h < 8; }
    character.animate(dt, { speed: p.speed, vy: 0, grounded: true, mode: 'drive', vel: p.velocity });
    character.head.rotation.y = (p._steerVis || 0) * 0.35;
    // sparks and spray
    if (sparks && dt > 0) {
      const back = _a.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)), side = _b.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      if (p.drifting && (p.grounded || p.onWater)) {
        const col = p.driftTier > 0 ? tune.drift.colors[p.driftTier - 1] : (type === 'boat' ? '#e8fbff' : '#ffe9b0');
        for (const s of [-1, 1]) {
          const at = _c.copy(p.position).addScaledVector(back, 1.0).addScaledVector(side, 0.8 * s); at.y += 0.15;
          for (let i = 0; i < (p.driftTier > 0 ? 3 : 1); i++)
            sparks.emit(at, new THREE.Vector3((Math.random() - 0.5) * 4 + back.x * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 4 + back.z * 3), col, 0.25 + Math.random() * 0.2);
        }
      }
      if (type === 'boat' && p.onWater && p.speed > 4) {
        for (const s of [-1, 1]) {
          const at = _c.copy(p.position).addScaledVector(back, 1.4).addScaledVector(side, 0.7 * s); at.y = p.waterLevel + 0.1;
          sparks.emit(at, new THREE.Vector3(side.x * s * 3 + (Math.random() - 0.5), 2 + Math.random() * 2.5 * (p.speed / 30), side.z * s * 3 + (Math.random() - 0.5)), '#ffffff', 0.45);
        }
      }
      if (p.boostT > 0) for (const fl of car.flames) { fl.getWorldPosition(_c); sparks.emit(_c, new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), '#ffcf5a', 0.2); }
      sparks.update(dt);
    }
  }

  let probeCache = null, probeT = 0;
  const tick = (dt) => {
    // death: shrink + pop, then respawn
    if (!p.alive) {
      deadT += dt;
      object.scale.setScalar(Math.max(0.01, 1 - deadT * 2.5));
      object.position.y += dt * 2;
      if (deadT > p.respawnDelay && !game.state.lost && !game.state.won && p.autoRespawn !== false) p.respawn();
      return;
    }
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    if (skipMove > 0) { skipMove--; body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z }); syncVisual(dt); return; }
    const inp = readInput();
    if (type === 'fps') fpsLook(dt, inp);
    carryOnPlatform();
    if (vehicle) vehicleStep(dt, inp); else charStep(dt, inp);
    if (!vehicle && p.boostT > 0) p.boostT = Math.max(0, p.boostT - dt);
    // what are we standing on (moving platforms carry us next frame)
    probeT -= dt;
    const g = Physics.raycast(game, pos, _b.set(0, -1, 0), 60, { excludeCollider: collider });
    probeCache = g ? g.point.y : null;
    platform = p.grounded && g && g.distance < centerH + 0.4 && g.kinematic ? g.kinematic : null;
    p.groundObject = g && g.distance < centerH + 0.4 ? g.object : null;
    if (!vehicle) p.speed = Math.hypot(hv.x, hv.z);
    if (p.position.y < p.killY) p.die('fall');
    syncVisual(dt);
  };
  // FPS look: pointer lock on click, drag fallback, arrow-free (WASD move), Q/E or mouse to turn
  function fpsLook(dt, inp) {
    if (mouse.clicked) {
      mouse.clicked = false;
      if (mouse.locked) shootClick = true;
      try { if (!mouse.locked && game.renderer.domElement.requestPointerLock) game.renderer.domElement.requestPointerLock(); } catch (e) { /* headless */ }
    }
    p.lookYaw -= mouse.dx * tune.lookSpeed; p.lookPitch -= mouse.dy * tune.lookSpeed; mouse.dx = 0; mouse.dy = 0;
    const turn = (keyDown('ArrowLeft') || keyDown('KeyQ') ? 1 : 0) - (keyDown('ArrowRight') ? 1 : 0);
    p.lookYaw += turn * tune.keyTurn * dt - (inp.lookX || 0) * tune.keyTurn * dt;
    p.lookPitch -= (inp.lookY || 0) * tune.keyTurn * dt;
    if (p._bot && p._bot.lookYaw !== undefined) p.lookYaw = p._bot.lookYaw;
    p.lookPitch = THREE.MathUtils.clamp(p.lookPitch, -1.4, 1.4);
  }
  // in FPS, arrows turn instead of strafe
  if (type === 'fps') {
    const base = readKeys;
    p._read = () => {
      const k = base();
      if (keyDown('ArrowLeft') || keyDown('ArrowRight')) k.x = (keyDown('KeyD') ? 1 : 0) - (keyDown('KeyA') ? 1 : 0);
      k.sprint = keyDown('ShiftLeft') || keyDown('ShiftRight'); k.action = keyDown('KeyE') || keyDown('KeyJ') || keyDown('KeyF');
      return k;
    };
  }
  game.update(tick, 0);
  syncVisual(0);
  return p;
}

/** All players created so far (first one is game.__player). */
export function all(game) { return game.__players || []; }
