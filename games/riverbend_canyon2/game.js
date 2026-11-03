import * as K from 'kit';
import { scenery } from './scenery.js';

// Riverbend Canyon: Paddle and hop down a red-rock canyon river to the waterfall pool.
const game = await K.createGame({ assets: './assets/assets.json', seed: 433, title: "Riverbend Canyon" });
K.Look.apply(game, "desert", {
  sun: { elevation: 7, azimuth: 115, intensity: 3.1, color: '#ffb347' },    // very low golden-hour rake, long shadows
  fog: { color: '#e8a063', near: 0.2, far: 0.85 },                           // deeper warm haze in the canyon depths
  grade: { saturation: 1.1, contrast: 1.07, vignette: 0.35 },                // warm grade + title vignette
  bloom: { strength: 0.4, radius: 0.5, threshold: 1.2 },
  palette: { water: '#35e0cc', waterDeep: '#0c7f78' },                       // brighter turquoise, deeper riverbed
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
// Composed canyon river run: a winding turquoise ribbon through red-rock mesas,
// stepping rocks, drifting rafts and a waterfall pool at the end.
const level = K.Level.compose(game, {
  ground: { style: 'sand', y: -3, size: 300, hills: 22 },
  pieces: [
    { type: 'water', position: [30, -1.6, 38], size: 320, waves: 0.4 },  // the river: rippling turquoise
    { type: 'cliff', position: [0, 2, 0], size: 8 },                 // start mesa
    { type: 'platform', position: [0, 1, 12.5], size: 2 },
    { type: 'platform', position: [4, 1.5, 17.5], size: 2 },
    { type: 'platform', position: [9, 2, 22], size: 2 },
    { type: 'cliff', position: [16, 4, 30], size: 7 },
    { type: 'bridge', from: [20.8, 4, 32.7], to: [29.2, 4.5, 37.3] },
    { type: 'cliff', position: [34, 4.5, 40], size: 7 },
    { type: 'stairs', from: [34, 4.5, 45.5], to: [34, 1, 53] },
    { type: 'platform', position: [34, 1, 56], size: [6, 4, 6] },
    { type: 'pillar', position: [34, 2.5, 63] },
    { type: 'pillar', position: [30, 4.5, 68] },
    { type: 'cliff', position: [22, 6, 76], size: 8 },               // goal mesa
    // canyon walls either side (scenery) - tall mesas for a sense of enclosure
    { type: 'cliff', position: [-22, 13, 6], size: 11, route: false },
    { type: 'cliff', position: [38, 15, 24], size: 11, route: false },
    { type: 'cliff', position: [-8, 14, 44], size: 12, route: false },
    { type: 'cliff', position: [52, 14, 58], size: 12, route: false },
    { type: 'cliff', position: [2, 14, 70], size: 11, route: false },
    { type: 'cliff', position: [-30, 15, 34], size: 11, route: false },
    { type: 'cliff', position: [46, 16, 74], size: 11, route: false },
    { type: 'arch', position: [10, 2, 60], width: 8, route: false }, // natural arch landmark
  ],
  goal: true,
  collectibles: 'along_route',
  dressing: 'auto',
  seed: 433,
});
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = 'seed';   // the plan's pickup
if (level.issueText) console.warn('[level]', level.issueText);

// --- Plan features: hazards, spring pads, drifting rafts, patrolling boulders ---
// The ALONG helper: a point + facing at a fraction along the level route.
const ALONG = (f) => { const r = level.route, i = Math.min(r.length - 2, Math.max(0, Math.floor(f * (r.length - 1)))), a = r[i], b = r[i + 1]; return { p: [a.x, a.y, a.z], yaw: Math.atan2(b.x - a.x, b.z - a.z) }; };
// Saw blades set in rock slots along the route (jump over them).
for (const f of [0.22, 0.5, 0.74]) {
  const a = ALONG(f);
  level.hazards.push({ type: 'saw', position: new K.THREE.Vector3(a.p[0], a.p[1] + 0.4, a.p[2]), radius: 1.1 });
}
// A couple of spring pads on rocks for big leaps.
for (const f of [0.35, 0.62]) {
  const a = ALONG(f);
  level.hazards.push({ type: 'bounce', position: new K.THREE.Vector3(a.p[0] + 1.6, a.p[1], a.p[2] - 1.2), power: 26 });
}
// Drift rafts: log rafts bobbing on the river, drifting downstream - ride them.
const raftSpots = [[6, 15], [14, 25], [30, 50], [26, 66]];
const raftZones = [];
for (const [f, off] of raftSpots) {
  const a = ALONG(f);
  const dx = Math.sin(a.yaw), dz = Math.cos(a.yaw);
  const px = a.p[0] + dx * off, pz = a.p[2] + dz * off;
  level.movers.push({ mesh: null, path: [new K.THREE.Vector3(px, -1.1, pz), new K.THREE.Vector3(px + dx * 14, -1.1, pz + dz * 14)], period: 9, type: 'raft' });
  raftZones.push([px, -1.1, pz]);
}
// Patrolling boulders: 4 patrol enemies spread along the route (Gameplay spawns them).
const enemySpots = [0.18, 0.42, 0.6, 0.82];
for (const f of enemySpots) {
  const a = ALONG(f);
  level.hazards.push({ type: 'enemy', kind: 'patrol', position: new K.THREE.Vector3(a.p[0], a.p[1], a.p[2]) });
}
// Lily seeds: 24 along the route (18 needed to feel complete).
const seedSpots = [];
for (let i = 1; i <= 24; i++) {
  const a = ALONG(i / 25);
  seedSpots.push([a.p[0], a.p[1] + 1.2, a.p[2]]);
}
level.collectibles = seedSpots.map(p => ({ position: new K.THREE.Vector3(p[0], p[1], p[2]), tag: 'seed' }));

const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "frog", "accessory": "backpack"}, colors: {"body": "#5ec93f", "accent": "#ffd23f"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
// Sparse desert dressing: dry ochre grass + scrub clustered on the riverbanks and rock tops
// (never on the path), with a segmented cactus every third spot for contrast.
for (let i = 2, k = 0; i < level.route.length - 1; i += 2, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 5 : -5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 3) continue;
  if (k % 3 === 0) {
    K.World.foliage(game, { area: { center: [x, y, z], radius: 0.9 }, kinds: ['cactus'], density: 1, seed: 433 + k * 7 });
  } else {
    K.World.foliage(game, { area: { center: [x, y, z], radius: 1.3 }, kinds: ['grass_dry', 'bush'], density: 0.7, seed: 433 + k * 7 });
  }
}
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "seed", "target": 18, "label": "Lily Seeds"}, "goal": true, "timer": false, "lives": 3});
// Rip-current trigger zones: invisible pads at each raft's boarding point.
// Stepping on one (i.e. hopping onto a raft) fires the Rip Current rule.
for (let i = 0; i < raftZones.length; i++) {
  K.Mechanics.add(game, { type: 'zone', id: 'raft' + i, position: raftZones[i], size: [4, 2, 4] });
}
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "seed", "label": "Lily Seeds"}], "timer": false, "lives": true, "minimap": true, "style": "fantasy", "objective": "Collect 18 Lily Seeds, then reach the goal"});
K.UI.titleScreen(game, {"title": "Riverbend Canyon", "subtitle": "Paddle and hop down a red-rock canyon river to the waterfall pool.", "start": "Press Space", "credit": "WASD / arrows: run \u00b7 Space: jump (again in the air: double jump) \u00b7 Shift: dash / long jump", "countdown": false});   // not awaited: it pauses the game until a key
// signature mechanics (K.Mechanics, after Gameplay.rules)
// mechanic: Frog Hop (tune): A springy leap and a quick dash let the frog clear wide rock gaps and drift rafts.
K.Mechanics.tune(player, {"jump": 1.2, "speed": 1.05, "dash": true, "glide": true, "airJumps": 1, "size": 0.8});
// mechanic: Drift Rafts (custom): Log rafts bob and drift down the current - hop on and ride them across the wide water.
// The raft movers are in level.movers (Gameplay animates them); this custom mechanic tracks
// whether the frog is riding one and fires the 'raftRide' event the Rip Current rule listens for.
K.Mechanics.custom(game, {
  name: 'Drift Rafts',
  text: 'Log rafts bob and drift down the current - hop on and ride them across the wide water.',
  update(dt, ctx) {
    const p = ctx.player;
    if (!p || !p.object) return;
    const pos = p.position;
    let riding = null;
    for (const m of (ctx.level.movers || [])) {
      const mesh = m.mesh;
      if (!mesh || !mesh.position) continue;
      const dx = pos.x - mesh.position.x, dz = pos.z - mesh.position.z;
      if (Math.abs(dx) < 3 && Math.abs(dz) < 3 && Math.abs(pos.y - mesh.position.y) < 2) { riding = m; break; }
    }
    const was = ctx.vars.raftRiding;
    ctx.vars.raftRiding = !!riding;
    if (riding && !was) {
      ctx.emit('raftRide', riding);
      ctx.toast('Riding the current!', 2);
    }
  }
});
// mechanic: Rip Current (rule): Ride a raft and the current pushes you downstream - time your hops off before it sweeps you past the rocks.
for (let i = 0; i < raftZones.length; i++) {
  K.Mechanics.rule(game, {
    name: 'Rip Current',
    text: 'Ride a raft and the current pushes you downstream - time your hops off before it sweeps you past the rocks.',
    when: 'enter',
    id: 'raft' + i,
    do: [{ tune: { speed: 1.45 }, seconds: 3 }, { banner: 'Rip current!' }, { sfx: 'boost' }]
  });
}
// TWIST mechanic (invented): Lily Rush - every 6 lily seeds collected, the frog gets a short
// springy highjump + speed burst and a splash of sparkles. Keeps the pacing bouncy.
K.Mechanics.rule(game, {
  name: 'Lily Rush',
  text: 'Every 6 lily seeds: a springy Lily Rush burst!',
  when: 'collect',
  tag: 'seed',
  every: 6,
  do: [
    { give: 'highjump', duration: 6 },
    { give: 'speed', duration: 4 },
    { banner: 'Lily Rush!' },
    { sfx: 'powerup' },
    { fx: 'sparkle' }
  ]
});
K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
