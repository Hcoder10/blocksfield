import * as K from 'kit';
import { scenery } from './scenery.js';

// Dune Raiders: Blast the scorpions, grab the gold, and run for the sun gate.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Dune Raiders" });
K.Look.apply(game, "desert", {
  sun: { elevation: 14, azimuth: 35, intensity: 2.6 },          // low late-afternoon sun, long shadows
  fog: { near: 0.35, far: 1.15 },                               // faint heat-haze
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "canyon", { size: "medium", collectibles: 24, seed: 7 });

// Ancient ruin cover along the canyon floor to break turret sightlines (before rules).
for (let i = 4, k = 0; i < level.route.length - 3; i += 5, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 5 : -5);
  const x = a.x + side.x, z = a.z + side.z;
  const y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2.5) continue;
  const kind = k % 3 === 0 ? 'ruins' : (k % 3 === 1 ? 'pillar' : 'arch');
  K.World.prop(game, kind, { position: [x, y, z], yaw: Math.atan2(b.x - a.x, b.z - a.z) + 0.6 });
}

const player = K.Player.create(game, { type: "topdown", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "robot", "accessory": "backpack"}, colors: {"body": "#e6b455", "accent": "#a63d2a"}, boltColor: "#ffd23f" });
K.Camera.topdown(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "coin", "target": 20, "label": "Relics"}, "goal": true, "timer": false, "lives": 3, "enemies": 8});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "coin", "label": "Relics"}], "timer": false, "lives": true, "minimap": true, "objective": "Grab 20 relics to open the sun gate", "style": "arcade"});
K.UI.titleScreen(game, {"title": "Dune Raiders", "subtitle": "Grab 20 relics, blast the scorpions, run for the sun gate!", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Mouse: aim blaster \u00b7 Left click: fire blaster \u00b7 P / Esc: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);

// --- Dune Raiders juice on top of the auto FX/Audio ---
game.on('collect', (item) => {
  if (item && item.tag === 'coin') K.FX.text(game, item, '+1', { color: '#ffd23f', size: 1 });
});
game.on('goalOpen', (goal) => {
  const pos = goal && goal.position ? goal.position : level.goal.position;
  K.FX.ring(game, pos, { color: '#ffd23f', radius: 6, life: 0.9, flat: true });
  K.FX.starBurst(game, pos, { color: ['#ffd23f', '#ff9d3f'], scale: 1.6 });
  K.UI.banner(game, 'THE SUN GATE OPENS', { style: 'stage_clear', sub: 'Run for it!' });
});
game.on('win', () => K.FX.confetti(game, null, { count: 220, colors: ['#ffd23f', '#ff9d3f', '#f5e6c8'] }));
game.on('death', (t) => {
  if (t === player || (t && t === player.object)) K.FX.shake(game, 0.5);
});
K.Debug.install(game, { level, player });
game.start();
