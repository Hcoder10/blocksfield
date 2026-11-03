# FX (fx.js)

Juice: GPU particles, confetti, trails, shockwave rings, floating "+10" text, screen shake, hit flash, speed lines
and slow-mo. **`FX.auto(game)` wires all of it to the CONTRACT events**, so most games need nothing else.

```js
FX.auto(game, { shake: true, dust: true, text: true, slowmo: true })   // call once
FX.sparkle(game, pos, { color, scale })          // pickup
FX.starBurst(game, pos, { color, scale, count })   // big reward, goal
FX.burst(game, pos, { count: 24, speed: 6, size: 0.35, life: 0.7, gravity: 4, shape, color, colorEnd, up: 0.4 })
FX.dust(game, pos, { amount: 0..1, color })      // small feet puffs
FX.smoke(game, pos, { count, color, size, life })   FX.poof(game, pos, { color, size })
FX.magic(game, pos, { color: [..], radius, height })   FX.splash(game, pos, { color, speed })
FX.ring(game, pos, { color, radius: 3, life: 0.5, flat: true })
FX.confetti(game, pos?, { count: 160, colors })   // no pos: rains over the view
FX.fire(game, posOrObject, { size, rate, duration }) -> handle.stop()
FX.sparkles(game, posOrObject, { color, radius, rate }) -> handle.stop()   // idle glitter on a treasure
FX.trail(game, object, { color, colorEnd, width: 0.6, length: 28, offset: [0,0.3,0], vertical: false }) -> handle.stop()
FX.text(game, pos, '+10', { color, size: 1, life: 1 })
FX.shake(game, amount = 0.35)   FX.flash(game, color, { opacity, duration, vignette })   FX.hitFlash(game, object, { color })
FX.speedLines(game, level 0..1, { pulse: seconds })   FX.slowmo(game, scale = 0.3, seconds = 0.6)
FX.clear(game)
FX.NAMES   // every function above
```
`pos` is a `Vector3`, `[x, y, z]`, or anything with `.position` (a collectible, the player, a mesh).
`shape` is one of `'glow' | 'star' | 'smoke' | 'ring' | 'square' | 'spark' | 'drop'`. Colours are `'#hex'` or arrays
of them (each particle picks one).

## What FX.auto does

| event | effect |
|---|---|
| `collect(item)` | sparkle in the item's colour (coin gold, gem cyan, star yellow, heart pink...), "+N" text if `item.value > 1` |
| `checkpoint(cp)` | ground ring + rising magic sparkles |
| `damage(target)` | target flashes red, red sparks; on the player: shake + red vignette |
| `death` / `respawn` | smoke poof / magic swirl and ring |
| `jump` / `land(p, speed)` | tiny dust puffs at the feet (bigger with landing speed; shake only on huge falls) |
| `boost` | speed lines pulse, cyan sparks, small shake |
| `lap` / `goal` | star burst |
| `win` / `lose` | confetti + white flash + brief slow-mo / dark red vignette |

## Examples

```js
K.FX.auto(game);
const glow = K.FX.sparkles(game, chest.object, { color: '#ffe066' });   // until opened
game.on('collect', (item) => { if (item.tag === 'key') K.FX.starBurst(game, item); });
const t = K.FX.trail(game, player.object, { color: '#7df9ff', width: 0.8 });   // boat wake / kart boost
K.FX.fire(game, [4, 0, -2], { size: 1.5 });   // campfire
```

## Common mistakes

- Calling `FX.sparkle` in your own `collect` handler as well as `FX.auto`: you get double effects.
- Huge sizes: particle `size` is in world units (a character is about 2). Dust stays small on purpose.
- Moving the camera for shake yourself: use `FX.shake`; it is applied after the camera kit and removed next frame.
- Emitters (`fire`, `sparkles`, `trail`) run until `handle.stop()`; keep the handle.
