import * as K from 'kit';

// Canyon Runner: Chain the boost pads, kiss the sunset, beat the clock.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Canyon Runner" });
K.Look.apply(game, "sunset");
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "race_track", { size: "medium", collectibles: 24 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "gem";   // the plan's pickup
const player = K.Player.create(game, { type: "kart", spawn: level.spawn, yaw: level.spawnYaw, colors: {"body": "#0f9bb0", "accent": "#ffd166"} });
K.Camera.chase(game, player);
// generated voxel props beside the route, standing on the ground
const PROPS = ["prop_canyon_totem", "prop_sun_stone"];
for (let i = 3, k = 0; i < level.route.length - 2; i += 3, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 3.5 : -3.5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2) continue;
  K.Assets.prop(game, PROPS[k % PROPS.length], { position: [x, y, z], rotationY: k * 1.3, height: 2.2 + (k % 3) * 0.6, fallback: 'mushroom' });
}
// generated Gaussian-splat landmarks (Idol) at mid distance from the route
const SPLATS = ["splat_canyon_totem", "splat_sun_stone"];
for (let i = 2, k = 0; i < level.route.length - 1 && k < 6; i += 4) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 7 : -7);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 3) continue;
  K.Assets.splat(game, SPLATS[k % SPLATS.length], { position: [x, y, z], height: 3.5 + (k % 3), rotationY: k * 2.1, fallback: 'tree' });
  k++;
}
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "gem", "target": 12}, "goal": true, "timer": 150, "lives": 3});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "icon_sunstone_gem", "label": "Sunstones"}], "timer": true, "lives": true, "minimap": true, "objective": "Reach the canyon finish gate before the clock hits zero, hav", "style": "arcade"});
K.UI.titleScreen(game, {"title": "Canyon Runner", "subtitle": "Chain the boost pads, kiss the sunset, beat the clock.", "start": "Press Space", "credit": "W / \u2191: throttle \u00b7 S / \u2193: brake / reverse \u00b7 A / D or \u2190 / \u2192: steer \u00b7 Shift: handbrake drift", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
