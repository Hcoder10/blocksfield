# UI (ui.js)

A DOM overlay over the 3D canvas: HUD, big animated banners, title / pause / win / lose screens, toasts, dialog
bubbles and a 3-2-1-GO countdown. It looks finished in five styles, scales with the window, and **reads `game.state`
by itself** (Gameplay.rules writes it) and **reacts to the CONTRACT events**: checkpoint -> banner, lap -> banner,
damage -> hearts shake, win -> win screen with stars, lose -> lose screen, Esc/P -> pause menu. You never write CSS.

```js
UI.hud(game, { style, counters: [{ id, icon, label, target }], timer, lives, hp, lap, position, speedometer, minimap, objective, player, level }) -> hud
UI.titleScreen(game, { title, subtitle, start, credit, level, countdown, pause, orbit }) -> Promise (resolves when the player starts)
UI.banner(game, text, { style: 'go'|'stage_clear'|'checkpoint'|'warning'|'info', sub, duration }) -> Promise
UI.countdown(game, { from: 3, go: 'GO!' }) -> Promise
UI.toast(game, text, { icon, duration })
UI.dialog(game, { name, lines | text, portrait, pause }) -> Promise (resolves after the last line)
UI.objective(game, text)            // change the objective line
UI.pauseMenu(game) / UI.winScreen(game, opts) / UI.loseScreen(game, opts)   // usually automatic
UI.setStyle(game, style)  UI.show(game, bool)  UI.icon(game, name) -> element
UI.STYLES  // ['arcade','cozy','sleek','fantasy','scifi']
UI.ICONS   // ['coin','star','gem','crystal','heart','seed','key','flag','checkered','bolt','skull','clock','trophy','leaf','fruit','orb','shield','sword','person']
```

## Styles

| style | for | look |
|---|---|---|
| `arcade` (default) | platformers, racers, anything bright | slanted navy plates, chunky outlined display font, yellow/orange gradient titles |
| `cozy` | farming, villages, cute games | cream rounded pills, brown ink, soft bouncy type |
| `sleek` | modern / minimal / snow / sports | frosted dark glass, thin edges, clean caps |
| `fantasy` | dungeons, magic, medieval | plum plates with gold borders and gems, Cinzel serif, gold text |
| `scifi` | space, neon, cyber | cut-corner cyan glass panels, Orbitron, glow |

If you skip `style`, it follows the look: `neon_night` -> scifi, `cozy`/`candy` -> cozy, `dark_fantasy` -> fantasy,
`snow` -> sleek, else arcade. Display-text colours follow `Look.palette(game)` (uiAccent / ui).

## UI.hud(game, opts)

| option | default | notes |
|---|---|---|
| `style` | from look | see Styles |
| `counters` | `[]` | `[{ id, icon, label, target }]`. Value is `game.state[id]`; the main pickup also falls back to `state.collected` / `state.target`, so `{ id: 'coins' }` works with `Gameplay.rules({collect: {tag: 'coin'}})`. Pops and shows "+1" when it rises. `icon`: a built-in name (UI.ICONS) or a generated asset name/url. |
| `timer` | `false` | `true`: shows `state.timeLeft` (counts down, turns red under 10 s) or else `state.time` |
| `lives` | `false` | `true`: hearts from `state.lives` (more than 6 -> heart x N). `'health'`: hearts from `state.health`/`maxHealth` |
| `hp` | `false` | same as `lives: 'health'` |
| `lap` | `false` | `true`: "LAP 2/3" from `state.lap` / `state.laps` |
| `position` | `false` | `true`: big "2nd /8" from `state.position` / `state.racers`, gold/silver/bronze |
| `speedometer` | `false` | `true` or `{ max: 140, unit: 'km/h' | 'mph' | 'm/s' }`; reads `player.speed` |
| `minimap` | `false` | `true` or `{ level, markers: () => [{position, color}] }`: route, pickups, checkpoints, goal flag, player arrow |
| `objective` | none | short text under the timer, e.g. `'Collect 30 coins'` (also follows `state.objective`) |
| `player`, `level` | from `Debug.install` | pass them if you don't call Debug.install |
| `winScreen` / `loseScreen` | `true` | `false` to show your own; or an options object for them |
| `auto` | `true` | `false` disables the event reactions (banners, screens) |
| `pauseMenu` | `true` | Esc / P opens the pause menu |

```js
K.UI.hud(game, { counters: [{ id: 'coins', icon: 'coin', label: 'Coins' }], timer: true, lives: true, minimap: true, objective: 'Collect 30 coins' });
K.UI.hud(game, { style: 'arcade', lap: true, position: true, timer: true, speedometer: true, minimap: true });   // racer
K.UI.hud(game, { style: 'cozy', counters: [{ id: 'seeds', icon: 'seed' }, { id: 'score', icon: 'star' }] });
```

## UI.titleScreen(game, opts)

Big logo (outlined, extruded, shining), subtitle plate, pulsing "Press SPACE". The game is paused and the camera
slowly orbits the level until the player presses any key or clicks. Then the HUD slides in.

| option | default | notes |
|---|---|---|
| `title` | `document.title` | long titles split over two lines automatically |
| `subtitle` | none | one short line: the goal or a tagline |
| `start` | `'Press Space'` | the word Space/Enter becomes a key cap |
| `credit` | none | small footer line |
| `countdown` | `false` | `true`: 3-2-1-GO after start |
| `pause` / `orbit` | `true` / `true` | pause the game / orbit camera while the title is up |

```js
await K.UI.titleScreen(game, { title: 'Starbloom Peaks', subtitle: 'Collect 30 coins before sundown', countdown: true });
```

## Banners, toasts, dialog

```js
K.UI.banner(game, 'Boss Fight!', { style: 'warning' });
K.UI.banner(game, 'Stage Clear!', { style: 'stage_clear', sub: 'New record' });
K.UI.toast(game, 'Double jump unlocked', { icon: 'bolt' });
await K.UI.dialog(game, { name: 'Mayor Pip', portrait: 'P', lines: ['Welcome, friend!', 'Find the five star seeds.'] });
```
Checkpoint, lap and final-lap banners, the win screen (with 1-3 stars and stats) and the lose screen appear on their
own from the events; do not add them again. Win stars: `state.stars` if set, else 1 + all counters full + no damage.

## Common mistakes

- Calling `UI.winScreen` in `game.on('win')` as well: the HUD already does it (pass `winScreen: false` to own it).
- Inventing state keys the HUD can't see: use the counter `id` you write to (`game.state.gems = 3` -> `{ id: 'gems' }`).
- Several `UI.hud` calls: the last one replaces the HUD; put everything in one call.
- `UI.banner(game, {text})`: the text is the second argument, a string.
- Long objective / subtitle text: keep it under ~40 characters.
