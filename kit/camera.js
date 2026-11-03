// camera.js: follow / chase / topdown / orbit / first-person cameras with spring smoothing and collision pull-in.
// One rig is active at a time (a new call replaces the old). Runs in lateUpdate order 20; while game.cameraOverride
// is set (debug survey cameras) the rig keeps tracking but core.js wins. See docs/Camera.md.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
  if (!player && game) player = game.__player;
  needPlayer('follow', player);
  if (player.type === 'kart' || player.type === 'boat') return chase(game, player, opts);
  if (player.type === 'fps') return firstPerson(game, player, opts);
  if (player.type === 'topdown') return topdown(game, player, opts);
  const o = { distance: 10, height: 1.6, pitch: 0.36, lookAhead: 1.6, autoYaw: 1.4, orbit: true, collide: true, fov: 60, ...opts };
  const d = installDrag(game);
  const st = { yaw: o.yaw ?? player.yaw + Math.PI, pitch: o.pitch, target: player.position.clone().add(new THREE.Vector3(0, o.height, 0)),
    ahead: new THREE.Vector3(), groundY: player.position.y, manualT: 0, dist: o.distance, pos: new THREE.Vector3(), first: true, zoom: 1,
    last: player.position.clone(), deadAt: null };
  const cam = game.camera;
  const occ = occluders(game, player);
  const rig = install(game, 'follow', o, (dt) => {
    if (dt <= 0 && !st.first) dt = 1 / 60;
    let p = player.position; const v = player.velocity;
    // respawn / teleport: cut to the new spot instead of flying the camera across the level
    if (p.distanceTo(st.last) > 6) { st.first = true; st.groundY = p.y; st.ahead.set(0, 0, 0); }
    st.last.copy(p);
    // falling to death: hold the shot where they fell (don't chase the body into the abyss)
    if (!player.alive) { cam.position.copy(st.pos); cam.lookAt(st.target); return; }   // hold the last shot until respawn
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
    if (player.grounded) st.groundY = p.y;
    else if (p.y < st.groundY) {
      // dropping to a lower platform: follow it down; falling into the void: hold the shot on the ledge
      const below = Physics.raycast(game, p.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, -1, 0), 25, { excludeCollider: player.collider });
      if (below) st.groundY = Math.max(p.y, below.point.y);
      else { st.groundY = Math.max(p.y, (st.voidHold ??= st.groundY) - 3); st.inVoid = true; }
    }
    if (player.grounded) { st.voidHold = undefined; st.inVoid = false; (st.ledge ??= new THREE.Vector3()).copy(p); }
    else if (p.y > st.groundY + 4) st.groundY = p.y - 4;
    // look-ahead along horizontal velocity
    const hv = new THREE.Vector3(v.x, 0, v.z);
    st.ahead.lerp(hv.clone().multiplyScalar(o.lookAhead / 12), damp(3, dt));
    // keep the player in frame on big jumps: the target rises once they are 2 above the tracked ground
    const want = new THREE.Vector3(p.x, Math.max(st.groundY + o.height, p.y + o.height - 2), p.z).add(st.ahead);
    // falling off the world: keep the ledge they fell from in the shot
    if (st.inVoid && st.ledge) { want.x = st.ledge.x * 0.6 + want.x * 0.4; want.z = st.ledge.z * 0.6 + want.z * 0.4; }
    if (st.first) st.target.copy(want);
    st.target.x += (want.x - st.target.x) * damp(10, dt);
    st.target.z += (want.z - st.target.z) * damp(10, dt);
    // follow drops quickly (a long fall must not leave the player below the frame), jumps lazily
    st.target.y += (want.y - st.target.y) * damp(player.grounded ? 6 : want.y < st.target.y - 1 ? 9 : 3, dt);
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
    // falling: tilt down a little more so the landing spot is in view
    const pitch = Math.max(0.12, st.pitch + (player.alive && v.y < -6 ? Math.min(0.35, -v.y * 0.012) : 0));
    const off = new THREE.Vector3(Math.sin(st.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(st.yaw) * Math.cos(pitch)).multiplyScalar(dist);
    let desired = st.target.clone().add(off);
    if (o.collide) desired = pullIn(game, st.target, desired, player);
    if (st.first) st.pos.copy(desired);
    // pull in fast, ease back out slowly
    const nearer = desired.distanceTo(st.target) < st.pos.distanceTo(st.target);
    st.pos.lerp(desired, damp(nearer ? 25 : 8, dt));
    // never look up at the sky: the camera stays above the point it looks at
    if (st.pos.y < st.target.y + 0.6) st.pos.y = st.target.y + 0.6;
    // and never trails far behind its ideal spot
    const lag = st.pos.distanceTo(desired); if (lag > 4) st.pos.lerp(desired, 1 - 4 / lag);
    cam.position.copy(st.pos);
    cam.lookAt(st.target);
    if (cam.fov !== o.fov) { cam.fov += (o.fov - cam.fov) * damp(6, dt); cam.updateProjectionMatrix(); }
    occ.update(dt);
    st.first = false;
  });
  const dispose = rig.dispose; rig.dispose = () => { occ.clear(); dispose(); };
  return rig;
}

// Fade whatever still hides the player after the collision pull-in (clouds, waterfalls, canopies, props without
// colliders): those meshes get their own faded material copy while they block the view, then get the original back.
function occluders(game, player, rays = null) {
  const ray = new THREE.Raycaster(), faded = new Map(), cam = game.camera;
  const head = new THREE.Vector3(), to = new THREE.Vector3();
  let k = 0, cands = [], candT = 0;
  const skip = (o) => { for (let q = o; q; q = q.parent) if (q === player.object || q.userData.noOcclude || q.isCamera || (game.__rules && q === game.__rules.root)) return true; return false; };
  function collect() {
    cands = [];
    game.scene.traverse(o => {
      if (!o.isMesh || !o.visible || o.isSprite || skip(o)) return;
      if (o.isInstancedMesh && o.count > 64) return;                     // grass / flowers: tiny, never hide the hero
      if (!o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const sc = o.getWorldScale(new THREE.Vector3());
      if (o.geometry.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z) > 30) return;   // terrain, water, sky domes
      cands.push(o);
    });
  }
  return {
    update(dt) {
      candT -= dt; if (candT <= 0) { collect(); candT = 2; }
      if ((k++ % 3) === 0) {
        const hits = new Set();
        if (rays) for (const [dir, far] of rays()) {
          ray.set(cam.position, dir); ray.far = far; ray.near = 0.05;
          for (const hit of ray.intersectObjects(cands, false)) hits.add(hit.object);
        }
        else for (const h of [1.0, 1.7]) {
          head.copy(player.position).y += h;
          to.subVectors(head, cam.position); const len = to.length(); if (len < 0.5) continue;
          ray.set(cam.position, to.divideScalar(len)); ray.far = len - 0.6; ray.near = 0.1;
          for (const hit of ray.intersectObjects(cands, false)) hits.add(hit.object);
        }
        for (const m of hits) if (!faded.has(m)) {
          const orig = m.material, mats = Array.isArray(orig) ? orig.map(x => x.clone()) : orig.clone();
          for (const x of [].concat(mats)) { x.transparent = true; x.depthWrite = false; x.userData.baseOpacity = x.opacity; }
          m.material = mats; faded.set(m, { orig, mats, a: 1, hit: true });
        }
        for (const [m, f] of faded) f.hit = hits.has(m);
      }
      for (const [m, f] of faded) {
        f.a += ((f.hit ? 0.22 : 1) - f.a) * Math.min(1, dt * 8);
        for (const x of [].concat(f.mats)) x.opacity = x.userData.baseOpacity * f.a;
        if (!f.hit && f.a > 0.97) { m.material = f.orig; for (const x of [].concat(f.mats)) x.dispose(); faded.delete(m); }
      }
    },
    clear() { for (const [m, f] of faded) m.material = f.orig; faded.clear(); },
  };
}

/**
 * Chase camera for vehicles: behind and above, swings with the heading, FOV kick on boost and with speed.
 * opts: { distance=7.5, height=2.6, lookAt=1.2, fov=64, boostFov=14, speedFov=8, stiffness=5 }
 */
export function chase(game, player, opts = {}) {
  if (!player && game) player = game.__player;
  needPlayer('chase', player);
  const o = { distance: 7.5, height: 2.6, lookAt: 1.2, fov: 64, boostFov: 10, speedFov: 6, stiffness: 5, collide: true, ...opts };
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
    // dolly-zoom: as the FOV widens with speed, move in so the vehicle keeps its size on screen
    const dist = (o.distance + Math.min(1, sp / maxS) * 0.8) * Math.tan(o.fov * Math.PI / 360) / Math.tan(st.fov * Math.PI / 360);
    const tgt = p.clone().add(new THREE.Vector3(0, o.lookAt, 0)).addScaledVector(f, 2.5);
    let desired = p.clone().addScaledVector(f, -dist).add(new THREE.Vector3(0, o.height, 0));
    if (o.collide) desired = pullIn(game, p.clone().add(new THREE.Vector3(0, 1.5, 0)), desired, player, 2);
    if (st.first) { st.pos.copy(desired); st.target.copy(tgt); }
    st.pos.x += (desired.x - st.pos.x) * damp(10, dt);
    st.pos.z += (desired.z - st.pos.z) * damp(10, dt);
    st.pos.y += (desired.y - st.pos.y) * damp(5, dt);
    // never trail more than a few units behind the ideal spot (boosts, teleports, respawns)
    const lag = st.pos.distanceTo(desired), maxLag = 1.2 + sp * 0.015;
    if (lag > maxLag) st.pos.lerp(desired, 1 - maxLag / lag);
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
  if (player === undefined && game) player = game.__player || null;
  const o = { height: 21, pitch: 1.05, yaw: 0, lookAhead: 2.5, fov: 50, ...opts };
  // keep it a real top-down view (55-85 deg, 18-45 high): flatter / lower settings lose the hero in the frame
  o.pitch = THREE.MathUtils.clamp(o.pitch, 0.96, 1.48); o.height = THREE.MathUtils.clamp(o.height, 16, 45);
  const st = { target: new THREE.Vector3(), ahead: new THREE.Vector3(), first: true };
  const cam = game.camera;
  const occ = player ? occluders(game, player) : null;
  const rig = install(game, 'topdown', o, (dt) => {
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
    if (occ) occ.update(dt);
    st.first = false;
  });
  const dispose = rig.dispose; rig.dispose = () => { if (occ) occ.clear(); dispose(); };
  return rig;
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
  if (!player && game) player = game.__player;
  needPlayer('firstPerson', player);
  const o = { eye: 1.55, fov: 72, bob: 0.05, sprintFov: 8, weapon: true, crosshair: true, ...opts };
  const cam = game.camera;
  const st = { phase: 0, fov: o.fov, dip: 0, recoil: 0, swayX: 0, swayY: 0, lastYaw: player.lookYaw, lastPitch: player.lookPitch || 0, hit: 0, kill: 0, hurt: 0, kick: 0 };
  const offs = [];
  offs.push(game.on('land', (pl, sp) => { if (pl === player) st.dip = Math.min(0.35, (sp || 0) * 0.012); }));
  offs.push(game.on('jump', (pl) => { if (pl === player) st.dip = -0.06; }));
  offs.push(game.on('shoot', (pl) => { if (pl === player) { st.recoil = 1; st.kick = 1; } }));
  // hit markers: a white X on a hit, red and bigger on a kill; red vignette + view kick when hurt
  offs.push(game.on('damage', (target, amount, by) => {
    if (target === player) { st.hurt = 1; st.dip = 0.12; return; }
    if (by === player) st.hit = 1;
  }));
  offs.push(game.on('death', (target) => { if (target !== player && st.hit > 0.5) st.kill = 1; }));
  // toy blaster + reticle parented to the camera (the camera joins the scene so its children render)
  const vm = new THREE.Group(); vm.name = 'viewmodel';
  if (o.weapon || o.crosshair) { if (!cam.parent) game.scene.add(cam); cam.add(vm); }
  let gun = null, muzzle = null;
  if (o.weapon) {
    const tm = (c) => new THREE.MeshToonMaterial({ color: c });
    gun = new THREE.Group();
    const col = player.character && player.character.mats.body.color ? '#' + player.character.mats.body.color.getHexString() : '#ff7a59';
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.15, 0.46, 3, 0.05), tm(col));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 14), tm('#3a3646')); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.01, -0.36);
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 8, 16), new THREE.MeshBasicMaterial({ color: '#7ff6ff', toneMapped: false })); tip.position.set(0, 0.01, -0.51);
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.2, 0.11, 2, 0.03), tm('#3a3646')); grip.position.set(0, -0.15, 0.1); grip.rotation.x = 0.3;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), new THREE.MeshBasicMaterial({ color: '#7ff6ff', toneMapped: false })); tank.rotation.x = Math.PI / 2; tank.position.set(0.078, 0.02, -0.02);
    gun.add(body, barrel, tip, grip, tank);
    muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#e8fdff', toneMapped: false, transparent: true, opacity: 0.85 }));
    muzzle.position.set(0, 0.03, -0.62); muzzle.visible = false; gun.add(muzzle);
    // the muzzle flash lights the world (reads great in dark looks)
    st.light = new THREE.PointLight('#9ff6ff', 0, 10, 1.4); st.light.position.set(0.2, 0, -2.6); vm.add(st.light);
    st.tipMat = tip.material;
    gun.scale.setScalar(0.42); gun.rotation.y = 0.06; gun.position.set(0.21, -0.19, -0.44);
    gun.traverse(m => { if (m.isMesh) { m.renderOrder = 10; m.material.depthTest = false; m.userData.noCollide = true; } });
    vm.add(gun);
  }
  let marker = null, vignette = null;
  if (o.crosshair) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.0085, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, toneMapped: false, transparent: true, opacity: 0.9 }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 10), ring.material);
    ring.position.z = dot.position.z = -0.5; ring.renderOrder = dot.renderOrder = 11; vm.add(ring, dot);
    marker = new THREE.Group(); marker.position.z = -0.5; vm.add(marker);
    const mm = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, toneMapped: false, transparent: true, opacity: 0 });
    for (const a of [1, 3, 5, 7]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.0085, 0.0018), mm); const r = a * Math.PI / 4; b.position.set(Math.cos(r) * 0.013, Math.sin(r) * 0.013, 0); b.rotation.z = r; b.renderOrder = 12; marker.add(b); }
    marker.userData.mat = mm;
  }
  {
    // damage vignette: a full-view red rim just in front of the camera
    const c2 = document.createElement('canvas'); c2.width = c2.height = 128; const x = c2.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 30, 64, 64, 92); gr.addColorStop(0, 'rgba(255,0,30,0)'); gr.addColorStop(1, 'rgba(255,20,40,0.9)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const h = 2 * Math.tan((o.fov + 20) * Math.PI / 360) * 0.2;
    vignette = new THREE.Mesh(new THREE.PlaneGeometry(h * 2.4, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c2), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    vignette.position.z = -0.2; vignette.renderOrder = 13; if (!cam.parent) game.scene.add(cam); if (!vm.parent) cam.add(vm); vm.add(vignette);
  }
  // anything within ~1.7 u in front of the eye fades out (decor bigger than its collider, walls while strafing)
  const fwd = new THREE.Vector3();
  const near = occluders(game, player, () => {
    cam.getWorldDirection(fwd); const out = [];
    for (const a of [0, 0.45, -0.45]) for (const p of [0, -0.35]) out.push([fwd.clone().applyAxisAngle(UP, a).add(new THREE.Vector3(0, p, 0)).normalize(), 1.7]);
    return out;
  });
  const rig = install(game, 'firstPerson', o, (dt) => {
    near.update(dt || 1 / 60);
    const fdt = dt || 1 / 60;
    if (gun) {
      st.recoil = Math.max(0, st.recoil - fdt * 12);
      const sp2 = Math.hypot(player.velocity.x, player.velocity.z);
      // sway: the blaster lags behind look turns and leans into strafes, then springs back
      const dyaw = angWrap(player.lookYaw - st.lastYaw), dpit = (player.lookPitch || 0) - st.lastPitch;
      st.lastYaw = player.lookYaw; st.lastPitch = player.lookPitch || 0;
      st.swayX += (THREE.MathUtils.clamp(dyaw * 1.6, -0.05, 0.05) - st.swayX) * Math.min(1, fdt * 10);
      st.swayY += (THREE.MathUtils.clamp(-dpit * 1.6, -0.04, 0.04) - st.swayY) * Math.min(1, fdt * 10);
      const run = Math.min(1, sp2 / 9);
      gun.position.set(0.21 + st.swayX + Math.sin(st.phase * 0.5) * 0.008 * run, -0.19 + st.swayY + Math.abs(Math.cos(st.phase * 0.5)) * 0.008 * run - st.dip * 0.1 - (player.grounded ? 0 : 0.015), -0.44 + st.recoil * 0.05);
      gun.rotation.set(st.recoil * 0.12, 0.06 + st.swayX * 2, -st.swayX * 3);
      muzzle.visible = st.recoil > 0.55; muzzle.scale.setScalar(0.5 + st.recoil * 0.8);
      st.light.intensity = st.recoil > 0.4 ? 3 * st.recoil : 0;
      if (st.tipMat) st.tipMat.color.setHSL(0.5, 1, 0.55 + 0.25 * st.recoil + 0.08 * Math.sin(game.time * 6));
    }
    st.hit = Math.max(0, st.hit - fdt * 6); st.kill = Math.max(0, st.kill - fdt * 3); st.hurt = Math.max(0, st.hurt - fdt * 1.6); st.kick = Math.max(0, st.kick - fdt * 12);
    if (marker) { const k = Math.max(st.hit, st.kill); marker.userData.mat.opacity = k; marker.userData.mat.color.set(st.kill > 0.05 ? '#ff4d5e' : '#ffffff'); marker.scale.setScalar(1 + st.kill * 0.6 + (1 - k) * 0.3); }
    if (vignette) vignette.material.opacity = st.hurt * 0.85;
    const sp = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.grounded) st.phase += (dt || 0) * sp * 1.1;
    const bob = player.grounded ? Math.sin(st.phase) * o.bob * Math.min(1, sp / 9) : 0;
    st.dip *= Math.exp(-(dt || 0) * 8);
    cam.position.copy(player.position).add(new THREE.Vector3(0, o.eye + bob - st.dip, 0));
    const y = player.lookYaw + (st.hurt > 0.7 ? Math.sin(game.time * 60) * 0.01 : 0), pt = (player.lookPitch || 0) + st.kick * 0.012;
    cam.lookAt(cam.position.x + Math.sin(y) * Math.cos(pt), cam.position.y + Math.sin(pt), cam.position.z + Math.cos(y) * Math.cos(pt));
    const fov = o.fov + (sp > (player.tuning.runSpeed || 9) + 1 ? o.sprintFov : 0);
    st.fov += (fov - st.fov) * damp(6, dt || 0.016);
    cam.fov = st.fov; cam.updateProjectionMatrix();
  });
  const dispose = rig.dispose;
  rig.dispose = () => { cam.remove(vm); near.clear(); for (const off of offs) off(); dispose(); };
  return rig;
}

/** Stop the active rig (the camera stays where it is). */
export function stop(game) { if (game.__camRig) game.__camRig.dispose(); }
export function active(game) { return game.__camRig || null; }
