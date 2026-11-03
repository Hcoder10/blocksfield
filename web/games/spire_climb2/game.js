import * as K from 'kit';
import { scenery } from './scenery.js';

// Spire Climb: Hop the spiral, ring the bell — a cozy cat's climb above the clouds.
const game = await K.createGame({ assets: './assets/assets.json', seed: 849, title: "Spire Climb" });
K.Look.apply(game, "cozy", {
  palette: { grass: '#93b97a', grass2: '#a8c98a', foliage: '#7fae6a', foliage2: '#e5a53a', flower: '#ff9fae', flower2: '#fff0a0', cliff: '#c8a684', cliff2: '#9a7a5e', stone: '#e2d2b6' },
  sun: { elevation: 12, intensity: 2.9, color: '#ffcf94' },
  sky: { top: '#f5a878', horizon: '#ffd9a8', bottom: '#ffe8cc', sunGlow: 0.9, disc: 2.4 },
  hemi: { sky: '#ffe0b8', ground: '#9a7a58', intensity: 1.55 },
  fog: { color: '#ffd9bd', near: 0.35, far: 1.15 },
  bloom: { strength: 0.5, radius: 0.6, threshold: 1.15 },
  rim: { color: '#ffc98a', strength: 0.6 },
  grade: { saturation: 1.12, contrast: 1.03, vignette: 0.35 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
// The level, composed from pieces (Level.md "Compose your own level"): reshape it to the pitch. Route pieces in visiting order;
// every jump at most 5 u across and 2.5 u up (bridges / stairs / ramps / movers for more).
// The spiral climb, laid out by hand: a start island, the tower core, a spiral of mossy pillars,
// a rotating stone beam and a ping-pong cloud raft between tiers, a rope bridge to the spire,
// and a big bell platform at the top (the goal).
const pieces = [
  { type: 'island', position: [0, 0, 0], size: 10 },
  { type: 'island', position: [0, -2, 26], size: 6, route: false },
  { type: 'tower', position: [0, -2, 26], height: 34 },
  { type: 'pillar', position: [0.0, 1.5, 16.0], size: 1.8 },
  { type: 'pillar', position: [5.81, 3.5, 17.86], size: 1.8 },
  { type: 'pillar', position: [9.46, 5.5, 22.75], size: 1.8 },
  { type: 'pillar', position: [9.58, 7.5, 28.85], size: 1.8 },
  // tier 1: the rotating stone beam sweeps the cat across the cloud gap
  { type: 'mover', position: [7.0, 9.5, 35.0], to: [2.5, 9.5, 35.0], motion: 'rotate', period: 6, size: 1.6 },
  { type: 'pillar', position: [0.42, 11.5, 35.99], size: 1.8 },
  { type: 'pillar', position: [-5.47, 13.5, 34.37], size: 1.8 },
  { type: 'pillar', position: [-9.31, 15.5, 29.64], size: 1.8 },
  // tier 2: the ping-pong cloud raft shuttles the cat up to the rope bridge
  { type: 'mover', position: [-9.7, 17.5, 23.55], to: [-4.0, 19.5, 22.0], motion: 'pingpong', period: 6, size: 1.8 },
  { type: 'bridge', from: [-2.0, 19.5, 21.5], to: [2.5, 21.5, 18.5], width: 2.8 },
  // the spire: a mossy stone step, then the bell platform
  { type: 'pillar', position: [3.0, 23.0, 17.0], size: 1.8 },
  { type: 'platform', position: [0.5, 25.0, 16.2], size: [5.5, 1, 5.5] },
];
const level = K.Level.compose(game, { pieces, goal: true, collectibles: 24 });
if (level.issueText) console.warn('[level] ' + level.issueText);
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "cat", "accessory": "scarf"}, colors: {"body": "#f4a259", "accent": "#8ab6a0"} });
K.Camera.follow(game, player, { distance: 13, pitch: 0.5, height: 2.2, collide: true });
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
// golden-hour dressing: lantern posts along the climb + a warm cloud sea below the spire
K.World.prop(game, 'lantern_post', { position: [level.spawn.x + 3.5, level.spawn.y, level.spawn.z - 2] });
K.World.prop(game, 'lantern_post', { position: [level.spawn.x - 3.5, level.spawn.y, level.spawn.z + 2] });
K.World.clouds(game, { count: 40, height: -12, radius: 160, center: [0, 0, 20], below: true, speed: 0.6 });
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "star", "target": 8, "label": "Stardust"}, "goal": true, "timer": false, "lives": 3});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "icon_star", "label": "Stardust"}], "timer": false, "lives": true, "minimap": true, "style": "cozy", "objective": "Ring the great bell at the top of the spire"});
K.UI.titleScreen(game, {"title": "Spire Climb", "subtitle": "Hop the spiral, ring the bell \u2014 a cozy cat's climb above the clouds.", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Space: jump (air-hop! hold to glide with the scarf) \u00b7 P: pause", "countdown": false, "orbit": true});   // not awaited: it pauses the game until a key
// cinematic title shot: a slow orbit around the whole spiral, spire and bell in view
game.on('start', () => K.Camera.follow(game, player));
// signature mechanics (K.Mechanics, after Gameplay.rules)
const ALONG = (f) => { const r = level.route, i = Math.min(r.length - 2, Math.max(0, Math.floor(f * (r.length - 1)))), a = r[i], b = r[i + 1]; return { p: [a.x, a.y, a.z], yaw: Math.atan2(b.x - a.x, b.z - a.z) }; };
// mechanic: Nimble Paws (tune): Milo is nimble: a springier jump and one air-hop for the tight ledges.
K.Mechanics.tune(player, {"speed": 1.08, "jump": 1.15, "airJumps": 1});
// mechanic: Scarf Glide (powerup): Scarf Glide: hold jump in the air to drift across the cloud gaps.
K.Mechanics.powerup(game, { type: "glide", count: 3 });
// mechanic: Star Chirp (rule): Every 8 stardust: +50 and a happy chirp!
K.Mechanics.rule(game, {"name": "Star Chirp", "text": "Every 8 stardust: +50 and a happy chirp!", "when": "collect", "every": 8, "do": [{"score": 50}, {"banner": "Chirp! +50"}]});
K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
