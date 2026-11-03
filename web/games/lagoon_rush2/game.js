import * as K from 'kit';
import { scenery } from './scenery.js';

// Lagoon Rush: Skim the turquoise, chain the boosts, and take the lead over three splashy laps.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Lagoon Rush" });
K.Look.apply(game, "toon_bright", {
  palette: {
    water: "#35d0c5", waterDeep: "#0f9e93", foam: "#ffffff",
    sand: "#ffe9b8", grass: "#3fbf5f", grass2: "#57d477",
    primary: "#ff6b4a", accent: "#ffe14d",
    ui: "#0e3a46", uiAccent: "#35d0c5",
  },
  sky: { top: "#7fd8ff", horizon: "#c8f2ff" },
  grade: { saturation: 1.15, contrast: 1.05 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "lagoon", { size: "large", collectibles: 24 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup
// Skim-the-turquoise water: bigger waves, a wide sheet so the shoreline foam reads clearly.
if (level.water) K.World.water(game, { level: level.water.y, size: 700, waves: 0.55 });
const player = K.Player.create(game, { type: "boat", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "kid", "accessory": "hat"}, colors: {"body": "#ff6b4a", "accent": "#ffe14d"} });
K.Camera.chase(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
// Tropical shoreline dressing: palms, ferns (bushes), grass tufts and rocks along the banks, kept off the racing lane.
{
  const route = level.route || [];
  const shore = (i, dist) => {
    const a = route[i], b = route[i + 1];
    const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(dist);
    const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
    return y == null ? null : [x, y, z];
  };
  const kinds = ["palm", "palm", "bush", "grass", "rock"];
  let k = 0;
  for (let i = 1; i < route.length - 1 && k < 70; i += 2, k++) {
    const p = shore(i, k % 2 ? 11 : -11);
    if (!p) continue;
    const kind = kinds[k % kinds.length];
    if (kind === "rock") K.World.prop(game, "rock", { position: p, scale: 0.8 + (k % 3) * 0.3, yaw: k * 0.9, collider: false });
    else K.World.foliage(game, { area: { center: p, radius: 1.5 }, kinds: [kind], density: 1, seed: 40 + k });
  }
}
// Candy-striped lighthouse: find the kit's lighthouse tower (tall mesh, far from the goal gantry) and
// repaint it red/white with a toon pop.
{
  const goal = level.goal ? level.goal.position : new K.THREE.Vector3();
  const tall = [];
  level.group.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      const box = o.geometry.boundingBox || o.geometry.computeBoundingBox() && o.geometry.boundingBox;
      const h = box ? box.max.y - box.min.y : 0;
      if (h > 6 && o.position.distanceTo(goal) > 30) tall.push({ o, h });
    }
  });
  tall.sort((a, b) => b.h - a.h);
  const tower = tall.length ? tall[0].o : null;
  game.state.__lh = { tall: tall.slice(0, 4).map((t) => [t.h.toFixed(1), t.o.name, t.o.position.toArray().map((n) => n.toFixed(0))]) };
  if (tower) {
    const g = tower.geometry;
    const pos = g.attributes.position;
    const box = g.boundingBox || g.computeBoundingBox();
    const colors = new Float32Array(pos.count * 3);
    const c = new K.THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const band = Math.floor(pos.getY(i) / 1.6) % 2 === 0;
      c.set(band ? "#ffffff" : "#ff4438");
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new K.THREE.BufferAttribute(colors, 3));
    tower.material = K.Look.material(game, { color: "#ffffff", kind: "toon", vertexColors: true, rim: 1.4 });
  }
}
// Buoy line: a continuous chain of red-and-white buoys along both edges of the lane, defining the racing line.
{
  const route = level.route || [];
  const w = (level.trackWidth || 8) / 2 + 1.2;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
    const step = 5;
    const len = a.distanceTo(b);
    for (let d = 0; d < len; d += step) {
      const t = a.clone().addScaledVector(b.clone().sub(a), d / len);
      for (const s of [w, -w]) {
        const x = t.x + side.x * s, z = t.z + side.z * s;
        const y = level.water ? level.water.y : t.y;
        K.Assets.prop(game, "prop_buoy", { position: [x, y, z], rotationY: (i + d) * 1.3, height: 1.4, fallback: "cone", collider: false });
      }
    }
  }
}
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "star", "target": 12, "label": "Starfish"}, "goal": true, "timer": false, "lives": false, "race": {"laps": 3, "opponents": 3}});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "icon_starfish", "label": "Starfish"}], "timer": true, "lives": false, "minimap": true, "style": "arcade", "lap": true, "position": true, "speedometer": true});
K.UI.titleScreen(game, {"title": "Lagoon Rush", "subtitle": "Skim the turquoise, chain the boosts, and take the lead over three splashy laps.", "start": "Press Space", "credit": "W / \u2191: throttle \u00b7 S / \u2193: brake and reverse \u00b7 A / D or \u2190 / \u2192: steer \u00b7 Gamepad: steer and throttle", "countdown": true});   // not awaited: it pauses the game until a key
K.FX.auto(game);
// Splashy wake: a white foam trail skimming the water behind the boat.
K.FX.trail(game, player.object, { color: "#ffffff", colorEnd: "#9ff5ef", width: 1.1, length: 22, offset: [0, -0.4, 0] });
// Boost juice: blue streak burst + splash when the boat hits a boost pad.
game.on("boost", (p) => {
  const pos = (p && p.position) || player.position;
  K.FX.burst(game, pos, { count: 26, speed: 9, size: 0.3, life: 0.6, color: ["#7df9ff", "#ffffff"], shape: "spark" });
  K.FX.splash(game, pos, { color: "#9ff5ef", speed: 6 });
});
// Big wet landing splash off the ramp.
game.on("land", (p, speed) => {
  if (speed > 8) K.FX.splash(game, (p && p.position) || player.position, { color: "#ffffff", speed: 8 });
});
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
