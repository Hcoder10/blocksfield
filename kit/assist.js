// ThreeKit assist: nobody stays stuck. R (or the touch "reset" button) puts the player back on the route / track just
// behind where they were, facing the right way; vehicles that stall against a wall or leave the track are eased back
// on their own, boats are kept on the water, and a platformer wedged in geometry gets nudged free. Installed by
// Debug.install and UI.hud (no game.js change). Uses only the public player API (position, velocity, speed, type,
// grounded, onWater, teleport, addVelocity) plus level.route / level.track / level.water. Off while the autopilot drives.
import * as THREE from 'three';
import { reportError } from './core.js';
import * as FX from './fx.js';
import { readKeys } from './player.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function install(game, opts = {}) {
  if (!game || !game.on) throw new Error('Assist.install(game, {level, player}): first argument must be the game from createGame()');
  if (game.__assist) { if (opts.player) game.__assist.player = opts.player; if (opts.level) game.__assist.level = opts.level; return game.__assist; }
  const A = game.__assist = { player: opts.player || null, level: opts.level || null, path: null, pathFor: null, stuckT: 0, offT: 0, wedgeT: 0,
    nudged: 0, cool: 0, last: V(0, 0, 0), resets: 0 };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR' || e.repeat || e.ctrlKey || e.metaKey) return;
    if (!active(game, A, true)) return;
    reset(game, A, 'key');
  });
  game.on('assistReset', () => { if (active(game, A, true)) reset(game, A, 'button'); });
  game.update((dt) => { try { watch(game, A, dt); } catch (e) { reportError(e); } }, 15);
  return A;
}

const playerOf = (game, A) => A.player || game.__player || (window.__kit && window.__kit.game === game && window.__kit.player) || null;
const levelOf = (game, A) => A.level || game.__level || (window.__kit && window.__kit.game === game && window.__kit.level) || game.level || null;
const vehicle = (p) => p && (p.type === 'kart' || p.type === 'boat');
function autopiloting(game, p) {
  return !!((game.__autopilot && game.__autopilot.on !== false) || (p && p._bot && game.time - (p._botT || -9) < 0.5));
}
// the player is in control right now (not paused, not on a title/countdown/end screen, alive, not the bot)
function active(game, A, byHand = false) {
  const p = playerOf(game, A), st = game.state || {}, U = game.__ui;
  if (!p || !p.alive || game.paused || st.won || st.lost) return false;
  if (st.phase && st.phase !== 'playing') return false;
  if (U && (U.title || U.screen || U.pauseEl || U.counting || U.dialog)) return false;
  if (st.cutscene) return false;
  if (p.controls && p.controls.enabled === false) return false;
  if (!byHand && autopiloting(game, p)) return false;
  return true;
}

// sampled guide path: the track loop (races) or the route (start -> goal), with tangents
function guide(game, A) {
  const level = levelOf(game, A);
  if (!level) return null;
  if (A.pathFor === level && A.path) return A.path;
  let pts = [], closed = false;
  if (level.track && level.track.getPointAt) {
    const N = Math.max(120, Math.round(level.track.getLength() / 2));
    for (let i = 0; i < N; i++) pts.push(level.track.getPointAt(i / N));
    closed = true;
  } else if (Array.isArray(level.route) && level.route.length > 1) {
    pts = level.route.map(p => (p.isVector3 ? p.clone() : V(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2])));
  }
  if (pts.length < 2) return null;
  const tans = pts.map((p, i) => {
    const a = pts[closed ? (i - 1 + pts.length) % pts.length : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % pts.length : Math.min(pts.length - 1, i + 1)];
    const t = b.clone().sub(a); t.y = 0; return t.lengthSq() > 1e-6 ? t.normalize() : V(0, 0, 1);
  });
  A.path = { pts, tans, closed, width: level.trackWidth || 12, water: level.water ? (level.water.y ?? level.water) : null };
  A.pathFor = level;
  return A.path;
}
function nearest(path, pos) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < path.pts.length; i++) { const q = path.pts[i]; const d = (q.x - pos.x) ** 2 + (q.z - pos.z) ** 2; if (d < bd) { bd = d; bi = i; } }
  return { i: bi, d: Math.sqrt(bd) };
}
// a point a few metres BEHIND the nearest one (never put the player further along than they got)
function backFrom(path, i, metres = 4) {
  let j = i, acc = 0;
  while (acc < metres) {
    const k = path.closed ? (j - 1 + path.pts.length) % path.pts.length : j - 1;
    if (k < 0) break;
    acc += path.pts[j].distanceTo(path.pts[k]); j = k;
    if (j === i) break;
  }
  return j;
}

function reset(game, A, why) {
  const p = playerOf(game, A), path = guide(game, A);
  if (!p) return false;
  if (A.cool > 0 && why !== 'key' && why !== 'button') return false;
  A.cool = 1.2;
  let at, yaw;
  if (path) {
    const n = nearest(path, p.position);
    const j = backFrom(path, n.i, vehicle(p) ? 6 : 2.5);
    at = path.pts[j].clone();
    const t = path.tans[j]; yaw = Math.atan2(t.x, t.z);
    if (p.type === 'boat' && path.water != null) at.y = path.water + 0.6; else at.y += vehicle(p) ? 1.0 : 0.6;
  } else if (p.respawnPoint) { at = p.respawnPoint.clone(); yaw = p.respawnYaw; }
  else return false;
  try { FX.poof(game, p.position.clone(), { size: vehicle(p) ? 1.3 : 0.9 }); } catch {}
  try { FX.flash(game, '#0b0820', { opacity: 0.35, duration: 0.3 }); } catch {}
  p.teleport(at, yaw);
  if ('invulnerable' in p) p.invulnerable = Math.max(p.invulnerable || 0, 1.0);
  A.stuckT = A.offT = A.wedgeT = 0; A.nudged = 0; A.resets++;
  game.emit('respawn', p, { reason: 'assist:' + why });
  return true;
}

function watch(game, A, dt) {
  if (A.cool > 0) A.cool -= dt;
  const p = playerOf(game, A);
  if (!p || !active(game, A)) { A.stuckT = A.offT = A.wedgeT = 0; if (p) A.last.copy(p.position); return; }
  const path = guide(game, A);
  const k = readKeys();
  const T = game.__touch;
  const intent = Math.abs(k.y) > 0.2 || Math.abs(k.x) > 0.2 || !!(T && T.stick && T.stick.id !== null);
  const hs = p.velocity ? Math.hypot(p.velocity.x, p.velocity.z) : (p.speed || 0);
  const moved = Math.hypot(p.position.x - A.last.x, p.position.z - A.last.z) / Math.max(dt, 1e-3);
  A.last.copy(p.position);
  if (vehicle(p)) {
    // (b) stalled against a wall / pinned: under ~4 km/h while trying to drive, for 2.5 s
    if (intent && Math.min(hs, moved) < 1.1) A.stuckT += dt; else A.stuckT = Math.max(0, A.stuckT - dt * 2);
    // off the track (or out of the water) for a while
    let off = false;
    if (path) {
      const n = nearest(path, p.position);
      off = n.d > path.width / 2 + 9;
      if (p.type === 'boat' && path.water != null) {
        const beached = p.onWater === false && p.grounded && p.position.y > path.water - 0.5;
        if (beached) off = true;
        // (c) soft push back toward the water lane while off it
        if (beached || n.d > path.width / 2 + 4) {
          const q = path.pts[n.i], dir = V(q.x - p.position.x, 0, q.z - p.position.z);
          if (dir.lengthSq() > 0.01 && p.addVelocity) p.addVelocity(dir.normalize().multiplyScalar(18 * dt));
        }
      }
    }
    if (off) A.offT += dt; else A.offT = Math.max(0, A.offT - dt * 2);
    const offLimit = p.type === 'boat' ? 1.5 : 2.0;
    if (A.stuckT > 2.5) reset(game, A, 'stuck');
    else if (A.offT > offLimit) reset(game, A, p.type === 'boat' ? 'water' : 'off-track');
  } else if (p.type === 'platformer' || p.type === 'topdown' || p.type === 'fps') {
    // wedged: holding a direction but going nowhere for 3 s -> a hop toward the route, then a reset if that fails
    if (intent && moved < 0.35 && hs < 0.6) A.wedgeT += dt; else A.wedgeT = Math.max(0, A.wedgeT - dt * 2);
    if (A.wedgeT > 3) {
      if (A.nudged < 1 && p.addVelocity) {
        A.nudged++; A.wedgeT = 1.5;
        let dir = V(0, 0, 0);
        if (path) { const n = nearest(path, p.position), q = path.pts[Math.min(path.pts.length - 1, n.i + 1)]; dir.set(q.x - p.position.x, 0, q.z - p.position.z); }
        if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        dir.normalize().multiplyScalar(6); dir.y = 9;
        p.addVelocity(dir);
        try { FX.dust(game, p.position.clone(), { amount: 0.6 }); } catch {}
      } else reset(game, A, 'wedged');
    }
    if (!intent || moved > 1) { if (A.wedgeT === 0) A.nudged = 0; }
  }
}
