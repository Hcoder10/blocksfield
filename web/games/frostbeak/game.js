import * as K from 'kit';

// Frostbeak: Waddle, hop, and slide up the dawn-lit peaks to the summit igloo.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Frostbeak" });
K.Look.apply(game, "snow");
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "sky_islands", { size: "medium", collectibles: 30 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "orb";   // the plan's pickup
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, colors: {"body": "#26324b", "accent": "#ff8fab"} });
K.Camera.follow(game, player);
// generated voxel props beside the route, standing on the ground
const PROPS = ["prop_snowman"];
for (let i = 3, k = 0; i < level.route.length - 2; i += 3, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 3.5 : -3.5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2) continue;
  K.Assets.prop(game, PROPS[k % PROPS.length], { position: [x, y, z], rotationY: k * 1.3, height: 2.2 + (k % 3) * 0.6, fallback: 'mushroom' });
}
// generated Gaussian-splat landmarks (Idol) at mid distance from the route
const SPLATS = ["splat_snowman"];
for (let i = 2, k = 0; i < level.route.length - 1 && k < 6; i += 4) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 7 : -7);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 3) continue;
  K.Assets.splat(game, SPLATS[k % SPLATS.length], { position: [x, y, z], height: 3.5 + (k % 3), rotationY: k * 2.1, fallback: 'tree' });
  k++;
}
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "orb", "target": 20}, "goal": true, "timer": 180, "lives": 3, "enemies": 5});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "orb", "label": "Fish"}], "timer": true, "lives": true, "minimap": true, "objective": "Collect 20 of the 30 glittering fish and reach the summit ig", "style": "cozy"});
K.UI.titleScreen(game, {"title": "Frostbeak", "subtitle": "Waddle, hop, and slide up the dawn-lit peaks to the summit igloo.", "start": "Press Space", "credit": "WASD / arrows: move and waddle \u00b7 Space: hop \u00b7 Esc / P: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
