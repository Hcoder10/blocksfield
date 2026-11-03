import * as K from 'kit';

// Lantern Lane: wander the golden-hour village, gather the lost lanterns, and light the big lantern tree.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Lantern Lane" });

// Golden-hour honey & peach palette, low warm sun for long shadows
K.Look.apply(game, "cozy", {
  palette: {
    primary: "#f0a05a",
    secondary: "#5fb8a6",
    accent: "#ffd27a",
    wood: "#a9714b",
    roof: "#d99a55",
    glow: "#ffcf7a",
    ground: "#c9a06a",
    ground2: "#b98f5e",
    grass: "#a3a05a",
    grass2: "#8f9450",
    uiAccent: "#ffb35c",
  },
  sun: { elevation: 14, intensity: 2.6 },
  sky: { top: "#7d9cc9", horizon: "#ffc98a", bottom: "#ff9e6b" },
  bloom: { strength: 0.45, radius: 0.55 },
  fog: { color: "#f2c493", near: 0.3, far: 1.15 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded

const level = K.Level.build(game, "town", { size: "medium", collectibles: 24 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "orb";   // the plan's pickup

const player = K.Player.create(game, {
  type: "platformer",
  spawn: level.spawn,
  yaw: level.spawnYaw,
  colors: { body: "#f0a05a", accent: "#5fb8a6", skin: "#ffe8c8" },
});
K.Camera.follow(game, player);

// ---- generated voxel props beside the route (lantern posts & mailboxes) ----
const PROPS = ["prop_lantern_post", "prop_mailbox"];
for (let i = 3, k = 0; i < level.route.length - 2; i += 3, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 3.5 : -3.5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2) continue;
  K.Assets.prop(game, PROPS[k % PROPS.length], { position: [x, y, z], rotationY: k * 1.3, height: 2.2 + (k % 3) * 0.6, fallback: 'mushroom' });
}

// ---- the big lantern tree in the plaza (at the goal) ----
const treePos = level.goal ? level.goal.position : level.spawn;
const treeY = K.World.heightAt(game, treePos.x, treePos.z) ?? treePos.y;
const tree = K.World.prop(game, 'tree', { position: [treePos.x, treeY, treePos.z], yaw: 0.6 });
// warm idle glitter on the tree; it brightens as the counter climbs
let treeGlow = K.FX.sparkles(game, tree, { color: ['#ffd27a', '#ffb35c'], radius: 3.5, rate: 4 });

// ---- villagers: friendly neighbours at stalls and doorsteps ----
const VILLAGERS = [
  { name: 'Mira the Baker', lines: ['Fresh bread, warm from the oven!', 'A lantern went missing from my stall...'], portrait: 'M', color: '#e88a5d' },
  { name: 'Old Bram', lines: ['Mind the benches, little one.', 'The big tree waits for its light.'], portrait: 'B', color: '#8a9a5b' },
  { name: 'Postman Pip', lines: ['Letters for the whole lane!', 'I left one in the mailbox by the bakery.'], portrait: 'P', color: '#5fb8a6' },
  { name: 'Sage', lines: ['The dusk is coming early tonight.', 'Gather the lanterns before it does.'], portrait: 'S', color: '#b07ac0' },
];
const villagerSpots = [];
for (let i = 4; i < level.route.length - 3; i += 5) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(i % 10 < 5 ? 5 : -5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2) continue;
  villagerSpots.push(new K.THREE.Vector3(x, y, z));
}
const villagers = VILLAGERS.map((v, i) => {
  const spot = villagerSpots[i % Math.max(villagerSpots.length, 1)] || level.spawn.clone();
  const npc = K.Player.create(game, { type: 'platformer', spawn: spot, yaw: i * 1.1, model: true, colors: { body: v.color, accent: '#ffd27a', skin: '#ffe8c8' } });
  npc.controls.enabled = false;
  return { ...v, npc, spot, talked: false, cooldown: 0 };
});

const rules = K.Gameplay.rules(game, {
  level, player,
  collect: { tag: "orb", target: 18 },
  goal: true,
  timer: false,
  lives: false,
});

// ---- cozy HUD ----
K.UI.hud(game, {
  style: "cozy",
  counters: [{ id: "collected", icon: "orb", label: "Lanterns", target: 18 }],
  timer: false,
  lives: false,
  minimap: true,
  objective: "Gather 18 lanterns, then light the tree",
  winScreen: { title: "The tree glows!", sub: "Lantern Lane is bright and warm tonight." },
});

// ---- title screen ----
K.UI.titleScreen(game, {
  title: "Lantern Lane",
  subtitle: "Gather the lost lanterns and light the big tree",
  start: "Press Space",
  credit: "WASD / arrows: move \u00b7 Space: jump \u00b7 P: pause",
  countdown: false,
});

K.FX.auto(game);
K.Audio.auto(game);

// ---- plan features: pickup juice, villager greetings, lantern tree that fills, win moment ----
let lanterns = 0;
const GREET_DELAY = 0;

game.on('collect', (item) => {
  if (item.tag !== 'orb') return;
  lanterns++;
  K.FX.burst(game, item, { count: 18, speed: 5, size: 0.3, life: 0.7, gravity: 3, shape: 'glow', color: ['#ffd27a', '#ffb35c', '#fff2c8'] });
  K.FX.text(game, item, '+1', { color: '#fff2c8', size: 1.1, life: 1 });
  // the tree fills up as the counter climbs
  if (treeGlow) treeGlow = K.FX.sparkles(game, tree, { color: ['#ffd27a', '#ffb35c', '#fff2c8'], radius: 3.5 + lanterns * 0.25, rate: 4 + lanterns * 1.5 });
});

// villager speech bubbles when the cat gets close
let greetingBusy = false;
function updateVillagers(dt) {
  if (greetingBusy) return;
  for (const v of villagers) {
    if (v.talked || v.cooldown > 0) continue;
    if (player.position.distanceTo(v.spot) > 4.5) continue;
    v.talked = true;
    greetingBusy = true;
    player.character.setEmote('wave', 2);
    K.UI.dialog(game, { name: v.name, portrait: v.portrait, lines: v.lines, pause: true }).then(() => {
      v.cooldown = 60;
      greetingBusy = false;
    });
    return;
  }
}

game.on('goal', () => {
  K.FX.starBurst(game, tree, { color: ['#ffd27a', '#ffb35c'], scale: 2.5, count: 40 });
});

game.on('win', () => {
  K.FX.slowmo(game, 0.35, 0.8);
  K.FX.confetti(game, null, { count: 220, colors: ['#ffd27a', '#ffb35c', '#ff9e6b', '#5fb8a6', '#fff2c8'] });
  K.FX.flash(game, '#fff2c8', { opacity: 0.5, duration: 0.6 });
  K.FX.sparkles(game, tree, { color: ['#ffd27a', '#ffb35c', '#fff2c8'], radius: 6, rate: 40 });
  player.character.setEmote('win', 5);
  K.UI.banner(game, "The tree glows!", { style: "stage_clear", sub: "Lantern Lane is bright and warm tonight." });
});

game.update((dt) => {
  for (const v of villagers) if (v.cooldown > 0) v.cooldown -= dt;
  updateVillagers(dt);
});

K.Debug.install(game, { level, player });
game.start();
