# Gameplay (gameplay.js)

`Gameplay.rules` turns a level's placements into a game: spinning collectibles, checkpoint flags, hazards, moving
platforms, enemies, the goal portal, timer, lives, health and races with AI opponents. It writes `game.state` and
emits the events UI / FX / Audio react to. `Gameplay.autopilot` is a bot that plays the level (demo footage, tests).

```js
Gameplay.rules(game, { level, player, collect, goal = true, timer, lives = 3, hp = 3, enemies, race,
                       killEnemiesToWin, scoreToWin, onWin, onLose }) -> rules
Gameplay.autopilot(game, { level, player }) -> { start(), stop(), enabled }   // Gameplay.autopilot(game, false) stops
Gameplay.spawnEnemy(game, kind, position, { hp, speed, range, color })
Gameplay.spawnCollectible(game, position, tag = 'coin', { value, color })
Gameplay.COLLECTIBLES   // ['coin', 'star', 'gem', 'seed', 'heart', 'orb']   (any other tag = glowing orb)
Gameplay.HAZARDS        // ['spinner', 'saw', 'spikes', 'lava', 'killzone', 'bounce', 'boost', 'crumble', 'enemy', 'wind', 'void']
Gameplay.ENEMIES        // ['patrol', 'chase', 'turret']
```

| option | values | default / meaning |
|---|---|---|
| `level` | the object `Level.build` returned (required) | |
| `player` | the object `Player.create` returned (required) | |
| `collect` | `{ tag, target, label }`, `true`, or `null` (`label` = what the HUD calls them, e.g. 'Energy Cores'; used in the objective text) | `tag` = most common tag in the level; `target` = all of them (capped to what exists). With a goal: the goal portal stays locked (grey) until `target` is collected. Without a goal: collecting `target` wins. |
| `goal` | `true` / `false` | `true`: touching `level.goal` wins (if unlocked) |
| `timer` | `true` (count up) or seconds (count down; `lose('time')` at 0) | off |
| `lives` | number or `false` (endless) | 3 (races: endless); each death costs one, 0 = `lose('lives')` |
| `hp` | hits per life | 3 (platformer/topdown/fps), 1 (vehicles). Hazards and enemies cost 1 hp with knockback; falling / lava = instant death |
| `enemies` | number (arena: its spawn points, farthest from the player first; other levels: spread along the route) or `[{ kind, position, hp, speed, range }]` | none. Enemies wait 2 s after play starts |
| `race` | `{ laps, opponents = 3, aiSpeed = 0.94, countdown = 3 }` or `true` | automatic for kart/boat on a level with `level.track`; laps default `level.laps` or 3 |
| `killEnemiesToWin` | `true`: win when every enemy is defeated | |
| `scoreToWin` | number: win at this score | |
| `objective` | string or `(state) => string`: the objective text (`state.objective`); wins over the generated one | generated from the rules |
| `onWin(state)`, `onLose(reason, state)` | callbacks (the `win` / `lose` events fire anyway) | |

Values: coin 1, gem 5, star 10, seed 2, heart (heals 1 hp). Collectibles have a magnet radius (~3 u).

## What spawns from the level

- `level.collectibles` -> spinning, bobbing, glowing pickups (coin / star / gem / seed / heart / orb).
- `level.checkpoints` -> flags that raise and wave when touched; you respawn at the last one.
- `level.goal` -> golden portal ring with a light beam (grey and dim while locked).
- `level.movers` `[{mesh, path, period}]` -> platforms that ease back and forth along `path` and carry the player.
- `level.hazards` (each `{type, position, ...}`):
  `spinner {length 7, speed 1.5, height 0.9}` striped bar sweeping at waist height (jump it) ·
  `saw {radius 1.1, path, period 3}` · `spikes {size: Vector3}` · `lava` / `killzone {size}` instant death ·
  `bounce {power 22, radius 1.3}` mushroom pad · `boost {yaw, width, length}` arrow pad (vehicles and runners) ·
  `crumble {size}` platform that shakes, falls and comes back · `wind {size, power}` updraft ·
  `enemy {kind}` · `void {y}` fall plane.
- Enemies (each a chibi monster with glowing eyes, its own self-lit colours and a red danger ring, readable in night
  looks): `patrol` green slime with a sprout, walks back and forth (turns at edges); `chase` red spiky ball with an
  angry toothy face: rolls after you, then **telegraphs** (shakes + glows ~0.65 s) and **charges** in a straight line,
  then recovers (dodge sideways!); `turret` purple horned cannon that turns and fires slow orbs every 2.2 s.
  Platformers **stomp** them (land on top); topdown players **shoot** them (blaster, default) or **dash** through
  them; fps players **shoot** them. Hits flash white, knock back, and interrupt a charge; deaths pop into debris.
  Touching one otherwise costs 1 hp. Colours: `enemies: [{ kind, position, color }]` (or `Gameplay.ENEMY_COLORS`).

## game.state (written every frame, `state` event on change)

`score, collected, target, collectTag, lives, health, maxHealth, time, timeLeft, lap, laps, position, racers,
checkpoint, checkpoints, enemiesLeft, goalOpen, objective (short text for the HUD), phase ('title' | 'countdown' |
'playing' | 'won' | 'lost'), won, lost, loseReason`; autopilot adds `autopilotDone`, `autopilotStuck`.

## Events

`collect(item, player)` · `checkpoint(cp)` · `damage(target, amount, source)` · `death(target)` (player or enemy) ·
`respawn(player)` · `goal(player)` · `win()` · `lose(reason)` · `lap(player, n)` · `state(state)` · extras:
`goalLocked(goal, missing)`, `goalOpen(goal)`, `stomp(player, enemy)`, `bounce(player, pad)`, `countdown(n)` (3, 2, 1, 0),
`raceStart`, `shot(turret, position)`.

The rules object: `rules.win()`, `rules.lose(reason)`, `rules.addCollectible(pos, tag)`, `rules.addEnemy(kind, pos)`,
`rules.items`, `rules.enemies`, `rules.racers`, `rules.state`.

## Examples

```js
// collect-a-thon: 30 coins open the portal
const rules = K.Gameplay.rules(game, { level, player, collect: { tag: 'coin', target: 30 }, goal: true, timer: true, lives: 3 });

// arena brawl: survive and stomp 6 enemies within 90 seconds
K.Gameplay.rules(game, { level, player, enemies: 6, killEnemiesToWin: true, timer: 90, goal: false });

// kart race, 3 laps against 5 AI karts
K.Gameplay.rules(game, { level, player, race: { laps: 3, opponents: 5 } });

// your own placements before rules
level.collectibles.push({ position: new K.THREE.Vector3(0, 6, 40), tag: 'star' });
level.hazards.push({ type: 'spinner', position: new K.THREE.Vector3(0, 0, 30), length: 8 });
K.Gameplay.rules(game, { level, player, collect: { tag: 'star', target: 1 } });

game.on('win', () => K.UI.banner && K.UI.banner(game, 'You did it!'));
```

## Autopilot

`Gameplay.autopilot(game)` (or `__kit.autopilot(true)`) plays the level with the real controls: follows `level.route`,
simulates each jump arc before taking it, times spinner bars, rides moving platforms, hops hazards, stomps / dashes /
shoots enemies, detours for coins it can walk to, roams for the last coins when the goal is still locked, and drifts
through corners in races. If it makes no progress for 6 s it nudges the player to the next route point (counted in
`status.assists`). Use it for attract-mode footage: `K.Gameplay.autopilot(game)` right after `rules`.

## Common mistakes

- Call `Gameplay.rules` once, after `Player.create`, with BOTH `level` and `player`.
- Push extra placements into `level.*` BEFORE calling rules; after, use `rules.addCollectible` / `rules.addEnemy`.
- `collect.tag` must match tags that exist in the level ('coin' unless you added others); a bigger `target` is capped.
- Don't write your own kill plane, respawn, lap counter or coin pickup: rules already does all of it.
- `timer: 60` is a countdown that LOSES at 0; `timer: true` just counts up.
- Races need a track level (`race_track`); on other levels `race` is ignored with a warning.
