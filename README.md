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
| 3D props | TRELLIS.2 → decimated under Roblox's 20k-triangle limit | ComfyUI |
| Trailer | LTX-2.5 distilled NVFP4, image-to-video | ComfyUI |
| Music | ACE-Step 1.5 turbo | ComfyUI |

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
  `edit`, `prop3d`, `music`, `trailer_clip`.
- `blocksfield/run.py`: build a game from a pitch.
- `blocksfield/marketing.py`: thumbnail, icon and trailer from the built game.
- `blocksfield/harness_ext.py`: the `generate_model` tool (prompt → 3D prop in the place).
- The build harness, which handles plan → style guide → architecture → build → Studio capture → vision judge →
  repair → polish, is [cybus-harness](#) (branch `blocksfield`).

## Run it

_Setup steps are being written; see `deploy/box_setup.sh` and `deploy/start_servers.sh`._

## License

MIT for this repository. Each model keeps its own licence (see the table above); check them before any
commercial use.
