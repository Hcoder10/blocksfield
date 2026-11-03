# Mechanics (mechanics.js)

Change how the game plays and invent new mechanics safely: tune the player, drop power-ups, place interactables
(keys, doors, switches, teleporters...), and wire **trigger -> effect rules**. Call these AFTER `Gameplay.rules(...)`.
Everything is autopilot-aware (keys before doors, switches before gates, power-ups picked up, hops on lava) and
talks to the HUD through events (power-up chips, key ring, prompts, rule toasts) - no UI wiring needed.

```js
Mechanics.tune(player, { speed, jump, gravity, airJumps, dash, glide, wallJump, size, friction }, seconds?) -> revert()
Mechanics.powerup(game, { type, position | placements: [[x,y,z], ...] | count, duration })   // pickups
Mechanics.give(game, player, type, duration)                                                 // apply directly
Mechanics.add(game, { type, id, position, ... }) -> interactable
Mechanics.rule(game, { name, text, when, ...trigger options, do: [effects], once })
Mechanics.var(game, name)  /  Mechanics.var(game, name, value)                              // rule variables
Mechanics.custom(game, { name, text, init(ctx), update(dt, ctx), onEvent: { eventName(ctx, ...args) } })
Mechanics.get(game, id)
Mechanics.POWERUPS      // ['speed', 'highjump', 'magnet', 'shield', 'giant', 'tiny', 'glide', 'doublepoints', 'slowmo', 'invincible']
Mechanics.INTERACTABLES // ['key', 'door', 'switch', 'plate', 'platform', 'teleporter', 'bounce', 'conveyor', 'zone', 'crumble', 'shrine', 'crate', 'shop']
Mechanics.TRIGGERS      // ['collect', 'enter', 'timer', 'defeat', 'count', 'state', 'interact', 'start']
Mechanics.EFFECTS       // ['spawn', 'give', 'tune', 'open', 'close', 'toggle', 'setObjective', 'banner', 'toast', 'fx', 'sfx', 'win', 'lose', 'score', 'teleport', 'set', 'add', 'lava', 'emit']
Mechanics.TUNE_KEYS     // ['speed', 'jump', 'gravity', 'airJumps', 'dash', 'glide', 'wallJump', 'size', 'friction']
Mechanics.KEY_COLORS    // red, blue, green, yellow, purple, orange
```

## Tune the player

Multipliers of the player's defaults, clamped: `speed` 0.3-3, `jump` 0.3-3, `gravity` 0.3-3 (moon = 0.4),
`airJumps` 0-5 (extra jumps in the air; 1 = double jump, 2 = triple), `size` 0.4-2.5, `friction` 0.05-2 (ice = 0.15);
booleans `dash`, `glide` (hold jump while falling to float), `wallJump` (jump off walls).
`Mechanics.tune(player, { gravity: 0.4, jump: 1.3 })` (moon), `Mechanics.tune(player, { friction: 0.15 }, 10)` (ice for 10 s).

## Power-ups (pickups)

| type | effect (default seconds) |
|---|---|
| `speed` | run 1.6x (karts/boats: boost + 1.25x top speed) (8) |
| `highjump` | jump 1.6x (10) |
| `magnet` | pickups fly to you from 9 u (12) |
| `shield` | no damage, bubble around you (10) |
| `giant` | 1.8x size, stomps enemies on touch (8) |
| `tiny` | 0.55x size (8) |
| `glide` | hold jump to float (12) |
| `doublepoints` | 2x score (12) |
| `slowmo` | world at 0.6x speed (6) |
| `invincible` | rainbow star power: enemies die on touch (7) |

```js
K.Mechanics.powerup(game, { type: 'speed', count: 3 });                       // spread along the route
K.Mechanics.powerup(game, { type: 'magnet', position: [10, 2, 30], duration: 15 });
```

## Interactables

| type | options | behaviour |
|---|---|---|
| `key` | `color`, `position` | pickup; adds to `state.keys` (key ring in the HUD) |
| `door` | `position`, `yaw`, `width` 4, `height` 4, `color` (key) or none (opened by switch / rule) | solid until opened; walking into a coloured door with its key opens it |
| `switch` | `position`, `targets: [ids]`, `once` | lever: touch to toggle its targets |
| `plate` | `position`, `targets: [ids]` | pressure plate: targets open while you stand on it |
| `platform` | `position`, `size [x,y,z]`, `solid` false | appears (solid) / disappears when toggled |
| `teleporter` | `position`, `to`, `twoWay` true | step on a pad to warp to the other |
| `bounce` | `position`, `power` 22 | mushroom pad |
| `conveyor` | `position`, `size`, `direction`, `speed` 6 | pushes you along |
| `zone` | `position`, `size`, `gravity` (multiplier) or `lift` | low-gravity / updraft area (`when:'enter', id` rules too) |
| `crumble` | `position`, `size` | falls after you step on it, comes back |
| `shrine` | `position` | checkpoint shrine |
| `crate` | `position`, `drops` ('coin' or a power-up), `count` 3 | dash / stomp to break it |
| `shop` | `position`, `sells` (power-up), `price` 10, `species` | NPC that sells a power-up for score points |

```js
K.Mechanics.add(game, { type: 'key', color: 'red', position: [4, 0, 3] });
K.Mechanics.add(game, { type: 'door', id: 'vault', color: 'red', position: [0, 0, 60], yaw: 0, width: 5 });
K.Mechanics.add(game, { type: 'switch', id: 'lever', position: [10, 0, 30], targets: ['bridge'] });
K.Mechanics.add(game, { type: 'platform', id: 'bridge', position: [10, 0, 40], size: [3, 0.5, 8] });
K.Mechanics.add(game, { type: 'teleporter', position: [0, 0, 10], to: [40, 8, 70] });
```

## Rules: invent mechanics

`when` (trigger) + options, then `do` (effects, each may have `delay: seconds`):

| when | options | fires |
|---|---|---|
| `collect` | `tag`, `every` | on each pickup (of tag), or every N |
| `enter` | `position`, `radius` 2.5 / `id` of a zone | when the player enters |
| `timer` | `every` / `after` (seconds) | repeatedly / once |
| `defeat` | `kind`, `all` | when an enemy dies / when all (of kind) are dead |
| `count` | `var`, `gte` / `eq` | when a variable reaches a value |
| `state` | `key`, `gte` / `lte` / `eq` | when a game.state value crosses (e.g. `collected`, `lap`, `score`) |
| `interact` | `id` | when a switch / plate is used |
| `start` | | once at the start |

Effects: `{ spawn: 'coin' | power-up | 'enemy:chase', at: [x,y,z] | 'player' | 'route', count }`,
`{ give: power-up | 'key:red' | 'life', duration }`, `{ tune: {...}, seconds }`, `{ open | close | toggle: id }`,
`{ setObjective: text }`, `{ banner: text }`, `{ toast: text, seconds }`, `{ fx: name }`, `{ sfx: name }`,
`{ win: true }`, `{ lose: reason }`, `{ score: n }`, `{ teleport: [x,y,z] }`, `{ set: {var: v} }`, `{ add: {var: n} }`,
`{ lava: seconds }` (standing on the ground hurts; jump!), `{ emit: eventName }`.

```js
// every 5 coins the floor turns to lava for 3 s
K.Mechanics.rule(game, { name: 'Lava floor', text: 'Every 5 coins: FLOOR IS LAVA!', when: 'collect', tag: 'coin', every: 5, do: [{ lava: 3 }] });
// defeating all slimes opens the vault
K.Mechanics.rule(game, { when: 'defeat', kind: 'patrol', all: true, do: [{ open: 'vault' }, { banner: 'The vault is open!' }] });
// a counter: 3 switches flipped -> win
K.Mechanics.rule(game, { when: 'interact', do: [{ add: { flips: 1 } }] });
K.Mechanics.rule(game, { when: 'count', var: 'flips', gte: 3, do: [{ win: true }] });
// every 20 s an enemy wave of 3 chasers around you
K.Mechanics.rule(game, { when: 'timer', every: 20, do: [{ spawn: 'enemy:chase', at: 'player', count: 3 }, { toast: 'Here they come!' }] });
```

## Custom mechanics (escape hatch)

When rules are not enough, write code - it runs sandboxed (errors are reported, after 3 it switches itself off; it can
never crash the game). `ctx`: `player`, `level`, `state`, `vars`, `time`, `rand()`, `enemies`, `items`,
`spawn(type, pos)`, `give(type, s)`, `tune(opts, s)`, `banner(text)`, `toast(text, s)`, `emit(name, ...)`,
`setVar(k, v)`, `win()`, `lose(reason)`, `V3(x,y,z)`, `dist(a, b)`, `THREE`.

```js
K.Mechanics.custom(game, { name: 'Coin rain', text: 'Stars fall from the sky!',
  update(dt, ctx) { ctx.vars.t = (ctx.vars.t || 0) + dt; if (ctx.vars.t > 12) { ctx.vars.t = 0; ctx.spawn('star'); } },
  onEvent: { damage(ctx, who) { if (who === ctx.player) ctx.toast('Ouch!', 1); } } });
```

## Events (UI / FX / Audio react automatically)

`powerup(player, {type, duration, label})`, `powerupEnd(player, {type})` (type names as the UI icons: highjump ->
`jump`, doublepoints -> `double_coins`), `key(player, {color})`, `keyUsed(player, {color})`, `door(door, {open} |
{locked, color})`, `switch(sw, {on})`, `rule({name, text, seconds})`, `mechanic({name, text})`, `prompt({text, key} |
null)`, `teleport(player, pad)`, `crate(crate)`. State: `game.state.keys`, `game.state.powerups` ({type: secondsLeft}),
`game.state.vars`.

## Common mistakes

- Call Mechanics after `Gameplay.rules` (it uses the rules' pickups, enemies and state).
- Ids must be unique and match: `targets: ['gate']` needs an interactable with `id: 'gate'`.
- A coloured door needs a key of the same colour somewhere reachable *before* the door.
- Doors only block if they span the path: give `width` the path's width and `yaw` along the route.
- Put switches on the walkable route (the autopilot walks to them; an unreachable switch locks the level).
