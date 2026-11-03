// Hand-built test levels in the CONTRACT `level` shape, for playtesting player/camera/gameplay without level.js.
import * as THREE from 'three';
import * as K from 'kit';

const toon = (c) => new THREE.MeshToonMaterial({ color: c });

function lights(game, sky = '#8fd3ff') {
  const T = THREE;
  game.scene.background = new T.Color(sky);
  game.scene.fog = new T.Fog(sky, 120, 420);
  game.scene.add(new T.HemisphereLight('#ffffff', '#5a7a4a', 1.6));
  const sun = new T.DirectionalLight('#fff3dc', 2.4);
  sun.position.set(40, 80, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 300 });
  sun.shadow.bias = -0.0005;
  game.scene.add(sun); game.scene.add(sun.target);
  game.update(() => { const p = game.__player; if (p) { sun.position.set(p.position.x + 40, p.position.y + 80, p.position.z + 30); sun.target.position.copy(p.position); } }, 25);
}

function block(game, group, pos, size, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), toon(color));
  m.position.copy(pos); if (opts.rot) m.rotation.set(...opts.rot);
  m.castShadow = true; m.receiveShadow = true; group.add(m);
  // grass cap
  if (opts.cap !== false) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(size.x + 0.2, 0.35, size.z + 0.2), toon(opts.capColor || '#7bd15a'));
    c.position.y = size.y / 2 + 0.05; c.receiveShadow = true; c.castShadow = true; m.add(c);
  }
  m.updateWorldMatrix(true, true);
  if (!opts.noCollide) K.Physics.addStatic(game, m, { shape: 'cuboid' });
  return m;
}

function base(kind) {
  return { kind, spawn: new THREE.Vector3(), spawnYaw: 0, bounds: new THREE.Box3(), route: [], checkpoints: [], collectibles: [],
    hazards: [], movers: [], goal: null, track: null, group: new THREE.Group(), colliders: [] };
}

export function platformer(game) {
  lights(game);
  const L = base('test_course'); game.scene.add(L.group);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const plat = (x, top, z, sx, sz, col = '#c8875a', h = 3) => block(game, L.group, V(x, top - h / 2, z), V(sx, h, sz), col);
  plat(0, 0, 0, 14, 14);
  plat(0, 1, 16, 8, 8);
  plat(4, 2.5, 27, 6, 6);
  // slope from z=31 to 43 rising 2.5 -> 6
  const sl = block(game, L.group, V(4, 2.5 + 1.75 - 0.6, 37), V(6, 1.2, 12.6), '#c8875a', { rot: [-Math.atan2(3.5, 12), 0, 0] });
  void sl;
  plat(4, 6, 49, 10, 10);
  // moving platform 56..70 (mover)
  const mover = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 5), toon('#ffcf5a'));
  mover.position.set(4, 5.6, 58); mover.castShadow = mover.receiveShadow = true; L.group.add(mover);
  L.movers.push({ mesh: mover, path: [V(4, 5.6, 58), V(4, 5.6, 70)], period: 5 });
  plat(4, 6.5, 79, 10, 10);
  // stairs
  for (let i = 0; i < 6; i++) plat(4, 7 + i * 0.5, 86 + i * 1.2, 6, 1.4, '#b77850', 2);
  plat(4, 10, 99, 12, 12);
  L.spawn.set(0, 0.1, 0); L.spawnYaw = 0;
  L.route = [V(0, 0, 0), V(0, 1, 16), V(4, 2.5, 27), V(4, 2.5, 31), V(4, 6, 43), V(4, 6, 49), V(4, 6, 55), V(4, 6.4, 64), V(4, 6.5, 73), V(4, 6.5, 79), V(4, 7, 85), V(4, 10, 95), V(4, 10, 99)];
  L.checkpoints.push({ position: V(4, 6, 49), radius: 2.5 });
  L.checkpoints.push({ position: V(4, 6.5, 79), radius: 2.5 });
  for (let i = 0; i < 4; i++) L.collectibles.push({ position: V(-3 + i * 2, 1.2, 4), tag: 'coin' });
  L.collectibles.push({ position: V(0, 3.2, 8), tag: 'coin' }, { position: V(2, 4.5, 22), tag: 'coin' }, { position: V(4, 3.7, 27), tag: 'gem' });
  for (let i = 0; i < 4; i++) L.collectibles.push({ position: V(4, 4.2 + i * 0.9, 33 + i * 3), tag: 'coin' });
  L.collectibles.push({ position: V(4, 7.8, 64), tag: 'star' });
  for (let i = 0; i < 5; i++) L.collectibles.push({ position: V(1 + i * 1.5, 7.7, 76), tag: 'coin' });
  L.collectibles.push({ position: V(0, 7.3, 47), tag: 'seed' }, { position: V(8, 7.3, 51), tag: 'seed' });
  L.hazards.push({ type: 'spinner', position: V(4, 6.5, 81), length: 8, speed: 1.6 });
  L.hazards.push({ type: 'enemy', kind: 'patrol', position: V(1, 6, 51) });
  L.hazards.push({ type: 'spikes', position: V(7, 2.5, 27), size: V(1.6, 0.6, 1.6) });
  L.hazards.push({ type: 'bounce', position: V(-4, 0.2, -4), power: 22 });
  L.hazards.push({ type: 'wind', position: V(4, 0.2, -4), size: V(3, 9, 3) });
  L.hazards.push({ type: 'saw', position: V(4, 6.2, 47), path: [V(1, 6.2, 47), V(7, 6.2, 47)], period: 3 });
  L.hazards.push({ type: 'crumble', position: V(-6, 0.5, 14), size: V(4, 0.8, 4) });
  L.hazards.push({ type: 'lava', position: V(-6, 0.25, 4), size: V(2, 0.4, 2) });
  L.goal = { position: V(4, 10, 101), radius: 2 };
  L.bounds.setFromObject(L.group);
  return L;
}

export function race(game, water = false) {
  lights(game, water ? '#9fe0ff' : '#8fd3ff');
  const L = base(water ? 'test_lagoon' : 'test_track'); game.scene.add(L.group);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 70 + Math.sin(a * 3) * 18;
    pts.push(new THREE.Vector3(Math.cos(a) * r * 1.2, 0, Math.sin(a) * r));
  }
  const track = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  L.track = track; L.trackWidth = 14;
  const width = 14;
  if (!water) {
    const ground = block(game, L.group, new THREE.Vector3(0, -1, 0), new THREE.Vector3(500, 2, 500), '#6cbf4a', { cap: false });
    void ground;
    // road ribbon
    const N = 400, posA = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, p = track.getPointAt(u % 1), t = track.getTangentAt(u % 1);
      const s = new THREE.Vector3(t.z, 0, -t.x).normalize().multiplyScalar(width / 2);
      posA.push(p.x + s.x, 0.04, p.z + s.z, p.x - s.x, 0.04, p.z - s.z);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3)); g.setIndex(idx); g.computeVertexNormals();
    const road = new THREE.Mesh(g, toon('#5b5670')); road.receiveShadow = true; L.group.add(road);
    // ramp on the back straight
    const u = 0.42, p = track.getPointAt(u), t = track.getTangentAt(u);
    const ramp = block(game, L.group, p.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(8, 0.6, 6), '#ffcf5a', { cap: false, noCollide: true });
    ramp.rotation.set(0, Math.atan2(t.x, t.z), 0); ramp.rotateX(-0.22); ramp.updateWorldMatrix(true, true);
    // replace collider with the rotated one
    K.Physics.addStatic(game, ramp, { shape: 'cuboid' });
    // continuous low barriers + decorative tyre stacks
    const M = 160;
    for (const side of [-1, 1]) {
      let prev = null;
      for (let i = 0; i <= M; i++) {
        const uu = (i % M) / M, pp = track.getPointAt(uu), tt = track.getTangentAt(uu);
        const s = new THREE.Vector3(tt.z, 0, -tt.x).normalize();
        const at = pp.clone().addScaledVector(s, side * (width / 2 + 2)); at.y = 0.6;
        if (prev) {
          const mid = prev.clone().add(at).multiplyScalar(0.5), len = prev.distanceTo(at);
          const m = block(game, L.group, mid, new THREE.Vector3(1, 1.2, len + 0.6), i % 2 ? '#ff5d5d' : '#ffffff', { cap: false, noCollide: true });
          m.rotation.y = Math.atan2(at.x - prev.x, at.z - prev.z); m.updateWorldMatrix(true, true);
          K.Physics.addStatic(game, m, { shape: 'cuboid' });
        }
        prev = at;
      }
    }
  } else {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshPhongMaterial({ color: '#2fb4e0', transparent: true, opacity: 0.85, shininess: 80 }));
    sea.rotation.x = -Math.PI / 2; sea.receiveShadow = true; L.group.add(sea);
    block(game, L.group, new THREE.Vector3(0, -5, 0), new THREE.Vector3(600, 2, 600), '#e9d39b', { cap: false });
    L.water = { y: 0 };
    // islands inside the loop and buoys
    for (const [x, z, r] of [[0, 0, 30], [70, 50, 8], [-60, -45, 10], [20, -95, 6]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.3, 8, 24), toon('#f2dc9a')); m.position.set(x, -2, z); m.castShadow = m.receiveShadow = true;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 1.5, 24), toon('#6cbf4a')); top.position.y = 4.5; m.add(top);
      L.group.add(m); m.updateWorldMatrix(true, true); K.Physics.addStatic(game, m, { shape: 'convex' });
    }
    for (let i = 0; i < 60; i++) {
      const uu = i / 60, pp = track.getPointAt(uu), tt = track.getTangentAt(uu);
      const s = new THREE.Vector3(tt.z, 0, -tt.x).normalize();
      for (const side of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), toon(i % 2 ? '#ff7a59' : '#ffd23f'));
        b.position.copy(pp).addScaledVector(s, side * (width / 2 + 3)); b.position.y = 0.2; b.castShadow = true; L.group.add(b);
      }
    }
  }
  L.spawn.copy(track.getPointAt(0)).setY(water ? 0.2 : 0.1);
  const t0 = track.getTangentAt(0); L.spawnYaw = Math.atan2(t0.x, t0.z);
  for (let i = 0; i < 40; i++) L.route.push(track.getPointAt(i / 40));
  for (let i = 1; i < 4; i++) L.checkpoints.push({ position: track.getPointAt(i / 4), radius: width / 2 });
  for (let i = 0; i < 6; i++) { const p = track.getPointAt(0.08 + i * 0.15); L.collectibles.push({ position: p.clone().setY(1.2), tag: 'coin' }); }
  L.hazards.push({ type: 'boost', position: track.getPointAt(0.2).setY(water ? 0.05 : 0.06), yaw: (() => { const t = track.getTangentAt(0.2); return Math.atan2(t.x, t.z); })() });
  L.hazards.push({ type: 'boost', position: track.getPointAt(0.7).setY(water ? 0.05 : 0.06), yaw: (() => { const t = track.getTangentAt(0.7); return Math.atan2(t.x, t.z); })() });
  L.goal = null;
  L.bounds.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(260, 30, 200));
  return L;
}

export function arena(game) {
  lights(game, '#ffd6a8');
  const L = base('test_arena'); game.scene.add(L.group);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  block(game, L.group, V(0, -1, 0), V(60, 2, 60), '#d9b38c', { capColor: '#e8c99a' });
  for (const [x, z, sx, sz] of [[0, 30.5, 61, 1], [0, -30.5, 61, 1], [30.5, 0, 1, 61], [-30.5, 0, 1, 61]]) block(game, L.group, V(x, 1.5, z), V(sx, 3, sz), '#a77a5a', { cap: false });
  for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, 0]]) block(game, L.group, V(x, 1.5, z), V(3, 3, 3), '#8a6a8a', { capColor: '#b58ab5' });
  block(game, L.group, V(18, 0.75, -2), V(6, 1.5, 6), '#c8875a');
  L.spawn.set(0, 0.1, 20); L.spawnYaw = Math.PI;
  L.route = [V(0, 0, 20), V(-20, 0, 10), V(-20, 0, -20), V(0, 0, -22), V(20, 0, -20), V(20, 0, 15), V(0, 0, 20)];
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; L.collectibles.push({ position: V(Math.cos(a) * 21, 1.1, Math.sin(a) * 21), tag: i % 6 === 0 ? 'gem' : 'coin' }); }
  L.hazards.push({ type: 'enemy', kind: 'chase', position: V(-15, 0, -15) }, { type: 'enemy', kind: 'patrol', position: V(15, 0, 5) }, { type: 'enemy', kind: 'turret', position: V(0, 0, -25) });
  L.hazards.push({ type: 'lava', position: V(-20, 0.02, 20), size: V(6, 0.5, 6) });
  L.goal = { position: V(18, 1.5, -2), radius: 2 };
  L.bounds.setFromCenterAndSize(V(0, 0, 0), V(62, 10, 62));
  return L;
}
