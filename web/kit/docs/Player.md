# Player (player.js)

One call makes a controllable, animated player: a chibi character (or a kart / boat with the character driving),
a Rapier character controller, keyboard + gamepad input, and juicy feedback (squash & stretch, flips, sparks).

```js
Player.create(game, { type = 'platformer', spawn, yaw = 0, character: { species, accessory, colors }, colors, tuning, waterLevel, killY, model = true,
                      weapon = 'blaster' (topdown only), autoFire = false, boltColor, ring, ringColor }) -> player
Player.WEAPONS      // ['blaster', 'none']
Player.TYPES        // ['platformer', 'kart', 'boat', 'topdown', 'fps']
Player.SPECIES      // ['kid', 'fox', 'cat', 'bunny', 'bear', 'frog', 'penguin', 'robot', 'knight', 'ninja', 'astronaut', 'slime']
Player.ACCESSORIES  // ['none', 'scarf', 'cape', 'backpack', 'hat', 'crown']
Player.TUNING       // default feel numbers per type (read-only reference; override with opts.tuning)
Player.all(game)    // every player created (AI racers too); game.__player is the main one
```

| option | values | default |
|---|---|---|
| `type` | `'platformer'` 3D jump-and-run, `'kart'` arcade kart, `'boat'` speedboat on water, `'topdown'` WASD + dash, `'fps'` first person | `'platformer'` |
| `spawn` | `Vector3` where the FEET go (use `level.spawn`) | `(0,2,0)` |
| `yaw` | radians, 0 faces +Z (use `level.spawnYaw`) | `0` |
| `character` | `{ species, accessory, colors }` (or just a species string) - see the table below | `{ species: 'kid' }` |
| `colors` | `{ body, skin, accent, eyes, belly, kart, boat, scarf, cape, hat }` CSS colours (override the species colours) | the species' colours |
| `tuning` | any key of `Player.TUNING[type]`, e.g. `{ runSpeed: 14, jumpHeight: 5 }` | — |
| `waterLevel` | boat only: water surface height (default `level.water.y` or 0) | — |
| `killY` | falling below this height = death (Gameplay.rules sets it from the level) | spawn.y - 60 |
| `model` | `false` hides the character | `true` |
| `weapon` | topdown only: `'blaster'` (twin-stick shooter: auto-aims at the nearest enemy, or at the mouse once it moves) or `'none'` (dash-and-dodge) | `'blaster'` |
| `autoFire` | `true` fires by itself whenever an enemy is in range (one-button / mobile-style shooters) | `false` |
| `boltColor` | colour of the blaster bolts and muzzle flash | `'#7ff6ff'` |
| `ring` / `ringColor` | bright ground ring under the hero so it pops (on by default for topdown and night looks) | auto |

## Characters: species and accessories

Every species is the same chibi rig (big head, round body, stubby limbs) with the same run / jump / flip / emote
animation, plus its own parts built from primitives. Pick the one closest to the pitch's hero.

| species | looks like | default colours (body / skin / accent) | default accessory |
|---|---|---|---|
| `kid` | child with a cap and a bouncy antenna sprout | orange / cream / yellow | backpack |
| `fox` | pointy ears, long snout, bushy white-tipped tail (wags) | orange / cream / dark | scarf |
| `cat` | small pointy ears, pink nose, whiskers, curly tail | grey-blue / cream / pink | none |
| `bunny` | long floppy ears, pink nose, cotton tail | white / white / pink | none |
| `bear` | round ears, big muzzle, stub tail | brown / tan / dark brown | none |
| `frog` | big eyes on top, wide smile | green / pale green / yellow | none |
| `penguin` | white face and belly, orange beak and feet, flippers | navy / white / orange | scarf |
| `robot` | boxy head, glowing visor eyes, antenna, bolts | steel blue / pale / cyan glow | none |
| `knight` | metal helmet with red plume, shoulder pads | blue / skin / silver | cape |
| `ninja` | dark hood with eye slit, red headband tails, belt | navy / skin / red | none |
| `astronaut` | glass bubble helmet, white suit, collar, life-support pack | white / skin / orange | backpack |
| `slime` | wobbly translucent jelly blob, no limbs | mint / light mint / white | none |

Aliases are accepted (rabbit -> bunny, kitten -> cat, dog / wolf -> fox, panda / teddy -> bear, toad -> frog,
android / bot -> robot, spaceman -> astronaut, samurai -> ninja, blob -> slime, human / boy / girl -> kid); anything
else throws with the list. Accessories: `none`, `scarf` (flutters), `cape` (billows when running), `backpack`,
`hat` (top hat), `crown`. `colors.body` recolours the fur / suit; `colors.scarf`, `colors.cape`, `colors.hat` colour accessories.

```js
K.Player.create(game, { type: 'platformer', spawn: level.spawn, yaw: level.spawnYaw, character: { species: 'fox', accessory: 'scarf' } });
K.Player.create(game, { type: 'kart', spawn: level.spawn, character: { species: 'penguin', colors: { scarf: '#3fa7ff' } } });  // drives the kart
K.Player.create(game, { type: 'platformer', spawn: level.spawn, character: 'robot', colors: { body: '#ff6b6b' } });
```

## Controls (all types)

| key | platformer | topdown | kart / boat | fps |
|---|---|---|---|---|
| WASD / arrows | run (camera-relative) | run | throttle / brake-reverse / steer | move (arrows turn) |
| Space | jump; again in the air = double jump (flip); hold = higher | jump | **drift**: hold while steering, release = boost | jump |
| Shift / E / J | dash; on the ground while running = long jump | Shift / E dash (kills enemies it hits); **Space / J / mouse button fire** (blaster) | drift (same as Space) | Shift sprint, E / click shoot |
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
FPS: 9 u/s, sprint 14, jump 2.3 u; hold E / J / F / mouse (pointer-locked) to fire glowing bolts (6/s, range 60) that fly
from the blaster to the crosshair; walk over pickups to collect them. Topdown: 10 u/s, dash 30 u/s; blaster 7 shots/s, bolts 38 u/s, range 20,
1 damage (patrol / chase enemies take 2 hits, turrets 3); tune with `tuning: { fireRate, range, boltSpeed, damage }`.

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
