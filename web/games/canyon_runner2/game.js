import * as K from 'kit';
import { scenery } from './scenery.js';

// Canyon Runner: Chain the boost pads. Kiss the red rock. Beat the sunset clock.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Canyon Runner" });
K.Look.apply(game, "sunset", { sun: { elevation: 7 }, fog: { color: '#ffb37a', near: 0.25, far: 0.85 } });
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "canyon", { size: "medium", collectibles: 24, seed: 7 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup
const player = K.Player.create(game, { type: "kart", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "robot", "accessory": "scarf"}, colors: {"body": "#2ec4b6", "accent": "#ff6b35", kart: "#2ec4b6"} });
K.Camera.chase(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "star", "target": 12, "label": "Embers"}, "goal": true, "timer": 150, "lives": false, "mode": "timetrial", "race": {"laps": 2, "opponents": 0}});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "icon_ember_star", "label": "Embers"}], "timer": true, "lives": false, "minimap": true, "style": "sleek", "lap": true, "speedometer": {"max": 140, "unit": "km/h"}, "objective": "2 laps before sundown"});
K.UI.titleScreen(game, {"title": "Canyon Runner", "subtitle": "Chain the boost pads. Kiss the red rock. Beat the sunset clock.", "start": "Press Space", "credit": "W / \u2191: throttle \u00b7 S / \u2193: brake / reverse \u00b7 A / D or \u2190 / \u2192: steer \u00b7 Shift: boost (stacks on boost pads)", "countdown": true});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
K.Audio.music(game, 'music_main');
K.Audio.preload(game, ['sfx_boost', 'sfx_collect', 'sfx_checkpoint', 'sfx_hit', 'sfx_win', 'sfx_lose']);

// --- Canyon Runner juice ---
// Amber dust trail behind the hover-bike
K.FX.trail(game, player.object, { color: '#ffb37a', colorEnd: '#ff6b35', width: 0.6, length: 14, offset: [0, 0.3, -0.4], vertical: true });
// Soft hover hum under the kart, pitch rising into boosts
let hoverS = null;
try {
  const AC = K.Audio.context().constructor;
  const ctx = K.Audio.context();
  const g = ctx.createGain(); g.gain.value = 0.05;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 110;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(ctx.destination);
  o1.start(); o2.start();
  hoverS = { o1, o2, g };
} catch (e) { hoverS = null; }

let lastBoost = 0;
game.on('boost', (p, kind) => {
  const t = game.time || 0;
  if (t - lastBoost < 0.6) return;
  lastBoost = t;
  K.FX.ring(game, player.object, { color: '#ffd23f', radius: 3, flat: true });
  K.FX.speedLines(game, 0.9, { pulse: 0.8 });
  K.Audio.sfx(game, 'sfx_boost');
  if (hoverS) { hoverS.o1.frequency.value = 120; hoverS.o2.frequency.value = 240; }
  setTimeout(() => { if (hoverS) { hoverS.o1.frequency.value = 55; hoverS.o2.frequency.value = 110; } }, 700);
});
game.on('collect', (item) => {
  if (item && item.tag === 'star') K.Audio.sfx(game, 'sfx_collect');
});
game.on('checkpoint', (cp) => K.Audio.sfx(game, 'sfx_checkpoint'));
game.on('damage', (target) => {
  if (target && target === player) K.Audio.sfx(game, 'sfx_hit');
});
game.on('win', () => {
  K.Audio.sfx(game, 'sfx_win');
  K.FX.slowmo(game, 0.3, 0.6);
  K.FX.confetti(game, null, { colors: ['#ffb37a', '#ff6b35', '#ffd23f', '#2ec4b6'] });
  K.FX.speedLines(game, 1, { pulse: 1 });
});
game.on('lose', (reason) => K.Audio.sfx(game, 'sfx_lose'));
// Dust puffs on hard turns
let lastDust = 0;
game.update((dt) => {
  if (player.mode === 'drive' && player.speed > 14 && Math.abs(player.velocity.x) + Math.abs(player.velocity.z) > 0.1) {
    const t = game.time || 0;
    if (t - lastDust > 0.25) { lastDust = t; K.FX.dust(game, player.position, { amount: 0.5, color: '#e8a06b' }); }
  }
});

K.Debug.install(game, { level, player });
game.start();
