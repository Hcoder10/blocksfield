import * as K from 'kit';
import { scenery } from './scenery.js';

// Cloudhop Meadows: Hop, dash and bloom your way to the flower portal at the top of the sky!
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Cloudhop Meadows" });
K.Look.apply(game, "candy", {
  quality: "high",
  sun: { elevation: 30, intensity: 2.2, color: "#fff0d0" },   // warm afternoon sun
  grade: { saturation: 1.12, contrast: 1.04 },                // vibrant but not fried
  bloom: { strength: 0.45, radius: 0.6 },                     // star seeds + portal glow
  sky: { horizon: "#ffe8d6" },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "sky_islands", { size: "medium", collectibles: 30, seed: 7 });
// One seed per hop between islands: the route is a straight line to the 12-seed goal.
const V3 = K.THREE.Vector3;
for (let i = 1; i < level.route.length - 1; i++) {
  const a = level.route[i - 1], b = level.route[i];
  const mid = a.clone().add(b).multiplyScalar(0.5);
  if (level.collectibles.some(c => c.position.distanceTo(mid) < 2)) continue;
  level.collectibles.push({ position: mid.clone().add(new V3(0, 2.6, 0)), tag: "seed" });
}
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "seed";   // the plan's pickup

// Spinning thorn bars in the hops between islands: dodge mid-jump.
const route = level.route;
for (let i = 3; i < route.length - 3; i += 3) {
  const a = route[i], b = route[i + 1];
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const side = new V3(-dir.z, 0, dir.x);
  const h = level.hazards.find(hz => hz.type === 'spinner');
  const len = Math.min(7, a.distanceTo(b) * 0.85);
  // Offset to the side so the bar sweeps the hop lane, not the seed above it.
  level.hazards.push({
    type: 'spinner',
    position: mid.clone().add(side.multiplyScalar(1.2)).setY(mid.y + 0.9),
    length: len,
    yaw: Math.atan2(dir.x, dir.z),
    speed: 1.6,
  });
  // Keep the hop's seed clear of the bar's sweep.
  const seed = level.collectibles[level.collectibles.length - 1];
  if (seed) seed.position.add(side.multiplyScalar(-0.9));
}

const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "bunny", "accessory": "scarf"}, colors: {"body": "#ff8fc7", "accent": "#6ee7b7", scarf: "#6ee7b7"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "seed", "target": 12, "label": "Star Seeds"}, "goal": true, "timer": 180, "lives": 3});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "seed", "label": "Star Seeds", "target": 12}], "timer": true, "lives": true, "minimap": true, "objective": "Collect 12 Star Seeds, then reach the flower portal", "style": "arcade"});
K.UI.titleScreen(game, {"title": "Cloudhop Meadows", "subtitle": "Hop, dash and bloom to the flower portal!", "start": "Press Space", "credit": "WASD: run \u00b7 Space: jump / double jump \u00b7 Shift: dash \u00b7 P: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);

// Dash juice: sparkle trail + speed lines on every dash.
game.on('dash', (p) => {
  K.FX.speedLines(game, 0.8, { pulse: 0.25 });
  K.FX.burst(game, p.position, { count: 14, speed: 7, size: 0.3, life: 0.5, shape: 'spark', color: ['#6ee7b7', '#ff8fc7'], up: 0.1 });
});
// Star seed pickup juice: star burst + floating +2.
game.on('collect', (item) => {
  if (item && item.tag === 'seed') {
    K.FX.starBurst(game, item.position, { color: '#ffd23f', scale: 1.2 });
    K.FX.text(game, item.position, '+2', { color: '#ffd23f', size: 1.1 });
  }
});
// Win: confetti + star burst at the portal.
game.on('win', () => {
  K.FX.confetti(game, null, { count: 200, colors: ['#ff8fc7', '#6ee7b7', '#ffd23f', '#8ec5ff'] });
  if (level.goal) K.FX.starBurst(game, level.goal.position, { color: '#ffd23f', scale: 2, count: 40 });
});
K.Debug.install(game, { level, player });
game.start();
