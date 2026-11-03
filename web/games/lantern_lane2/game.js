import * as K from 'kit';
import { scenery } from './scenery.js';

// Lantern Lane: Gather the lost lights, deliver the letters, and light the tree.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Lantern Lane" });
// Golden hour deepening to dusk violet: low warm sun, long soft shadows, violet ambient,
// gentle bloom so every window, lamp and lantern glows against the twilight.
K.Look.apply(game, "cozy", {
  sun: { elevation: 6, azimuth: 205, intensity: 1.15, color: '#ff9d5c' },
  sky: { top: '#3d3568', horizon: '#e8956a', bottom: '#7a5a9e', stars: 0.5 },
  fog: { color: '#6a5288', near: 0.25, far: 0.85 },
  bloom: { strength: 0.55, radius: 0.75, threshold: 1.1 },
  grade: { saturation: 1.1, contrast: 0.94, vignette: 0.45 },
  palette: {
    primary: '#e8955a', secondary: '#9a7bd8', accent: '#ffd27a',
    ground: '#5a4e7a', ground2: '#6a5e8a', grass: '#5e7050', grass2: '#6e8060',
    foliage: '#5e7a4e', foliage2: '#7a9060', wood: '#8a6a4a', stone: '#9a8aae',
    roof: '#b06a5a', water: '#4a5a8e', waterDeep: '#32427a', foam: '#d8c8e8',
    glow: '#ffcf7a', cloud: '#e0b8cc', ui: '#f5e6d0', uiText: '#5a4636', uiAccent: '#ffb35c'
  }
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "town", { size: "medium", collectibles: 12 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "lantern";   // the plan's pickup
// Wren's scattered letters: a few off the main route, by the hedges and the well
const route = level.route;
for (let i = 4; i < route.length - 2 && level.collectibles.filter(c => c.tag === 'letter').length < 3; i += 4) {
  const a = route[i], b = route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(4);
  const x = a.x + side.x, z = a.z + side.z;
  const y = K.World.heightAt(game, x, z);
  if (y != null && Math.abs(y - a.y) < 3) level.collectibles.push({ position: new K.THREE.Vector3(x, y, z), tag: 'letter' });
}
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "cat", "accessory": "scarf"}, colors: {"body": "#e08a3c", "accent": "#ffdf9e"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
// --- Lantern Lane dressing: round cottages, glowing lamps, string-light posts, soft foliage ---
{
  const route = level.route;
  const beside = (i, dist) => {
    const a = route[i], b = route[i + 1];
    const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(dist);
    const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
    return y == null || Math.abs(y - a.y) > 3 ? null : [x, y, z];
  };
  // Rounded cottages along the lanes, roofs in the dusk palette
  const cottageSpots = [];
  for (let i = 5; i < route.length - 4; i += 6) {
    const p = beside(i, i % 12 < 6 ? 8.5 : -8.5);
    if (p) cottageSpots.push(p);
  }
  cottageSpots.slice(0, 8).forEach((p, k) => {
    K.World.prop(game, 'house', {
      position: p, yaw: k * 0.9, width: 5, depth: 4.5, floors: 1,
      roofColor: k % 3 === 0 ? '#b06a5a' : (k % 3 === 1 ? '#9a7bd8' : '#c98a5a')
    });
  });
  // Glowing streetlamps hugging the route — the warm/cool contrast at dusk
  for (let i = 2; i < route.length - 2; i += 4) {
    const p = beside(i, i % 8 < 4 ? 2.6 : -2.6);
    if (p) K.World.prop(game, 'lantern_post', { position: p, yaw: i * 0.7 });
  }
  // Soft, varied foliage: flowers, round bushes, rounded trees and rocks
  if (level.bounds) {
    const c = level.bounds.getCenter(new K.THREE.Vector3());
    const sz = level.bounds.getSize(new K.THREE.Vector3());
    const r = Math.min(sz.x, sz.z) * 0.42;
    K.World.foliage(game, {
      area: { center: [c.x, 0, c.z], radius: r },
      kinds: { flowers: 1.2, bush: 1.0, tree_round: 0.5, rock: 0.4, mushroom: 0.2 },
      density: 2.0,
      avoid: cottageSpots.concat(route.filter((_, i) => i % 2 === 0).map(v => [v.x, v.y, v.z])),
      seed: 11
    });
  }
  // Benches and planters near the plaza for the "villagers seated" feel
  if (level.goal) {
    const gp = level.goal.position;
    const by = K.World.heightAt(game, gp.x + 6, gp.z - 4);
    if (by != null) K.World.prop(game, 'bench', { position: [gp.x + 6, by, gp.z - 4], yaw: 0.8 });
    const by2 = K.World.heightAt(game, gp.x - 5, gp.z + 5);
    if (by2 != null) K.World.prop(game, 'planter', { position: [gp.x - 5, by2, gp.z + 5] });
  }
}
// The big lantern tree: plaza centerpiece beside the goal, dressed with the generated prop
if (level.goal) {
  const gp = level.goal.position;
  const tx = gp.x + 3.5, tz = gp.z + 3.5;
  const ty = K.World.heightAt(game, tx, tz);
  const tree = K.Assets.prop(game, 'prop_lantern_tree', { position: [tx, ty, tz], height: 7, fallback: 'tree' });
  if (tree) game.lanternTree = tree;
  // Warm lantern glow at the plaza, always
  K.FX.sparkles(game, [gp.x, ty + 2.5, gp.z], { color: ['#ffd27a', '#fff3c4'], radius: 7, rate: 12 });
}
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "lantern", "target": 8, "label": "Lanterns"}, "goal": true, "timer": false, "lives": false, "mode": "quests", "npcs": [{"name": "Bramble", "species": "bear", "lines": ["My porch light went out, little one.", "Find me four lanterns and I'll share the master light.", "You're the reason this lane glows."]}, {"name": "Wren", "species": "frog", "lines": ["The wind scattered my letters again.", "Three of them \u2014 check the hedges and the well.", "A village runs on letters, you know."]}, {"name": "Pip", "species": "bunny", "lines": ["Psst! How's the festival going?", "Just say hi to everyone, that's all I ask.", "You'll light the tree, won't you?"]}, {"name": "Milo", "species": "kid", "lines": ["I saved you a seat by the tree!", "Mama says the tree lights when the lane is ready.", "Bring the big lantern when you can!"]}], "quests": [{"type": "fetch", "npc": "Bramble", "item": "lantern", "count": 4}, {"type": "fetch", "npc": "Wren", "item": "letter", "count": 3}, {"type": "talk", "npc": "Pip"}, {"type": "deliver", "from": "Bramble", "to": "Milo", "item": "lantern", "count": 1, "label": "Bring the master lantern to the tree"}]});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "icon_lantern", "label": "Lanterns"}, {"id": "letters", "icon": "icon_letter", "label": "Letters"}], "timer": false, "lives": false, "minimap": true, "objective": "Gather the lost lights", "style": "cozy"});
K.UI.titleScreen(game, {"title": "Lantern Lane", "subtitle": "Gather the lost lights \u2014 and light the tree.", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Space: hop \u00b7 Walk up to a villager: chat \u00b7 Esc: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
// --- Lantern Lane juice: quest toasts, and the tree-lighting finale ---
game.on('collect', (item) => {
  if (!item) return;
  if (item.tag === 'letter') {
    K.UI.toast(game, 'A letter for Wren!', { icon: 'icon_letter' });
    K.FX.burst(game, item, { count: 18, speed: 5, size: 0.3, life: 0.8, shape: 'star', color: ['#fff3c4', '#ffd27a', '#c9a2ff'], up: 0.6 });
  } else if (item.tag === 'lantern') {
    // 3D juice: warm spark burst + rising glow ring + chime
    K.FX.burst(game, item, { count: 26, speed: 6, size: 0.32, life: 0.9, shape: 'glow', color: ['#ffcf6e', '#fff3c4', '#ffb35c'], up: 0.5 });
    K.FX.ring(game, item, { color: '#ffcf6e', radius: 2.2, life: 0.6, flat: true });
    K.Audio.sfx(game, 'powerup', { pitchVariation: 0.15 });
  }
});
game.on('questDone', (quest, npc) => {
  K.UI.toast(game, (npc ? npc.name : 'A villager') + ' is happy!', { icon: 'icon_quest' });
});
game.on('questsDone', () => {
  K.UI.banner(game, 'The lane is ready!', { style: 'stage_clear', sub: 'Light the big lantern tree' });
});
game.on('win', () => {
  const tree = game.lanternTree;
  if (tree && tree.position) {
    const p = tree.position;
    K.FX.ring(game, [p.x, p.y + 3, p.z], { color: '#ffcf6e', radius: 8, life: 1.2 });
    K.FX.magic(game, [p.x, p.y + 3, p.z], { color: ['#ffdf9e', '#ffb35c', '#fff3c4'], radius: 7, height: 9 });
  }
  K.FX.confetti(game, null, { count: 220, colors: ['#ffcf6e', '#ff9d5c', '#fff3c4', '#c9a2ff'] });
  K.FX.flash(game, '#ffdf9e', { opacity: 0.5, duration: 0.8 });
  K.FX.slowmo(game, 0.4, 0.7);
});
K.Debug.install(game, { level, player });
game.start();
