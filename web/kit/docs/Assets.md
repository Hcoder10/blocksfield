# Assets (assets.js)

Generated art (ComfyUI skies, icons, textures; Idol splat props) from `assets/assets.json`, with a procedural fallback
for everything: nothing here throws when the manifest or a file is missing. A game must look great with no assets.

```js
await Assets.sky(game, 'sky')            -> true if the panorama loaded (else the Look sky stays)
Assets.icon('coin', game, { fallback }) -> image url (manifest icon, or a drawn icon; fallback:true forces the drawn one)
Assets.texture('bricks', { game, repeat: [4, 4], fallback: 'noise'|'checker'|'grid'|'stripes' }) -> THREE.Texture
Assets.prop(game, 'prop_mushroom', { position, rotationY = 0, scale = 1, height, collider = true, fallback = 'crate' }) -> Group
Assets.splat(game, 'splat_tree', { position, scale = 1, height, rotationY = 0, collider = true, fallback = 'crate' }) -> Group
Assets.music('music_main', game), Assets.sfx('collect', game) -> url | null
Assets.has(game, name) -> boolean
await Assets.verify(game) -> [removed names]   // drop manifest entries whose file is missing (optional, once at start)
Assets.ICONS  // drawn fallback icons: coin gem star heart key clock flag trophy bolt skull shield leaf fish mushroom crown lap speed
```

## Manifest lookup
`name` matches the manifest key exactly, else `<kind>_<name>` (`icon('coin')` finds `icon_coin`), else an entry whose
`"for"` (icons) or `"event"` (sfx) equals the name. Manifest format: see CONTRACT.md "Exact manifest entries".

## sky
Sets the equirect panorama as background and environment light, hides the procedural sky and tints the fog to the
panorama horizon. Call it after `Look.apply`. It is async: `await` it or let it pop in.

## prop (Idol splats as voxel props)
Returns a Group at once (place it immediately); the voxels stream in. `group.userData.ready` resolves `true` when the
generated prop is shown, `false` when the fallback `World.prop` kind was used instead. One box collider is added.
`scale` = length of the longest side in units (default 1); `height` overrides it (exact height in units).

Prop JSON the pipeline writes (CONTRACT, binding):
```json
{ "name": "mushroom", "style": "voxel", "size": [0.8, 1.0, 0.8],
  "palette": ["#e04040", "#fff4e0"],
  "parts": [ { "p": [0.0, 0.85, 0.0], "s": [0.6, 0.2, 0.6], "c": 0 }, { "p": [0, 0.35, 0], "s": [0.2, 0.7, 0.2], "c": 1 } ] }
```
`size`: bounding size, longest side = 1, Y up, origin at bottom centre, front = -Z. Each part is a box: `p` centre,
`s` size, `c` palette index (or a `"#hex"`). Also accepted: `{ "voxel": 0.05, "points": [[x,y,z,r,g,b], ...] }`
(colours 0-255 or 0-1, any origin; recentred to bottom-centre).

```js
const tree = K.Assets.prop(game, 'prop_tree', { position: [5, 0, 3], height: 6, fallback: 'tree' });
K.UI.hud(game, { counters: [{ id: 'coins', icon: K.Assets.icon('coin', game) }] });
```

## Common mistakes
- Waiting on `Assets.prop(...).userData.ready` before starting the game: not needed, it pops in.
- Passing `game` as the first argument to `icon`/`texture`: the name comes first (`icon('coin', game)`).
- Hard-coding file paths: use names from the manifest; missing ones fall back on their own.

## splat (real Gaussian splats, rendered with Spark)
Idol turns each generated prop image into a 3D Gaussian splat. `Assets.splat` draws it as a real splat in the game
(Spark, MIT, `vendor/spark`, loaded only when the first splat is requested). Returns a Group at once; the splat streams
in (about 1-2 s). `group.userData.ready` resolves `'splat'`, `'voxel'` (a same-name voxel prop was used) or `'prop'`
(a `World.prop` fallback kind). Orientation is fixed for Idol (`up: 'idol'`), the prop is normalised to bottom centre,
`scale` = longest side in units (or `height`), stray floaters are hidden, a soft contact shadow and one box collider are
added, and the colours are tinted toward the look's ambient light (darker at night).

```js
K.Assets.splat(game, 'splat_tree', { position: [6, 0, -4], scale: 6 });            // a 6-unit tall blossom tree
K.Assets.splat(game, 'splat_mushroom', { position: level.spawn, scale: 2, fallback: 'rock' });
```
Manifest entry: `{"kind": "splat", "file": "splat_tree.spz", "up": "idol"}` (`.spz` preferred, about 5x smaller than
`.ply`; `web/tools/ply_to_spz.py` converts; `.ply` and `.splat` also load). Optional `"camera": {"yaw": radians}` turns
the side Idol's input camera saw toward -Z.

Use splats for **hero scenery and landmarks at mid distance** (trees, giant mushrooms, statues, a shrine): they look
painterly and rich from 5+ units away, and slightly grainy right up against the camera. 4-8 splats per scene is plenty
(130k Gaussians each). They are not lit by the sun and cast no real shadow; avoid using them for things the player
must read exactly (platforms, pickups).
