// Level.compose demo: ?ex=spiral|canyon|castle&look=<look>&bot=1&cam=overview|play
import * as K from 'kit';
import * as THREE from 'three';
import * as EX from './examples.js';

const q = new URLSearchParams(location.search);
const ex = q.get('ex') || 'spiral';
if (!EX.all[ex]) throw new Error(`unknown example "${ex}"; examples: ${Object.keys(EX.all).join(', ')}`);
const game = await K.createGame({ seed: 3, assets: q.get('cut') ? './cut_test.json' : null });   // ?cut=1: cutscene test manifest
K.Look.apply(game, q.get('look') || EX.looks[ex]);
const level = K.Level.compose(game, EX.all[ex]);
const player = K.Player.create(game, { type: 'platformer', spawn: level.spawn, yaw: level.spawnYaw, colors: { body: '#ff7a59' } });
K.Camera.follow(game, player);
K.Gameplay.rules(game, { level, player, collect: { tag: 'coin', target: Math.min(15, level.collectibles.length) }, goal: true, timer: true, lives: 3 });
if (q.get('ui')) {
  K.UI.hud(game, { title: ex, counters: [{ id: 'coins', icon: 'coin', label: 'Coins' }], timer: true });
  K.UI.titleScreen(game, { title: 'Composed: ' + ex, subtitle: 'Collect coins, reach the goal', start: 'Press Space' });
}
K.Debug.install(game, { level, player });
const box = document.getElementById('issues');
box.textContent = level.issueText.length ? level.issueText.join('\n') : 'no route issues';
if (q.get('hud') === '0') box.style.display = 'none';
if (q.get('cam') === 'overview') {
  const b = level.bounds, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()), R = Math.max(s.x, s.z) * 0.5;
  game.cameraOverride = { position: c.clone().add(new THREE.Vector3(R * 0.8, R * 0.55 + s.y * 0.5, -R * 0.9)), target: c };
}
window.__level = level;
if (q.get('bot')) K.Gameplay.autopilot(game, { level, player });
game.start();
