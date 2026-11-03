import * as K from 'kit';
import { scenery } from './scenery.js';

// Crystal Hollow: Blast the shadows. Gather the souls. Survive until dawn.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Crystal Hollow" });
K.Look.apply(game, "dark_fantasy", {
  palette: {
    ground: "#322b3c", ground2: "#241f2e", grass: "#2c2738", grass2: "#3a3448",
    cliff: "#3a3446", cliff2: "#262232", stone: "#4a4458", foliage: "#2e2a3e", foliage2: "#5a4a7e",
    ui: "#14101c", uiText: "#e8e0ff", uiAccent: "#b8a8d8",
  },
  fog: { color: "#3a2a58", near: 0.18, far: 0.75 },
  bloom: { strength: 0.65, radius: 0.55, threshold: 1.0 },
  grade: { saturation: 0.9, contrast: 1.12, vignette: 0.5 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "arena", { size: "medium", collectibles: 40 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "orb";   // the plan's pickup
const player = K.Player.create(game, { type: "fps", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "knight", "accessory": "cape"}, colors: {"body": "#3d2b56", "accent": "#a78bfa"} });
K.Camera.firstPerson(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "goal": false, "timer": false, "lives": 3, "mode": "waves", "waves": {"count": 5, "size": 4}});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "orb", "label": "Soul Crystals"}], "timer": false, "lives": true, "minimap": true, "style": "fantasy"});
K.UI.titleScreen(game, {"title": "Crystal Hollow", "subtitle": "Blast the shadows. Gather the souls. Survive until dawn.", "start": "Press Space", "credit": "WASD / arrows: move \u00b7 Mouse: aim \u00b7 Left click: fire wand blaster \u00b7 Esc: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
hollowScenery(game, level);
game.start();

// ---- Crystal Hollow scenery: basalt ruins, ember runes, cyan rune circle, purple mist ----
function hollowScenery(game, level) {
  const stone = K.Look.material(game, { color: "#2a2438", kind: "standard", rim: 0.4 });
  const darkStone = K.Look.material(game, { color: "#1b1728", kind: "standard", rim: 0.3 });
  const ember = K.Look.material(game, { kind: "emissive", color: "#ff7a3c", emissive: "#ff7a3c", emissiveIntensity: 2.4 });
  const runeCyan = K.Look.material(game, { kind: "emissive", color: "#67e8f9", emissive: "#67e8f9", emissiveIntensity: 2.2 });
  const silhouette = K.Look.material(game, { color: "#141020", kind: "standard", rim: 0.15 });

  const g = new K.THREE.Group();
  level.group.add(g);

  // Ember rune monoliths around the arena ring (with colliders)
  const ringR = 26;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.35;
    const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
    const y = K.World.heightAt(game, x, z) ?? 0;
    const h = 3.4 + (i % 3) * 0.7;
    const monolith = new K.THREE.Mesh(new K.THREE.BoxGeometry(1.7, h, 1.7), stone);
    monolith.position.set(x, y + h / 2, z);
    monolith.rotation.y = a + 1.1;
    g.add(monolith);
    K.Physics.addStatic(game, monolith, {});
    const rune = new K.THREE.Mesh(new K.THREE.BoxGeometry(0.85, 1.5, 0.12), ember);
    rune.position.set(0, 0.15, 0.88);
    rune.rotation.y = 0.22 * (i % 2 ? 1 : -1);
    monolith.add(rune);
    const cap = new K.THREE.Mesh(new K.THREE.BoxGeometry(2.1, 0.5, 2.1), darkStone);
    cap.position.y = h / 2 + 0.25;
    monolith.add(cap);
  }

  // Jagged broken-arch silhouettes on the far rim (scenery, no colliders)
  const rimR = 44;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.1;
    const x = Math.cos(a) * rimR, z = Math.sin(a) * rimR;
    const h = 5 + (i % 4) * 2.2;
    const arch = new K.THREE.Mesh(new K.THREE.BoxGeometry(1.4 + (i % 3) * 0.6, h, 1.4 + (i % 3) * 0.6), silhouette);
    arch.position.set(x, (K.World.heightAt(game, x, z) ?? 0) + h / 2 - 0.5, z);
    arch.rotation.y = a;
    arch.rotation.z = (i % 2 ? 1 : -1) * (0.06 + (i % 3) * 0.05);
    g.add(arch);
  }

  // Cyan rune circle at the arena centre
  const cy = (K.World.heightAt(game, 0, 0) ?? 0) + 0.06;
  const ring = new K.THREE.Mesh(new K.THREE.TorusGeometry(5.5, 0.09, 8, 64), runeCyan);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, cy, 0);
  g.add(ring);
  const inner = new K.THREE.Mesh(new K.THREE.TorusGeometry(3.2, 0.06, 8, 48), runeCyan);
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(0, cy + 0.02, 0);
  g.add(inner);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tick = new K.THREE.Mesh(new K.THREE.BoxGeometry(1.1, 0.08, 0.22), runeCyan);
    tick.position.set(Math.cos(a) * 4.35, cy + 0.03, Math.sin(a) * 4.35);
    tick.rotation.y = -a;
    g.add(tick);
  }

  // Purple mist pooling between the pillars
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r = 12 + (i % 3) * 5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = (K.World.heightAt(game, x, z) ?? 0) + 0.4;
    K.FX.smoke(game, [x, y, z], { count: 3, color: "#7c5cd6", size: 2.6, life: 2.2 });
  }
}
