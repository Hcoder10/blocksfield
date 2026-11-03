import * as K from 'kit';
import { scenery } from './scenery.js';

// Riverbend Canyon: Paddle, hop, and splash down the red-rock river to the waterfall pool
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Riverbend Canyon" });
K.Look.apply(game, "desert", {
  sun: { elevation: 14, azimuth: 55, intensity: 2.6 },
  sky: { top: "#7fa8d8", horizon: "#ffb066", bottom: "#ffd9a0" },
  grade: { saturation: 1.18, contrast: 1.06, vignette: 0.35 },
  fog: { color: "#ffcf9e", near: 0.3, far: 0.9 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
// The level, composed from pieces (Level.md "Compose your own level"): reshape it to the pitch. Route pieces in visiting order;
// every jump at most 5 u across and 2.5 u up (bridges / stairs / ramps / movers for more).
const LAYOUT = {"ground": {"style": "sand", "y": -3, "size": 300, "hills": 22}, "pieces": [{"type": "water", "position": [30, -1.6, 38], "size": 320}, {"type": "cliff", "position": [0, 2, 0], "size": 8}, {"type": "platform", "position": [0, 1, 12.5], "size": 2}, {"type": "platform", "position": [4, 1.5, 17.5], "size": 2}, {"type": "platform", "position": [9, 2, 22], "size": 2}, {"type": "cliff", "position": [16, 4, 30], "size": 7}, {"type": "bridge", "from": [20.8, 4, 32.7], "to": [29.2, 4.5, 37.3]}, {"type": "cliff", "position": [34, 4.5, 40], "size": 7}, {"type": "stairs", "from": [34, 4.5, 45.5], "to": [34, 1, 53]}, {"type": "platform", "position": [34, 1, 56], "size": [6, 4, 6]}, {"type": "pillar", "position": [34, 2.5, 63]}, {"type": "pillar", "position": [30, 4.5, 68]}, {"type": "island", "position": [22, 6, 76], "size": 8, "waterfall": true}, {"type": "cliff", "position": [-16, 8, 8], "size": 9, "route": false}, {"type": "cliff", "position": [-22, 10, 22], "size": 9, "route": false}, {"type": "cliff", "position": [-18, 9, 38], "size": 9, "route": false}, {"type": "cliff", "position": [-24, 11, 52], "size": 9, "route": false}, {"type": "cliff", "position": [-16, 9, 66], "size": 9, "route": false}, {"type": "cliff", "position": [-22, 10, 78], "size": 9, "route": false}, {"type": "cliff", "position": [46, 12, 14], "size": 9, "route": false}, {"type": "cliff", "position": [48, 13, 32], "size": 9, "route": false}, {"type": "cliff", "position": [46, 12, 50], "size": 9, "route": false}, {"type": "cliff", "position": [48, 13, 66], "size": 9, "route": false}, {"type": "cliff", "position": [42, 11, 80], "size": 9, "route": false}], "goal": true};
const level = K.Level.compose(game, { ...LAYOUT, collectibles: 26 });
if (level.issueText) console.warn('[level] ' + level.issueText);
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "flower";   // the plan's pickup
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "kid", "accessory": "backpack"}, colors: {"body": "#e07b39", "accent": "#ffd23f"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
waterfallPool(game, level);               // the goal: wide pool + glowing waterfall + foam
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "flower", "target": 18, "label": "Lilies"}, "goal": true, "timer": false, "lives": 3, "enemies": 2});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "flower", "label": "Lilies"}], "timer": false, "lives": true, "minimap": true, "style": "cozy"});
K.UI.titleScreen(game, {"title": "Riverbend Canyon", "subtitle": "Paddle, hop, and splash down the red-rock river to the waterfall pool", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Space: jump (hold for a higher hop) \u00b7 Esc / P: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();

// The waterfall pool at the goal: a wider, brighter basin, a glowing white waterfall sheet,
// foam at its base, and a few lily pads bobbing in the pool.
function waterfallPool(game, level) {
  const g = level.goal ? level.goal.position : new K.THREE.Vector3(22, 6, 76);
  const T = K.THREE;
  // Wider turquoise basin, slightly above the river level so it reads as a distinct pool.
  K.World.water(game, { level: 4.2, size: 46, center: [g.x, 0, g.z], waves: 0.2 });
  // Waterfall sheet: a thin glowing plane pouring from the mesa lip into the pool.
  const sheet = new T.Mesh(
    new T.PlaneGeometry(5.5, 9.5, 4, 8),
    K.Look.material(game, { kind: 'emissive', color: '#eafcff', emissive: '#dff6ff', emissiveIntensity: 1.6, opacity: 0.85, side: 'double' })
  );
  sheet.position.set(g.x, 7.2, g.z - 5.2);
  sheet.rotation.x = 0.12;
  level.group.add(sheet);
  // Foam line where the sheet meets the pool.
  const foam = K.Look.material(game, { kind: 'emissive', color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.2, opacity: 0.9 });
  for (let i = -3; i <= 3; i++) {
    const puff = new T.Mesh(new T.SphereGeometry(0.7 + (i % 2 ? 0.25 : 0), 8, 6), foam);
    puff.position.set(g.x + i * 0.95, 4.55, g.z - 4.6);
    puff.scale.y = 0.55;
    level.group.add(puff);
  }
  // Lily pads bobbing in the pool: flat green discs with a white flower on top.
  const padMat = K.Look.material(game, { color: '#3f8f3a', rim: 1.4 });
  const flowerMat = K.Look.material(game, { kind: 'emissive', color: '#ffffff', emissive: '#fff6e8', emissiveIntensity: 0.9 });
  const spots = [[-4.5, 2.5], [4, 3], [-3, -3.5], [5, -2], [0, 4.5], [-5.5, -1], [3.5, 4.5]];
  for (const [dx, dz] of spots) {
    const pad = new T.Mesh(new T.CylinderGeometry(0.85, 0.9, 0.12, 16), padMat);
    pad.position.set(g.x + dx, 4.3, g.z + dz);
    level.group.add(pad);
    const bloom = new T.Mesh(new T.SphereGeometry(0.28, 8, 6), flowerMat);
    bloom.position.set(g.x + dx, 4.5, g.z + dz);
    level.group.add(bloom);
  }
  // Continuous white spray at the base of the falls.
  const spray = new T.Vector3(g.x, 4.6, g.z - 4.6);
  game.update(() => {
    if (Math.random() < 0.5) K.FX.splash(game, spray, { color: '#eafcff', speed: 3 });
  });
}
