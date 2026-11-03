import * as K from 'kit';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Neon Arena: Dash the grid. Dodge the swarm. Bank the cores before the synthwave clock dies.
const game = await K.createGame({ seed: 7 });

// --- Look: deep indigo synthwave night, high-contrast neon pops, bloom for the grid glow ---
K.Look.apply(game, 'neon_night', {
  palette: {
    primary: '#00e5ff',   // cyan (player body / cores)
    secondary: '#ff2d95', // hot pink (accent / grid)
    accent: '#00ffc8',
    ui: '#120a2a', uiText: '#ffffff', uiAccent: '#00e5ff',
  },
  sky: { top: '#0a0626', horizon: '#2a1a66', bottom: '#05031a', stars: 1, aurora: 0.35 },
  sun: { color: '#ff2d95', intensity: 1.5, elevation: 7, azimuth: -20 },
  hemi: { sky: '#4a3a9a', ground: '#1a0a2a', intensity: 0.9 },   // less purple wash
  fog: { color: '#1a0a3a' },
  bloom: { strength: 0.8, radius: 0.55, threshold: 0.9 },
  rim: { color: '#ff2d95', strength: 0.9 },
});

// --- Level: circular arena ---
const level = K.Level.build(game, 'arena', { size: 'medium', seed: 7, collectibles: 40 });

// --- Player: topdown hover-robot ---
const player = K.Player.create(game, {
  type: 'topdown',
  spawn: level.spawn,
  colors: { body: '#00e5ff', accent: '#ff2d95' },
});

// --- Camera: lower, tighter third-person arena view ---
const cam = K.Camera.topdown(game, player, { height: 14, pitch: 0.72, fov: 46, lookAhead: 3.2 });

// --- Rules: bank 25 cores before the 150s clock dies; 3 lives; 10 enemies ---
const rules = K.Gameplay.rules(game, {
  level, player,
  collect: { tag: 'coin', target: 25 },
  goal: false,
  timer: 150,
  lives: 3,
  enemies: 10,
});

// --- UI / FX / Audio ---
K.UI.setStyle(game, 'scifi');
K.UI.hud(game, {
  title: 'Neon Arena',
  counters: [
    { id: 'collected', icon: K.Assets.icon('gem', game), label: 'Cores' },
    { id: 'lives', icon: K.Assets.icon('heart', game), label: 'Hull' },
  ],
  timer: true,
});
K.UI.titleScreen(game, { title: 'NEON ARENA', subtitle: 'Bank 25 cores before the clock dies', start: 'Press Space' });
K.FX.auto(game);
K.Audio.auto(game);
K.Audio.music(game, K.Assets.music('music_main', game));

// --- Player robot: distinct silhouette + persistent cyan thruster trail ---
const T = K.THREE;
const bodyMat = K.Look.material(game, { color: '#00e5ff', kind: 'toon', rim: 1.6 });
const accentMat = K.Look.material(game, { color: '#ff2d95', kind: 'emissive', emissive: '#ff2d95', emissiveIntensity: 2.4, rim: 1.2 });
const darkMat = K.Look.material(game, { color: '#12102e', kind: 'toon', rim: 0.8 });
const coreMat = K.Look.material(game, { color: '#ffffff', kind: 'emissive', emissive: '#00e5ff', emissiveIntensity: 3.2, rim: 1.5 });

function buildRobot() {
  const g = new T.Group(); g.name = 'hover-robot';
  // main hull: angled wedge capsule
  const hull = new T.Mesh(new T.CapsuleGeometry(0.42, 0.55, 6, 14), bodyMat);
  hull.rotation.z = Math.PI / 2;
  hull.position.y = 0.55;
  g.add(hull);
  // cockpit dome
  const dome = new T.Mesh(new T.SphereGeometry(0.28, 14, 12), coreMat);
  dome.position.set(0, 0.85, 0.12);
  dome.scale.set(1, 0.8, 1.1);
  g.add(dome);
  // nose cone (points forward = +Z)
  const nose = new T.Mesh(new T.ConeGeometry(0.3, 0.7, 10), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.55, 0.72);
  g.add(nose);
  // side thruster pods
  for (const s of [-1, 1]) {
    const pod = new T.Mesh(new T.CylinderGeometry(0.16, 0.2, 0.5, 10), darkMat);
    pod.position.set(s * 0.48, 0.45, -0.25);
    g.add(pod);
    const glow = new T.Mesh(new T.CylinderGeometry(0.12, 0.14, 0.1, 10), accentMat);
    glow.position.set(s * 0.48, 0.2, -0.25);
    g.add(glow);
  }
  // rear thruster ring
  const ring = new T.Mesh(new T.TorusGeometry(0.3, 0.06, 8, 20), accentMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.55, -0.55);
  g.add(ring);
  // antenna
  const ant = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.45, 6), darkMat);
  ant.position.set(0, 1.25, -0.1);
  g.add(ant);
  const tip = new T.Mesh(new T.SphereGeometry(0.06, 8, 8), accentMat);
  tip.position.set(0, 1.5, -0.1);
  g.add(tip);
  return g;
}
const robot = buildRobot();
player.object.add(robot);

// persistent cyan thruster trail behind the bot
const trail = K.FX.trail(game, player.object, {
  color: '#00e5ff', colorEnd: '#ff2d95', width: 0.7, length: 14, offset: [0, 0.5, -0.6],
});

// hover bob + face the mouse aim
game.update(() => {
  const t = game.time;
  robot.position.y = Math.sin(t * 6) * 0.05;
  robot.rotation.y = Math.sin(t * 2.2) * 0.06;
});

// --- Enemies: recolour + detail pass on the kit's spiky orbs and slimes ---
game.on('start', () => {
  const enemies = rules.enemies || [];
  for (const e of enemies) {
    const obj = e.object || e.mesh || e.group;
    if (!obj) continue;
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      const c = m.color ? m.color.getHex() : 0;
      // spiky chase orbs: hot pink spikes, cyan core
      if (e.kind === 'chase') {
        if (c === 0x000000 || c > 0x444444) { m.color.set('#ff2d95'); }
        if (m.emissive) m.emissive.set('#ff2d95');
      }
      // patrol slimes: bright green blob with a cyan rim
      if (e.kind === 'patrol') {
        m.color.set('#39ff7a');
        if (m.emissive) { m.emissive.set('#12ff9a'); m.emissiveIntensity = 0.7; }
        if (m.rim !== undefined) m.rim = 1.6;
      }
    });
    // give slimes a squashed, gooey silhouette; orbs a spiky halo
    if (e.kind === 'patrol') {
      obj.scale.y = 0.72;
      obj.position.y = (obj.position.y || 0) + 0.18;
    }
    if (e.kind === 'chase') {
      const halo = new T.Mesh(new T.IcosahedronGeometry(0.95, 0),
        K.Look.material(game, { color: '#ff2d95', kind: 'emissive', emissive: '#ff2d95', emissiveIntensity: 1.6, flat: true }));
      halo.scale.setScalar(1.12);
      obj.add(halo);
      obj.userData.halo = halo;
    }
  }
});

// spin the orb halos
game.update(() => {
  for (const e of rules.enemies || []) {
    const h = e.object && e.object.userData && e.object.userData.halo;
    if (h) { h.rotation.y = game.time * 1.4; h.rotation.x = game.time * 0.9; }
  }
});

// --- Arena floor: bright emissive magenta grid over the dark tiles ---
function buildNeonGrid(radius) {
  const g = new T.Group(); g.name = 'neon-grid';
  const lineMat = new T.MeshBasicMaterial({ color: '#ff2d95', toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false });
  const step = 4, half = Math.floor(radius / step);
  const geos = [];
  for (let i = -half; i <= half; i++) {
    const d = i * step;
    const ext = Math.sqrt(Math.max(0, radius * radius - d * d));
    geos.push(new T.BoxGeometry(0.14, 0.05, ext * 2));
    geos[geos.length - 1].translate(0, 0.03, d);
    const gx = new T.BoxGeometry(ext * 2, 0.05, 0.14);
    gx.translate(d, 0.03, 0);
    geos.push(gx);
  }
  // concentric rings
  for (const r of [radius * 0.33, radius * 0.66, radius * 0.97]) {
    const ring = new T.TorusGeometry(r, 0.09, 6, 96);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, 0.03, 0);
    geos.push(ring);
  }
  const merged = mergeGeometries(geos, false);
  const grid = new T.Mesh(merged, lineMat);
  grid.position.y = 0.02;
  g.add(grid);
  return g;
}
const grid = await buildNeonGrid(34);
game.scene.add(grid);

// --- Debug / start ---
K.Debug.install(game, { level, player });
game.start();
