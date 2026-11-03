// Mechanics demo: ?setup=keys (key/door/switch puzzle, sky_islands) | race (power-up kart race, race_track)
//                 | lava (rule "every 5 coins the floor is lava", meadow_course)   &bot=1 for the autopilot
import * as K from 'kit';
const T = K.THREE, V = (x, y, z) => new T.Vector3(x, y, z);
const q = new URLSearchParams(location.search), setup = q.get('setup') || 'keys';
const game = await K.createGame({ seed: 4 });
K.Look.apply(game, setup === 'race' ? 'toon_bright' : setup === 'lava' ? 'sunset' : 'candy');
const level = K.Level.build(game, { keys: 'sky_islands', race: 'race_track', lava: 'meadow_course' }[setup], { size: 'medium', seed: 3 });
const player = K.Player.create(game, { type: setup === 'race' ? 'kart' : 'platformer', spawn: level.spawn, yaw: level.spawnYaw, character: { species: setup === 'race' ? 'penguin' : 'fox' } });
K.Camera.follow(game, player);
const R = level.route, at = (f) => R[Math.min(R.length - 1, Math.floor(f * (R.length - 1)))].clone();
const sideOf = (f, d) => { const a = at(f), b = at(Math.min(1, f + 0.03)); const s = V(b.z - a.z, 0, a.x - b.x).normalize(); return a.addScaledVector(s, d); };
const yawAt = (f) => { const a = at(f), b = at(Math.min(1, f + 0.03)); return Math.atan2(b.x - a.x, b.z - a.z); };

let rules;
if (setup === 'keys') {
  rules = K.Gameplay.rules(game, { level, player, collect: { tag: 'coin', target: 10 }, goal: true, timer: true, lives: 3,
    objective: 'Find the red key, flip the switch, reach the portal' });
  // the red key on the start island, a red door and a switch-door on the last stretch before the goal
  K.Mechanics.add(game, { type: 'key', color: 'red', position: level.spawn.clone().add(V(3, 0, 3)) });
  K.Mechanics.add(game, { type: 'door', id: 'redDoor', color: 'red', position: at(0.72), yaw: yawAt(0.72), width: 5 });
  K.Mechanics.add(game, { type: 'switch', id: 'lever', position: at(0.45), targets: ['gate'] });
  K.Mechanics.add(game, { type: 'door', id: 'gate', position: at(0.9), yaw: yawAt(0.9), width: 5 });
  K.Mechanics.powerup(game, { type: 'highjump', position: at(0.3) });
  K.Mechanics.powerup(game, { type: 'shield', position: at(0.6) });
  K.Mechanics.rule(game, { name: 'Gate', when: 'interact', id: 'lever', once: true, do: [{ toast: 'The gate is open!', seconds: 2.5 }] });
} else if (setup === 'race') {
  rules = K.Gameplay.rules(game, { level, player, race: { laps: 2, opponents: 3 }, timer: true });
  const tr = level.track;
  K.Mechanics.powerup(game, { type: 'speed', placements: [0.12, 0.37, 0.62, 0.87].map(u => tr.getPointAt(u).add(V(0, 0.2, 0))), duration: 3 });
  K.Mechanics.powerup(game, { type: 'shield', placements: [tr.getPointAt(0.5).add(V(2, 0.2, 0))] });
  K.Mechanics.rule(game, { name: 'Lap bonus', when: 'state', key: 'lap', gte: 2, once: true, do: [{ give: 'speed', duration: 3 }, { toast: 'Final lap: free boost!', seconds: 2 }] });
} else {
  rules = K.Gameplay.rules(game, { level, player, collect: { tag: 'coin', target: 20 }, goal: true, timer: true, lives: 3 });
  // a rule the model could write: every 5 coins the floor turns to lava for 3 s
  K.Mechanics.rule(game, { name: 'Lava floor', text: 'Every 5 coins: FLOOR IS LAVA!', when: 'collect', tag: 'coin', every: 5, do: [{ lava: 3 }] });
  // a variable + count rule: the 3rd lava wave gives a glide
  K.Mechanics.rule(game, { when: 'collect', tag: 'coin', every: 5, do: [{ add: { waves: 1 } }] });
  K.Mechanics.rule(game, { name: 'Glider', when: 'count', var: 'waves', gte: 3, once: true, do: [{ give: 'glide', duration: 12 }, { toast: 'You earned a glider!', seconds: 2 }] });
  // and a sandboxed custom mechanic: a bonus coin drops near you every 12 s
  K.Mechanics.custom(game, { name: 'Coin rain', update(dt, ctx) { ctx.vars.rainT = (ctx.vars.rainT || 0) + dt; if (ctx.vars.rainT > 12) { ctx.vars.rainT = 0; ctx.spawn('star'); } } });
  K.Mechanics.powerup(game, { type: 'magnet', position: at(0.25) });
}
K.Debug.install(game, { level, player });
window.__p = player; window.__level = level; window.__rules = rules; window.K = K;
const log = window.__events = [];
for (const ev of ['powerup', 'powerupEnd', 'key', 'keyUsed', 'door', 'switch', 'rule', 'mechanic', 'teleport', 'win', 'lose', 'death', 'lap', 'damage'])
  game.on(ev, (a, b) => log.push(ev + '@' + game.time.toFixed(1) + (b && (b.type || b.color) ? ':' + (b.type || b.color) : '')));
if (q.get('bot')) K.Gameplay.autopilot(game, { level, player });
game.start();
