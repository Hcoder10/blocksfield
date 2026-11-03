# Look (look.js)

One call gives the whole game its style: tone mapping, sun + sky light with soft shadows that follow the camera,
a procedural sky (gradient, sun disc, stars, aurora), fog matched to the horizon, ink outlines, bloom, colour grade,
vignette and anti-aliasing. Every other kit takes its colours from the active look, so **call `Look.apply` first**.

```js
Look.apply(game, name = 'toon_bright', overrides = {}) -> game.look
Look.material(game, opts) -> THREE.Material (cached; share freely)
Look.palette(game) -> { primary, secondary, accent, danger, good, ground, grass, foliage, water, ui, uiText, ... } ('#rrggbb')
Look.NAMES   // ['toon_bright','candy','sunset','neon_night','dark_fantasy','cozy','desert','snow','realistic']
Look.fit(game, level)            // fit fog/shadow range to a level (Level.build does this for you)
Look.isNight(game)               // true for neon_night, dark_fantasy
```

## Looks

| name | feel | foliage remap |
|---|---|---|
| `toon_bright` | sunny Nintendo-style platformer (default) | - |
| `candy` | pastel pink/mint/lilac dream | pines -> round trees, rocks -> crystals |
| `sunset` | low golden sun, warm haze | - |
| `neon_night` | synthwave purple night, glowing cyan/pink | rocks -> crystals, glowing mushrooms + flowers |
| `dark_fantasy` | moonlit, misty, aurora, eerie green glow | dead trees, glowing mushrooms + flowers |
| `cozy` | warm afternoon village | - |
| `desert` | bright sand, red rock, turquoise | trees -> cacti / palms, dry grass |
| `snow` | crisp white, blue shadows | snowy pines, frosted bushes |
| `realistic` | PBR, no outlines (use only if asked) | - |

## Look.apply(game, name, overrides)

`overrides` may replace any part of the preset:
- `quality: 'high' | 'low'` (default `'high'`; low = 1024 shadows, FXAA, pixel ratio 1, sparser grass)
- `palette: { primary: '#ff4060', ... }` (any palette key)
- `sun: { elevation: 30, azimuth: 40, intensity: 2.4, color }`, `sky: { top, horizon, bottom, stars: 0..1, aurora: 0..1 }`
- `bloom: { strength, radius, threshold }`, `fog: { color, near, far }` (fractions of the level size),
  `edges: { strength: 0 }` (turn ink outlines off), `grade: { saturation, contrast, vignette }`

```js
K.Look.apply(game, 'candy');
K.Look.apply(game, 'sunset', { palette: { primary: '#ff4f81' }, sun: { elevation: 6 } });
```

## Look.material(game, opts)

Use it for every mesh you make yourself, so it matches the kit art (cel shading + rim light + outlines).

| option | default | notes |
|---|---|---|
| `color` | `'primary'` | `'#hex'` or a palette key: `'primary'`, `'accent'`, `'wood'`, `'stone'`, `'foliage'`... |
| `kind` | `'toon'` | `'toon'`, `'standard'` (PBR), `'emissive'` (glows via bloom: pickups, lamps, portals), `'glass'`, `'metal'` |
| `emissive`, `emissiveIntensity` | none / 2.2 for emissive | glow colour (palette key ok) |
| `opacity` | 1 | <1 makes it transparent |
| `vertexColors` | false | for geometry with a colour attribute |
| `rim` | 1 | rim light strength 0..2 |
| `wind` | 0 | sway for plants (0.02-0.25; only vertices above y=0 move) |
| `side` | `'front'` | `'double'` for thin planes |

```js
const coinMat = K.Look.material(game, { kind: 'emissive', color: 'accent' });
const body = new K.THREE.Mesh(new K.THREE.CapsuleGeometry(0.5, 1), K.Look.material(game, { color: 'primary' }));
```

## Palette keys

`primary secondary accent danger good` (gameplay/UI), `ground ground2 grass grass2 cliff cliff2 sand snow` (terrain),
`foliage foliage2 trunk flower flower2` (plants), `water waterDeep foam`, `wood stone roof metal cloud glow`,
`ui uiText uiAccent` (HUD panels / text / highlights).

## Common mistakes

- Calling `Look.apply` after building the level: materials already picked the old palette. Apply first.
- Adding your own `DirectionalLight`/`AmbientLight`/`scene.fog`/`scene.background`: the look already set them; extra
  lights wash out the cel shading.
- `new MeshStandardMaterial(...)`: looks out of place next to kit art. Use `Look.material`.
- Making something glow with `kind: 'standard'` + emissive 1: too dim for bloom. Use `kind: 'emissive'`.
- Unknown look names throw: use only names from `Look.NAMES`.
