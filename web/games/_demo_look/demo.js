// Look/World/Level demo: ?kind=sky_islands&look=candy&cam=overview|hero|side|top|low|mid|orbit&quality=high&seed=1&size=medium&hud=0&route=1
// Imports the A-owned modules directly so it keeps working while other kit modules are mid-edit.
import * as THREE from 'three';
import { createGame } from '../../kit/core.js';
import * as Look from '../../kit/look.js';
import * as World from '../../kit/world.js';
import * as Level from '../../kit/level.js';

const q = new URLSearchParams(location.search);
const kind = q.get('kind') || 'sky_islands';
const look = q.get('look') || 'toon_bright';
const cam = q.get('cam') || 'hero';
const game = await createGame({ seed: +(q.get('seed') || 1) });
Look.apply(game, look, { quality: q.get('quality') || 'high', autoQuality: q.get('auto') === '1' });
const t0 = performance.now();
const level = Level.build(game, kind, { size: q.get('size') || 'medium', seed: +(q.get('seed') || 1), collectibles: 40 });
const buildMs = performance.now() - t0;

// stand-ins for gameplay so screenshots read at the right scale: coins, a hero capsule, checkpoint + goal rings
const coinMat = Look.material(game, { kind: 'emissive', color: 'accent', emissiveIntensity: 0.7 });
const coinGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.16, 20).rotateX(Math.PI / 2);
const coins = new THREE.InstancedMesh(coinGeo, coinMat, Math.max(1, level.collectibles.length));
const m4 = new THREE.Matrix4();
coins.castShadow = true; coins.frustumCulled = false; game.scene.add(coins);
game.update((dt, t) => {
  level.collectibles.forEach((c, i) => { m4.makeRotationY(t * 2 + i * 0.3).setPosition(c.position.x, c.position.y + Math.sin(t * 3 + i) * 0.15, c.position.z); coins.setMatrixAt(i, m4); });
  coins.instanceMatrix.needsUpdate = true;
});
const hero = new THREE.Group();
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.8, 6, 12), Look.material(game, { color: 'primary' }));
body.position.y = 0.9; body.castShadow = true; hero.add(body);
const eyeM = Look.material(game, { color: '#ffffff' });
for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), eyeM); e.position.set(s * 0.18, 1.3, 0.38); hero.add(e); }
hero.position.copy(level.spawn).add(new THREE.Vector3(0, -1, 0)); hero.rotation.y = level.spawnYaw; game.scene.add(hero);
if (level.goal) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(level.goal.radius, 3), 0.14, 8, 40).rotateX(Math.PI / 2), Look.material(game, { kind: 'emissive', color: 'good', emissiveIntensity: 0.9 }));
  ring.position.copy(level.goal.position); game.scene.add(ring);
}
for (const c of level.checkpoints) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(c.radius * 0.6, 0.12, 6, 32).rotateX(Math.PI / 2), Look.material(game, { kind: 'emissive', color: 'secondary', emissiveIntensity: 0.8 }));
  ring.position.copy(c.position); game.scene.add(ring);
}
for (const h of level.hazards.filter(h => h.type === 'boost')) World.prop(game, 'boost_pad', { position: h.position, yaw: h.yaw, collider: false });
for (const mv of level.movers) {
  const a = mv.path[0], b = mv.path[1];
  game.update((dt, t) => { const k = 0.5 - 0.5 * Math.cos(t / mv.period * Math.PI * 2); mv.mesh.position.lerpVectors(a, b, k); });
}
if (q.get('route') === '1') {
  const g = new THREE.BufferGeometry().setFromPoints(level.route.map(p => p.clone().add(new THREE.Vector3(0, 0.3, 0))));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ff00ff', depthTest: false })); line.renderOrder = 999;
  game.scene.add(line);
}

// cameras framed from the level
const box = level.bounds, ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
const R = Math.max(sz.x, sz.z) * 0.5;
const fwd = new THREE.Vector3(Math.sin(level.spawnYaw), 0, Math.cos(level.spawnYaw));
const along = (f, back, up, side, ahead) => {
  const i = Math.floor((level.route.length - 1) * f), p = level.route[i], n = level.route[Math.min(i + 3, level.route.length - 1)];
  const d = n.clone().sub(p).setY(0).normalize(), s = new THREE.Vector3(d.z, 0, -d.x);
  return [p.clone().addScaledVector(d, -back).addScaledVector(s, side).add(new THREE.Vector3(0, up, 0)), p.clone().addScaledVector(d, ahead).add(new THREE.Vector3(0, 1, 0))];
};
const cams = {
  overview: () => [ctr.clone().add(new THREE.Vector3(R * 0.75, R * 0.62 + sz.y * 0.4, R * 0.95)), ctr.clone()],
  side: () => [ctr.clone().add(new THREE.Vector3(0, sz.y * 0.4 + R * 0.18, R * 1.35)), ctr.clone()],
  top: () => [ctr.clone().add(new THREE.Vector3(0.01, R * 2.1, 0)), ctr.clone()],
  hero: () => [level.spawn.clone().addScaledVector(fwd, -9).add(new THREE.Vector3(0, 4.2, 0)), level.spawn.clone().addScaledVector(fwd, 12).add(new THREE.Vector3(0, 0.5, 0))],
  low: () => along(0.45, 10, 4.5, 2, 10),
  mid: () => along(0.7, 12, 6, -3, 12),
  end: () => along(0.93, 12, 5, 3, 12),
  // player-height chase cameras (what a follow camera shows while playing)
  chase: () => along(0.06, 6.5, 2.8, 0, 9),
  chase_mid: () => along(0.5, 6.5, 2.8, 0, 9),
  chase_end: () => along(0.85, 6.5, 2.8, 0, 9),
};
const orbit = cam === 'orbit';
function setCam(name) {
  const f = cams[name] || cams.hero;
  const [p, t] = f();
  game.cameraOverride = { position: p, target: t };
}
setCam(orbit ? 'overview' : cam);
if (orbit) game.update((dt, t) => { const a = t * 0.15; game.cameraOverride.position.set(ctr.x + Math.cos(a) * R * 1.1, ctr.y + R * 0.55, ctr.z + Math.sin(a) * R * 1.1); });

// fps meter
const frames = [];
let last = performance.now();
game.renderer.info.autoReset = false;
let infoCalls = 0, infoTris = 0;
game.lateUpdate(() => { infoCalls = game.renderer.info.render.calls; infoTris = game.renderer.info.render.triangles; game.renderer.info.reset(); const n = performance.now(); frames.push(n - last); last = n; if (frames.length > 240) frames.shift(); }, 99);
const hud = document.getElementById('hud');
if (q.get('hud') === '0') hud.style.display = 'none';
setInterval(() => {
  const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
  hud.textContent = `${kind} / ${look} / ${cam}   ${(1000 / avg).toFixed(0)} fps  calls ${infoCalls}  tris ${(infoTris / 1000).toFixed(0)}k  build ${buildMs.toFixed(0)}ms`;
}, 500);
game.start();
requestAnimationFrame(() => requestAnimationFrame(() => {
  window.__kit = Object.assign(window.__kit || {}, {
    ready: true, level, game,
    errors: window.__kitErrors || [],
    camera(pos, target) { game.cameraOverride = { position: new THREE.Vector3(...pos), target: new THREE.Vector3(...target) }; },
    cam: setCam,
    state() {
      const sorted = [...frames].sort((a, b) => a - b);
      const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
      return { kind, look, fps: +(1000 / avg).toFixed(1), p95ms: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2),
        calls: infoCalls, tris: infoTris, buildMs: +buildMs.toFixed(0),
        route: level.route.length, collectibles: level.collectibles.length, colliders: level.colliders.length,
        issues: Level.validate(level), errors: (window.__kitErrors || []).length };
    },
  });
}));
