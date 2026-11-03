# Camera (camera.js)

One active camera rig at a time; calling another replaces it. Every rig smooths with springs, pulls in when a wall
gets between it and the player, and yields to debug/survey cameras (`game.cameraOverride`) automatically.

```js
Camera.follow(game, player, opts)      // third-person; picks chase for kart/boat, topdown for topdown, first-person for fps
Camera.chase(game, player, opts)       // vehicles: behind, swings with the slide, FOV kick on boost
Camera.topdown(game, player, opts)     // high three-quarter view, world-aligned (WASD = screen directions)
Camera.orbit(game, { target, radius }) // slow orbit: title / win screens, attract mode
Camera.firstPerson(game, player, opts) // eye camera + toy blaster + crosshair (fps players)
Camera.stop(game)                      // freeze the camera where it is
Camera.MODES                           // ['follow', 'chase', 'topdown', 'orbit', 'firstPerson']
```

| function | options (defaults) |
|---|---|
| `follow` | `distance` 10, `height` 1.6 (look-at above the feet), `pitch` 0.36 rad (+ = looking down), `lookAhead` 1.6, `autoYaw` 1.4 (swing-behind speed, 0 = never), `orbit` true (mouse drag / right stick / wheel zoom), `collide` true, `fov` 60, `yaw` (start; default behind the player) |
| `chase` | `distance` 7.5, `height` 2.6, `lookAt` 1.2, `fov` 64, `boostFov` 10, `speedFov` 6, `stiffness` 5 (dolly-zooms in as the FOV widens, so the vehicle keeps its size) |
| `topdown` | `height` 24 (clamped 18-45), `pitch` 1.05 rad (clamped 0.96-1.48, i.e. 55-85 deg; 1.57 = straight down), `yaw` 0 (camera south, looking north / -Z), `lookAhead` 2.5, `fov` 50 |
| `orbit` | `target` Vector3 or a player, `radius` 30, `height` 12, `speed` 0.12 rad/s, `lookHeight` 0, `fov` 55 |
| `firstPerson` | `eye` 1.55, `fov` 72, `bob` 0.05, `sprintFov` 8, `weapon` true (toy blaster with sway, recoil, glowing tip, muzzle flash that lights the scene), `crosshair` true (with white hit / red kill markers); a red vignette + view kick when hurt, a dip on jump / land |

Each returns a rig: `rig.set({ distance: 14 })` changes options live, `rig.dispose()` stops it.
The follow camera tracks the ground height (it doesn't bob with every jump) and swings behind a running player; it
never fights the player while they run toward it.

## Examples

```js
K.Camera.follow(game, player);                               // the right camera for every player type
K.Camera.follow(game, player, { distance: 14, pitch: 0.5 }); // further and higher: big levels
K.Camera.topdown(game, player, { height: 28 });              // twin-stick / arena games
K.Camera.orbit(game, { target: level.goal.position, radius: 25, height: 10 }); // title screen
game.on('start', () => K.Camera.follow(game, player));       // switch from title orbit to gameplay
```

## Common mistakes

- Don't set `game.camera.position` every frame yourself; the rig overwrites it. Use rig options.
- Only one rig: `Camera.orbit` for the title then `Camera.follow` when play starts (not both).
- Angles are radians: `pitch: 0.5`, not `30`.
