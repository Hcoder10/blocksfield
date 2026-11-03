# Blocksfield

**Open-source Higgsfield Games, on one GPU.** Type a pitch and get back a playable game: a three.js game that plays
in any browser from a link (desktop or phone), or a real Roblox place you open in Studio. Open-weight models plan
it, code it, make its art, music and sound in ComfyUI, play it, look at it and fix it. They all take turns on a single
RTX 5090, at $0 per generation.

> Entry for Comfy's [Open Source Higgsfield](https://comfy.org/open-source-higgsfield/) challenge. #OpenSourceHiggsfield

**Play the games: https://hcoder10.github.io/blocksfield/**

## Why

Higgsfield's Games 2.0 turns a prompt into a hosted browser game, using GPT-6 Astra plus paid generation credits.
The "Roblox + Higgsfield" videos online work differently: a chatbot writes code, a person pastes it into Studio
by hand, and Higgsfield makes the promo video. Blocksfield does the whole loop locally:

- **It makes the game, not a trailer.** On the web the result is a game you play from a link, on a phone too;
  on Roblox it is a place you open, play and publish.
- **It builds a real Roblox place**, saved as `.rbxlx`, that you open, play and publish. Roblox has 100M+ daily
  players; a hosted demo does not.
- **The model builds in Studio and looks at what it built.** The world is made in Roblox Studio's edit mode, as real
  instances saved in the place, not as a script that builds it at runtime. After each step the model plays the game
  and looks at it: from the player's view, plus an overview, a side view and a top-down view framed on the world it
  made, or from any camera it chooses. It gets runtime errors and a judge's score against the generated concept art,
  and keeps fixing until it reads right. Blind code generation stops at "it runs"; this loop is what makes the
  result look good.
- **The art is generated.** Concept frames, UI art and icons come from Qwen-Image-2.1. Textured 3D props come
  from TRELLIS.2 and are imported into the place as MeshParts. Trailer shots are animated from real gameplay
  captures with LTX-2.5 and scored with ACE-Step.
- **Every model runs on one 5090.** A GPU arbiter time-slices the card. The 27B LLM sleeps to host RAM (vLLM
  sleep mode) while ComfyUI runs an art job, then wakes. A burst of art requests shares one swap. The live
  dashboard shows which model holds the card at each moment.

## Web games (three.js)

The web target turns a pitch into a static three.js game: one `game.js` of a few hundred lines that composes
**ThreeKit**, our kit library, plus the art, music and sound generated for it. Every finished game is published to
**https://hcoder10.github.io/blocksfield/** with its thumbnail, a gameplay video and a "How it was made" page (the
plan, the concept board, every generated asset, the judged versions, the build log and any operator interventions).
The gallery lists untouched games first, ordered by judge score and then newest. A game with operator
interventions carries a chip with the count, and its making-of page lists every change. A superseded game is hidden
once its replacement has finished. Today all 15 listed games are untouched. The games play with keyboard or gamepad
on desktop, and with touch on phones (landscape).

### How a game gets made

`python -m blocksfield.web_run` runs these stages. Each stage's result is kept in `runs/web_<id>/stages/`, so a run
resumes after the last finished stage, and `--redo <stage>` reruns a stage and everything after it.

1. **Plan.** The lead (Qwen3.8-27B) designs the game as schema-checked JSON whose enums are the kits' own option
   lists (level kind, look, player type, rules, assets), read from the kit code itself.
2. **Art, in one burst through the arbiter.** A concept board (Qwen-Image-2.1), which is the judge's target; a sky
   panorama; UI icons (Qwen-Image-2.1 + BiRefNet cut-outs); music (ACE-Step 1.5); sound effects (Stable Audio 3);
   and props: Idol lifts a generated image to a Gaussian splat, shipped both as a `.spz` splat rendered in the browser
   (Spark) and as voxel boxes (`blocksfield/splat_to_parts.py`) for the fallback and the collider.
3. **Scaffold.** A working `index.html` + `game.js` generated straight from the plan.
4. **Build.** A builder agent customises `game.js` with file tools and the kit docs, and plays the game in real
   Chrome (`play_game`) as it works.
5. **Judge and repair.** Every version is played by the autopilot bot in Chrome through `window.__kit` (does it load,
   console errors, how far it moved, what it collected) for a play score, and a vision judge scores survey shots and
   the player's view against the concept board. The combined score is the mean of the two (a broken game never wins
   on looks). A repair agent fixes what the judge found. The best version is kept: fewer errors first, then the
   playtest, then, within the judge's noise, a pairwise A/B judge. A repair never ships a regression.
6. **Finalize.** The best version is restored; the thumbnail, an autopilot gameplay video and `about.json` are
   written to `web/games/<id>/`.

### Run it (web)

Same GPU box as the Roblox target (step 1 of "Run it (Roblox)" below). The laptop needs Python and Chrome; no Roblox
Studio.
```bash
export BLOCKSFIELD_BOX="-p <ssh port> root@<box>"
python -m blocksfield.web_run --check                                   # tunnel, arbiter, LLM, Chrome, kit catalog
python -m blocksfield.web_run "A neon kart race around a seaside track at night ..." --id neon_drift
python -m blocksfield.web_queue runs/web_queue.json --max 2             # keep the box busy: a JSON list of {id, pitch}
python web/tools/build_index.py                                          # games/index.json for the gallery
python deploy/publish_pages.py --push                                    # publish web/ to GitHub Pages
```
`deploy/launch_web.ps1 -Pitch "..." -Id <id>` starts a detached build on Windows. `--dry-run` uses a fake LLM and
fake ComfyUI with real Chrome. `--intervention "..."` records a hand edit in the game's `about.json`, and the gallery
shows it on the game's page.

### Blocksfield Studio

The app face of the web pipeline: a local web app where you type a pitch and watch the game get made. It shows the
plan, the concept board, every generated asset (sky, icons, music, sound, props), the builder's playtests, each judged
version with its scores, and finally the playable three.js game. A live strip shows who holds the GPU second by second
(the 27B LLM or ComfyUI), read from the arbiter. A finished build can be replayed "live" (`/run/<id>?replay=auto`,
labelled as a replay in the UI).

```bash
python -m blocksfield.studio                    # http://127.0.0.1:8420/  (needs the arbiter tunnel for the live GPU strip)
python -m blocksfield.studio --allow-launch     # also lets "Make game" start real builds (blocksfield.web_run)
python -m blocksfield.studio_record --run neon_drift   # a scripted 15 s 1920x1080 clip -> video/studio_take.mp4
```
Without `--allow-launch` the pitch box never starts a build; it opens the latest run instead. With it, "Make game"
runs `python -m blocksfield.web_run "<pitch>" --id <slug>` detached (set `BLOCKSFIELD_BOX` as above), logging to
`runs/web_<id>/build.log`, and opens that run's live view. Pages: `/` (create), `/run/<id>` (a build), `/runs` (every
web game).

### ThreeKit: the web kit library

The same idea as the Roblox kits below: the model composes tested, good-looking parts and never writes a shader,
physics or UI CSS. `web/kit/CONTRACT.md` is the shared API, and each module has a doc the builder reads.

| Module | What it gives a game | Doc |
|---|---|---|
| `core.js` | `createGame`: renderer, scene, camera, Rapier physics world, game loop, events, assets manifest | [CONTRACT.md](web/kit/CONTRACT.md) |
| `look.js` | One-call art direction (toon_bright, candy, sunset, neon_night, dark_fantasy, cozy, desert, snow, realistic): sky, sun and shadows, fog, ink outlines, bloom, grade, toon materials, a palette | [Look.md](web/kit/docs/Look.md) |
| `world.js` | Terrain, islands, water, plazas, instanced foliage, clouds, props, static batching | [World.md](web/kit/docs/World.md) |
| `level.js` | One call builds a dressed, playable level: `sky_islands`, `meadow_course`, `arena`, `town`, `race_track`, `lagoon`, `canyon`; or the model lays out its own level from pieces with `Level.compose` | [Level.md](web/kit/docs/Level.md) |
| `mechanics.js` | The model adds or changes mechanics: tuning (speed, jump, air jumps, dash, glide, size), power-ups, interactables (keys and doors, switches, crates, zones...), trigger -> effect rules, and a sandboxed custom hook for anything else | [Mechanics.md](web/kit/docs/Mechanics.md) |
| `assets.js` | Generated sky panoramas, icons, textures, music, sfx and Idol splat props, each with a procedural fallback | [Assets.md](web/kit/docs/Assets.md) |
| `physics.js` | Rapier helpers: colliders, kinematic movers, sensors, raycasts | [Physics.md](web/kit/docs/Physics.md) |
| `player.js` | Controllers (platformer, kart, boat, topdown, fps) with a procedural character, keyboard + gamepad | [Player.md](web/kit/docs/Player.md) |
| `camera.js` | Follow, chase, orbit and top-down cameras with collision and smoothing | [Camera.md](web/kit/docs/Camera.md) |
| `gameplay.js` | Collectibles, checkpoints, hazards, enemies, goal, timer, lives, races with AI opponents, and the autopilot bot | [Gameplay.md](web/kit/docs/Gameplay.md) |
| `ui.js` | A HUD bound to the game state, banners, title / pause / win / lose screens, dialog, countdown; five styles | [UI.md](web/kit/docs/UI.md) |
| `fx.js` | GPU particles, confetti, trails, floating text, screen shake, hit flash, speed lines, slow-mo | [FX.md](web/kit/docs/FX.md) |
| `audio.js` | Music with crossfade, sfx with variation, procedural fallback sounds; wired to game events automatically | [Audio.md](web/kit/docs/Audio.md) |
| `debug.js` | `window.__kit`: the harness API (survey cameras, state, input, autopilot) the playtests and the judge use | [Debug.md](web/kit/docs/Debug.md) |
| `touch.js` | Phones: a virtual joystick and buttons per player type, camera drag, tap to start, a rotate-your-phone hint | automatic |
| `assist.js` | Unsticks the player: `R` (or the ↺ button on phones) resets you a little way back; karts stuck or off the track and boats run aground are put back on their own | automatic |
| `cutscene.js` | Plays a game's intro / win / lose clips (LTX-2.5, see below), skippable with any key or a tap | automatic |

**Every game gets these without asking:** touch controls on phones, the reset assist, cutscenes when the game has
them, and graphics quality tiers. A probe measures the frame rate during play and picks `high`, `low` (no shadows or
bloom, FXAA, fewer grass blades) or `potato` (lower resolution, no post-processing); `?quality=low` (or `high`,
`potato`) on the URL forces a tier.

**What the model uses them for.** In the current gallery, Spire Climb and Riverbend Canyon lay out their own levels
with `Level.compose`. Turbo Treats, Spire Climb, Riverbend Canyon and Vault Hopper add their own mechanics, for
example a Sugar Rush speed rule, glide power-ups, key-and-door vaults and a floor-is-lava rule. Turbo Treats (oil
slicks that spin your kart out) and Riverbend Canyon (log rafts you ride) also write custom sandboxed code.

**Cutscenes.** After a game is built, a uniform pipeline stage animates its concept frames into short intro, win
and lose clips with LTX-2.5 (image-to-video, in ComfyUI). Before a clip is published, an agent reviews a frame sheet
of it and drops any clip with garbled lettering or an off-model character, so some games have fewer clips or none.
Each game's `about.json` (`post_stages`) lists the clips it shipped.

## Models (all open weights)

The web games use the LLM, Qwen-Image-2.1 + BiRefNet, Idol, ACE-Step, Stable Audio and LTX-2.5 (cutscenes); in the browser they run on
three.js, Rapier (physics) and Spark (Gaussian splats).

| Role | Model | Runs in |
|---|---|---|
| Game design, Luau / JavaScript code, vision judge | Qwen3.8-27B NVFP4 (`RedHatAI/Qwen3.8-27B-NVFP4`) | vLLM 0.32 (sleep mode) |
| Concept art, UI art, icons, thumbnail | Qwen-Image-2.1 turbo int8 + BiRefNet cut-outs | ComfyUI |
| 3D props (meshes, Roblox) | TRELLIS.2 → decimated under Roblox's 20k-triangle limit | ComfyUI |
| Procedural props | Idol (`speridlabs/idol`, image → Gaussian splat in ~2 s) → voxel / blob Parts (Roblox); `.spz` splat + voxels (web) | ComfyUI (custom node in `comfy_nodes/idol`) |
| Web game cutscenes; Roblox trailer | LTX-2.5 distilled NVFP4, image-to-video | ComfyUI |
| Music | ACE-Step 1.5 turbo | ComfyUI |
| Sound effects | Stable Audio 3 small-sfx (t5gemma text encoder) | ComfyUI |
| Demo video voiceover only (not part of the pipeline) | Kokoro TTS | local |

## Roblox target

The original target: a pitch becomes a real Roblox place, built inside Roblox Studio.

### The kit library: why a 27B model can make good-looking games

A local 27B model can't write a vehicle controller, an animated HUD or a lighting rig to the standard of a top
Roblox game. In our live runs it reliably failed in the same ways: geometry that renders as nothing, noon lighting
for "golden hour", and contracts between its own files that don't match. It does reliably *compose* well-made parts.
So Blocksfield gives it a library of genre-general kits, each tested in Studio, and the game is the model's choices
on top of them: the design, layout, art direction, tuning and UI. The kits live in the harness's
`harness/kit/`, and every builder gets their API plus routing rules for which kit to use when.

| Kit | What it gives a game |
|---|---|
| **LookKit** | One-call art direction: toon_bright, realistic, cozy, neon_night, dark_fantasy, snow, desert, candy, space (lighting, atmosphere, sky, post-processing, terrain colours, a palette), plus MaterialVariants from generated textures, outlines and cel helpers |
| **LevelKit** | One call builds a whole dressed, gameplay-tagged level in any look: `sky_islands` (a hub you spawn on, islands rising in an arc, jump courses between them), `meadow_course`, `arena`, `town`. Checkpoints, coins, goals, hazards and movers come tagged for the gameplay code |
| **WorldKit / WorldKit2** | Sculpted terrain islands and water, 12 biomes, 63 stylised prop kinds, builders for race courses, N64-style platforming courses, arenas, interiors (kitchen, tavern, lab…), towns and dungeons, with gameplay hooks |
| **ControllerKit** | Feel profiles: platformer (coyote time, buffering, double and long jump, dive, ground pound, wall kick), top-down / isometric, FPS/TPS shooter (ADS, recoil, viewmodel, server-validated hits), arcade vehicles (kart, car, hover, boat; drift-boost tiers, chase camera) |
| **GameplayKit** | Self-wiring, server-authoritative systems: rounds, score, objectives, health and damage, NPC AI with waves, collectibles, interactables, cooking/crafting stations and recipes, inventory, checkpoints, races with AI followers, moving hazards |
| **UIKit** | ~25 animated, themed components (arcade, cozy, tactical, fantasy, toon): banners, countdowns, rolling counters, bars, dials, minimap, standings, crosshair, ammo, dialog, hotbar, shop cards, results |
| **FXKit** | 51 VFX presets in four styles (movement, combat, pickups, ambient weather) plus screen juice |
| **PropKit** | Spawns generated procedural props (Luau data modules of Parts) with scale, tint, palette swap, collision and anchoring options |

**Procedural props.** `generate_prop` turns a prompt into an editable prop with no upload step: Qwen-Image draws it
on a clean background, Idol lifts it to a Gaussian splat, and `blocksfield/splat_to_parts.py` clusters the splat into
Roblox Parts (a greedy-merged voxel style with a quantised palette, or smooth k-means blobs). The result is a plain
Luau module in `ReplicatedStorage/Shared/Props/`, so the model can re-tint, rescale, scatter or edit it like any other
code, and `PropKit.spawn` places it. If Idol is unavailable it voxelises a TRELLIS.2 mesh instead.

The ComfyUI asset tools (above) fill the kits' art slots: generated skyboxes, tileable textures, UI art, icons,
sound effects and music.

### How it fits together

```
 laptop (Windows/Mac)                          GPU box (one RTX 5090)
 ┌──────────────────────────┐   ssh tunnel   ┌───────────────────────────────────────────────┐
 │ Roblox Studio + bridge   │                │ arbiter :8100   ── LLM turn ──▶ vLLM :8000      │
 │ build harness (agents)   │ ─────────────▶ │   /v1  /generate  /job  /     ── art turn ─▶ ComfyUI │
 │ blocksfield.run          │                │   (sleep LLM → run workflows → free → wake LLM) │
 └──────────────────────────┘                └───────────────────────────────────────────────┘
```

- `blocksfield/arbiter.py`: the GPU turn-taking server and the live dashboard.
- `workflows/api/*.json`: the ComfyUI workflows (API format, with `{{param}}` slots): `image`, `image_rgba`,
  `edit`, `prop3d`, `prop_splat`, `music`, `sfx`, `trailer_clip`.
- `blocksfield/run.py`: build a game from a pitch.
- The harness's `harness/studio_build.py`: the builder's Studio tools. `studio_build` runs Luau in edit mode (logged,
  and replayed if Studio restarts; the finished place is saved from Studio). `studio_view` plays the game and returns
  framed survey shots, errors and a judge score. It refuses the moves that wrecked worlds in our live runs: fogging
  or re-grading the kit's tuned look, hand-sculpting terrain, and wiping the whole world to start again.
- `blocksfield/marketing.py`: thumbnail, icon and trailer from the built game.
- `blocksfield/harness_ext.py`: the builders' extra tools: `generate_model` (prompt → 3D prop in the place) plus
  everything in `blocksfield/asset_tools.py`.
- `blocksfield/asset_tools.py`: `generate_texture` (seamless MaterialVariant colour maps), `generate_skybox` (six
  wrapped Sky faces from a panorama and a zenith image), `generate_sfx`, `generate_music`, `generate_icon` and
  `generate_ui_art` (panels, buttons, banners, badges with 9-slice centres), and `generate_prop` (prompt → procedural
  Parts prop, above). Each is a ComfyUI workflow through the
  arbiter; the files are installed into Studio's local content folder as `rbxasset://cybus/<run>/<file>`.
- The build harness, which handles plan → style guide → architecture → build → Studio capture → vision judge →
  repair → polish, is [cybus-harness](https://github.com/Hcoder10/cybus-harness/tree/blocksfield) (branch `blocksfield`).

### Try the Roblox demo game (no GPU needed)

`examples/starbloom_peaks.rbxlx` is Starbloom Peaks, the game in the demo video, as the pipeline built it. Open it in
Roblox Studio and press Play. For its one generated UI glyph, first copy `examples/content/cybus` into Studio's
content folder (Windows: `%LOCALAPPDATA%\Roblox\Versions\<version>\content\`); without it the star icon is blank.

### Run it (Roblox)

You need a Linux GPU box with one 32 GB card (we use a rented RTX 5090) and a Windows or Mac machine with Roblox
Studio. They can be the same machine.

**1. GPU box: models and servers.**
```bash
git clone https://github.com/Hcoder10/blocksfield /root/blocksfield && cd /root/blocksfield
bash deploy/box_setup.sh all        # ComfyUI + vLLM venvs, ~106 GB of open weights (LTX-2.5 needs its HF gate accepted)
bash deploy/start_servers.sh all    # vLLM :8000 (sleep mode), ComfyUI :8189, arbiter :8100
```
Open `http://<box>:8100/` to watch the GPU timeline.

**2. Studio machine: bridge and harness.**
- Install the Studio Bridge plugin and server
  ([roblox-studio-mcp](https://github.com/Hcoder10/roblox-studio-mcp)). Start it with `node packages/server/dist/index.js`, which serves
  `localhost:3000`.
- Clone [cybus-harness](https://github.com/Hcoder10/cybus-harness) next to this repo:
  `git clone -b blocksfield https://github.com/Hcoder10/cybus-harness`.
- Put `luau-analyze`, `luau-lsp` and `rojo` on PATH.

**3. Build a game.**
```bash
export BLOCKSFIELD_BOX="-p <ssh port> root@<box>"         # the runner opens the ssh tunnel to the arbiter itself
python -m blocksfield.run --check                         # tunnel, arbiter, LLM, bridge, Studio, tools
python -m blocksfield.run "A neon obby tower in the clouds with laser gates and checkpoints" --id neon_obby
python -m blocksfield.marketing runs/neon_obby            # thumbnail, icon, trailer from the built game's captures
python -m blocksfield.export_place runs/neon_obby --look toon_bright   # the Studio-built world -> place/final.rbxlx
python -m blocksfield.capture_footage --attach --place runs/neon_obby/place/final.rbxlx   # orbit/dolly/hero clips
python -m blocksfield.promo_video --run runs/neon_obby --out video/promo.mp4             # the demo cut
```
The build opens its own Studio place, plays it, judges every capture against the concept board, and repairs the
game. The finished place is `runs/<id>/place/final.rbxlx`.

Builders always get the art and audio tools through `HARNESS_EXTRA_TOOLS=blocksfield.harness_ext:tools` (the runner
sets it).

**Optional: 3D props.** Set `ROBLOX_API_KEY` (Open Cloud, Assets read and write) and `ROBLOX_CREATOR_ID`. Builders then
also get a `generate_model` tool (Qwen-Image → TRELLIS.2 → decimated GLB → uploaded → loaded into the place).

#### The ComfyUI workflows

`workflows/api/` holds the API-format workflows the arbiter runs, with `{{param}}` slots and defaults in
`<name>.meta.json`:

| Workflow | What it does |
|---|---|
| `image` | Qwen-Image-2.1 turbo text-to-image at native ~2K |
| `image_rgba` | the same image, then a BiRefNet cut-out to RGBA (UI art, icons) |
| `edit` | Qwen-Image-2.1 edit with two reference images (thumbnail and icon from real captures) |
| `prop3d` | prop image → TRELLIS.2 → remesh → QEM decimate to 15k triangles → baked PBR textures → GLB |
| `prop_splat` | prop image → Idol → Gaussian splat `.ply` (then `splat_to_parts` → Luau) |
| `music` | ACE-Step 1.5 turbo, instrumental, any length |
| `sfx` | Stable Audio 3 small-sfx text-to-audio, 1-4 takes per call, MP3 |
| `trailer_clip` | LTX-2.5 distilled image-to-video, 720p, with its own audio |

Drag any of them into ComfyUI to see and edit the graph. `python -m blocksfield.comfy run <name> key=value`
runs one headless.

## License

MIT for this repository (see `LICENSE`). Each model keeps its own licence (see the table above); check them before any
commercial use.

## Honest notes

- **What's verified.** Every kit was screenshotted in Studio: UIKit, LookKit and WorldKit2 look good; ControllerKit
  and GameplayKit run without errors (their *feel* has not been playtested by a person); FXKit was retuned after its
  first Studio pass showed effects too small. All six ComfyUI asset tools ran end to end on the 5090.
- **Web games: operator interventions.** Every web game records any hand action in its `about.json`
  (`operator_interventions`), and its gallery page lists them. All 15 games in the gallery have zero. Nine earlier
  runs are superseded (`superseded_by`) by fresh re-runs of the same pitch and are no longer listed. Five of them had
  interventions, mostly re-running a stage after an LLM outage or a pipeline fix (`--redo`, `--backfill-assets`).
  Their folders and records are still in `web/games/`. Four games (Turbo Treats, Spire Climb, Riverbend Canyon,
  Vault Hopper) record a separate incident (`incidents`): a duplicate builder process of the pipeline ran on their
  run directories for four minutes and was killed.
- **Roblox: operator interventions.** Where a build's own code crashed on a one-line bug its repair rounds missed, we fixed
  that line by hand so the rest of the build could be judged, and we logged every such edit in the run's
  `OPERATOR_NOTES.md`. Everything else in a game is written by the local model.
- **What we learned running a 27B model as the builder.** It composes kits well but cannot tune a look. Left free in
  Studio it fogged the world, graded everything orange, hand-sculpted flat terrain slabs and wiped its world every
  round. Advice in the prompt did not stop that; hard refusals in the tools and one-call LevelKit presets did. Every
  harness change made during the night is in the cybus-harness history with the live failure that prompted it.
- **What the model still gets wrong.** Its own glue code: type confusion, such as passing a `Color3` to
  `Color3.fromHex` or indexing a `Vector3` like a table, and API slips hidden behind untyped helpers. The kits
  removed whole classes of failure; strict typing in builder files is the next step.
- **Licences.** This repository is MIT. Model licences vary: Qwen-Image-2.1 is research-only (non-commercial), and
  LTX-2.5 and Stable Audio 3 use community licences. Qwen3.8, TRELLIS.2, ACE-Step and BiRefNet are
  permissive. Check each one before any commercial use.
