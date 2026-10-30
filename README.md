# Blocksfield

**Open-source Higgsfield Games, for Roblox, on one GPU.** Type a pitch and get back a real, playable Roblox
place, plus the creator kit Higgsfield gets used for in Roblox videos: a thumbnail, an icon and a scored
gameplay trailer. Every model is open-weight, and they all take turns on a single RTX 5090.

> Entry for Comfy's [Open Source Higgsfield](https://comfy.org/open-source-higgsfield/) challenge. #OpenSourceHiggsfield

## Why

Higgsfield's Games 2.0 turns a prompt into a hosted browser game, using GPT-6 Astra plus paid generation credits.
The "Roblox + Higgsfield" videos online work differently: a chatbot writes code, a person pastes it into Studio
by hand, and Higgsfield makes the promo video. Blocksfield does the whole loop locally:

- **It builds a real Roblox place**, saved as `.rbxlx`, that you open, play and publish. Roblox has 100M+ daily
  players; a hosted demo does not.
- **The model sees its own game.** It captures the running game in Studio, judges the capture against the
  generated concept art, and repairs what looks wrong. Blind code generation stops at "it runs"; this loop is
  what makes the result look good.
- **The art is generated.** Concept frames, UI art and icons come from Qwen-Image-2.1. Textured 3D props come
  from TRELLIS.2 and are imported into the place as MeshParts. Trailer shots are animated from real gameplay
  captures with LTX-2.5 and scored with ACE-Step.
- **Every model runs on one 5090.** A GPU arbiter time-slices the card. The 27B LLM sleeps to host RAM (vLLM
  sleep mode) while ComfyUI runs an art job, then wakes. A burst of art requests shares one swap. The live
  dashboard shows which model holds the card at each moment.

## Models (all open weights)

| Role | Model | Runs in |
|---|---|---|
| Game design, Luau code, vision judge | Qwen3.8-27B NVFP4 (`RedHatAI/Qwen3.8-27B-NVFP4`) | vLLM 0.32 (sleep mode) |
| Concept art, UI art, icons, thumbnail | Qwen-Image-2.1 turbo int8 + BiRefNet cut-outs | ComfyUI |
| 3D props (meshes) | TRELLIS.2 → decimated under Roblox's 20k-triangle limit | ComfyUI |
| Procedural props | Idol (`speridlabs/idol`, image → Gaussian splat in ~2 s) → voxel / blob Parts | ComfyUI (custom node in `comfy_nodes/idol`) |
| Trailer | LTX-2.5 distilled NVFP4, image-to-video | ComfyUI |
| Music | ACE-Step 1.5 turbo | ComfyUI |
| Sound effects | Stable Audio 3 small-sfx (t5gemma text encoder) | ComfyUI |

## The kit library: why a 27B model can make good-looking games

A local 27B model can't write a vehicle controller, an animated HUD or a lighting rig to the standard of a top
Roblox game. In our live runs it reliably failed in the same ways: geometry that renders as nothing, noon lighting
for "golden hour", and contracts between its own files that don't match. It does reliably *compose* well-made parts.
So Blocksfield gives it a library of genre-general kits, each tested in Studio, and the game is the model's choices
on top of them: the design, layout, art direction, tuning and UI. The kits live in the harness's
`harness/kit/`, and every builder gets their API plus routing rules for which kit to use when.

| Kit | What it gives a game |
|---|---|
| **LookKit** | One-call art direction: toon_bright, realistic, cozy, neon_night, dark_fantasy, snow, desert, candy, space (lighting, atmosphere, sky, post-processing, terrain colours, a palette), plus MaterialVariants from generated textures, outlines and cel helpers |
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

## How it fits together

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
- `blocksfield/marketing.py`: thumbnail, icon and trailer from the built game.
- `blocksfield/harness_ext.py`: the builders' extra tools: `generate_model` (prompt → 3D prop in the place) plus
  everything in `blocksfield/asset_tools.py`.
- `blocksfield/asset_tools.py`: `generate_texture` (seamless MaterialVariant colour maps), `generate_skybox` (six
  wrapped Sky faces from a panorama and a zenith image), `generate_sfx`, `generate_music`, `generate_icon` and
  `generate_ui_art` (panels, buttons, banners, badges with 9-slice centres), and `generate_prop` (prompt → procedural
  Parts prop, above). Each is a ComfyUI workflow through the
  arbiter; the files are installed into Studio's local content folder as `rbxasset://cybus/<run>/<file>`.
- The build harness, which handles plan → style guide → architecture → build → Studio capture → vision judge →
  repair → polish, is [cybus-harness](#) (branch `blocksfield`).

## Run it

You need a Linux GPU box with one 32 GB card (we use a rented RTX 5090) and a Windows or Mac machine with Roblox
Studio. They can be the same machine.

**1. GPU box: models and servers.**
```bash
git clone <this repo> /root/blocksfield && cd /root/blocksfield
bash deploy/box_setup.sh all        # ComfyUI + vLLM venvs, ~106 GB of open weights (LTX-2.5 needs its HF gate accepted)
bash deploy/start_servers.sh all    # vLLM :8000 (sleep mode), ComfyUI :8189, arbiter :8100
```
Open `http://<box>:8100/` to watch the GPU timeline.

**2. Studio machine: bridge and harness.**
- Install the Studio Bridge plugin and server
  ([roblox-studio-mcp](https://github.com/)). Start it with `node packages/server/dist/index.js`, which serves
  `localhost:3000`.
- Clone [cybus-harness](https://github.com/) (branch `blocksfield`) next to this repo.
- Put `luau-analyze`, `luau-lsp` and `rojo` on PATH.

**3. Build a game.**
```bash
export BLOCKSFIELD_BOX="-p <ssh port> root@<box>"         # the runner opens the ssh tunnel to the arbiter itself
python -m blocksfield.run --check                         # tunnel, arbiter, LLM, bridge, Studio, tools
python -m blocksfield.run "A neon obby tower in the clouds with laser gates and checkpoints" --id neon_obby
python -m blocksfield.marketing runs/neon_obby            # thumbnail, icon, trailer from the built game's captures
python -m blocksfield.demo_video runs/neon_obby           # the 2-minute cut
```
The build opens its own Studio place, plays it, judges every capture against the concept board, and repairs the
game. The finished place is `runs/<id>/place/final.rbxlx`.

Builders always get the art and audio tools through `HARNESS_EXTRA_TOOLS=blocksfield.harness_ext:tools` (the runner
sets it).

**Optional: 3D props.** Set `ROBLOX_API_KEY` (Open Cloud, Assets read and write) and `ROBLOX_CREATOR_ID`. Builders then
also get a `generate_model` tool (Qwen-Image → TRELLIS.2 → decimated GLB → uploaded → loaded into the place).

### The ComfyUI workflows

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

MIT for this repository. Each model keeps its own licence (see the table above); check them before any
commercial use.

## Honest notes

- **What's verified.** Every kit was screenshotted in Studio: UIKit, LookKit and WorldKit2 look good; ControllerKit
  and GameplayKit run without errors (their *feel* has not been playtested by a person); FXKit was retuned after its
  first Studio pass showed effects too small. All six ComfyUI asset tools ran end to end on the 5090.
- **Operator interventions.** Where a build's own code crashed on a one-line bug its repair rounds missed, we fixed
  that line by hand so the rest of the build could be judged, and we logged every such edit in the run's
  `OPERATOR_NOTES.md`. Everything else in a game is written by the local model.
- **What the model still gets wrong.** Its own glue code: type confusion, such as passing a `Color3` to
  `Color3.fromHex` or indexing a `Vector3` like a table, and API slips hidden behind untyped helpers. The kits
  removed whole classes of failure; strict typing in builder files is the next step.
- **Licences.** This repository is MIT. Model licences vary: Qwen-Image-2.1 is research-only (non-commercial), and
  LTX-2.5, Stable Audio 3, Hunyuan3D and FLUX use community licences. Qwen3.8, TRELLIS.2, ACE-Step and BiRefNet are
  permissive. Check each one before any commercial use.
