# ThreeKit contract

ThreeKit is the three.js twin of the Roblox kits: tested, beautiful building blocks so a local 27B model can make a
web game that looks and plays great by *composing* kits, not by writing a renderer. A generated game is one
`game.js` of roughly 100-300 lines that calls these modules. The model never writes shaders, physics or UI CSS.

**Quality bar:** every preset, in every look, must look like a shipped stylised indie game (think a Nintendo-style
toon platformer, a cel-shaded arcade racer, a cozy diorama): soft shadows, rich sky, outlines/rim light, bloom on
pickups, lush instanced foliage, juicy animation and feedback. Never flat grey boxes, never fog soup, never placeholder.
Runs at 60 fps on a laptop GPU at 1280x720 (`quality: 'high'`), and degrades with `quality: 'low'`.

## Files and owners

| File | Owner | Purpose |
|---|---|---|
| `core.js` | done | `createGame(opts)`: renderer, scene, camera, Rapier world, loop, events, rng, assets manifest |
| `look.js` | A | `Look.apply(game, name, overrides)`: tone mapping, lights + shadows, sky, fog, post FX, toon materials |
| `world.js` | A | terrain islands / ground, water, foliage, rocks, trees, clouds, props (procedural, instanced) |
| `level.js` | A | `Level.build(game, kind, opts)`: a whole dressed, playable level in one call |
| `assets.js` | A | generated assets: sky panorama, textures, icons, Idol splat props (voxel meshes), music/sfx urls |
| `physics.js` | B | Rapier helpers: static colliders from meshes/heightfields, kinematic movers, sensors, raycasts |
| `player.js` | B | `Player.create(game, opts)`: controllers (platformer, kart, boat, topdown, fps) + procedural character |
| `camera.js` | B | follow / orbit / chase / topdown cameras with collision and smoothing |
| `gameplay.js` | B | collectibles, checkpoints, hazards, movers, enemies, goal, rules, autopilot |
| `ui.js` | C | HUD, title/pause/win/lose screens, banners, counters, timer, minimap, speedometer, toasts |
| `fx.js` | C | particles (bursts, trails, dust, sparkles, confetti), screen shake, hit flash, floating text |
| `audio.js` | C | music (crossfade, loop), sfx (variation), procedural fallback blips |
| `debug.js` | C | `window.__kit`, the harness API (cameras, survey, state, input, errors) |
| `index.js` | done | re-exports everything |

Every module is an ES module importing `three` / `three/addons/...` through the page's import map, and must never
import another module's internals: only the APIs below. Unknown options are ignored, missing options get good
defaults. Every public function validates its input and throws an Error with a *helpful message* (the model reads
it), e.g. `Level.build: unknown kind "skyislands"; kinds: sky_islands, meadow_course, arena, town, race_track`.

## Page skeleton (a generated game)

```html
<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Game</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}</style>
<script type="importmap">{"imports":{"three":"../../vendor/three/three.module.js",
 "three/addons/":"../../vendor/three/addons/","kit":"../../kit/index.js"}}</script>
</head><body><script type="module" src="./game.js"></script></body></html>
```

```js
import * as K from 'kit';
const game = await K.createGame({ assets: './assets/assets.json', seed: 7 });
K.Look.apply(game, 'toon_bright');                       // or candy, sunset, neon_night, dark_fantasy, cozy, desert, snow
const level = K.Level.build(game, 'sky_islands', { size: 'medium', collectibles: 40 });
const player = K.Player.create(game, { type: 'platformer', spawn: level.spawn, colors: { body: '#ff7a59' } });
K.Camera.follow(game, player);
const rules = K.Gameplay.rules(game, { level, player, collect: { tag: 'coin', target: 30 }, goal: true, timer: true, lives: 3 });
K.UI.hud(game, { title: 'Starbloom Peaks', counters: [{ id: 'coins', icon: 'coin', label: 'Coins' }], timer: true });
K.UI.titleScreen(game, { title: 'Starbloom Peaks', subtitle: 'Collect 30 coins', start: 'Press Space' });
K.Audio.music(game, game.asset('music_main'));
K.Debug.install(game, { level, player });
game.start();
```

## Shared objects

- `game` (core.js): `{ THREE, RAPIER, renderer, scene, camera, world, composer, time, dt, rand(), on/off/emit,
  update(fn, order), lateUpdate(fn, order), state, cameraOverride, asset(name), start() }`.
  Update order: input -10, player 0, gameplay 10, camera 20 (lateUpdate), fx/ui 30.
- **Events** (`game.emit` / `game.on`): `collect(item, by)`, `checkpoint(cp)`, `damage(target, amount, source)`,
  `death(target)`, `respawn(player)`, `goal(player)`, `win()`, `lose(reason)`, `jump(player)`, `land(player, speed)`,
  `boost(player)`, `lap(player, n)`, `start`, `pause(bool)`, `state(state)`. UI/FX/Audio react to these; nobody
  else needs to wire feedback by hand.
- `level` (level.js): `{ kind, spawn: Vector3, spawnYaw, bounds: Box3, route: Vector3[] (the intended path, start to
  goal, used by autopilot and minimap), checkpoints: [{position, radius}], collectibles: [{position, tag}],
  hazards: [{type, position, ...}], movers: [{mesh, path, period}], goal: {position, radius} | null,
  track: CatmullRomCurve3 | null (race kinds), group: Object3D, colliders: [] }`.
  `Level.build` creates the art and the colliders (through physics.js) but NOT the gameplay objects: it returns their
  placements; `Gameplay.rules` spawns collectibles/checkpoints/hazards/goal from them. A game can add its own
  placements before calling rules (e.g. `level.collectibles.push(...)`).
- `player` (player.js): `{ type, object (Object3D), position (Vector3, live), velocity, yaw, grounded, speed, alive,
  controls: {enabled}, teleport(pos, yaw), respawn(), setInput(axisX, axisY, jump, action) (autopilot/bot),
  character: {setColors, setEmote} }`.

## Debug / harness API (`window.__kit`, debug.js)

The web harness drives every game through this; it must work in every game that calls `K.Debug.install`.

```
__kit.ready                 true after the first rendered frame
__kit.errors                runtime errors (also console.error'd)
__kit.state()               {time, fps, player:{position,velocity,grounded,alive}, ...game.state, level:{kind,bounds}}
__kit.camera(pos, target)   hold the view (arrays or Vector3); __kit.release() returns it to the game camera
__kit.survey()              [{name:'overview'|'side'|'top'|'player', position, target}] framed from level bounds
__kit.input(key, ms)        press a key for ms (also hold/release); same as a real KeyboardEvent
__kit.autopilot(on)         a bot plays the level along level.route (jumps, steers, collects); for footage + playtests
__kit.timeScale(x), __kit.pause(bool), __kit.teleport(pos)
```

## Generated assets (assets.js)

The pipeline writes `assets/assets.json`: `{ "<name>": {"kind": "sky"|"texture"|"icon"|"music"|"sfx"|"prop",
"file": "sky.png", ...} }`. `Assets.sky(game, name)` sets an equirect panorama as background + environment (PMREM);
`Assets.icon(name)` returns an image url for UI; `Assets.prop(game, name, opts)` builds an Idol splat prop as an
instanced voxel/blob mesh from its `.json` (positions, colors, sizes) with a Rapier collider; `Assets.texture(name)`.
Every kit must look great with NO generated assets at all (procedural fallbacks), and better with them.
