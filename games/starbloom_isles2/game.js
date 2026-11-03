import * as K from 'kit';
import { scenery } from './scenery.js';

// Starbloom Isles: Hop, stomp, and bloom: light the beacon across the floating sky.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Starbloom Isles" });
K.Look.apply(game, "toon_bright", {
  sun: { elevation: 24, azimuth: -35, intensity: 2.6, color: "#fff2d8" },
  sky: { top: "#3f9fe8", horizon: "#ffe9a8", bottom: "#bfe9ff" },
  fog: { color: "#cfe9ff", near: 0.35, far: 1.15 },
  bloom: { strength: 0.45, radius: 0.7, threshold: 1.15 },
  grade: { saturation: 1.15, contrast: 1.05, vignette: 0.25 }
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "sky_islands", { size: "medium", collectibles: 30 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup

const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "fox", "accessory": "scarf"}, colors: {"body": "#ff8a3d", "accent": "#fff1dc"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "star", "target": 20, "label": "Star Blooms"}, "goal": true, "timer": false, "lives": 3, "enemies": 6,
  objective: (s) => s.goalOpen ? "Light the beacon!" : `Collect ${s.target - s.collected} more Star Blooms` });
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "star", "label": "Star Blooms"}], "timer": false, "lives": true, "minimap": true, "style": "cozy"});
K.UI.titleScreen(game, {"title": "Starbloom Isles", "subtitle": "Hop, stomp, and bloom: light the beacon across the floating sky.", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Space: jump (tap again mid-air to double-jump) \u00b7 Esc / P: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);

// Beacon portal juice: pulsing light rings as blooms are banked, full ring + confetti when it opens
let goalGlow = null;
if (level.goal) {
  goalGlow = K.FX.sparkles(game, level.goal.position, { color: ['#ffe066', '#7df9ff'], radius: 3.5, rate: 6 });
}
let lastCollected = 0;
game.on('collect', (item) => {
  if (item.tag === 'star') {
    const n = game.state.collected;
    // coral + lavender halo so each bloom pops against the mint grass
    K.FX.burst(game, item.position, { count: 14, speed: 4.5, size: 0.28, life: 0.55, gravity: 0, shape: 'glow', color: ['#ff7f66', '#c9a7ff', '#ffe066'] });
    if (n % 5 === 0 && n > lastCollected) {
      lastCollected = n;
      K.FX.ring(game, level.goal.position, { color: '#ffe066', radius: 5, life: 0.8 });
    }
  }
});
game.on('goalOpen', (goal) => {
  K.FX.ring(game, goal.position, { color: '#7df9ff', radius: 6, life: 1.2 });
  K.FX.starBurst(game, goal.position, { color: '#ffe066', scale: 2 });
  K.UI.banner(game, 'The beacon is lit!', { style: 'stage_clear', sub: 'Reach the portal to win' });
});
game.on('stomp', (p, enemy) => {
  K.FX.starBurst(game, enemy.position, { color: '#ffe066', scale: 1.4 });
  K.FX.text(game, enemy.position, 'STOMP!', { color: '#ffe066', size: 1.1 });
});
game.on('death', (target) => {
  if (target === player) { K.FX.poof(game, player.position, { color: '#fff1dc' }); K.FX.shake(game, 0.5); }
});
game.on('win', () => {
  K.FX.confetti(game, null, { count: 200, colors: ['#ffe066', '#7df9ff', '#ff8a3d', '#fff1dc'] });
  K.FX.starBurst(game, level.goal.position, { color: '#ffe066', scale: 3 });
});
K.Debug.install(game, { level, player });
game.start();
