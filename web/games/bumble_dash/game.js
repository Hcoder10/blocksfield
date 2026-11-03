import * as K from 'kit';
import { scenery } from './scenery.js';

// Bumble Dash: Dash, boing and double-jump the spring meadow — grab the carrots and beat the clock!
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Bumble Dash" });
K.Look.apply(game, "toon_bright");
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "meadow_course", { size: "medium", collectibles: 20, seed: 7 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "seed";   // the plan's pickup

// --- Bumble Dash custom placements (before rules) ---
const route = level.route;
const V = (v, y = 0) => new K.THREE.Vector3(v.x, v.y + y, v.z);
// Spinning bars across the path at three spots (jump them)
[0.3, 0.55, 0.8].forEach((f, i) => {
  const idx = Math.min(route.length - 1, Math.floor(f * route.length));
  const a = route[idx], b = route[Math.min(route.length - 1, idx + 1)];
  const mid = new K.THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const dir = new K.THREE.Vector3().subVectors(b, a).normalize();
  const yaw = Math.atan2(dir.x, dir.z);
  level.hazards.push({ type: 'spinner', position: mid.clone(), length: 6.5, speed: 1.5 + i * 0.3, height: 0.9, yaw });
});
// Spring pads (bounce) + spring_pad visuals at two launch spots
[0.42, 0.72].forEach((f, i) => {
  const idx = Math.min(route.length - 1, Math.floor(f * route.length));
  const p = route[idx].clone();
  level.hazards.push({ type: 'bounce', position: p, power: 22, radius: 1.3 });
  K.World.prop(game, 'spring_pad', { position: p });
});
// Extra carrot pickups along the route for the 20 total / 10 target
for (let i = 1; i < route.length - 1; i += 3) {
  const a = route[i], b = route[Math.min(route.length - 1, i + 1)];
  const mid = new K.THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  level.collectibles.push({ position: mid.clone().add(new K.THREE.Vector3(0, 1.2, 0)), tag: 'seed' });
}
// Two bumblebee enemies patrolling the course
[0.45, 0.75].forEach((f) => {
  const idx = Math.min(route.length - 1, Math.floor(f * route.length));
  level.hazards.push({ type: 'enemy', kind: 'patrol', position: route[idx].clone() });
});

const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "bunny", "accessory": "scarf"}, colors: {"body": "#fff8ef", "accent": "#ff5a5f"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "seed", "target": 10, "label": "Carrots"}, "goal": true, "timer": 90, "lives": 3, "enemies": 2, objective: "Reach the flower arch before the clock runs out!"});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "seed", "label": "Carrots"}], "timer": true, "lives": true, "minimap": true, "style": "arcade"});
K.UI.titleScreen(game, {"title": "Bumble Dash", "subtitle": "Dash, boing and double-jump the spring meadow \u2014 grab the carrots and beat the clock!", "start": "Press Space", "credit": "A / D or arrow keys: move \u00b7 Space: jump, press again mid-air: double jump \u00b7 Shift: dash \u00b7 P: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);

// --- Bumble Dash juice: extra FX moments on top of FX.auto ---
const ppos = (p) => (p && p.position) || player.position;
game.on('bounce', (p) => {
  const pos = ppos(p);
  K.FX.burst(game, pos, { color: '#ffd54a', count: 24, speed: 8 });
  K.FX.ring(game, pos, { color: '#ff8a3d' });
  K.FX.text(game, pos.clone().add(new K.THREE.Vector3(0, 1.5, 0)), 'BOING!', { color: '#ff5a5f' });
});
game.on('stomp', (p, e) => {
  const pos = ppos(p);
  K.FX.burst(game, pos, { color: '#ffe066', count: 18, speed: 7 });
  K.FX.text(game, pos.clone().add(new K.THREE.Vector3(0, 1.5, 0)), '+STOMP!', { color: '#3aa655' });
});
game.on('dash', (p) => {
  K.FX.speedLines(game, 0.9);
  K.FX.dust(game, ppos(p), { color: '#e8d9b8' });
});
game.on('checkpoint', () => {
  K.UI.banner(game, 'Checkpoint!', { style: 'checkpoint' });
});
game.on('win', () => {
  K.FX.confetti(game, null, { count: 120 });
  K.FX.slowmo(game, 0.35, 0.8);
});
K.Debug.install(game, { level, player });
game.start();
