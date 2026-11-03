import * as K from 'kit';

// Neon Drift Circuit: Drift the neon, charge the boost, out-run five rivals under a giant synthwave sun.
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Neon Drift Circuit" });
K.Look.apply(game, "neon_night");
K.Assets.sky(game, 'sky');                 // generated panorama; pops in when loaded

// ---------------- Level ----------------
const level = K.Level.build(game, "race_track", { size: "medium", collectibles: 24, seed: 7 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "orb";   // the plan's pickup

// ---------------- Player ----------------
const player = K.Player.create(game, { type: "kart", spawn: level.spawn, yaw: level.spawnYaw, colors: { body: "#00f0ff", accent: "#ff2d95" } });
K.Camera.chase(game, player);

// ---------------- Decorative props along the route ----------------
const PROPS = ["prop_neon_palm", "prop_boost_pylon"];
for (let i = 3, k = 0; i < level.route.length - 2; i += 3, k++) {
  const a = level.route[i], b = level.route[i + 1];
  const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(k % 2 ? 3.5 : -3.5);
  const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
  if (y == null || Math.abs(y - a.y) > 2) continue;
  K.Assets.prop(game, PROPS[k % PROPS.length], { position: [x, y, z], rotationY: k * 1.3, height: 2.2 + (k % 3) * 0.6, fallback: k % 2 ? 'lamp' : 'palm' });
}

// ---------------- Rules ----------------
const rules = K.Gameplay.rules(game, {
  level, player,
  collect: { tag: "orb", target: 10 },
  goal: true,
  timer: true,
  lives: false,
  race: { laps: 3, opponents: 5, countdown: 3 },
  onWin: (state) => {
    K.FX.confetti(game, player.position, { count: 160 });
    K.FX.starBurst(game, player.position);
    K.FX.flash(game, '#ffffff', { strength: 0.5 });
  },
  onLose: (reason) => {
    K.FX.flash(game, '#ff2d95', { strength: 0.4 });
  }
});

// ---------------- UI ----------------
K.UI.hud(game, {
  style: "scifi",
  counters: [{ id: "collected", icon: "icon_orb_icon", label: "Volt Orbs", target: 10 }],
  timer: true,
  lap: true,
  position: true,
  speedometer: { max: 200, unit: "km/h" },
  minimap: { level },
  objective: "Finish 3 laps in 1st place"
});

K.UI.titleScreen(game, {
  title: "Neon Drift Circuit",
  subtitle: "Drift the neon. Charge the boost. Out-run five rivals.",
  start: "Press Space",
  credit: "W/↑ accelerate · S/↓ brake · A/D steer · Space drift → boost · R reset",
  countdown: true
});   // not awaited: it pauses the game until a key

// ---------------- FX + Audio ----------------
K.FX.auto(game);
K.Audio.auto(game);

// ---------------- Custom juice ----------------
// Cyan boost trail on the kart (visible while boosting)
const trail = K.FX.trail(game, player.object, { color: "#00f0ff", width: 0.6 });

// Drift: magenta smoke at the rear of the kart while drifting
game.on('drift', (p, tier) => {
  const rear = player.position.clone().add(new K.THREE.Vector3(
    -Math.sin(player.yaw) * 1.2, 0.4, -Math.cos(player.yaw) * 1.2));
  K.FX.smoke(game, rear, { color: "#ff2d95", count: 6, size: 0.5 });
  if (tier >= 2) K.FX.speedLines(game, 0.5);
});

// Boost: whoosh + shockwave ring + speed lines
game.on('boost', (p, kind) => {
  K.FX.ring(game, p.position, { color: "#00f0ff", radius: 3 });
  K.FX.speedLines(game, 0.9);
  K.Audio.sfx(game, 'sfx_boost');
});

// Collect: extra sparkle burst + pling
game.on('collect', (item) => {
  K.FX.sparkle(game, item.position || item, { color: "#00f0ff", count: 10 });
  K.Audio.sfx(game, 'sfx_collect');
});

// Lap: banner + chime
game.on('lap', (p, n) => {
  K.Audio.sfx(game, 'sfx_checkpoint');
  if (n === rules.state.laps) {
    K.UI.banner(game, 'FINAL LAP!', { style: 'warning', sub: 'Push it — the finish line is close' });
  } else {
    K.UI.banner(game, `LAP ${n}/${rules.state.laps}`, { style: 'checkpoint' });
  }
});

// Position toasts when overtaking / dropping
let lastPos = null;
game.on('state', (s) => {
  if (s.phase !== 'playing' || s.position == null) return;
  if (lastPos == null) { lastPos = s.position; return; }
  if (s.position < lastPos) {
    const ord = s.position === 1 ? '1st' : s.position === 2 ? '2nd' : s.position === 3 ? '3rd' : `${s.position}th`;
    K.UI.toast(game, `Overtake! Now ${ord}`, { icon: 'bolt' });
  } else if (s.position > lastPos && s.position - lastPos >= 1) {
    const ord = s.position === 5 ? '5th' : s.position === 6 ? '6th' : `${s.position}th`;
    K.UI.toast(game, `Slipped to ${ord}`, { icon: 'skull' });
  }
  lastPos = s.position;
});

// Slow-mo on the final lap's finish straight (last 15% of route on final lap)
let slowmoDone = false;
game.update((dt) => {
  const s = rules.state;
  if (s.phase !== 'playing' || slowmoDone) return;
  if (s.lap === s.laps) {
    // rough progress along route: use checkpoint count as proxy — final checkpoint reached => finish straight
    if (s.checkpoint >= s.checkpoints - 1) {
      slowmoDone = true;
      K.FX.slowmo(game, 0.5, 1.2);
      K.FX.speedLines(game, 1.0);
    }
  }
});

K.Debug.install(game, { level, player });
game.start();
