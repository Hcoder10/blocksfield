// ThreeKit UI/FX/Audio/Debug demo. URL params:
//   style=arcade|cozy|sleek|fantasy|scifi   screen=hud|race|title|win|lose|pause|dialog|banners|countdown|fx|toast
//   fx=0 turns off the timed event loop; t=<seconds> fast-forwards the scripted timeline.
import * as K from 'kit';
const T = K.THREE;
const q = new URLSearchParams(location.search);
const style = q.get('style') || 'arcade';
const screen = q.get('screen') || 'hud';
const race = screen === 'race';

const game = await K.createGame({ seed: 3 });
const { scene, camera, renderer } = game;
renderer.toneMappingExposure = 1.05;

// ---------- a pleasant little toon island (stand-in for Look/World while those land) ----------
const PAL = {
  arcade: { top: '#4fb3ff', bot: '#cdeeff', grass: '#7bd34f', water: '#2bb5d8' },
  cozy: { top: '#ffb38a', bot: '#ffe9c9', grass: '#a6d96a', water: '#69c7c9' },
  sleek: { top: '#7aa7d8', bot: '#e6eef6', grass: '#8fbf6a', water: '#3c8fb5' },
  fantasy: { top: '#3b2a63', bot: '#d98a6a', grass: '#5f9a4a', water: '#2c5f8a' },
  scifi: { top: '#070b2a', bot: '#4a1f6a', grass: '#2f6f6a', water: '#14305a' },
}[style] || {};
const sky = new T.Mesh(new T.SphereGeometry(900, 32, 16), new T.ShaderMaterial({ side: T.BackSide, depthWrite: false,
  uniforms: { a: { value: new T.Color(PAL.top) }, b: { value: new T.Color(PAL.bot) } },
  vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform vec3 a,b; varying vec3 p; void main(){ float t = smoothstep(-.1,.6,p.y); gl_FragColor = vec4(mix(b,a,t),1.); \n#include <colorspace_fragment>\n }' }));
scene.add(sky);
scene.fog = new T.Fog(PAL.bot, 120, 600);
scene.add(new T.HemisphereLight('#ffffff', '#6a7a5a', 1.4));
const sun = new T.DirectionalLight('#fff3dc', 2.6);
sun.position.set(30, 50, 20); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 150 }); sun.shadow.bias = -0.0005;
scene.add(sun);
const toon = (c) => new T.MeshToonMaterial({ color: c });
const water = new T.Mesh(new T.CircleGeometry(400, 64), new T.MeshStandardMaterial({ color: PAL.water, roughness: 0.25, metalness: 0.1 }));
water.rotation.x = -Math.PI / 2; water.position.y = -1.2; water.receiveShadow = true; scene.add(water);
const island = new T.Mesh(new T.CylinderGeometry(30, 26, 4, 48), [toon('#a9744a'), toon(PAL.grass), toon('#8a5a36')]);
island.position.y = -2; island.receiveShadow = true; scene.add(island);
const rng = (a, b) => a + game.rand() * (b - a);
for (let i = 0; i < (screen === 'fx' ? 18 : 26); i++) {
  const a = rng(0, Math.PI * 2), r = i < 18 ? rng(23, 28) : rng(3, 9);
  const tr = new T.Group();
  const trunk = new T.Mesh(new T.CylinderGeometry(0.35, 0.5, 2.2, 8), toon('#7a4a2a')); trunk.position.y = 1.1;
  const s = rng(0.8, 1.4);
  const crown = new T.Mesh(new T.IcosahedronGeometry(1.8 * s, 0), toon(new T.Color(PAL.grass).offsetHSL(rng(-0.04, 0.04), 0, rng(-0.12, 0)))); crown.position.y = 2.6 + s;
  for (const m of [trunk, crown]) { m.castShadow = true; tr.add(m); }
  tr.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); scene.add(tr);
}
for (let i = 0; i < 10; i++) { const r = new T.Mesh(new T.DodecahedronGeometry(rng(0.6, 1.4), 0), toon('#9aa2ad')); const a = rng(0, 6.28), d = rng(10, 22); r.position.set(Math.cos(a) * d, 0.3, Math.sin(a) * d); r.castShadow = true; scene.add(r); }

// route: a loop around the island; coins along it; four checkpoints; goal
const R0 = 16;
const route = Array.from({ length: 48 }, (_, i) => { const a = i / 48 * Math.PI * 2; return new T.Vector3(Math.cos(a) * R0 * 1.15, 0, Math.sin(a) * R0 * 0.85); });
const coinGeo = new T.CylinderGeometry(0.55, 0.55, 0.14, 24); coinGeo.rotateX(Math.PI / 2);
const coinMat = new T.MeshStandardMaterial({ color: '#ffcc33', emissive: '#7a4a00', metalness: 0.6, roughness: 0.3 });
const coins = [];
for (let i = 2; i < 48; i += 2) { const m = new T.Mesh(coinGeo, coinMat); m.position.copy(route[i]).setY(1.2); m.castShadow = true; scene.add(m); coins.push({ position: m.position, tag: 'coin', mesh: m }); }
const checkpoints = [12, 24, 36].map(i => ({ position: route[i].clone(), radius: 2.5 }));
for (const c of checkpoints) { const ring = new T.Mesh(new T.TorusGeometry(2.2, 0.18, 10, 40), new T.MeshStandardMaterial({ color: '#7dfcff', emissive: '#2aa9b5' })); ring.position.copy(c.position).setY(2.4); ring.rotation.y = Math.PI / 2; scene.add(ring); }
const level = { kind: 'demo', spawn: route[0].clone(), spawnYaw: 0, bounds: new T.Box3(new T.Vector3(-31, -2, -31), new T.Vector3(31, 10, 31)),
  route, checkpoints, collectibles: coins, hazards: [], movers: [], goal: { position: route[46].clone(), radius: 3 }, track: race ? new T.CatmullRomCurve3(route, true) : null, group: scene, colliders: [] };

// a bouncy bean of a player running the loop
const body = new T.Group();
const bean = new T.Mesh(new T.CapsuleGeometry(0.55, 0.7, 6, 16), toon('#ff7a59')); bean.position.y = 0.9; bean.castShadow = true; body.add(bean);
for (const x of [-0.2, 0.2]) { const e = new T.Mesh(new T.SphereGeometry(0.11, 10, 8), toon('#1b1430')); e.position.set(x, 1.25, 0.5); body.add(e); }
scene.add(body);
const player = { type: race ? 'kart' : 'platformer', object: body, position: body.position, velocity: new T.Vector3(), yaw: 0, grounded: true, speed: 0, alive: true,
  controls: { enabled: true }, teleport(p) { body.position.copy(p); }, respawn() {}, setInput() {} };
let u = 0, vy = 0, nextJump = 1.5;
const curve = new T.CatmullRomCurve3(route, true);
game.update((dt, t) => {
  const sp = race ? 22 + Math.sin(t * 0.7) * 8 : 6.5;
  u = (u + dt * sp / curve.getLength()) % 1;
  const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
  nextJump -= dt;
  if (!race && nextJump < 0 && player.grounded) { vy = 9; player.grounded = false; nextJump = 2.2; game.emit('jump', player); }
  if (!player.grounded) { vy -= 26 * dt; body.position.y += vy * dt; if (body.position.y <= 0) { body.position.y = 0; player.grounded = true; game.emit('land', player, Math.abs(vy)); vy = 0; } }
  player.velocity.set(tan.x * sp, vy, tan.z * sp);
  body.position.x = p.x; body.position.z = p.z;
  player.yaw = Math.atan2(tan.x, tan.z); body.rotation.y = player.yaw; player.speed = sp;
  bean.scale.set(1, 1 + Math.sin(t * 14) * 0.04, 1);
  for (const c of coins) c.mesh.rotation.y += dt * 3;
});
// camera: simple chase (the camera kit's job in real games)
const camPos = new T.Vector3(0, 8, 30);
game.lateUpdate((dt) => {
  const back = new T.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(-9);
  camPos.lerp(body.position.clone().add(back).add(new T.Vector3(0, 5, 0)), 1 - Math.exp(-dt * 4));
  camera.position.copy(camPos); camera.lookAt(body.position.clone().add(new T.Vector3(0, 1.5, 0)));
}, 20);

// ---------- the kits ----------
game.state = race ? { lap: 1, laps: 3, position: 3, racers: 8, time: 0 } : { coins: 0, gems: 0, lives: 3, maxLives: 3, time: 0 };
const hudOpts = race
  ? { style, title: 'Wave Racer', lap: true, position: true, timer: true, speedometer: { max: 140 }, minimap: { level }, player, objective: 'Finish 3 laps' }
  : { style, title: 'Starbloom Peaks', counters: [{ id: 'coins', icon: 'coin', label: 'Coins', target: 23 }, { id: 'gems', icon: 'gem', label: 'Gems', target: 5 }], timer: true, lives: true, minimap: { level }, player, objective: 'Collect 23 coins' };
const HUD = K.UI.hud(game, hudOpts);
K.FX.auto(game, { player });
K.Audio.auto(game, { music: false });
K.Debug.install(game, { level, player });
game.update((dt) => { game.state.time += dt; }, 10);

// scripted event loop so every effect shows up on its own
let coinI = 0;
const collect = () => { const c = coins[coinI++ % coins.length]; game.state.coins = Math.min(23, (game.state.coins || 0) + 1); game.emit('collect', { position: body.position.clone().add(new T.Vector3(0, 1.2, 0)), tag: 'coin' }, player); c.mesh.visible = false; c.collected = true; };
const timeline = [];
const at = (t, fn) => timeline.push({ t, fn });
if (q.get('fx') !== '0') {
  if (!race) {
    for (let i = 0; i < 40; i++) at(0.6 + i * 0.7, collect);
    at(2.2, () => { game.state.gems++; game.emit('collect', { position: body.position.clone().add(new T.Vector3(0, 1.5, 0)), tag: 'gem', value: 5 }, player); });
    at(3.0, () => game.emit('checkpoint', checkpoints[0]));
    at(5.2, () => { game.state.lives = 2; game.emit('damage', player, 1, null); });
    at(6.5, () => game.emit('boost', player));
    at(8.5, () => K.UI.toast(game, 'New ability: Double Jump', { icon: 'bolt' }));
  } else {
    at(1.0, () => game.emit('boost', player));
    at(2.5, () => { game.state.position = 2; });
    at(4.0, () => { game.state.lap = 2; game.emit('lap', player, 2); });
    at(6.0, () => { game.state.position = 1; });
    at(8.0, () => { game.state.lap = 3; game.emit('lap', player, 3); });
  }
}
const ff = +(q.get('t') || 0);
let clock = ff;
for (const e of timeline) if (e.t < ff) e.fn();
game.update((dt) => { clock += dt; while (timeline.length && timeline[0].t <= clock) { timeline.sort((a, b) => a.t - b.t); timeline.shift().fn(); } }, 11);

// ---------- screens ----------
const S = {
  title: () => K.UI.titleScreen(game, { title: race ? 'Wave Racer' : 'Starbloom Peaks', subtitle: race ? 'Three laps. No brakes.' : 'Collect every star before sundown', start: 'Press Space', credit: 'Made with Blocksfield', level }),
  win: () => { game.state.coins = 23; game.state.gems = 4; game.state.deaths = 0; game.emit('win'); },
  lose: () => { game.state.lives = 0; game.emit('lose', 'lives'); },
  pause: () => setTimeout(() => K.UI.pauseMenu(game), 300),
  dialog: () => setTimeout(() => K.UI.dialog(game, { name: 'Mayor Pip', portrait: 'P', lines: ['Oh! A visitor! Welcome to Starbloom Peaks, friend.', 'The festival lanterns went dark last night. Could you find the 5 star seeds?'] }), 400),
  banners: () => { const seq = [['GO!', 'go'], ['Checkpoint!', 'checkpoint'], ['Final Lap!', 'warning'], ['Stage Clear!', 'stage_clear']]; seq.forEach(([t, s], i) => setTimeout(() => K.UI.banner(game, t, { style: s, duration: 1.5 }), 300 + i * 2000)); },
  banner_go: () => setTimeout(() => K.UI.banner(game, 'GO!', { style: 'go', duration: 30 }), 200),
  banner_cp: () => setTimeout(() => K.UI.banner(game, 'Checkpoint!', { style: 'checkpoint', duration: 30, sub: '2 of 3' }), 200),
  banner_warn: () => setTimeout(() => K.UI.banner(game, 'Final Lap!', { style: 'warning', duration: 30 }), 200),
  banner_clear: () => setTimeout(() => K.UI.banner(game, 'Stage Clear!', { style: 'stage_clear', duration: 30, sub: 'New record' }), 200),
  countdown: () => setTimeout(() => K.UI.countdown(game), 300),
  mech: () => {   // mechanics UI driven by the events mechanics.js emits
    setTimeout(() => { game.emit('powerup', player, { type: 'speed', duration: 8 }); game.emit('powerup', player, { type: 'magnet', duration: 4 }); game.emit('powerup', player, { type: 'invincible', duration: 12 }); }, 300);
    setTimeout(() => { game.emit('key', player, { color: 'red' }); game.emit('key', player, { color: 'blue' }); game.emit('key', player, { color: 'gold' }); }, 500);
    setTimeout(() => game.emit('prompt', { text: 'Open door', key: 'E', icon: 'door' }), 700);
    setTimeout(() => game.emit('rule', { name: 'floor_is_lava', text: 'Floor is lava!', seconds: 5 }), 900);
    if (q.get('banner')) setTimeout(() => game.emit('mechanic', { name: 'Gravity Flip', text: 'Press G to flip gravity' }), 300);
  },
  toast: () => { K.UI.toast(game, 'Checkpoint reached', { icon: 'flag' }); K.UI.toast(game, '+50 Combo!', { icon: 'star' }); },
  fx: () => {
    const c = new T.Vector3(0, 1, 0);
    body.visible = false;
    const loop = () => {
      K.FX.starBurst(game, c.clone().add(new T.Vector3(-6, 2, 0)));
      K.FX.sparkle(game, c.clone().add(new T.Vector3(-2, 1.5, 0)), { color: '#5ef1ff' });
      K.FX.dust(game, c.clone().add(new T.Vector3(1, -1, 2)), { amount: 0.6 });
      K.FX.splash(game, c.clone().add(new T.Vector3(5, -1, 0)));
      K.FX.magic(game, c.clone().add(new T.Vector3(2, -1, -4)));
      K.FX.confetti(game, c.clone().add(new T.Vector3(0, 0, -2)), { count: 80 });
      K.FX.text(game, c.clone().add(new T.Vector3(-2, 3, 0)), '+10');
      K.FX.ring(game, c.clone().add(new T.Vector3(0, -1, 0)), { color: '#7dfcff', radius: 5 });
      K.FX.smoke(game, c.clone().add(new T.Vector3(7, -1, -5)));
    };
    loop(); setInterval(loop, 2500);
    K.FX.fire(game, new T.Vector3(-8, 0, -4), { size: 1.2 });
    K.FX.speedLines(game, 0.6);
    game.cameraOverride = { position: new T.Vector3(0, 5.5, 13), target: new T.Vector3(0, 1.8, -1) };
  },
};
if (S[screen]) S[screen]();
game.start();
window.__demo = { game, level, player, HUD };
