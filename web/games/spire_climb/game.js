import * as K from 'kit';
import { scenery } from './scenery.js';

// Spire Climb: Hop the cloud spire, spin the platforms, and ring the great bell.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Spire Climb" });
K.Look.apply(game, "cozy", {
  sun: { elevation: 8, azimuth: 35, intensity: 2.6, color: '#ffd9a0' },   // low honey-gold late-afternoon sun
  sky: { top: '#b9a7e8', horizon: '#ffc98a', bottom: '#f7b98d' },          // lavender -> peach horizon
  bloom: { strength: 0.35, radius: 0.6, threshold: 1.15 },
  grade: { saturation: 1.1, contrast: 1.02, vignette: 0.4 },
  palette: { grass: '#b3c98f', grass2: '#9dbd7d', ground: '#c9a97e', ground2: '#b8946a', cloud: '#ffe6c9' },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
// The level, composed from pieces (Level.md "Compose your own level"): reshape it to the pitch. Route pieces in visiting order;
// every jump at most 5 u across and 2.5 u up (bridges / stairs / ramps / movers for more).
const LAYOUT = {"pieces": [{"type": "island", "position": [0, 0, 0], "size": 10}, {"type": "island", "position": [0, -2, 26], "size": 6, "route": false}, {"type": "tower", "position": [0, -2, 26], "height": 30}, {"type": "pillar", "position": [0.0, 1.5, 16.0], "size": 1.8}, {"type": "pillar", "position": [5.81, 3.5, 17.86], "size": 1.8}, {"type": "pillar", "position": [9.46, 5.5, 22.75], "size": 1.8}, {"type": "pillar", "position": [9.58, 7.5, 28.85], "size": 1.8}, {"type": "pillar", "position": [6.14, 9.5, 33.89], "size": 1.8}, {"type": "pillar", "position": [0.42, 11.5, 35.99], "size": 1.8}, {"type": "pillar", "position": [-5.47, 13.5, 34.37], "size": 1.8}, {"type": "pillar", "position": [-9.31, 15.5, 29.64], "size": 1.8}, {"type": "pillar", "position": [-9.7, 17.5, 23.55], "size": 1.8}, {"type": "pillar", "position": [-6.47, 19.5, 18.37], "size": 1.8}, {"type": "pillar", "position": [-0.83, 21.5, 16.03], "size": 3.5}], "goal": true};
const level = K.Level.compose(game, { ...LAYOUT, collectibles: 18 });
if (level.issueText) console.warn('[level] ' + level.issueText);
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "cat", "accessory": "scarf"}, colors: {"body": "#f2a154", "accent": "#6e3b12"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "star", "target": 18, "label": "Sky Stars"}, "goal": true, "timer": 240, "lives": 3, "enemies": 3});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "icon_star", "label": "Sky Stars"}], "timer": true, "lives": true, "minimap": true, "style": "cozy"});
K.UI.titleScreen(game, {"title": "Spire Climb", "subtitle": "Hop the cloud spire, spin the platforms, and ring the great bell.", "start": "Press Space", "credit": "A / D or \u2190 / \u2192: move \u00b7 Space / W / \u2191: jump \u00b7 S / \u2193: drop / crouch \u00b7 P or Esc: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
// Juicier star pickup: big golden burst + ring + a soft flash (FX.auto already sparkles; this adds the reward feel)
game.on('collect', (item) => {
  if (item && item.tag === 'star') {
    K.FX.starBurst(game, item, { color: ['#ffd94a', '#ffb347', '#fff3c4'], scale: 1.6, count: 40 });
    K.FX.ring(game, item, { color: '#ffd94a', radius: 2.4, life: 0.5 });
    K.FX.flash(game, '#fff3d6', { opacity: 0.18, duration: 0.18 });
  }
});
K.Debug.install(game, { level, player });
game.start();
