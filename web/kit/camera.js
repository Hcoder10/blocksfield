// camera.js: follow / chase / topdown / orbit / first-person cameras with spring smoothing and collision pull-in.
// One rig is active at a time (a new call replaces the old). Runs in lateUpdate order 20; while game.cameraOverride
// is set (debug survey cameras) the rig keeps tracking but core.js wins. See docs/Camera.md.
import * as THREE from 'three';
import * as Physics from './physics.js';

export const MODES = ['follow', 'chase', 'topdown', 'orbit', 'firstPerson'];
const UP = new THREE.Vector3(0, 1, 0);
const angWrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

let drag = null;
function installDrag(game) {
  if (drag) return drag;
  drag = { dx: 0, dy: 0, down: false, wheel: 0 };
  const el = game.renderer.domElement;
  el.addEventListener('pointerdown', e => { if (e.button === 0 || e.button === 2) drag.down = true; });
  window.addEventListener('pointerup', () => { drag.down = false; });
  window.addEventListener('pointermove', e => { if (drag.down && !document.pointerLockElement) { drag.dx += e.movementX || 0; drag.dy += e.movementY || 0; } });
  el.addEventListener('wheel', e => { drag.wheel += Math.sign(e.deltaY); }, { passive: true });
  el.addEventListener('contextmenu', e => e.preventDefault());
  return drag;
}
function padLook() {
  try {
    const g = navigator.getGamepads && [...navigator.getGamepads()].find(x => x && x.connected);
    if (!g) return [0, 0];
    const d = v => (Math.abs(v) < 0.18 ? 0 : v);
    return [d(g.axes[2] || 0), d(g.axes[3] || 0)];
  } catch (e) { return [0, 0]; }
}

function install(game, mode, opts, step) {
  if (game.__camRig) game.__camRig.dispose();
  const rig = {
    mode, opts,
    set(o) { Object.assign(opts, o); return rig; },
    dispose() { game.removeUpdate(fn); if (game.__camRig === rig) game.__camRig = null; },
  };
  const fn = (dt, t) => step(dt, t, rig);
  game.lateUpdate(fn, 20);
  game.__camRig = rig;
  return rig;
}

function needPlayer(fnName, player) {
  if (!player || !player.position) throw new Error(`Camera.${fnName}(game, player, opts): player must be the object Player.create() returned`);
}

function pullIn(game, from, to, player, minDist = 1.2) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-3) return to;
  const hit = Physics.raycast(game, from, dir, len, { excludeCollider: player && player.collider });
  if (hit && hit.distance < len) return from.clone().addScaledVector(dir.divideScalar(len), Math.max(minDist, hit.distance - 0.35));
  return to;
}

/**
 * Third-person follow camera (platformer, topdown-ish games, anything with a character).
 * Vehicles get Camera.chase, FPS players get Camera.firstPerson automatically.
 * opts: { distance=9, height=1.4 (look-at height above feet), pitch=0.3 (rad, + looks down), lookAhead=1.6,
 *         autoYaw=1.4 (how fast it swings behind a running player, 0 = never), orbit=true (mouse drag / right stick),
 *         collide=true, fov=60, yaw (initial; default behind the player) }
 */
export function follow(game, player, opts = {}) {
  needPlayer('follow', player);
  if (player.type === 'kart' || player.type === 'boat') return chase(game, player, opts);
  if (player.type === 'fps') return firstPerson(game, player, opts);
  if (player.type === 'topdown') return topdown(game, player, opts);
  const o = { distance: 10, height: 1.6, pitch: 0.36, lookAhead: 1.6, autoYaw: 1.4, orbit: true, collide: true, fov: 60, ...opts };
  const d = installDrag(game);
  const st = { yaw: o.yaw ?? player.yaw + Math.PI, pitch: o.pitch, target: player.position.clone().add(new THREE.Vector3(0, o.height, 0)),
    ahead: new THREE.Vector3(), groundY: player.position.y, manualT: 0, dist: o.distance, pos: new THREE.Vector3(), first: true, zoom: 1 };
  const cam = game.camera;
  return install(game, 'follow', o, (dt) => {
    if (dt <= 0 && !st.first) dt = 1 / 60;
    const p = player.position, v = player.velocity;
    // input orbit
    const [lx, ly] = padLook();
    if (o.orbit && (d.dx || d.dy || lx || ly)) {
      st.yaw -= d.dx * 0.006 + lx * 2.6 * dt; st.pitch = THREE.MathUtils.clamp(st.pitch + d.dy * 0.004 + ly * 1.6 * dt, -0.2, 1.25);
      st.manualT = 1.5;
    }
    d.dx = 0; d.dy = 0;
    if (d.wheel) { st.zoom = THREE.MathUtils.clamp(st.zoom + d.wheel * 0.1, 0.5, 2); d.wheel = 0; }
    st.manualT -= dt;
    // vertical: track the ground height, not every jump (Mario-style), unless falling below it or climbing far above
    if (player.grounded || !player.alive) st.groundY = p.y;
    else if (p.y < st.groundY) st.groundY = p.y;
    else if (p.y > st.groundY + 4) st.groundY = p.y - 4;
    // look-ahead along horizontal velocity
    const hv = new THREE.Vector3(v.x, 0, v.z);
    st.ahead.lerp(hv.clone().multiplyScalar(o.lookAhead / 12), damp(3, dt));
    // keep the player in frame on big jumps: the target rises once they are 2 above the tracked ground
    const want = new THREE.Vector3(p.x, Math.max(st.groundY + o.height, p.y + o.height - 2), p.z).add(st.ahead);
    if (st.first) st.target.copy(want);
    st.target.x += (want.x - st.target.x) * damp(10, dt);
    st.target.z += (want.z - st.target.z) * damp(10, dt);
    st.target.y += (want.y - st.target.y) * damp(player.grounded ? 6 : 3, dt);
    // auto-swing behind a running player (not while they run at the camera)
    const sp = hv.length();
    if (o.autoYaw > 0 && sp > 1 && st.manualT <= 0) {
      const camF = new THREE.Vector3(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
      const along = hv.clone().divideScalar(sp).dot(camF);
      const behind = Math.atan2(v.x, v.z) + Math.PI;
      const k = along < -0.3 ? 0 : 0.25 + 0.75 * Math.max(0, along);
      st.yaw += angWrap(behind - st.yaw) * Math.min(1, o.autoYaw * k * Math.min(1, sp / 12) * dt);
    }
    const dist = o.distance * st.zoom;
    const off = new THREE.Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch)).multiplyScalar(dist);
    let desired = st.target.clone().add(off);
    if (o.collide) desired = pullIn(game, st.target, desired, player);
    if (st.first) st.pos.copy(desired);
    // pull in fast, ease back out slowly
    const nearer = desired.distanceTo(st.target) < st.pos.distanceTo(st.target);
    st.pos.lerp(desired, damp(nearer ? 25 : 8, dt));
    cam.position.copy(st.pos);
    cam.lookAt(st.target);
    if (cam.fov !== o.fov) { cam.fov += (o.fov - cam.fov) * damp(6, dt); cam.updateProjectionMatrix(); }
    st.first = false;
  });
}

/**
 * Chase camera for vehicles: behind and above, swings with the heading, FOV kick on boost and with speed.
 * opts: { distance=7.5, height=2.6, lookAt=1.2, fov=64, boostFov=14, speedFov=8, stiffness=5 }
 */
export function chase(game, player, opts = {}) {
  needPlayer('chase', player);
  const o = { distance: 7.5, height: 2.6, lookAt: 1.2, fov: 64, boostFov: 14, speedFov: 8, stiffness: 5, collide: true, ...opts };
  const st = { yaw: player.yaw, pos: new THREE.Vector3(), target: new THREE.Vector3(), first: true, fov: o.fov, kick: 0 };
  const cam = game.camera;
  const maxS = (player.tuning && player.tuning.maxSpeed) || 30;
  game.on('boost', pl => { if (pl === player) st.kick = 1; });
  return install(game, 'chase', o, (dt) => {
    if (dt <= 0 && !st.first) dt = 1 / 60;
    const p = player.position;
    // follow the velocity direction when sliding, the heading otherwise
    const v = player.velocity, sp = Math.hypot(v.x, v.z);
    const velYaw = sp > 4 ? Math.atan2(v.x, v.z) : player.yaw;
    const want = angWrap(player.yaw + angWrap(velYaw - player.yaw) * 0.55);
    if (st.first) st.yaw = want;
    st.yaw += angWrap(want - st.yaw) * damp(o.stiffness, dt);
    const f = new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    const dist = o.distance + Math.min(1, sp / maxS) * 1.5 + st.kick * 1.2;
    const tgt = p.clone().add(new THREE.Vector3(0, o.lookAt, 0)).addScaledVector(f, 2.5);
    let desired = p.clone().addScaledVector(f, -dist).add(new THREE.Vector3(0, o.height, 0));
    if (o.collide) desired = pullIn(game, p.clone().add(new THREE.Vector3(0, 1.5, 0)), desired, player, 2);
    if (st.first) { st.pos.copy(desired); st.target.copy(tgt); }
    st.pos.x += (desired.x - st.pos.x) * damp(10, dt);
    st.pos.z += (desired.z - st.pos.z) * damp(10, dt);
    st.pos.y += (desired.y - st.pos.y) * damp(5, dt);
    st.target.lerp(tgt, damp(14, dt));
    cam.position.copy(st.pos);
    cam.lookAt(st.target);
    st.kick = Math.max(player.boostT > 0 ? 0.6 : 0, st.kick - dt * 1.5);
    const fov = o.fov + o.speedFov * Math.min(1, sp / maxS) + o.boostFov * Math.min(1, st.kick + (player.boostT > 0 ? 0.5 : 0));
    st.fov += (fov - st.fov) * damp(5, dt);
    cam.fov = st.fov; cam.updateProjectionMatrix();
    st.first = false;
  });
}

/**
 * Top-down / three-quarter camera that follows a player (or a fixed point when player is null).
 * opts: { height=22, pitch=1.0 (rad from horizontal; 1.57 = straight down), yaw=0 (camera south of the player,
 *         looking north/-Z), lookAhead=2.5, fov=50 }
 */
export function topdown(game, player, opts = {}) {
  const o = { height: 22, pitch: 1.0, yaw: 0, lookAhead: 2.5, fov: 50, ...opts };
  const st = { target: new THREE.Vector3(), ahead: new THREE.Vector3(), first: true };
  const cam = game.camera;
  return install(game, 'topdown', o, (dt) => {
    if (dt <= 0 && !st.first) dt = 1 / 60;
    const p = player ? player.position : (o.target || new THREE.Vector3());
    if (player) st.ahead.lerp(new THREE.Vector3(player.velocity.x, 0, player.velocity.z).multiplyScalar(o.lookAhead / 10), damp(3, dt));
    const want = p.clone().add(st.ahead);
    if (st.first) st.target.copy(want);
    st.target.lerp(want, damp(7, dt));
    const dist = o.height / Math.sin(o.pitch);
    const off = new THREE.Vector3(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)).multiplyScalar(dist);
    cam.position.copy(st.target).add(off);
    cam.lookAt(st.target);
    if (cam.fov !== o.fov) { cam.fov = o.fov; cam.updateProjectionMatrix(); }
    st.first = false;
  });
}

/**
 * Slow orbit around a point: title screens, attract mode, win screens.
 * Camera.orbit(game, { target: Vector3 | player, radius=30, height=12, speed=0.12 (rad/s), lookHeight=0, fov=55 })
 */
export function orbit(game, opts = {}) {
  const o = { radius: 30, height: 12, speed: 0.12, lookHeight: 0, fov: 55, angle: 0, ...opts };
  if (!o.target) o.target = new THREE.Vector3();
  const cam = game.camera;
  let a = o.angle;
  return install(game, 'orbit', o, (dt) => {
    a += o.speed * (dt || 1 / 60);
    const t = o.target.position && !o.target.isVector3 ? o.target.position : o.target;
    cam.position.set(t.x + Math.sin(a) * o.radius, t.y + o.height, t.z + Math.cos(a) * o.radius);
    cam.lookAt(t.x, t.y + o.lookHeight, t.z);
    if (cam.fov !== o.fov) { cam.fov = o.fov; cam.updateProjectionMatrix(); }
  });
}

/**
 * First-person camera for type 'fps' players (Camera.follow picks it automatically).
 * opts: { eye=1.55, fov=72, bob=0.05, sprintFov=8 }
 */
export function firstPerson(game, player, opts = {}) {
  needPlayer('firstPerson', player);
  const o = { eye: 1.55, fov: 72, bob: 0.05, sprintFov: 8, weapon: true, crosshair: true, ...opts };
  const cam = game.camera;
  const st = { phase: 0, fov: o.fov, dip: 0, recoil: 0 };
  game.on('land', (pl, sp) => { if (pl === player) st.dip = Math.min(0.35, (sp || 0) * 0.012); });
  game.on('shoot', (pl) => { if (pl === player) st.recoil = 1; });
  // toy blaster + reticle parented to the camera (the camera joins the scene so its children render)
  const vm = new THREE.Group(); vm.name = 'viewmodel';
  if (o.weapon || o.crosshair) { if (!cam.parent) game.scene.add(cam); cam.add(vm); }
  let gun = null, muzzle = null;
  if (o.weapon) {
    const tm = (c) => new THREE.MeshToonMaterial({ color: c });
    gun = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), tm(player.character && player.character.mats.body.color ? '#' + player.character.mats.body.color.getHexString() : '#ff7a59'));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.32, 12), tm('#2a2733')); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, -0.38);
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.022, 6, 14), new THREE.MeshBasicMaterial({ color: '#7ff6ff', toneMapped: false })); tip.position.set(0, 0.03, -0.54);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.12), tm('#2a2733')); grip.position.set(0, -0.15, 0.1); grip.rotation.x = 0.3;
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshBasicMaterial({ color: '#ffd23f', toneMapped: false })); tank.position.set(0, 0.12, 0.05);
    gun.add(body, barrel, tip, grip, tank);
    muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff6a8', toneMapped: false, transparent: true }));
    muzzle.position.set(0, 0.03, -0.62); muzzle.visible = false; gun.add(muzzle);
    gun.scale.setScalar(0.45); gun.position.set(0.2, -0.17, -0.42);
    gun.traverse(m => { if (m.isMesh) { m.renderOrder = 10; m.material.depthTest = false; m.userData.noCollide = true; } });
    vm.add(gun);
  }
  if (o.crosshair) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.0085, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, toneMapped: false, transparent: true, opacity: 0.9 }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 10), ring.material);
    ring.position.z = dot.position.z = -0.5; ring.renderOrder = dot.renderOrder = 11; vm.add(ring, dot);
  }
  const rig = install(game, 'firstPerson', o, (dt) => {
    if (gun) {
      st.recoil = Math.max(0, st.recoil - (dt || 0) * 7);
      const sp2 = Math.hypot(player.velocity.x, player.velocity.z);
      gun.position.set(0.2 + Math.sin(st.phase * 0.5) * 0.008 * Math.min(1, sp2 / 9), -0.17 + Math.abs(Math.cos(st.phase * 0.5)) * 0.008 * Math.min(1, sp2 / 9) - st.dip * 0.1, -0.42 + st.recoil * 0.05);
      gun.rotation.x = st.recoil * 0.25;
      muzzle.visible = st.recoil > 0.7; muzzle.scale.setScalar(0.6 + st.recoil);
    }
    const sp = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.grounded) st.phase += (dt || 0) * sp * 1.1;
    const bob = player.grounded ? Math.sin(st.phase) * o.bob * Math.min(1, sp / 9) : 0;
    st.dip *= Math.exp(-(dt || 0) * 8);
    cam.position.copy(player.position).add(new THREE.Vector3(0, o.eye + bob - st.dip, 0));
    const y = player.lookYaw, pt = player.lookPitch || 0;
    cam.lookAt(cam.position.x + Math.sin(y) * Math.cos(pt), cam.position.y + Math.sin(pt), cam.position.z + Math.cos(y) * Math.cos(pt));
    const fov = o.fov + (sp > (player.tuning.runSpeed || 9) + 1 ? o.sprintFov : 0);
    st.fov += (fov - st.fov) * damp(6, dt || 0.016);
    cam.fov = st.fov; cam.updateProjectionMatrix();
  });
  const dispose = rig.dispose;
  rig.dispose = () => { cam.remove(vm); dispose(); };
  return rig;
}

/** Stop the active rig (the camera stays where it is). */
export function stop(game) { if (game.__camRig) game.__camRig.dispose(); }
export function active(game) { return game.__camRig || null; }
