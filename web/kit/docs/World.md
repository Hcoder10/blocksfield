# World (world.js)

Procedural, instanced building blocks that match every look (colours from `Look.palette`, materials from
`Look.material`). All of them add static colliders. `Level.build` uses these; use them to add to a level or to
build your own layout. Positions are `[x, y, z]` arrays or `Vector3`.

```js
World.island(game, { position, radius = 10, depth, style = 'floating'|'ground', bumps = 0.35, waterfall = false, seed }) -> island
World.ground(game, { size = 240, center, style = 'grass'|'sand'|'snow'|'dirt'|'cobble', flat = size*0.32, hills = 10, seed }) -> ground
World.water(game, { level = 0, size = 600, center, waves = 0.25 }) -> water      // shore foam is automatic
World.plaza(game, { center, radius = 20, color = 'stone', trim = 'primary', emblem = 'accent' }) -> plaza   // round tiled floor
World.foliage(game, { area, kinds, density = 1, avoid, seed }) -> { meshes, count, trees }
World.clouds(game, { count = 16, height = 45, radius = 220, center, below = false, speed = 1.2 })
World.prop(game, kind, { position, yaw = 0, scale = 1, color, collider = true, ...kind options }) -> Group
World.heightAt(game, x, z) -> number | null          // top of the highest kit surface (island, ground, plaza)
World.noPlant(game, points, radius = 2.5)             // keep foliage off these points (call before foliage)
World.PROPS, World.FOLIAGE                            // valid names
```

## island
`position` is the centre of the walkable TOP. Returns `{ group, position, radius, topY, heightAt(x,z), contains(x,z),
edgePoint(angleRad, inset), surfacePoint(x,z) }`. Floating islands have rocky undersides hanging below.
```js
const isl = K.World.island(game, { position: [40, 6, 0], radius: 9, waterfall: true });
K.World.foliage(game, { area: isl, kinds: ['grass', 'flowers', 'tree_round'] });
```

## foliage
`area`: an island, `{ center: [x,y,z], radius, inner }` or `{ min: [x, z], max: [x, z] }`. Heights come from the kit
surfaces automatically. `kinds`: array or weights `{ grass: 1, tree_round: 0.5 }`. Generic kinds:
`grass flowers bush tree_round tree_pine mushroom rock crystal palm cactus tree_dead`. Each look remaps them
(desert turns trees into cacti, snow gives snowy pines), so ask for the generic kind. Trees and rocks get colliders;
grass/flowers sway in the wind. `avoid: [[x,y,z], ...]` or `[{position, radius}]` keeps paths clear.

## prop kinds
| kind | options | notes |
|---|---|---|
| `crate` `barrel` `chest` `rock` | `size` (crate, rock) | cover, loot |
| `fence` `wall` `barrier` | `length`, `height` (wall) | runs along local X; `yaw` turns it |
| `lamp` `flag` `pillar` `tower` | `height`, `radius` (tower) | lamps/windows glow at night |
| `house` | `width`, `depth`, `floors`, `roofColor` | door faces local +Z |
| `bridge` | `from`, `to` (deck end points), `width` | rope bridge with colliders; ignores `position` |
| `arch` `gate` | `width`, `height` | arch = goal/doorway, gate = race start/finish gantry |
| `platform_round` `platform_box` | `radius`, `thick` / `size: [w,h,d]` | top surface at `position.y` |
| `ramp` `stairs` | `length`, `width`, `height` / `steps` | rises toward local +X (ramp), +Z (stairs) |
| `spring_pad` `boost_pad` | | visuals only; Gameplay adds the behaviour |
| `crystal` `sign` `fountain` `well` `stall` `bench` `windmill` `tire_stack` `cone` `tree` `ruins` | | dressing |

```js
K.World.prop(game, 'house', { position: [12, 0, 4], yaw: Math.PI / 2, floors: 2, roofColor: 'secondary' });
K.World.prop(game, 'bridge', { from: islandA.edgePoint(0), to: islandB.edgePoint(Math.PI) });
```

## Common mistakes
- Calling `foliage` before the surface exists (ground/island first, then foliage): nothing gets planted.
- Huge `density` values: grass is already dense; use 0.5-2.
- Putting props at `y = 0` on islands or hills: use `isl.surfacePoint(x, z)` or `World.heightAt(game, x, z)`.
- Unknown prop kind throws; the error lists the valid kinds.
