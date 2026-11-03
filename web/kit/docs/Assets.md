# Assets (assets.js)

Generated art (ComfyUI skies, icons, textures; Idol splat props) from `assets/assets.json`, with a procedural fallback
for everything: nothing here throws when the manifest or a file is missing. A game must look great with no assets.

```js
await Assets.sky(game, 'sky')            -> true if the panorama loaded (else the Look sky stays)
Assets.icon('coin', game, { fallback }) -> image url (manifest icon, or a drawn icon; fallback:true forces the drawn one)
Assets.texture('bricks', { game, repeat: [4, 4], fallback: 'noise'|'checker'|'grid'|'stripes' }) -> THREE.Texture
Assets.prop(game, 'prop_mushroom', { position, rotationY = 0, scale = 1, height, collider = true, fallback = 'crate' }) -> Group
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
