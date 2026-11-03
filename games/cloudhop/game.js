import * as K from 'kit';

// Cloudhop Meadows: Hop, dash and bloom your way up the candy-coloured sky islands!
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Cloudhop Meadows" });
K.Look.apply(game, "candy", {
  palette: {
    cliff: "#f8a5c0", cliff2: "#f7c8d9",   // bubblegum-pink island undersides
    ground: "#ffe08a", ground2: "#ffd93d", // butter-yellow earth
    grass: "#9ff0c8", grass2: "#7de8b4",   // soft saturated mint
    primary: "#ff6f91", accent: "#ffd93d",
  },
  sun: { elevation: 42, azimuth: 35, intensity: 2.6, color: "#fff3d6" }, // warm noon sun for rim light
  bloom: { strength: 0.35, radius: 0.5, threshold: 0.9 },
  fog: { near: 0.55, far: 1.2 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "sky_islands", { size: "large", collectibles: 40 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, colors: {"body": "#ff6f91", "accent": "#ffd93d"} });
K.Camera.follow(game, player);
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "star", "target": 25}, "goal": true, "timer": 180, "lives": 3, "enemies": 4});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "star", "label": "Star Seeds", "target": 25}], "timer": true, "lives": true, "minimap": true, "objective": "Grab 25 star seeds, then reach the bloom", "style": "cozy"});
K.UI.titleScreen(game, {"title": "Cloudhop Meadows", "subtitle": "Hop, dash and bloom your way up the candy-coloured sky islands!", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Space: jump, press again mid-air for double jump \u00b7 Shift: dash \u00b7 P / Esc: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);

// Extra juice: every star seed pops with a burst, ring and sparkle on top of FX.auto
game.on('collect', (item) => {
  if (item.tag === 'star') {
    const p = item.position || item;
    K.FX.burst(game, p, { count: 18, speed: 7, size: 0.3, life: 0.6, gravity: 3, shape: 'star', color: ['#ffd93d', '#fff6c9', '#ff9ec4'] });
    K.FX.ring(game, p, { color: '#ffd93d', radius: 2.2, life: 0.45, flat: false });
    K.FX.sparkle(game, p, { color: '#fff6c9', scale: 1.4 });
  }
});
// Goal: confetti + star burst when the bloom opens
game.on('goal', () => {
  K.FX.confetti(game, null, { count: 180, colors: ['#ff6f91', '#ffd93d', '#9ff0c8', '#c9a7ff'] });
});
K.Debug.install(game, { level, player });
game.start();
