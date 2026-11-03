// Play demo for player/camera/gameplay: ?type=platformer|kart|boat|topdown|fps  &level=test|<Level.build kind>  &bot=1
import * as K from 'kit';
import * as THREE from 'three';
import * as TL from './testlevel.js';

const q = new URLSearchParams(location.search);
const type = q.get('type') || 'platformer';
const levelKind = q.get('level') || 'test';
const game = await K.createGame({ seed: 7 });
let level;
const vehicle = type === 'kart' || type === 'boat';
if (levelKind !== 'test' && K.Level.build) {
  if (K.Look.apply) K.Look.apply(game, q.get('look') || 'toon_bright');
  level = K.Level.build(game, levelKind, { size: 'medium' });
} else {
  level = type === 'kart' ? TL.race(game, false) : type === 'boat' ? TL.race(game, true) : type === 'topdown' ? TL.arena(game) : TL.platformer(game);
}
const player = K.Player.create(game, { type, spawn: level.spawn, yaw: level.spawnYaw, colors: { body: q.get('color') || '#ff7a59' } });
if (type === 'topdown') K.Camera.topdown(game, player);
else K.Camera.follow(game, player);
const rules = K.Gameplay.rules(game, {
  level, player,
  collect: vehicle ? null : { tag: 'coin' },
  goal: true, timer: true, lives: 3,
  race: vehicle ? { laps: +(q.get('laps') || 2), opponents: +(q.get('opp') ?? 3), countdown: +(q.get('cd') ?? 3) } : null,
  enemies: type === 'fps' ? [{ kind: 'patrol', position: new THREE.Vector3(4, 6.5, 77) }] : null,
});

// event log for tests
const log = window.__events = [];
for (const ev of ['collect', 'checkpoint', 'damage', 'death', 'respawn', 'goal', 'win', 'lose', 'jump', 'land', 'boost', 'lap', 'drift', 'dash', 'countdown', 'goalLocked', 'stomp', 'bounce'])
  game.on(ev, (a, b) => log.push({ ev, t: +game.time.toFixed(2), a: a && (a.name || a.tag || a.kind || a.index) || a, b: typeof b === 'number' ? +b.toFixed(1) : b }));

const hud = document.getElementById('hud');
game.update(() => {
  const s = game.state;
  hud.textContent = `${type}  ${s.won ? 'WON' : s.lost ? 'LOST ' + s.loseReason : ''}\n` +
    (vehicle ? `lap ${s.lap}/${s.laps}  pos ${s.position}/${s.racers}  speed ${player.speed.toFixed(0)}${player.drifting ? '  DRIFT ' + player.driftTier : ''}${player.boostT > 0 ? '  BOOST' : ''}` :
      `coins ${s.collected}/${s.target}  score ${s.score}  hp ${s.hp}  lives ${s.lives}  cp ${s.checkpoint}  t ${s.time.toFixed(1)}`);
}, 30);

if (K.Debug && typeof K.Debug.install === 'function') K.Debug.install(game, { level, player });
else {
  window.__kit = {
    ready: false, errors: window.__kitErrors || [],
    state: () => ({ time: game.time, player: { position: player.position.toArray().map(v => +v.toFixed(2)), velocity: player.velocity.toArray().map(v => +v.toFixed(2)), grounded: player.grounded, alive: player.alive }, ...game.state, level: { kind: level.kind } }),
    autopilot: (on = true) => K.Gameplay.autopilot(game, { level, player, on }),
    camera: (p, t) => { game.cameraOverride = { position: new THREE.Vector3(...p), target: new THREE.Vector3(...t) }; },
    release: () => { game.cameraOverride = null; },
    timeScale: (x) => { game.timeScale = x; },
    teleport: (p) => player.teleport(new THREE.Vector3(...p)),
  };
  game.on('start', () => requestAnimationFrame(() => requestAnimationFrame(() => { window.__kit.ready = true; })));
}
window.__p = player; window.__rules = rules; window.__level = level; window.K = K;
if (q.get('bot')) K.Gameplay.autopilot(game, { level, player });
game.start();
