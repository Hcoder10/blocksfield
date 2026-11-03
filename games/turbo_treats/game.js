import * as K from 'kit';
import { scenery } from './scenery.js';

// Turbo Treats: Sugar-rush coins, spin-out oil slicks, and a trail of gumdrops behind the leader.
const game = await K.createGame({ assets: './assets/assets.json', seed: 486, title: "Turbo Treats" });
// Bright high-noon candy: vibrant azure sky, strong lemon sun, punchy saturation.
K.Look.apply(game, "candy", {
  sun: { elevation: 62, azimuth: 40, intensity: 2.6, color: '#fff6c8' },
  sky: { top: '#38a8ff', horizon: '#bdf3ff', bottom: '#eaffff' },
  grade: { saturation: 1.25, contrast: 1.12, vignette: 0.18 },
  bloom: { strength: 0.45, radius: 0.6, threshold: 1.15 },
  fog: { color: '#bdf3ff', near: 0.35, far: 0.95 },
});
// The generated panorama is a muddy wash; the candy look's procedural sky reads cleaner.
const level = K.Level.build(game, "race_track", { size: "medium", seed: 486, collectibles: 40 });
const player = K.Player.create(game, { type: "kart", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "bunny", "accessory": "scarf"}, colors: {"body": "#ff5d8f", "accent": "#59e8c2", "kart": "#ff5d8f"} });
K.Camera.chase(game, player, { distance: 8.5, height: 3.0, fov: 66 });
scenery(game, level);                     // generated candy props + splat landmarks (scenery.js)
candyScenery(game, level);                 // lane markers, gumdrop curbs, candy hills, clouds (below)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "coin", "target": 12, "label": "Sugar Coins"}, "goal": true, "timer": false, "lives": false, "race": {"laps": 3, "opponents": 3}});
// Candy-styled HUD: cozy plates + generated candy icons for counters.
K.UI.hud(game, {"counters": [{"id": "collected", "icon": K.Assets.icon('coin', game), "label": "Sugar Coins"}], "timer": true, "lives": false, "minimap": true, "style": "cozy", "lap": true, "position": true, "speedometer": true, "objective": "3 laps · 12 coins = Sugar Rush"});
K.UI.titleScreen(game, {"title": "Turbo Treats", "subtitle": "Sugar-rush coins, spin-out oil slicks, and a trail of gumdrops behind the leader.", "start": "Press Space", "credit": "W / up: throttle, S / down: brake · A D / left right: steer · Space (hold while steering): drift, release = boost", "countdown": true, "orbit": true, "pause": true});   // not awaited: it pauses the game until a key
// signature mechanics (K.Mechanics, after Gameplay.rules)
// Candy scenery: candy-stripe lane markers, gumdrop curbs, distant candy hills, cotton-candy clouds.
function candyScenery(game, level) {
  const route = level.route;
  const pink = K.Look.material(game, { color: '#ff5d8f', kind: 'toon', rim: 0.5 });
  const mint = K.Look.material(game, { color: '#59e8c2', kind: 'toon', rim: 0.5 });
  // candy-stripe lane markers down the middle of the track
  const dashGeo = new K.THREE.BoxGeometry(0.35, 0.06, 1.4);
  for (let i = 1; i < route.length - 1; i += 2) {
    const a = route[i], b = route[i + 1];
    const m = new K.THREE.Mesh(dashGeo, (i / 2) % 2 ? pink : mint);
    m.position.set(a.x, a.y + 0.05, a.z);
    m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    level.group.add(m);
  }
  // gumdrop curbs: little candy bumps at corners
  const gumGeo = new K.THREE.SphereGeometry(0.55, 10, 8);
  gumGeo.scale(1, 0.6, 1);
  for (let i = 2; i < route.length - 1; i += 4) {
    const a = route[i], b = route[i + 1];
    const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
    for (const s of [1.8, -1.8]) {
      const x = a.x + side.x * s, z = a.z + side.z * s;
      const y = K.World.heightAt(game, x, z);
      if (y == null) continue;
      const g = new K.THREE.Mesh(gumGeo, (i / 4) % 2 ? pink : mint);
      g.position.set(x, y + 0.25, z);
      level.group.add(g);
    }
  }
  // distant candy hills: big soft gumdrop domes on the horizon for depth
  const hillMat = K.Look.material(game, { color: '#c9f5e4', kind: 'toon', rim: 0.3 });
  const hillMat2 = K.Look.material(game, { color: '#ffd9ec', kind: 'toon', rim: 0.3 });
  const b = level.bounds;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  for (let k = 0; k < 10; k++) {
    const ang = (k / 10) * Math.PI * 2 + 0.4;
    const r = span * 0.85 + k * 8;
    const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
    const y = K.World.heightAt(game, x, z);
    if (y == null) continue;
    const dome = new K.THREE.Mesh(new K.THREE.SphereGeometry(14 + (k % 4) * 6, 14, 10), k % 2 ? hillMat : hillMat2);
    dome.scale.y = 0.45;
    dome.position.set(x, y, z);
    level.group.add(dome);
  }
  // cotton-candy clouds for a bright high-noon sky
  K.World.clouds(game, { count: 14, height: 42, radius: span * 0.9, center: [cx, 0, cz] });
}
const ALONG = (f) => { const r = level.route, i = Math.min(r.length - 2, Math.max(0, Math.floor(f * (r.length - 1)))), a = r[i], b = r[i + 1]; return { p: [a.x, a.y, a.z], yaw: Math.atan2(b.x - a.x, b.z - a.z) }; };
// mechanic: Sugar Rush (rule): 12 sugar coins = SUGAR RUSH: 4 seconds of 1.5x speed.
K.Mechanics.rule(game, {"name": "Sugar Rush", "text": "12 sugar coins = SUGAR RUSH: 4 seconds of 1.5x speed.", "when": "state", "key": "collected", "gte": 12, "do": [{"tune": {"speed": 1.5}, "seconds": 4}, {"banner": "SUGAR RUSH!"}, {"score": 50}, {"fx": "speedLines"}, {"sfx": "boost"}]});
// mechanic: Oil Slick Spin-Out (custom): Cross an oil slick and your kart spins out — dizzy wobble, no steering for a second.
K.Mechanics.custom(game, {
  name: "Oil Slick Spin-Out",
  text: "Cross an oil slick and your kart spins out — dizzy wobble, no steering for a second.",
  init(ctx) {
    ctx.vars.slips = [];
    ctx.vars.spin = 0;
    // Place 5 oil slicks on the racing line, avoiding the start area.
    const fracs = [0.15, 0.32, 0.5, 0.68, 0.85];
    const THREE = ctx.THREE;
    const dark = new THREE.MeshBasicMaterial({ color: '#1c2028', transparent: true, opacity: 0.85 });
    const sheen = new THREE.MeshBasicMaterial({ color: '#8a6cff', transparent: true, opacity: 0.4 });
    for (const f of fracs) {
      const a = ALONG(f), b = ALONG(f + 0.004);
      const yaw = Math.atan2(b.p[0] - a.p[0], b.p[2] - a.p[2]);
      const g = new THREE.Group();
      const blob = new THREE.Mesh(new THREE.CircleGeometry(1.7, 22), dark);
      blob.rotation.x = -Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.55, 22), sheen);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
      g.add(blob, ring);
      g.position.set(a.p[0], a.p[1] + 0.06, a.p[2]); g.rotation.y = yaw;
      ctx.level.group.add(g);
      ctx.vars.slips.push({ x: a.p[0], z: a.p[2], mesh: g, hit: false, cd: 0 });
    }
  },
  update(dt, ctx) {
    // spin-out: dizzy wobble + no steering for 1 second
    if (ctx.vars.spin > 0) {
      ctx.vars.spin -= dt;
      const p = ctx.player;
      p.yaw += dt * 9; // spin the kart
      p.setInput(0, 0.9, false, false); // throttle only, no steering
      if (ctx.vars.spin <= 0) p.setInput(null);
    }
    // check slick hits (simple distance, with cooldown so you can cross again next lap)
    const pp = ctx.player.position;
    for (const s of ctx.vars.slips) {
      if (s.cd > 0) { s.cd -= dt; if (s.cd <= 0) s.hit = false; continue; }
      if (s.hit) continue;
      const dx = pp.x - s.x, dz = pp.z - s.z;
      if (dx * dx + dz * dz < 2.4 * 2.4) {
        s.hit = true; s.cd = 5;
        ctx.vars.spin = 1.0;
        ctx.emit('damage', ctx.player, 0, 'oil');
        ctx.toast('SPIN-OUT!', 1);
      }
    }
  }
});
// mechanic: Gumdrops of the Leader (custom): The leader leaves a trail of gumdrops; trailing karts can pick them up for a boost.
K.Mechanics.custom(game, {
  name: "Gumdrops of the Leader",
  text: "The leader leaves a trail of gumdrops; trailing karts can pick them up for a boost.",
  init(ctx) {
    ctx.vars.t = 0;
    ctx.vars.drops = [];
    const THREE = ctx.THREE;
    ctx.vars.mat = new THREE.MeshBasicMaterial({ color: '#ff7ab8' });
  },
  update(dt, ctx) {
    ctx.vars.t += dt;
    // We track the leader via ctx.state.position (player's rank). If player is leader, they drop gumdrops behind.
    if (ctx.state.position === 1 && ctx.vars.t > 0.5) {
      ctx.vars.t = 0;
      const p = ctx.player;
      const THREE = ctx.THREE;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), ctx.vars.mat);
      m.position.set(p.position.x, p.position.y + 0.3, p.position.z);
      ctx.level.group.add(m);
      ctx.vars.drops.push({ mesh: m, born: ctx.time });
    }
    // expire drops after 6s, and let the player (if not leader) collect them for a boost
    for (let i = ctx.vars.drops.length - 1; i >= 0; i--) {
      const d = ctx.vars.drops[i];
      if (ctx.time - d.born > 6) { ctx.level.group.remove(d.mesh); ctx.vars.drops.splice(i, 1); continue; }
      if (ctx.state.position !== 1) {
        const p = ctx.player.position;
        const dx = p.x - d.mesh.position.x, dz = p.z - d.mesh.position.z;
        if (dx * dx + dz * dz < 1.5 * 1.5) {
          ctx.level.group.remove(d.mesh); ctx.vars.drops.splice(i, 1);
          ctx.player.boost(1.2);
          ctx.toast('GUMDROP BOOST!', 0.8);
          ctx.emit('boost', ctx.player, 'gumdrop');
        }
      }
    }
  }
});
K.FX.auto(game);
// Extra juice: candy-dust trail + confetti pops on coin collect + boost speed lines.
K.FX.trail(game, player.object, { color: '#ff5d8f', colorEnd: '#59e8c2', width: 0.5, length: 16, offset: [0, 0.4, 0] });
game.on('collect', (item) => {
  if (item && item.tag === 'coin') {
    K.FX.confetti(game, item.position, { count: 26, colors: ['#ff5d8f', '#59e8c2', '#ffd23f', '#fff'] });
    K.FX.ring(game, item.position, { color: '#ffd23f', radius: 1.4, life: 0.4, flat: true });
  }
});
game.on('boost', () => {
  K.FX.speedLines(game, 0.9, { pulse: 0.8 });
});
K.Audio.auto(game);
K.Debug.install(game, { level, player });
game.start();
