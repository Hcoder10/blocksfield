// ThreeKit debug: window.__kit, the harness API every generated game exposes (see CONTRACT.md "Debug / harness API").
// The web harness screenshots and playtests every game through this, so every entry point is defensive: it never
// throws on a missing level/player, and it always returns plain JSON-serialisable data.
import * as THREE from 'three';
import { reportError } from './core.js';
import * as Gameplay from './gameplay.js';
import * as World from './world.js';
import * as Physics from './physics.js';
import * as Touch from './touch.js';

// ---- errors: capture from the moment the kit is imported, not just after install ----
if (!window.__kitErrorHooks) {
  window.__kitErrorHooks = true;
  window.__kitErrors = window.__kitErrors || [];
  window.addEventListener('error', (e) => {
    if (e && e.target && e.target !== window && (e.target.src || e.target.href)) {     // resource load failure
      reportError(new Error(`failed to load ${e.target.src || e.target.href}`));
      return;
    }
    reportError(e.error || new Error(`${e.message} (${e.filename}:${e.lineno})`));
  }, true);
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason instanceof Error ? e.reason : new Error(`unhandled rejection: ${String(e.reason)}`)));
}

const V = (a, fallback = null) => {
  if (a == null) return fallback;
  if (a.isVector3) return a.clone();
  if (Array.isArray(a) && a.length >= 3) return new THREE.Vector3(+a[0], +a[1], +a[2]);
  if (typeof a === 'object' && 'x' in a) return new THREE.Vector3(+a.x || 0, +a.y || 0, +a.z || 0);
  throw new Error(`__kit: expected a position as [x,y,z] or a Vector3, got ${JSON.stringify(a)}`);
};
const arr = (v, d = 3) => v ? [+v.x.toFixed(d), +v.y.toFixed(d), +v.z.toFixed(d)] : null;

// plain-JSON view of anything in game.state (Vector3 -> array, Object3D -> name, no cycles, bounded depth)
function plain(x, depth = 0, seen = new WeakSet()) {
  if (x == null || typeof x === 'boolean' || typeof x === 'string') return x;
  if (typeof x === 'number') return Number.isFinite(x) ? +x.toFixed(4) : String(x);
  if (typeof x === 'function') return undefined;
  if (typeof x !== 'object') return String(x);
  if (x.isVector3) return arr(x);
  if (x.isVector2) return [+x.x.toFixed(3), +x.y.toFixed(3)];
  if (x.isColor) return '#' + x.getHexString();
  if (x.isObject3D) return `Object3D(${x.name || x.type})`;
  if (x.isBox3) return { min: arr(x.min), max: arr(x.max) };
  if (seen.has(x) || depth > 4) return '[…]';
  seen.add(x);
  if (Array.isArray(x)) return x.slice(0, 64).map(v => plain(v, depth + 1, seen));
  const o = {};
  let n = 0;
  for (const k of Object.keys(x)) {
    if (n++ > 64) { o['…'] = 'truncated'; break; }
    const v = plain(x[k], depth + 1, seen);
    if (v !== undefined) o[k] = v;
  }
  return o;
}

// ---- keyboard: real KeyboardEvents so every controller sees them exactly like a key press ----
const KEY_ALIASES = { ' ': 'Space', space: 'Space', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', shift: 'ShiftLeft', ctrl: 'ControlLeft', control: 'ControlLeft',
  alt: 'AltLeft', tab: 'Tab', backspace: 'Backspace' };
const KEY_CODES = { Space: 32, Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17,
  ControlRight: 17, AltLeft: 18, AltRight: 18, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
function keyInfo(k) {
  if (typeof k !== 'string' || !k) throw new Error(`__kit.input: key must be a string like 'KeyW', 'Space', 'ArrowUp' or 'w', got ${JSON.stringify(k)}`);
  let code = KEY_ALIASES[k] || KEY_ALIASES[k.toLowerCase()] || k;
  if (/^[a-z]$/i.test(code)) code = 'Key' + code.toUpperCase();
  else if (/^[0-9]$/.test(code)) code = 'Digit' + code;
  let key;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (code === 'Space') key = ' ';
  else if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code)) key = code.replace(/(Left|Right)$/, '');
  else key = code;
  const keyCode = KEY_CODES[code] || (/^Key[A-Z]$/.test(code) ? code.charCodeAt(3) : /^Digit/.test(code) ? 48 + +code[5] : 0);
  return { code, key, keyCode };
}
function dispatchKey(type, info) {
  const ev = new KeyboardEvent(type, { key: info.key, code: info.code, bubbles: true, cancelable: true, composed: true,
    shiftKey: info.code.startsWith('Shift') });
  for (const p of ['keyCode', 'which']) { try { Object.defineProperty(ev, p, { get: () => info.keyCode }); } catch {} }
  const target = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : document.body || document;
  target.dispatchEvent(ev);   // bubbles body -> document -> window, so listeners on any of them fire
}

// ---- survey framing: robust to outliers (huge ocean planes, skydomes, stray props) ----
function pct(sorted, p) { if (!sorted.length) return 0; const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1)))); return sorted[i]; }
function robustBox(points, lo = 0.03, hi = 0.97) {
  const xs = points.map(p => p.x).sort((a, b) => a - b), ys = points.map(p => p.y).sort((a, b) => a - b), zs = points.map(p => p.z).sort((a, b) => a - b);
  return new THREE.Box3(new THREE.Vector3(pct(xs, lo), pct(ys, lo), pct(zs, lo)), new THREE.Vector3(pct(xs, hi), pct(ys, hi), pct(zs, hi)));
}
function finiteBox(b) {
  return b && b.isBox3 && !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
}
function asBox(b) {
  if (!b) return null;
  if (b.isBox3) return b;
  if (b.min && b.max) { try { return new THREE.Box3(V(b.min), V(b.max)); } catch { return null; } }
  return null;
}

function interestPoints(level, player) {
  const pts = [];
  const add = (p) => { try { const v = p && (p.position || p); if (v && (v.isVector3 || Array.isArray(v) || 'x' in v)) { const w = V(v); if ([w.x, w.y, w.z].every(Number.isFinite)) pts.push(w); } } catch {} };
  if (level) {
    add(level.spawn);
    for (const k of ['route', 'checkpoints', 'collectibles', 'hazards']) for (const p of (Array.isArray(level[k]) ? level[k] : [])) add(p);
    if (level.goal) add(level.goal);
    for (const m of (Array.isArray(level.movers) ? level.movers : [])) if (m && m.mesh) add(m.mesh.getWorldPosition(new THREE.Vector3()));
    if (level.track && level.track.getPoints) for (const p of level.track.getPoints(64)) add(p);
  }
  if (player && player.position) add(player.position);
  return pts;
}

// mesh centres (weighted by count, not size) give a robust footprint when the level has few placements
function meshPoints(root, limit = 4000) {
  const pts = [];
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (pts.length >= limit || !o.isMesh || !o.geometry || o.visible === false) return;
    if (o.frustumCulled === false && o.geometry.boundingSphere && o.geometry.boundingSphere.radius > 1500) return;   // sky domes
    if (o.isInstancedMesh && o.count > 0) {
      const m = new THREE.Matrix4(), p = new THREE.Vector3();
      const step = Math.max(1, Math.floor(o.count / 200));
      for (let i = 0; i < o.count && pts.length < limit; i += step) { o.getMatrixAt(i, m); pts.push(p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld).clone()); }
      return;
    }
    box.setFromObject(o);
    if (!finiteBox(box)) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    pts.push(c);
    if (Math.max(s.x, s.z) < 600) { pts.push(new THREE.Vector3(box.min.x, c.y, box.min.z), new THREE.Vector3(box.max.x, c.y, box.max.z)); }
  });
  return pts;
}

export function frameBox(game, level, player) {
  let pts = interestPoints(level, player);
  const placed = pts.length >= 6;          // enough gameplay placements to frame what the player actually travels
  if (!placed) {
    const root = (level && level.group) || game.scene;
    pts = pts.concat(meshPoints(root));
  }
  let box = pts.length >= 2 ? robustBox(pts) : null;
  const lb = asBox(level && level.bounds);
  if (finiteBox(lb)) {
    const ls = lb.getSize(new THREE.Vector3());
    if (!box) box = lb.clone();
    else if (placed) { const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()); box.expandByVector(new THREE.Vector3(sz.x * 0.08 + 3, 2, sz.z * 0.08 + 3)); box.intersect(lb.clone().expandByScalar(4)); if (box.isEmpty()) box.setFromCenterAndSize(c, sz); }
    else if (Math.max(ls.x, ls.z) < 1500) box.union(lb).intersect(lb.clone().expandByScalar(1));   // trust sane bounds
    else box.intersect(lb);
  }
  if (!finiteBox(box)) box = new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 10, 20));
  const s = box.getSize(new THREE.Vector3());
  const m = Math.max(s.x, s.y, s.z, 4);                                      // never a degenerate box
  box.expandByVector(new THREE.Vector3(Math.max(0, (m * 0.25 - s.x) / 2) + s.x * 0.06, Math.max(0, (m * 0.08 - s.y) / 2), Math.max(0, (m * 0.25 - s.z) / 2) + s.z * 0.06));
  return box;
}

// place a camera looking along -dir at the box so all 8 corners land inside the frame (margin = NDC extent)
const fitCam = new THREE.PerspectiveCamera();
function fitShot(cam, box, dir, target, margin = 0.86, pts = null) {
  fitCam.fov = cam.fov || 60; fitCam.aspect = cam.aspect || 16 / 9; fitCam.near = 0.1; fitCam.far = 1e6; fitCam.updateProjectionMatrix();
  let corners = [];
  if (pts && pts.length >= 6) { const step = Math.max(1, Math.floor(pts.length / 240)); for (let i = 0; i < pts.length; i += step) corners.push(pts[i]); }
  else for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const t = target.clone(), v = new THREE.Vector3();
  const extent = (d) => {
    fitCam.position.copy(t).addScaledVector(dir, d); fitCam.lookAt(t); fitCam.updateMatrixWorld();
    let mx = 0, cx = 0, cy = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const c of corners) {
      v.copy(c).applyMatrix4(fitCam.matrixWorldInverse);
      if (v.z > -0.1) return { mx: 1e9 };                       // corner behind the camera
      v.applyMatrix4(fitCam.projectionMatrix);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    cx = (minX + maxX) / 2; cy = (minY + maxY) / 2;
    mx = Math.max((maxX - minX) / 2, (maxY - minY) / 2);
    return { mx, cx, cy };
  };
  const size = box.getSize(new THREE.Vector3()).length();
  let d = size;
  for (let it = 0; it < 3; it++) {
    let lo = size * 0.05, hi = size * 20;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (extent(m).mx > margin) lo = m; else hi = m; }
    d = hi;
    // recentre: move the target so the projected box sits in the middle of the frame
    const e = extent(d);
    if (!(e.mx < 1e8)) break;
    const right = new THREE.Vector3().setFromMatrixColumn(fitCam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(fitCam.matrixWorld, 1);
    const halfH = Math.tan(THREE.MathUtils.degToRad(fitCam.fov) / 2) * d, halfW = halfH * fitCam.aspect;
    t.addScaledVector(right, e.cx * halfW).addScaledVector(up, e.cy * halfH);
  }
  return { position: t.clone().addScaledVector(dir, d), target: t };
}

// highest solid thing under (x, z): World.heightAt (terrain/islands) and a physics ray (buildings, rocks, props)
function groundAt(game, x, z, top, exclude = null) {
  let g = null;
  try { const h = typeof World.heightAt === 'function' ? World.heightAt(game, x, z) : null; if (Number.isFinite(h)) g = h; } catch {}
  try {
    if (typeof Physics.raycast === 'function') {
      const hit = Physics.raycast(game, new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0), top + 2000, exclude ? { excludeCollider: exclude } : {});
      const y = hit && (hit.point ? hit.point.y : hit.y);
      if (Number.isFinite(y) && (g == null || y > g)) g = y;
    }
  } catch {}
  return g;
}
// keep a survey camera above the ground under it and above everything between it and its target, pitched down a bit
function clampShot(game, shot, top, { margin = 3, clear = 1.5, exclude = null } = {}) {
  const p = new THREE.Vector3(...shot.position), t = new THREE.Vector3(...shot.target);
  const hd = Math.hypot(p.x - t.x, p.z - t.z);
  if (t.y > p.y - 0.12 * hd) t.y = p.y - 0.12 * hd;                 // look slightly down
  let raise = 0;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const k = i / N * 0.85;                                         // stop short of the target itself
    const x = p.x + (t.x - p.x) * k, z = p.z + (t.z - p.z) * k;
    const g = groundAt(game, x, z, Math.max(top, p.y) + 60, exclude);
    if (g == null) continue;
    const need = g + (i === 0 ? margin : clear);
    const y = p.y + (t.y - p.y) * k;
    if (y < need) raise = Math.max(raise, (need - y) / (1 - k));
  }
  if (raise > 0) { p.y += raise; if (t.y > p.y - 0.12 * hd) t.y = p.y - 0.12 * hd; }
  shot.position = arr(p, 2); shot.target = arr(t, 2);
  return shot;
}

export function survey(game, level, player) {
  const box = frameBox(game, level, player);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const cam = game.camera;
  const vfov = THREE.MathUtils.degToRad(cam.fov || 60);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (cam.aspect || 16 / 9));
  const fit = (w, h) => Math.max(h / 2 / Math.tan(vfov / 2), w / 2 / Math.tan(hfov / 2));
  const horiz = Math.hypot(s.x, s.z);
  const longX = s.x >= s.z;
  const shots = [];
  // principal axis of what the player travels (xz): the side shot looks across it, the overview obliquely
  const ip = interestPoints(level, player).filter(p => box.containsPoint(p));
  let axis = new THREE.Vector3(longX ? 1 : 0, 0, longX ? 0 : 1);
  if (ip.length >= 6) {
    let mx = 0, mz = 0; for (const p of ip) { mx += p.x; mz += p.z; } mx /= ip.length; mz /= ip.length;
    let xx = 0, zz = 0, xz = 0; for (const p of ip) { const dx = p.x - mx, dz = p.z - mz; xx += dx * dx; zz += dz * dz; xz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * xz, xx - zz);
    axis.set(Math.cos(ang), 0, Math.sin(ang));
  }
  const across = new THREE.Vector3(-axis.z, 0, axis.x);
  if (across.z < 0) across.negate();
  // fit to the placements plus their ground level so islands/track bodies stay in frame
  const fitPts = ip.length >= 6 ? ip.flatMap(p => [p, new THREE.Vector3(p.x, Math.max(box.min.y, p.y - 6), p.z), new THREE.Vector3(p.x, p.y + 3, p.z)]) : null;
  const push = (name, p, t) => shots.push({ name, position: arr(p, 2), target: arr(t, 2) });

  // overview: 3/4 view from high up, the whole footprint in frame
  {
    const t = c.clone(); t.y = box.min.y + s.y * 0.3;
    const dir = across.clone().multiplyScalar(0.8).addScaledVector(axis, 0.45).setY(0.95).normalize();
    const f = fitShot(cam, box, dir, t, 0.76, fitPts);
    push('overview', f.position, f.target);
  }
  // side: low, looking across the short axis so the long axis fills the frame
  {
    const t = c.clone(); t.y = box.min.y + s.y * 0.35;
    const f = fitShot(cam, box, across.clone().setY(0.32).normalize(), t, 0.84, fitPts);
    push('side', f.position, f.target);
  }
  // top: straight down (tiny z offset keeps lookAt stable)
  {
    const d = fit(s.x, s.z) * 1.02 + s.y;
    const t = c.clone(); t.y = box.min.y;
    push('top', new THREE.Vector3(c.x, box.max.y + d, c.z + d * 0.02), t);
  }
  // player: over the shoulder, looking where the game camera looks (or along spawnYaw)
  {
    const pp = player && player.position ? V(player.position) : (level && level.spawn ? V(level.spawn) : c.clone());
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4 || game.cameraOverride) {
      const yaw = (player && Number.isFinite(player.yaw)) ? player.yaw : (level && Number.isFinite(level.spawnYaw) ? level.spawnYaw : 0);
      fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    }
    fwd.normalize();
    const size = player && player.object ? new THREE.Box3().setFromObject(player.object).getSize(new THREE.Vector3()) : new THREE.Vector3(1, 2, 1);
    const k = THREE.MathUtils.clamp(Math.max(size.x, size.y, size.z), 1, 6);
    const p = pp.clone().addScaledVector(fwd, -5.5 * k).add(new THREE.Vector3(0, 2.6 * k, 0));
    const t = pp.clone().addScaledVector(fwd, 4 * k).add(new THREE.Vector3(0, 0.6 * k, 0));
    push('player', p, t);
  }
  for (const sh of shots) { try { clampShot(game, sh, box.max.y, { ...(sh.name === 'player' ? { margin: 1.6, clear: 0.6 } : {}), exclude: player && player.collider }); } catch (e) { reportError(e); } }
  return shots;
}

// ---- dev overlay (backquote) ----
function overlay() {
  const el = document.createElement('pre');
  el.id = 'tk-dev-overlay';
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;margin:0;padding:8px 10px;max-width:46vw;max-height:60vh;overflow:hidden;' +
    'font:11px/1.35 ui-monospace,Consolas,monospace;color:#d8ffe6;background:rgba(8,12,18,.78);border:1px solid rgba(120,255,180,.35);' +
    'border-radius:6px;pointer-events:none;white-space:pre-wrap;display:none';
  document.body.appendChild(el);
  return el;
}

export function install(game, opts = {}) {
  if (!game || !game.scene || !game.camera) throw new Error('Debug.install(game, {level, player}): first argument must be the game from createGame()');
  let { level = null, player = null } = opts;
  const held = new Map();       // code -> timeout id
  let fps = 0, frames = 0, lastT = performance.now();
  let pilot = null, pilotOn = false;
  let dev = null, readyPending = false;

  const kit = {
    ready: false,
    version: 1,
    get errors() { return (window.__kitErrors || []).slice(); },
    get level() { return level; },
    get player() { return player; },
    get game() { return game; },
    setLevel(l) { level = l; }, setPlayer(p) { player = p; },

    state() {
      const out = { time: +(game.time || 0).toFixed(3), fps: Math.round(fps), frame: game.frame || 0 };
      try {
        if (player) out.player = { position: arr(player.position || (player.object && player.object.position)), velocity: arr(player.velocity),
          grounded: !!player.grounded, alive: player.alive !== false, speed: Number.isFinite(player.speed) ? +player.speed.toFixed(3) : undefined, type: player.type };
        Object.assign(out, plain(game.state || {}));
        if (level) { const b = asBox(level.bounds); out.level = { kind: level.kind || null, bounds: finiteBox(b) ? { min: arr(b.min, 2), max: arr(b.max, 2) } : null }; }
        out.paused = !!game.paused; out.timeScale = game.timeScale;
        out.camera = { position: arr(game.camera.position, 2), override: !!game.cameraOverride };
        out.autopilot = pilotOn;
        out.errors = (window.__kitErrors || []).length;
      } catch (e) { out.stateError = String(e && e.message || e); }
      return out;
    },

    camera(pos, target) {
      const p = V(pos);
      if (!p) throw new Error('__kit.camera(pos, target): pos is required, e.g. __kit.camera([0,40,80],[0,0,0])');
      let t = V(target);
      if (!t) { t = new THREE.Vector3(); game.camera.getWorldDirection(t); t.multiplyScalar(10).add(p); }
      game.cameraOverride = { position: p, target: t };
      game.camera.position.copy(p); game.camera.lookAt(t);
      return { position: arr(p, 2), target: arr(t, 2) };
    },
    // release() -> camera back to the game; release('KeyW') -> let go of a held key
    release(key) {
      if (key != null) return kit.releaseKey(key);
      game.cameraOverride = null;
      return true;
    },
    survey() { return survey(game, level, player); },
    shot(name = 'overview') {
      const s = kit.survey().find(x => x.name === name);
      if (!s) throw new Error(`__kit.shot: unknown shot "${name}"; shots: overview, side, top, player`);
      kit.camera(s.position, s.target);
      return s;
    },

    hold(key) {
      const info = keyInfo(key);
      if (held.has(info.code)) clearTimeout(held.get(info.code));
      else dispatchKey('keydown', info);
      held.set(info.code, null);
      return true;
    },
    releaseKey(key) {
      const info = keyInfo(key);
      if (held.has(info.code)) clearTimeout(held.get(info.code));
      held.delete(info.code);
      dispatchKey('keyup', info);
      return true;
    },
    releaseAll() { for (const code of [...held.keys()]) kit.releaseKey(code); return true; },
    input(key, ms = 120) {
      const info = keyInfo(key);
      ms = Math.max(0, +ms || 0);
      if (held.has(info.code)) clearTimeout(held.get(info.code));
      else dispatchKey('keydown', info);
      return new Promise((resolve) => {
        held.set(info.code, setTimeout(() => { held.delete(info.code); dispatchKey('keyup', info); resolve(true); }, ms));
      });
    },
    press(key) { return kit.input(key, 90); },
    click(x = innerWidth / 2, y = innerHeight / 2) {
      const el = document.elementFromPoint(x, y) || game.renderer.domElement;
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, clientX: x, clientY: y, button: 0 }));
      return true;
    },

    autopilot(on = true) {
      on = !!on;
      if (on === pilotOn) return pilotOn;
      try {
        if (on) {
          if (typeof game.__uiDismissTitle === 'function') game.__uiDismissTitle();
          if (pilot && typeof pilot === 'object' && typeof pilot.start === 'function') pilot.start();
          else if (pilot && typeof pilot === 'object' && 'enabled' in pilot) pilot.enabled = true;
          else {
            pilot = null;
            if (typeof Gameplay.autopilot === 'function') {
              try { pilot = Gameplay.autopilot(game, { level, player }); }
              catch (e) { console.warn('__kit.autopilot: Gameplay.autopilot failed, using the simple route bot:', e && e.message); }
            }
            if (!pilot || pilot.on === false) pilot = fallbackPilot(game, level, player);
          }
          if (pilot && typeof pilot === 'object' && 'enabled' in pilot) pilot.enabled = true;
        } else if (pilot) {
          if (typeof pilot === 'function') { pilot(); pilot = null; }
          else if (typeof pilot.stop === 'function') pilot.stop();
          else if (typeof pilot.dispose === 'function') { pilot.dispose(); pilot = null; }
          else if ('enabled' in pilot) pilot.enabled = false;
          if (player && typeof player.setInput === 'function') player.setInput(0, 0, false, false);
        }
        pilotOn = on;
      } catch (e) { reportError(e); }
      return pilotOn;
    },
    timeScale(x) { if (x != null) { const v = +x; if (!(v >= 0)) throw new Error('__kit.timeScale(x): x must be a number >= 0'); game.timeScale = v; } return game.timeScale; },
    pause(b = true) { b = !!b; if (game.paused !== b) { game.paused = b; game.__kitPause = true; try { game.emit('pause', b); } finally { game.__kitPause = false; } } return game.paused; },   // no pause menu: harness freezes for clean shots
    teleport(pos, yaw) {
      const p = V(pos);
      if (!p) throw new Error('__kit.teleport(pos): pos is required, e.g. __kit.teleport([0,5,0])');
      if (!player) throw new Error('__kit.teleport: no player; call K.Debug.install(game, {level, player})');
      if (typeof player.teleport === 'function') player.teleport(p, yaw);
      else if (player.position) player.position.copy(p);
      return arr(p);
    },
    emit(name, ...args) { game.emit(name, ...args); return true; },
    // dismiss a title screen without a key press (harness), and hide/show the whole UI overlay for clean shots
    start() { if (typeof game.__uiDismissTitle === 'function') game.__uiDismissTitle(); if (!game.started) game.start(); return true; },
    ui(on = true) { const r = game.__ui && game.__ui.root; if (r) r.classList.toggle('tk-hidden', !on); return !!r; },
    overlay(on) { dev = dev || overlay(); dev.style.display = (on == null ? dev.style.display === 'none' : on) ? 'block' : 'none'; return dev.style.display === 'block'; },
  };

  game.lateUpdate(() => {
    const now = performance.now();
    frames++;
    if (now - lastT >= 500) { fps = frames * 1000 / (now - lastT); frames = 0; lastT = now; }
    if (!kit.ready && !readyPending && game.frame >= 1) {
      // lateUpdate runs before render; flag ready once this frame has been drawn
      readyPending = true;
      requestAnimationFrame(() => { kit.ready = true; window.dispatchEvent(new Event('kit-ready')); });
    }
    if (dev && dev.style.display === 'block' && game.frame % 10 === 0) {
      const s = kit.state();
      dev.textContent = `${s.fps} fps  frame ${s.frame}  t ${s.time.toFixed(1)}s${game.paused ? '  PAUSED' : ''}${game.timeScale !== 1 ? `  x${game.timeScale}` : ''}\n` +
        JSON.stringify({ ...s, fps: undefined, frame: undefined, time: undefined }, null, 1).replace(/\n\s*/g, ' ').replace(/(.{80,}?,) /g, '$1\n');
    }
  }, 1000);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' && e.isTrusted !== false) kit.overlay();
  });
  window.addEventListener('blur', () => kit.releaseAll());

  try { Touch.install(game, { player }); } catch (e) { reportError(e); }
  // ?quality=low|high forces the Look tier (weak laptops, or to compare); auto-quality still runs otherwise
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (['high', 'low', 'potato'].includes(q) && game.look && typeof game.look.setQuality === 'function') { game.look.locked = true; game.look.setQuality(q); }
  } catch (e) { reportError(e); }   // phones: joystick + buttons, no game.js change
  window.__kit = kit;
  game.debug = kit;
  return kit;
}

// a minimal bot used only when gameplay.js has no autopilot: walk the route, jump on a timer
function fallbackPilot(game, level, player) {
  if (!player || typeof player.setInput !== 'function') throw new Error('__kit.autopilot: needs a player with setInput(); pass it to Debug.install(game, {level, player})');
  const route = (level && Array.isArray(level.route) && level.route.length) ? level.route.map(p => V(p)) : [];
  const ctl = { enabled: true, i: 0 };
  let jumpT = 0;
  const fn = game.update((dt) => {
    if (!ctl.enabled || !route.length) return;
    const p = player.position;
    let tgt = route[Math.min(ctl.i, route.length - 1)];
    while (ctl.i < route.length - 1 && Math.hypot(tgt.x - p.x, tgt.z - p.z) < 2.5) tgt = route[++ctl.i];
    const dx = tgt.x - p.x, dz = tgt.z - p.z, L = Math.hypot(dx, dz) || 1;
    jumpT -= dt;
    const jump = (tgt.y > p.y + 0.8 || jumpT < 0) && player.grounded;
    if (jump) jumpT = 2.5;
    player.setInput(dx / L, dz / L, jump, false);
  }, -5);
  ctl.stop = () => { ctl.enabled = false; player.setInput(0, 0, false, false); };
  ctl.start = () => { ctl.enabled = true; };
  ctl.dispose = () => { ctl.stop(); game.removeUpdate(fn); };
  return ctl;
}
