# Player (player.js)

One call makes a controllable, animated player: a chibi character (or a kart / boat with the character driving),
a Rapier character controller, keyboard + gamepad input, and juicy feedback (squash & stretch, flips, sparks).

```js
Player.create(game, { type = 'platformer', spawn, yaw = 0, colors, tuning, waterLevel, killY, model = true }) -> player
Player.TYPES        // ['platformer', 'kart', 'boat', 'topdown', 'fps']
Player.TUNING       // default feel numbers per type (read-only reference; override with opts.tuning)
Player.all(game)    // every player created (AI racers too); game.__player is the main one
```

| option | values | default |
|---|---|---|
| `type` | `'platformer'` 3D jump-and-run, `'kart'` arcade kart, `'boat'` speedboat on water, `'topdown'` WASD + dash, `'fps'` first person | `'platformer'` |
| `spawn` | `Vector3` where the FEET go (use `level.spawn`) | `(0,2,0)` |
| `yaw` | radians, 0 faces +Z (use `level.spawnYaw`) | `0` |
| `colors` | `{ body, skin, accent, eyes, belly, kart, boat }` CSS colours | orange body, cream skin, yellow accent |
| `tuning` | any key of `Player.TUNING[type]`, e.g. `{ runSpeed: 14, jumpHeight: 5 }` | — |
| `waterLevel` | boat only: water surface height (default `level.water.y` or 0) | — |
| `killY` | falling below this height = death (Gameplay.rules sets it from the level) | spawn.y - 60 |
| `model` | `false` hides the character | `true` |

## Controls (all types)

| key | platformer | topdown | kart / boat | fps |
|---|---|---|---|---|
| WASD / arrows | run (camera-relative) | run | throttle / brake-reverse / steer | move (arrows turn) |
| Space | jump; again in the air = double jump (flip); hold = higher | jump | **drift**: hold while steering, release = boost | jump |
| Shift / E / J | dash; on the ground while running = long jump | dash (kills enemies it hits) | drift (same as Space) | Shift sprint, E / click shoot |
| C / Ctrl | ground pound (in the air) | — | — | — |
| mouse | drag to orbit the camera | — | — | click = pointer lock, look |

Gamepad: left stick move, A jump, X / RB / RT action, B / LT pound, right stick camera / look.

## Feel numbers (platformer defaults)

Run 12 u/s (reached in ~0.17 s), jump apex **4.5 u** (0.5 s up), double jump +3.2 u, coyote time 0.12 s, jump buffer
0.14 s, release Space early for a short hop (~1.3 u). A full-speed single jump clears ~11 u of flat gap, with the
double jump ~17 u. Dash 24 u/s for 0.18 s (once per air time). Long jump 21 u/s forward, 12 up. Climbs slopes up to
50 degrees and steps up to 0.55 u. Stands on moving platforms (it is carried along and turned with them).
Kart: top speed ~29 u/s (32 max), boosts to 1.4x. Drift tiers at 0.6 / 1.3 / 2.2 s of drifting give 0.55 / 1.0 / 1.6 s
boosts (blue / orange / purple sparks). Boat: same with a looser slide; floats and bobs at `waterLevel`, crawls on land.
FPS: 9 u/s, sprint 14, jump 1.8 u. Topdown: 10 u/s, dash 30 u/s.

## The player object

```
player.type  .object (Object3D)  .position (Vector3 FEET, live)  .center (collider centre)  .velocity  .yaw
player.grounded  .speed  .alive  .mode ('idle'|'run'|'air'|'dash'|'pound'|'drive'|'dead')
player.controls.enabled = false      // freeze input (title screens, cutscenes)
player.respawnPoint / .respawnYaw    // checkpoints update these
player.teleport(pos, yaw)  player.respawn()  player.die(reason)  player.hurt(fromPos, power)  player.bounce(power)
player.boost(seconds)                // speed burst (karts: boost pad / item)
player.setInput(x, y, jump, action)  // bot input, same meaning as the keys (x right, y forward); call it EVERY frame
                                     // (it expires after 0.3 s and the keyboard takes over); setInput(null) = keyboard now
player.character.setColors({ body: '#3ad' })   player.character.setEmote('wave'|'happy'|'sad'|'win'|'none', seconds)
```

Events it emits (UI/FX/Audio react; you don't wire feedback): `jump(player, kind)` kind = 'jump'|'double'|'long'|'hop',
`land(player, impactSpeed)`, `boost(player, kind)`, `death(player, reason)`, `respawn(player)`, plus extras
`dash(player)`, `pound(player)`, `drift(player, tier)`, `bump(player, speed)`, `shoot(player, origin, dir)`.

## Examples

```js
const player = K.Player.create(game, { type: 'platformer', spawn: level.spawn, yaw: level.spawnYaw, colors: { body: '#6c5ce7', accent: '#ffd23f' } });
K.Camera.follow(game, player);
```
```js
// a kart race (Gameplay.rules turns on racing + 3 AI karts automatically on a race level)
const player = K.Player.create(game, { type: 'kart', spawn: level.spawn, yaw: level.spawnYaw, colors: { kart: '#ff4d6d' } });
K.Camera.follow(game, player);          // vehicles get the chase camera
K.Gameplay.rules(game, { level, player, race: { laps: 3 } });
```
```js
const boat = K.Player.create(game, { type: 'boat', spawn: level.spawn, yaw: level.spawnYaw, waterLevel: 0 });
const hero = K.Player.create(game, { type: 'platformer', spawn: level.spawn, tuning: { runSpeed: 14, jumps: 3 } });
```

## Common mistakes

- `spawn` is the feet position. Do not add the player height yourself.
- Player.create does NOT make a camera: call `Camera.follow(game, player)` (it picks the right rig for every type).
- Do not move `player.object` or `player.position` directly; use `player.teleport(pos)`.
- Unknown `type` throws; there is no 'car' or 'runner': use `'kart'` and `'platformer'`.
- A boat floats on `level.water.y` (or `waterLevel`). In a race on a dry track (race_track) Gameplay.rules turns boats into
  hover boats that skim the road; outside races a boat on land crawls.
- Don't make jumps the player cannot reach: apex 4.5 u, gap <= ~11 u at full run.
