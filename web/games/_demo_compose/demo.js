// Level.compose demo: ?ex=spiral|canyon|castle&look=<look>&bot=1&cam=overview|play
import * as K from 'kit';
import * as THREE from 'three';
import * as EX from './examples.js';

const q = new URLSearchParams(location.search);
const kind = q.get('kind');          // ?kind=<Level kind>&seed=N&type=platformer|kart|boat: test Level.build instead
const ex = q.get('ex') || 'spiral';
if (!kind && !EX.all[ex]) throw new Error(`unknown example "${ex}"; examples: ${Object.keys(EX.all).join(', ')}`);
const game = await K.createGame({ seed: 3, assets: q.get('cut') ? './cut_test.json' : null });   // ?cut=1: cutscene test manifest
if (kind) game.title = q.get('title') || 'seedtest';
K.Look.apply(game, q.get('look') || (kind ? 'toon_bright' : EX.looks[ex]));
const level = kind ? K.Level.build(game, kind, { size: 'medium', seed: +(q.get('seed') || 1), collectibles: 30 }) : K.Level.compose(game, EX.all[ex]);
const ptype = q.get('type') || 'platformer';
const vehicle = ptype === 'kart' || ptype === 'boat';
const player = K.Player.create(game, { type: ptype, spawn: level.spawn, yaw: level.spawnYaw, colors: { body: '#ff7a59' } });
K.Camera.follow(game, player);
K.Gameplay.rules(game, { level, player, collect: vehicle ? null : { tag: 'coin', target: Math.min(15, level.collectibles.length) }, goal: level.goal ? true : false,
  timer: true, lives: 3, race: vehicle ? { laps: 1, opponents: 2, countdown: 1 } : null });
if (q.get('ui')) {
  K.UI.hud(game, { title: ex, counters: [{ id: 'coins', icon: 'coin', label: 'Coins' }], timer: true });
  K.UI.titleScreen(game, { title: 'Composed: ' + ex, subtitle: 'Collect coins, reach the goal', start: 'Press Space' });
}
K.Debug.install(game, { level, player });
const box = document.getElementById('issues');
box.textContent = (level.issueText && level.issueText.length) ? level.issueText.join(String.fromCharCode(10)) : (level.layout ? 'layout: ' + level.layout : 'no route issues');
if (q.get('hud') === '0') box.style.display = 'none';
if (q.get('cam') === 'overview') {
  const b = level.bounds, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()), R = Math.max(s.x, s.z) * 0.5;
  game.cameraOverride = { position: c.clone().add(new THREE.Vector3(R * 0.8, R * 0.55 + s.y * 0.5, -R * 0.9)), target: c };
}
window.__level = level;
if (q.get('bot')) K.Gameplay.autopilot(game, { level, player });
game.start();
