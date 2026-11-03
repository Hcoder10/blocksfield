import * as K from 'kit';
import { scenery } from './scenery.js';

// Neon Arena: Blast the swarm. Bank the cores. Outlast the clock.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Neon Arena" });
K.Look.apply(game, "neon_night", { quality: "low", sky: { stars: 1, aurora: 0 }, bloom: { strength: 0.6 } });
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "arena", { size: "medium", collectibles: 28 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "orb";   // the plan's pickup
const player = K.Player.create(game, { type: "topdown", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "robot", "accessory": "none"}, colors: {"body": "#19e6ff", "accent": "#ff2d78"}, ring: true, ringColor: "#19e6ff" });
K.Camera.topdown(game, player, { height: 18, pitch: 0.96, fov: 55 });
scenery(game, level);                     // generated props + splat landmarks (scenery.js)

// Glowing center anchor: a neon hub disc under the arena fountain pulls the eye
{
  const cx = level.spawn ? level.spawn.x : 0, cz = level.spawn ? level.spawn.z : 0;
  const y = K.World.heightAt(game, cx, cz) ?? 0;
  const disc = new K.THREE.Mesh(
    new K.THREE.RingGeometry(3.2, 4.6, 48),
    K.Look.material(game, { kind: "emissive", color: "#ff2d78", emissive: "#ff2d78", emissiveIntensity: 2.2, side: "double" })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(cx, y + 0.06, cz);
  game.scene.add(disc);
  const core = new K.THREE.Mesh(
    new K.THREE.CircleGeometry(1.4, 32),
    K.Look.material(game, { kind: "emissive", color: "#19e6ff", emissive: "#19e6ff", emissiveIntensity: 2.4, side: "double" })
  );
  core.rotation.x = -Math.PI / 2;
  core.position.set(cx, y + 0.05, cz);
  game.scene.add(core);
  K.FX.ring(game, [cx, y + 0.1, cz], { color: "#19e6ff", radius: 4.6, life: 0.8, flat: true });
}
const rules = K.Gameplay.rules(game, {level, player, "goal": false, "timer": 150, "lives": 3, "hp": 3, "enemies": 4, "mode": "waves", "waves": {"count": 5, "size": 5, "kinds": ["chase", "patrol"]}, "collect": { tag: "orb", target: 14, label: "Energy Cores" }, "objective": "Bank 14 cores"});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": "orb", "label": "Energy Cores"}], "timer": true, "lives": true, "hp": true, "minimap": true, "objective": "Bank 14 cores", "style": "scifi"});
K.UI.titleScreen(game, {"title": "Neon Arena", "subtitle": "Blast the swarm. Bank the cores. Outlast the clock.", "start": "Press Space", "credit": "WASD / arrows: dash around the arena \u00b7 Mouse: aim \u00b7 Left click (hold): fire blaster \u00b7 Shift: boost dash \u00b7 P / Esc: pause", "countdown": false});   // not awaited: it pauses the game until a key
K.FX.auto(game);
K.Audio.auto(game);
K.Audio.music(game, "music_main", { style: "scifi" });

// ---- Neon Arena juice: plan features on top of FX.auto ----
const CYAN = "#19e6ff", PINK = "#ff2d78";

// Cyan bullet trail + pink muzzle sparks from the blaster
game.on("shoot", (player, origin, dir) => {
  K.FX.burst(game, origin, { count: 6, speed: 4, size: 0.22, life: 0.25, color: [PINK, "#ffffff"], shape: "spark" });
});

// "+1" floating text over every energy core
game.on("collect", (item) => {
  K.FX.text(game, item, "+1", { color: CYAN, size: 0.9 });
});

// Shield hit flash + bigger shake on damage
game.on("damage", (target, amount, source) => {
  if (target === player) {
    K.FX.hitFlash(game, player.object, { color: PINK });
    K.FX.shake(game, 0.45);
  }
});

// Enemy deaths: shockwave ring + starburst; slow-mo beat on the last enemy of each wave
game.on("death", (target) => {
  if (target === player) return;
  const pos = target.position || (target.object && target.object.position) || target;
  K.FX.ring(game, pos, { color: PINK, radius: 3, life: 0.5, flat: true });
  K.FX.starBurst(game, pos, { color: [PINK, CYAN], scale: 1.4 });
  K.FX.shake(game, 0.5);
  const st = rules.state;
  if (st && st.enemiesLeft === 0 && st.wave && st.wave < st.waves) K.FX.slowmo(game, 0.3, 0.6);
});

// Speed lines while boost-dashing
game.on("boost", () => K.FX.speedLines(game, 0.8, { pulse: 0.6 }));
game.on("dash", () => K.FX.speedLines(game, 0.6, { pulse: 0.5 }));
K.Debug.install(game, { level, player });
game.start();
