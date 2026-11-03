import * as K from 'kit';

// Lagoon Rush: Skim the turquoise, chain the boosts, and out-drive three rivals to the lighthouse.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Lagoon Rush" });
K.Look.apply(game, "toon_bright", {
  sun: { elevation: 72, intensity: 2.7, color: '#fff6e0' },
  sky: { top: '#1e9be0', horizon: '#8fe8ff' },
  bloom: { strength: 0.5, radius: 0.6, threshold: 1.1 },
  grade: { saturation: 1.18, contrast: 1.12, vignette: 0.25 },
  palette: { water: '#2fd0e0', waterDeep: '#0f7fae', foam: '#ffffff' }
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded
const level = K.Level.build(game, "lagoon", { size: "medium", collectibles: 24 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";   // the plan's pickup
const player = K.Player.create(game, { type: "boat", spawn: level.spawn, yaw: level.spawnYaw, colors: {"body": "#ff5c4d", "accent": "#ffd23f", "boat": "#ff5c4d"} });
K.Camera.chase(game, player);

// White foam wake behind the player boat
K.FX.trail(game, player.object, { color: '#ffffff', colorEnd: '#bfefff', width: 1.4, length: 26, offset: [0, 0.15, 0.4] });

// generated voxel props beside the route, standing on the ground
const PROPS = ["prop_lighthouse", "prop_buoy"];
for (let i = 3, k = 0; i < level.route.length - 2; i += 3, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 4.5 : -4.5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2) continue;
  K.Assets.prop(game, PROPS[k % PROPS.length], { position: [x, y, z], rotationY: k * 1.3, height: 2.2 + (k % 3) * 0.6, fallback: 'mushroom' });
}
// generated Gaussian-splat landmarks (Idol) at mid distance from the route
const SPLATS = ["splat_lighthouse"];
for (let i = 2, k = 0; i < level.route.length - 1 && k < 6; i += 4) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 8 : -8);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 3) continue;
  K.Assets.splat(game, SPLATS[k % SPLATS.length], { position: [x, y, z], height: 3.5 + (k % 3), rotationY: k * 2.1, fallback: 'tree' });
  k++;
}

// ---- Shore dressing: chunky palms, rocks, flowers, bushes along the route ----
const shoreAvoid = level.route.map(p => p.toArray());
K.World.noPlant(game, shoreAvoid, 6);
K.World.foliage(game, {
  area: { center: [level.bounds ? (level.bounds.min.x + level.bounds.max.x) / 2 : 0, 0, level.bounds ? (level.bounds.min.z + level.bounds.max.z) / 2 : 0], radius: 120 },
  kinds: { palm: 1, rock: 0.7, flowers: 0.8, bush: 0.6, grass: 0.5 },
  density: 1.1,
  avoid: shoreAvoid,
  seed: 7
});

const rules = K.Gameplay.rules(game, {
  level, player,
  collect: { tag: "star", target: 12 },
  goal: true,
  timer: false,
  lives: false,
  race: { laps: 3, opponents: 3, aiSpeed: 0.94, countdown: 3 }
});

// ---- Custom FX moments on top of FX.auto ----
// Boost: speed lines + splash burst at the bow + shake
game.on('boost', (p, kind) => {
  if (p && p === player) {
    K.FX.speedLines(game, 0.9);
    K.FX.splash(game, player.position, { color: ['#ffffff', '#bfefff'], speed: 8 });
    K.FX.shake(game, 0.2);
  }
});
// Jump / land: splash burst + shake on landing
game.on('jump', (p) => {
  if (p === player) K.FX.splash(game, player.position, { color: ['#ffffff', '#a8ecff'], speed: 5 });
});
game.on('land', (p, speed) => {
  if (p === player) {
    K.FX.splash(game, player.position, { color: ['#ffffff', '#a8ecff'], speed: Math.min(14, 4 + speed * 0.8) });
    if (speed > 8) K.FX.shake(game, 0.25);
  }
});
// Collect starfish: star burst
game.on('collect', (item) => {
  if (item && item.tag === 'star') {
    K.FX.starBurst(game, item, { color: ['#ffd23f', '#ff5c4d'], scale: 1.2 });
  }
});
// Checkpoint: ring + text
game.on('checkpoint', (cp) => {
  K.FX.ring(game, cp.position || cp, { color: '#ffd23f', radius: 4, life: 0.6, flat: true });
});
// Lap: banner + shake
game.on('lap', (p, n) => {
  if (p === player) {
    const total = rules.state ? rules.state.laps : 3;
    if (n >= total) {
      K.UI.banner(game, 'FINAL LAP!', { style: 'warning', duration: 2 });
    } else {
      K.UI.banner(game, `LAP ${n + 1} / ${total}`, { style: 'checkpoint', duration: 1.4 });
    }
    K.FX.shake(game, 0.15);
  }
});
// Win: confetti + trophy text
game.on('win', () => {
  K.FX.confetti(game, null, { count: 220, colors: ['#ffd23f', '#ff5c4d', '#7df9ff', '#ffffff'] });
  K.FX.starBurst(game, player.position, { color: ['#ffd23f', '#ffffff'], scale: 2.5 });
});
game.on('lose', () => {
  K.FX.flash(game, '#3a0000', { opacity: 0.35, duration: 0.8 });
});

K.UI.hud(game, {
  style: "arcade",
  counters: [{ id: "collected", icon: "icon_starfish", label: "Starfish", target: 12 }],
  timer: true,
  lives: false,
  minimap: true,
  objective: "Beat 3 rivals over 3 laps",
  lap: true,
  position: true,
  speedometer: { max: 60, unit: 'km/h' },
  winScreen: { title: "You won the lagoon!", subtitle: "The lighthouse is yours." },
  loseScreen: { title: "Out-driven!", subtitle: "A rival beat you to the lighthouse." }
});

K.UI.titleScreen(game, {
  title: "Lagoon Rush",
  subtitle: "Skim the turquoise · chain the boosts · beat 3 rivals",
  start: "Press Space",
  credit: "WASD / arrows: steer & throttle · Shift: boost · Esc / P: pause",
  countdown: true
});

K.FX.auto(game);
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
