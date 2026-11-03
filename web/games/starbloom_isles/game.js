import * as K from 'kit';

// ─── Starbloom Isles: Hop, bloom, and light the beacon across the floating sky ───
const game = await K.createGame({ assets: './assets/assets.json', seed: 7, title: "Starbloom Isles" });

// ─── LOOK: warm sunny toon with enhanced sun, rim light, and candy-sky palette ───
K.Look.apply(game, 'toon_bright', {
  sun: { elevation: 50, azimuth: 35, intensity: 2.2, color: '#fff0c8' },
  sky: { top: '#3aa8e0', horizon: '#8ed4f0', bottom: '#b8e8f8' },
  bloom: { strength: 0.4, radius: 0.3, threshold: 0.8 },
  edges: { strength: 1.0 },
  grade: { saturation: 1.1, contrast: 1.0, vignette: 0.25 }
});

// ─── SKY: generated panorama (pops in when loaded) ───
K.Assets.sky(game, 'sky');

// ─── LEVEL: sky islands, medium, 24 star blooms ───
const level = K.Level.build(game, 'sky_islands', { size: 'medium', collectibles: 24 });
for (const c of level.collectibles) if (c.tag === 'coin') c.tag = "star";

// ─── EXTRA FOLIAGE & PROPS for plush, rounded, candy-sky feel ───
if (level.islands) {
  for (const isl of level.islands) {
    // balanced grass tufts and flowers — lush but not overwhelming
    K.World.foliage(game, {
      area: isl,
      kinds: { grass: 1.0, flowers: 0.5, bush: 0.3 },
      density: 0.8,
      seed: isl.position ? Math.floor(isl.position.x * 7 + isl.position.z * 3) : 1
    });
    // scatter a few decorative props on larger islands
    if (isl.radius > 7 && isl.surfacePoint) {
      const sp = isl.surfacePoint(1.5, -1);
      K.World.prop(game, 'rock', { position: [sp[0], sp[1], sp[2]], scale: 0.5 });
    }
  }
}

// ─── CLOUDS: fluffy cumulus below the islands for weightless sky mood ───
K.World.clouds(game, { count: 18, height: -12, radius: 280, below: true, speed: 0.6 });

// ─── PLAYER: toon fox character with expressive features ───
const player = K.Player.create(game, {
  type: 'platformer',
  spawn: level.spawn,
  yaw: level.spawnYaw,
  colors: {
    body: '#ff8a3d',
    skin: '#fff1d6',
    accent: '#ffd23f',
    eyes: '#2a1a0a',
    belly: '#fff1d6'
  },
  tuning: { runSpeed: 12, jumpHeight: 4.5 }
});

// ─── CAMERA: slightly higher and further for cinematic platformer view ───
K.Camera.follow(game, player, { distance: 13, pitch: 0.45, height: 2.0, lookAhead: 2.0, fov: 58 });

// ─── GAMEPLAY RULES ───
const rules = K.Gameplay.rules(game, {
  level,
  player,
  collect: { tag: 'star', target: 12 },
  goal: true,
  timer: false,
  lives: 3,
  enemies: 4
});

// ─── COLLECTIBLE GLOW: add sparkle emitters to star blooms ───
game.on('collect', (item) => {
  if (item.tag === 'star') {
    K.FX.starBurst(game, item, { color: ['#ffd23f', '#fff1d6', '#ff8a3d'], scale: 1.2, count: 16 });
  }
});

// Add idle sparkles to remaining star collectibles (visual pop)
game.on('start', () => {
  if (rules.items) {
    for (const item of rules.items) {
      if (item.tag === 'star' && item.object) {
        K.FX.sparkles(game, item.object, { color: '#ffd23f', radius: 0.8, rate: 3 });
      }
    }
  }
});

// ─── HUD: candy-sky palette, star icon, lives, objective ───
K.UI.hud(game, {
  style: 'arcade',
  counters: [{ id: 'collected', icon: 'star', label: 'Star Blooms', target: 12 }],
  timer: false,
  lives: true,
  minimap: true,
  objective: 'Collect 12 Star Blooms to open the beacon!'
});

// ─── TITLE SCREEN ───
K.UI.titleScreen(game, {
  title: 'Starbloom Isles',
  subtitle: 'Hop, bloom, and light the beacon across the floating sky.',
  start: 'Press Space',
  credit: 'WASD / arrows: move · Space: jump (hold for higher hop) · P / Esc: pause',
  countdown: false
});

// ─── FX & AUDIO ───
K.FX.auto(game);
K.Audio.auto(game);

// ─── DEBUG ───
K.Debug.install(game, { level, player });
game.start();
