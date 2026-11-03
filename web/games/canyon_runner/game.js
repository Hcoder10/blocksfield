import * as K from 'kit';

// Canyon Runner: Chain the boost pads, kiss the sunset, beat the clock.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Canyon Runner" });

// Golden-hour canyon: low warm sun, peach-to-violet sky, long raking shadows.
K.Look.apply(game, "sunset", {
  sun: { elevation: 8, intensity: 2.6 },
  fog: { near: 0.25, far: 0.85 },
});
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded

const level = K.Level.build(game, "race_track", { size: "medium", seed: 7, collectibles: 24 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "gem";   // the plan's pickup: Sunstones

// A few extra Sunstones off the racing line, on the ground beside the route (bonus gems).
for (let i = 4; i < level.route.length - 3 && level.collectibles.length < 30; i += 5) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(4.5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 1.5) continue;
  level.collectibles.push({ position: new K.THREE.Vector3(x, y + 0.6, z), tag: 'gem' });
}

const player = K.Player.create(game, {
  type: "kart",
  spawn: level.spawn,
  yaw: level.spawnYaw,
  colors: { body: "#0f9bb0", accent: "#ffd166", kart: "#0f9bb0" },
  character: { species: 'kid', accessory: 'hat', colors: { body: '#0f9bb0', accent: '#ffd166' } },
});
K.Camera.chase(game, player);

// Long amber dust trail off the hover-bike, plus a teal boost trail.
K.FX.trail(game, player.object, { color: '#ffd166', colorEnd: '#ff8c42', width: 0.5, length: 20, offset: [0, 0.25, 0] });

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

// Desert dressing: cacti and dead scrub around the circuit (outside the racing line).
K.World.noPlant(game, level.route.map(p => p), 4);
K.World.foliage(game, {
  area: { center: [level.spawn.x, 0, level.spawn.z], radius: level.bounds ? Math.max(level.bounds.max.x - level.bounds.min.x, level.bounds.max.z - level.bounds.min.z) * 0.5 : 120 },
  kinds: { cactus: 1, rock: 0.6, tree_dead: 0.3, grass_dry: 0.5 },
  density: 0.7,
  avoid: level.route.map(p => p),
  seed: 11,
});

const rules = K.Gameplay.rules(game, {
  level, player,
  collect: { tag: "gem", target: 12 },
  goal: true,
  timer: 150,
  lives: 3,
  race: { laps: 1, opponents: 0, countdown: 0 },   // time trial, not a multi-lap race
});

K.UI.hud(game, {
  style: "arcade",
  counters: [{ id: "collected", icon: "icon_sunstone_gem", label: "Sunstones", target: 12 }],
  timer: true,
  lives: true,
  speedometer: { max: 140, unit: 'km/h' },
  minimap: true,
  objective: "Scoop 12 Sunstones, reach the gate before midnight",
  winScreen: { title: "TIME TRIAL COMPLETE", subtitle: "You kissed the sunset and beat the clock." },
  loseScreen: { title: "CANYON CLAIMS YOU", subtitle: "The dust settles over the canyon floor." },
});

K.UI.titleScreen(game, {
  title: "Canyon Runner",
  subtitle: "Chain the boost pads, kiss the sunset, beat the clock.",
  start: "Press Space",
  credit: "W / ↑: throttle · S / ↓: brake · A / D: steer · Shift: drift",
  countdown: true,
});

K.FX.auto(game);
K.Audio.auto(game);
K.Audio.music(game, 'music_main', { volume: 0.6 });

// ---- Plan's extra juice, wired to the CONTRACT events ----
// Boost pads: whoosh + speed lines ramp while fast.
game.on('boost', (p, kind) => {
  K.Audio.sfx(game, 'sfx_boost');
  K.FX.speedLines(game, 0.9, { pulse: 0.5 });
  K.FX.burst(game, player.position, { count: 20, speed: 8, size: 0.3, life: 0.5, color: ['#ffd166', '#0f9bb0'], shape: 'spark' });
});

// Checkpoint flags: gold ring pulse + toast banner.
game.on('checkpoint', (cp) => {
  K.Audio.sfx(game, 'sfx_checkpoint');
  const pos = cp && cp.position ? cp.position : player.position;
  K.FX.ring(game, pos, { color: '#ffd166', radius: 4, life: 0.6, flat: true });
  K.UI.toast(game, 'CHECKPOINT', { icon: 'flag' });
});

// Canyon falls: poof at respawn + damage sfx on the fall itself.
game.on('death', (t, reason) => {
  if (t === player) K.Audio.sfx(game, 'sfx_hit');
});
game.on('respawn', (p) => {
  K.Audio.sfx(game, 'respawn');
  K.FX.poof(game, player.position, { color: '#ffb37a', size: 1.6 });
  K.FX.ring(game, player.position, { color: '#ffd166', radius: 3, life: 0.5, flat: true });
});

// Finish-gate moment: slow-mo + confetti + big banner.
game.on('win', () => {
  K.Audio.sfx(game, 'sfx_win');
  K.FX.slowmo(game, 0.35, 0.8);
  K.FX.confetti(game, null, { count: 200, colors: ['#ffd166', '#ff8c42', '#0f9bb0', '#ff5e8a'] });
  K.FX.starBurst(game, player.position, { color: '#ffd166', scale: 2 });
  K.UI.banner(game, 'TIME TRIAL COMPLETE', { style: 'stage_clear', sub: 'You kissed the sunset' });
});
game.on('lose', (reason) => {
  K.Audio.sfx(game, 'sfx_lose');
});

// Speed lines ramp with velocity: the canyon blurs past at top speed.
let lastSpeedLevel = 0;
game.update((dt) => {
  const s = player.speed || 0;
  const lvl = Math.max(0, Math.min(1, (s - 16) / 14));
  if (Math.abs(lvl - lastSpeedLevel) > 0.08) {
    K.FX.speedLines(game, lvl, { pulse: 0.2 });
    lastSpeedLevel = lvl;
  }
});

K.Debug.install(game, { level, player });
game.start();
