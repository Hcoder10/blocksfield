import * as K from 'kit';

// Starbloom Isles: Hop, bloom, and light the beacon across the floating sky.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Starbloom Isles" });
K.Look.apply(game, "toon_bright");
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "sky_islands", { size: "medium", collectibles: 24 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, colors: {"body": "#ff8a3d", "accent": "#fff1d6"} });
K.Camera.follow(game, player);
// generated voxel props beside the route, standing on the ground
const PROPS = ["prop_star_shroom", "prop_beacon_lantern"];
for (let i = 3, k = 0; i < level.route.length - 2; i += 3, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 3.5 : -3.5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2) continue;
  K.Assets.prop(game, PROPS[k % PROPS.length], { position: [x, y, z], rotationY: k * 1.3, height: 2.2 + (k % 3) * 0.6, fallback: 'mushroom' });
}
// generated Gaussian-splat landmarks (Idol) at mid distance from the route
const SPLATS = ["splat_star_shroom", "splat_beacon_lantern"];
for (let i = 2, k = 0; i < level.route.length - 1 && k < 6; i += 4) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 7 : -7);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 3) continue;
  K.Assets.splat(game, SPLATS[k % SPLATS.length], { position: [x, y, z], height: 3.5 + (k % 3), rotationY: k * 2.1, fallback: 'tree' });
  k++;
}
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "star", "target": 12}, "goal": true, "timer": false, "lives": 3, "enemies": 4});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "icon_star_bloom", "label": "Star Blooms"}], "timer": false, "lives": true, "minimap": true, "objective": "Reach the beacon portal on the final island; star blooms col", "style": "arcade"});
K.UI.titleScreen(game, {"title": "Starbloom Isles", "subtitle": "Hop, bloom, and light the beacon across the floating sky.", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Space: jump (hold for higher hop) \u00b7 P / Esc: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
