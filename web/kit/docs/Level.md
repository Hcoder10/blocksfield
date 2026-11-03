# Level (level.js)

`Level.build` makes a whole dressed, playable level in one call: terrain, props, foliage, clouds, colliders, plus
the *placements* gameplay needs (spawn, route, coins, checkpoints, hazards, movers, goal). It draws no gameplay
objects itself: pass the level to `Gameplay.rules` and it spawns coins, checkpoints and the goal from the placements.

```js
Level.build(game, kind, { size = 'medium', seed = 1, collectibles = 30 }) -> level
Level.KINDS        // ['sky_islands', 'meadow_course', 'arena', 'town', 'race_track']
Level.validate(level) -> []   // list of route problems; [] means every route jump is reachable
```

| kind | what you get | good for |
|---|---|---|
| `sky_islands` | floating islands joined by hops, rope bridges and stepping platforms; waterfalls; goal island with arch; a bonus island reached by a moving platform | platformers, collect-a-thons |
| `meadow_course` | ground-level obstacle course on a winding dirt path: fence hurdles, crate stack, stepping stones over a river, rising blocks, floating platforms; farm, windmill | platformers for beginners, races on foot |
| `arena` | round tiled arena with walls, 4 gates, 4 raised platforms with ramps, cover (crates, pillars, walls, rocks), fountain | combat, collect, survival, king of the hill |
| `town` | cozy village: plaza with fountain + market stalls, 4 streets of houses, lamps, town-hall tower | exploration, delivery, hide and seek, collect |
| `race_track` | closed banked circuit with curbs, barriers, start/finish gantry, boost pads, lake infield | kart / car / boat-free races, time trials |

Sizes: `small` (~0.7x), `medium`, `large` (~1.45x). `seed` changes the layout; same seed = same level.

## The level object

```
level.spawn        Vector3 (stand the player here)          level.spawnYaw   radians, 0 faces +Z
level.route        Vector3[] ordered start -> goal, ON the walking surface (autopilot + minimap)
level.collectibles [{position, tag}]  tag 'coin' on the route, 'gem' = bonus (off-route)
level.checkpoints  [{position, radius}] (race: + yaw, index)
level.hazards      [{type:'void', y}] fall plane (all kinds), [{type:'boost', position, direction, yaw, width, length}] (race)
level.movers       [{mesh, path:[a, b], period, type:'platform'}] ping-pong platforms (Gameplay animates them)
level.goal         {position, radius} | null (arena has no goal)      level.killY   fall-death height
level.track        CatmullRomCurve3 | null (race_track: centre line, closed)    level.laps (race) = 3
level.bounds       Box3        level.group  Object3D with all level art        level.colliders  [...]
level.spawnPoints  (arena) Vector3[] for enemies          level.islands (sky_islands) island objects
```

## Movement numbers the levels are built for

The player controller should match these (Player kit defaults do):
**jump apex 4.5 units, run speed 12 units/s, double jump.** Every jump on `level.route` is at most
**5 units across** (edge to edge) and **2.5 units up**, so a single jump always makes it and the double jump is
spare. A single jump covers ~11 units at full run; with the double jump ~16. `arena` and `town` need no jumps
(ramps reach the raised platforms), so `topdown`/`fps` players work there too.

## Examples

```js
const level = K.Level.build(game, 'sky_islands', { size: 'medium', collectibles: 40, seed: 3 });
level.collectibles.push({ position: level.goal.position.clone().add(new K.THREE.Vector3(0, 3, 0)), tag: 'star' });
const player = K.Player.create(game, { type: 'platformer', spawn: level.spawn, yaw: level.spawnYaw });
K.Gameplay.rules(game, { level, player, collect: { tag: 'coin', target: 30 }, goal: true });
```

```js
const level = K.Level.build(game, 'race_track', { size: 'large', collectibles: 20 });
const kart = K.Player.create(game, { type: 'kart', spawn: level.spawn, yaw: level.spawnYaw });
```

Add your own props on top with `World.prop` (see World.md), e.g. a chest at the goal:
`K.World.prop(game, 'chest', { position: level.goal.position, yaw: 0 })`.

## Common mistakes

- Building before `Look.apply`: the level comes out in the default palette.
- Placing things at `y = 0`: levels are not flat (islands float, roads are banked). Use `K.World.heightAt(game, x, z)`
  or offsets from `level.spawn` / route points.
- Moving `level.group` after build: colliders stay where they were built.
- Expecting coins to appear by themselves: `Level.build` only returns placements; `Gameplay.rules` spawns them.
- Kind names are exact: `sky_islands`, not `skyislands` or `floating_islands`.
