# Level (level.js)

`Level.build` makes a whole dressed, playable level in one call: terrain, props, foliage, clouds, colliders, plus
the *placements* gameplay needs (spawn, route, coins, checkpoints, hazards, movers, goal). It draws no gameplay
objects itself: pass the level to `Gameplay.rules` and it spawns coins, checkpoints and the goal from the placements.

```js
Level.build(game, kind, { size = 'medium', seed = 1, collectibles = 30 }) -> level
Level.KINDS        // ['sky_islands', 'meadow_course', 'arena', 'town', 'race_track', 'lagoon', 'canyon']
Level.validate(level) -> []   // list of route problems; [] means every route jump is reachable
Level.compose(game, spec) -> level   // your OWN layout from pieces (see "Compose your own level" below)
Level.PIECES       // ['island','platform','cliff','pillar','ramp','stairs','bridge','wall','arch','tower','mover','water']
```

| kind | what you get | good for |
|---|---|---|
| `sky_islands` | floating islands joined by hops, rope bridges and stepping platforms; waterfalls; goal island with arch; a bonus island reached by a moving platform | platformers, collect-a-thons |
| `meadow_course` | ground-level obstacle course on a winding dirt path: fence hurdles, crate stack, stepping stones over a river, rising blocks, floating platforms; farm, windmill | platformers for beginners, races on foot |
| `arena` | round tiled arena with walls, 4 gates, 4 raised platforms with ramps, cover (crates, pillars, walls, rocks), fountain | combat, collect, survival, king of the hill |
| `town` | cozy village: plaza with fountain + market stalls, 4 streets of houses, lamps, town-hall tower | exploration, delivery, hide and seek, collect |
| `race_track` | closed banked circuit with curbs, barriers, start/finish gantry, boost pads, lake infield | kart / car / boat-free races, time trials |
| `lagoon` | closed water course through a tropical lagoon: buoy-lined lane, beaches, lighthouse island, boost pads, a jump ramp, rocks | boat / jet-ski races (`Player` type `boat`), water time trials |
| `canyon` | red-rock desert canyon: a winding loop of packed-dirt floor between terraced, banded sandstone walls cut into a mesa plateau; natural arches, hoodoos, buttes, cacti, scrub, bones; jump ramps, boost pads, saw blades on the shoulders; goal under a sunlit arch | kart races (it has `level.track`) AND platformers (`level.route` runs start -> goal arch); best with the `desert` or `sunset` look |

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
level.track        CatmullRomCurve3 | null (race_track, lagoon, canyon: centre line, closed)    level.laps = 3, level.trackWidth
level.water        {y} | null (lagoon: boats float at y; meadow river; race_track lake)
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

```js
K.Look.apply(game, 'desert');                                  // or 'sunset'
const level = K.Level.build(game, 'canyon', { size: 'medium' });
// karts race 3 laps of level.track; a platformer instead runs level.route to the goal arch:
const player = K.Player.create(game, { type: 'kart', spawn: level.spawn, yaw: level.spawnYaw });
K.Gameplay.rules(game, { level, player });                     // vehicle + track -> race
```
`canyon` options: `width` (track width, default 15). The canyon floor is wider than the track; walls are ~30 units tall.

Add your own props on top with `World.prop` (see World.md), e.g. a chest at the goal:
`K.World.prop(game, 'chest', { position: level.goal.position, yaw: 0 })`.

## Common mistakes

- Building before `Look.apply`: the level comes out in the default palette.
- Placing things at `y = 0`: levels are not flat (islands float, roads are banked). Use `K.World.heightAt(game, x, z)`
  or offsets from `level.spawn` / route points.
- Moving `level.group` after build: colliders stay where they were built.
- Expecting coins to appear by themselves: `Level.build` only returns placements; `Gameplay.rules` spawns them.
- Kind names are exact: `sky_islands`, not `skyislands` or `floating_islands`.

## Compose your own level

When no kind fits the pitch (a tower climb, a river canyon, a castle in the sky), lay the level out yourself from
pieces. `Level.compose` builds them, walks the route over the real geometry, fixes small jump problems with stepping
platforms, dresses everything in the look's style (foliage, rocks, props, cloud sea or hills) and returns the same
`level` object as `Level.build`, so Player, Gameplay, Camera, Debug and the autopilot work unchanged.

```js
Level.compose(game, {
  ground: { style: 'grass'|'sand'|'snow'|'dirt'|'cobble', y: 0, size: 260, hills: 14 },   // omit = floating level
  pieces: [ { type, position: [x, y, z], size, rotationY, from, to, route, color }, ... ],
  route: [[x, y, z], ...],        // optional; default: the standable pieces in the order you list them
  spawn: [x, y, z],               // optional; default: the first route point
  goal: true | [x, y, z] | false, // true = the last route point (gets an arch + flag)
  collectibles: 'along_route' | 30 | [[x, y, z], ...],
  hazards: [{ type: 'spikes', position: [x, y, z] }, ...],
  dressing: 'auto' | 'none', autofix: true, strict: false, seed: 1,
}) -> level            // + level.issues [{severity: 'fixed'|'warning'|'error', piece, message}], level.issueText
```

**Positions are where you stand**: `position` is the centre of the top surface for island, cliff, platform and
pillar. Ramp, stairs and bridge use `from` / `to` (the two walkway ends, on the surfaces they join). Wall, arch and
tower use `position` = their base on the floor.

| type | options | notes |
|---|---|---|
| `island` | `size` = radius (9), `waterfall` | floating rock island with grass (with ground: a mesa down to the ground) |
| `cliff` | `size` = radius (8) | a mesa whose sides reach the ground (or 8 u down) |
| `platform` | `size` = radius (2.2), or `size: [w, h, d]` for a box, `rotationY` | small stepping platform |
| `pillar` | `size` = cap radius (1.8) | stone column with a round cap; base on the ground or 7 u down |
| `ramp` / `stairs` | `from`, `to`, `width` (3.6) | slope or steps between two heights; keep them under 45 degrees |
| `bridge` | `from`, `to`, `width` (2.8) | rope bridge with lamps; any length |
| `wall` | `position`, `length` (8), `height` (2.4), `rotationY` | obstacle / castle wall (not on the route) |
| `arch`, `tower` | `position`, `width`/`height` | landmarks (not on the route) |
| `mover` | `position`, `to`, `period` (5), `size` | moving platform (not on the route: the autopilot cannot time it) |
| `water` | `position` = [x, waterLevel, z], `size` (200) | water plane with shore foam; put the ground below it for a river |

Any piece takes `route: false` to keep it out of the route (scenery). **Movement limits**: every route jump must be
at most **5 u across and 2.5 u up** (jump apex 4.5, run 12 u/s). Gaps up to about 30 u are bridged automatically with
stepping platforms and reported as `fixed` issues; bigger problems are `error` issues whose message says what to change,
e.g. `piece 7 (platform) is 9.2 u across from piece 6 (island): the max jump is 5 u across and 2.5 u up; move it closer,
lower it, or add a 'bridge', 'ramp' or 'stairs' piece between them`. Use `strict: true` to throw instead.

### Example: spiral tower climb

```js
const pieces = [{ type: 'island', position: [0, 0, 0], size: 10 },
  { type: 'island', position: [0, -2, 26], size: 6, route: false }, { type: 'tower', position: [0, -2, 26], height: 30 }];
for (let k = 0; k < 11; k++) {
  const a = -Math.PI / 2 + k * 0.62;
  pieces.push({ type: 'pillar', position: [Math.cos(a) * 10, 1.5 + k * 2, 26 + Math.sin(a) * 10], size: k === 10 ? 3.5 : 1.8 });
}
const level = K.Level.compose(game, { pieces, goal: true });
```

### Example: canyon river run

```js
const level = K.Level.compose(game, {
  ground: { style: 'sand', y: -3, size: 300, hills: 22 },            // the canyon floor, flooded below
  pieces: [
    { type: 'water', position: [30, -1.6, 38], size: 320 },         // the river
    { type: 'cliff', position: [0, 2, 0], size: 8 },                // start mesa
    { type: 'platform', position: [0, 1, 12.5], size: 2 }, { type: 'platform', position: [4, 1.5, 17.5], size: 2 },
    { type: 'platform', position: [9, 2, 22], size: 2 },
    { type: 'cliff', position: [16, 4, 30], size: 7 },
    { type: 'bridge', from: [20.8, 4, 32.7], to: [29.2, 4.5, 37.3] },
    { type: 'cliff', position: [34, 4.5, 40], size: 7 },
    { type: 'stairs', from: [34, 4.5, 45.5], to: [34, 1, 53] },
    { type: 'platform', position: [34, 1, 56], size: [6, 4, 6] },
    { type: 'pillar', position: [34, 2.5, 63] }, { type: 'pillar', position: [30, 4.5, 68] },
    { type: 'cliff', position: [22, 6, 76], size: 8 },              // goal mesa
    { type: 'cliff', position: [-22, 11, 6], size: 9, route: false }, // canyon walls either side...
    { type: 'cliff', position: [38, 13, 24], size: 9, route: false },
  ],
  goal: true,
});
```

### Example: floating castle

```js
const level = K.Level.compose(game, { pieces: [
  { type: 'island', position: [0, 0, 0], size: 9 },                         // gate island
  { type: 'stairs', from: [0, 0, 6.5], to: [0, 5, 14] },
  { type: 'island', position: [0, 5, 24], size: 12 },                       // the keep
  { type: 'arch', position: [0, 5, 15] }, { type: 'wall', position: [0, 5, 33], length: 16 },
  { type: 'tower', position: [-8, 5, 32], height: 11 }, { type: 'tower', position: [8, 5, 32], height: 11 },
  { type: 'bridge', from: [9.5, 5, 27.2], to: [24.3, 7, 32.1] },
  { type: 'island', position: [30, 7, 34], size: 7 },
  { type: 'pillar', position: [31, 9, 45] }, { type: 'pillar', position: [34, 11, 50.5] },
  { type: 'island', position: [34, 13, 58], size: 6 },                      // the spire (goal)
  { type: 'mover', position: [-12, 5, 24], to: [-26, 7, 30] }, { type: 'island', position: [-31, 7, 32], size: 5, route: false },
], goal: true });
```

Tips: list the route pieces in the order the player visits them. Keep consecutive standable pieces within about
5 u edge to edge (or join them with bridge / ramp / stairs). Walls must not cross the route. Read `level.issueText`
after composing: `fixed` lines are fine, `error` lines need a change.
