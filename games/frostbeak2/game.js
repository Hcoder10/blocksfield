import * as K from 'kit';
import { scenery } from './scenery.js';

// Frostbeak: Waddle, hop and belly-slide up a pink-dawn mountain to the summit igloo.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Frostbeak" });
K.Look.apply(game, "snow", {
  palette: { accent: "#ff9ec4", primary: "#7ec8e3", uiAccent: "#ff9ec4" },
  sun: { elevation: 7, azimuth: 40, intensity: 2.7, color: "#ffc9a0" },   // low warm sun: long soft shadows, peach rim light
  sky: { top: "#b8d4f0", horizon: "#ffc9a3", bottom: "#ffe4d6" },
  fog: { color: "#e2d2f2", near: 0.25, far: 1.25 },                        // lavender mist drifting between the floes
  bloom: { strength: 0.5, radius: 0.55, threshold: 1.15 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "sky_islands", { size: "medium", collectibles: 24, seed: 7 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup

// Mid-mountain checkpoint flags (banner + respawn point)
if (level.checkpoints.length === 0) {
  const n = level.route.length;
  const mid = Math.floor(n * 0.5);
  level.checkpoints.push({ position: level.route[mid].clone(), radius: 3 });
}

const player = K.Player.create(game, {
  type: "platformer", spawn: level.spawn, yaw: level.spawnYaw,
  character: { species: "penguin", accessory: "scarf" },
  // Frostbeak the puffin: near-black body, pale snow face, coral beak, pink scarf
  colors: { body: "#26324b", skin: "#f4f8ff", accent: "#ff8a5c", scarf: "#ff9ec4" },
});
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)

// Drifting ice floes: the level's movers carry Frostbeak across wide gaps
// (Gameplay animates level.movers as ping-pong platforms).

const rules = K.Gameplay.rules(game, {
  level, player,
  collect: { tag: "star", target: 12, label: "Fish" },
  goal: true,
  timer: false,
  lives: 3,
  enemies: 6,
  objective: (s) => `Collect ${s.target} fish, reach the igloo`,
});

// Summit igloo dressing: an igloo prop at the goal, ice crystals flanking it
if (level.goal) {
  K.Assets.prop(game, "prop_igloo", { position: level.goal.position, height: 4.5, rotationY: 0.4, fallback: "house" });
  K.Assets.prop(game, "prop_ice_crystal", { position: [level.goal.position.x + 3, level.goal.position.y, level.goal.position.z + 1], height: 2.5, rotationY: 1.2, fallback: "crystal" });
  K.Assets.prop(game, "prop_ice_crystal", { position: [level.goal.position.x - 3, level.goal.position.y, level.goal.position.z + 1], height: 2.0, rotationY: -0.8, fallback: "crystal" });
}

K.UI.hud(game, {
  counters: [{ id: "collected", icon: K.Assets.icon("fish", game), label: "Fish", target: 12 }],
  timer: false,
  lives: true,
  minimap: true,
  style: "cozy",
  objective: "Collect 12 fish, reach the igloo",
});
K.UI.titleScreen(game, {"title": "Frostbeak", "subtitle": "Waddle, hop and belly-slide up a pink-dawn mountain to the summit igloo.", "start": "Press Space", "credit": "A / D or \u2190 / \u2192: waddle \u00b7 Space or W / \u2191: hop \u00b7 P: pause", "countdown": false});   // not awaited: it pauses the game until a key
// --- Custom FX moments on top of FX.auto ---
// Fish sparkle + floating "+1" on each pickup
game.on('collect', (item) => {
  const p = item && item.position ? item.position : null;
  if (p) {
    K.FX.sparkle(game, p, { color: "#8fd8ff", scale: 1.1 });
    K.FX.text(game, [p.x, p.y + 1.2, p.z], "+1", { color: "#ff9ec4", size: 1.1, life: 1.1 });
  }
});

// Powder-snow landing: a bigger dust burst on hard landings
game.on('land', (p, speed) => {
  if (speed > 6) {
    K.FX.dust(game, p.position, { amount: 0.8, color: "#eef6ff" });
  }
});

// Checkpoint banner (UI auto does a banner too, but the plan calls for a specific one)
game.on('checkpoint', () => {
  K.UI.banner(game, "Checkpoint!", { style: "checkpoint", duration: 2 });
});

// Stomp: a satisfying poof + shake
game.on('stomp', (p, enemy) => {
  const pos = enemy && enemy.position ? enemy.position : (p && p.position);
  if (pos) {
    K.FX.poof(game, pos, { color: "#ffffff", size: 1.6 });
    K.FX.shake(game, 0.25);
  }
});

// Summit win: ice-crystal confetti + slow-mo
game.on('win', () => {
  K.FX.confetti(game, null, { count: 220, colors: ["#ffffff", "#8fd8ff", "#ff9ec4", "#ffe066"] });
  K.FX.slowmo(game, 0.3, 0.9);
  K.FX.starBurst(game, level.goal ? level.goal.position : player.position, { color: "#8fd8ff", scale: 2 });
});

// Lose: a soft snow thud poof
game.on('lose', () => {
  K.FX.dust(game, player.position, { amount: 1, color: "#ffffff" });
  K.FX.shake(game, 0.4);
});

K.FX.auto(game);
K.Audio.auto(game, { map: { collect: 'sfx_collect', jump: 'sfx_jump', land: 'sfx_land', damage: 'sfx_hit', win: 'sfx_win', lose: 'sfx_lose' } });
K.Debug.install(game, { level, player });
game.start();
