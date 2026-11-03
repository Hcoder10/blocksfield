# Debug (debug.js)

`window.__kit`: the harness API that screenshots and playtests every game. **Every game calls
`K.Debug.install(game, { level, player })` once, after creating the level and player.** Press the backquote key
(`` ` ``) in the browser for an fps/state overlay.

```js
Debug.install(game, { level, player }) -> __kit
__kit.ready                    // true after the first rendered frame (also fires window 'kit-ready')
__kit.errors                   // runtime errors (window errors, rejections, kit errors)
__kit.state()                  // {time, fps, frame, player:{position,velocity,grounded,alive,speed}, ...game.state, level:{kind,bounds}, paused, camera}
__kit.camera(pos, target)      // hold the view; arrays or Vector3
__kit.release()                // camera back to the game; release('KeyW') lets go of a held key
__kit.survey()                 // [{name:'overview'|'side'|'top'|'player', position, target}] framed from the level
__kit.shot(name)               // = camera(...) of that survey shot
__kit.input(key, ms = 120)     // press a key for ms (real KeyboardEvent); returns a Promise
__kit.hold(key) / __kit.releaseKey(key) / __kit.releaseAll() / __kit.press(key)
__kit.click(x, y)              // pointer + mouse + click events at a screen point
__kit.autopilot(on)            // bot plays the level (Gameplay.autopilot); also dismisses the title screen
__kit.timeScale(x)  __kit.pause(bool)  __kit.teleport(pos, yaw)
__kit.start()                  // dismiss a title screen without a key press
__kit.ui(bool)                 // hide/show the whole UI overlay for clean screenshots
__kit.overlay(bool)            // fps/state overlay
```

Keys accept codes or names: `'KeyW'`, `'w'`, `'Space'`, `' '`, `'ArrowUp'`, `'up'`, `'Enter'`, `'Escape'`, `'Shift'`.

## Notes

- `__kit.pause(true)` freezes the game without opening the pause menu (clean shots); Esc/P from a player opens it.
- `survey()` frames what the player travels (route, pickups, checkpoints, spawn, goal) clamped by `level.bounds`,
  so a huge ocean plane or sky dome doesn't shrink the shot. Without a level it uses scene mesh centres.
- The camera override is applied after every camera kit and screen shake, so held views never jitter.

## Example harness session

```js
await page.waitForFunction(() => window.__kit && __kit.ready);
__kit.start(); __kit.ui(false);
for (const s of __kit.survey()) { __kit.camera(s.position, s.target); /* screenshot */ }
__kit.release(); __kit.ui(true); __kit.autopilot(true);
```

## Common mistakes

- Calling `Debug.install` before `Level.build` / `Player.create`: pass both objects, they are needed for survey/autopilot.
- Forgetting `game.start()`: `__kit.ready` only turns true after a frame is drawn.
