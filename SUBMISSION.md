# Blocksfield: submission (Comfy "Open Source Higgsfield", closes Nov 3 2026, 9:00 AM PT)

## Checklist against the contest rules (comfy.org/open-source-higgsfield, "How to enter")

| Rule | Status |
|---|---|
| Built with ComfyUI | Yes: every image, prop, music and sound job is a ComfyUI workflow (`workflows/api/`) run through the arbiter, plus a custom node (`comfy_nodes/idol`) |
| Repo with an open-source licence and enough setup detail to run it locally | MIT `LICENSE` in all three repos; README "Web games: Run it (web)", "Run it (Roblox)" (GPU box + laptop) and "Try the Roblox demo game" |
| Repo holds app code, workflow files, licence, local run instructions | Yes: pipeline (`blocksfield/`), ThreeKit (`web/kit/`), Studio app (`web/studio/`, `blocksfield/studio.py`), workflows, licence, README |
| Demo video, two minutes max | `video/promo_v3.mp4`, rendered by `blocksfield/promo_v3.py` (<= 2:00, 1080p30; the latest render is `video/promo_v3_draft.mp4`). Kokoro TTS voiceover (the operator had COVID; noted in the video) |
| Other tools/models explained in the demo video | Models card plus the pipeline steps; the Studio app shows the GPU time-slicing live |
| Lawful, SFW, no unlicensed IP or likenesses | Game art, music and sound are generated; the games are our own; Roblox Studio is shown as a platform |
| Most Innovative: video must explain why it is innovative | Voiceover: it makes the game, not a trailer; the model plays and looks at its own game and fixes it; one GPU, open weights |
| Social post linking the demo video, tagging #OpenSourceHiggsfield | Draft below; post on X / YT / LI / Reddit / IG / TikTok |
| Link to try it (optional) | **https://hcoder10.github.io/blocksfield/**: every web game plays in the browser, on desktop and on phones. Roblox: `examples/starbloom_peaks.rbxlx` |
| One submission per person | One entry |

## Links

- Play: https://hcoder10.github.io/blocksfield/
- Repo: https://github.com/Hcoder10/blocksfield
- Build harness (Roblox target): https://github.com/Hcoder10/cybus-harness (branch `blocksfield`)
- Studio Bridge (Roblox Studio plugin + server the harness drives): https://github.com/Hcoder10/roblox-studio-mcp
- Video: `video/promo_v3.mp4` (upload to YouTube, unlisted or public, and use that link)
- Categories: Most Innovative, Open Weights Only (Best Overall is automatic)

## The web games (from each game's `web/games/<id>/about.json`)

| Game | Genre | Judge score | Build time | Operator interventions |
|---|---|---|---|---|
| Neon Drift Circuit (`neon_drift`) | Synthwave arcade kart racing | 7.5 | 31 min | 0 |
| Starbloom Isles (`starbloom_isles`) | Toon 3D platformer | 7.0 | 29 min | 6 |
| Neon Arena (`neon_arena2`, fresh re-run of the same pitch) | Top-down synthwave arena shooter | 6.14 | 30 min | 0 |
| Cloudhop Meadows (`cloudhop`) | 3D platformer | 6.06 | 24 min | 3 |
| Lagoon Rush (`lagoon_rush`) | Arcade boat racing | 5.92 | 23 min | 2 |
| Canyon Runner (`canyon_runner`) | Hover-bike time trial / kart racer | 5.75 | 30 min | 1 |
| Frostbeak (`frostbeak`) | Cozy platformer | 5.7 | 28 min | 1 |
| Neon Arena (`neon_arena`) | Top-down arena survival | 5.28 | 30 min | 0 |
| Lantern Lane (`lantern_lane`) | Cozy collect-a-thon / village adventure | 5.22 | 33 min | 0 |

Build time is the sum of the stage timings in `about.json`. The judge score is the mean of the autopilot play score
and the vision judge's score against the concept board, out of 10. This table is a snapshot: re-runs still finishing
replace the games they supersede.

## Form answers (paste-ready)

**Project name.** Blocksfield

**One line.** Open-source Higgsfield Games: type a pitch and get a playable game, a three.js game you play from a
link (on a phone too) or a real Roblox place, made by local open-weight models that play their own game, look at
it and fix it, with ComfyUI making the art, props, music and sound. One RTX 5090, $0 per generation.

**What it does.** Higgsfield's Games 2.0 turns a prompt into a hosted browser game with closed models and paid
credits. Blocksfield does the same with open weights on one GPU. A pitch becomes a schema-checked plan (Qwen3.8-27B)
whose options are our kit library's own, a concept board (Qwen-Image-2.1 in ComfyUI), then in one burst a sky
panorama, UI icons (+ BiRefNet cut-outs), music (ACE-Step 1.5), sound effects (Stable Audio 3) and 3D props (Idol:
generated image -> Gaussian splat, rendered in the browser). A builder agent writes the game on top of ThreeKit, our
three.js kit library, and plays it in real Chrome as it works. Every version is then played by an autopilot bot and
scored by a vision judge against the concept board; a repair agent fixes what the judge found, and the best version
ships with a thumbnail, a gameplay video and a "How it was made" page. Blocksfield Studio, a local web app, shows the
whole build live: plan, concept board, assets as they are generated, playtests, judged versions and the game, with a
strip showing which model holds the GPU. The same pipeline also targets Roblox: it builds the world inside Roblox
Studio and saves a real `.rbxlx` place.

**Why it is innovative.** It makes the game, not a cover or a trailer, and it checks its own work: the model plays
the game, surveys it from framed cameras, gets runtime errors and a judge's score against ComfyUI concept art, and
repairs it, keeping only improvements. A kit library lets a 27B model compose games that look and play well. One
GPU is time-sliced between the LLM (vLLM sleep mode) and ComfyUI. Generated images become Gaussian-splat props in the
browser, and native Parts on Roblox.

**Other tools or techniques.**
1. **A kit library the model composes instead of writing an engine.** ThreeKit for the web (`web/kit/`: look,
   world, level, player, camera, gameplay, UI, FX, audio, debug, touch; one tested module each, with docs written for
   the model) and the Roblox kits in the harness. The model's choices are the design, layout, art direction, tuning
   and UI; the kits make every option look and play right, on desktop and phones, with automatic quality tiers.
2. **Guardrails in the tools, not advice in the prompt.** The plan is schema-checked against enums read from the kit
   code, kit calls validate their input and name the valid choices, and the Roblox tools refuse the moves that wrecked
   worlds in live runs (re-grading the look, hand-sculpting terrain, wiping the world).
3. **Self-playtest + vision judge, keep the best.** Every version is played by an autopilot bot in real Chrome through
   the kit's harness API (`window.__kit`), surveyed from framed cameras, and scored by the LLM as a vision judge
   against the concept board; a pairwise A/B judge settles close calls, and a repair never ships a regression.
4. **One GPU, time-sliced.** A small arbiter puts the 27B LLM to sleep in host RAM (vLLM sleep mode) while ComfyUI
   runs a burst of art jobs, then wakes it; Blocksfield Studio shows who holds the card second by second.
5. **Image -> splat -> game.** Qwen-Image draws a prop, the Idol custom node lifts it to a Gaussian splat, and the game
   gets it as a splat rendered in the browser (Spark) with a voxel collider and fallback, or, on Roblox, as editable
   native Parts.
6. **Export and publish.** Each web game is a static folder (`web/games/<id>/`) published to GitHub Pages with its
   making-of record; on Roblox the Studio-built world is exported to a `.rbxlx` place.

**Open weights.** Qwen3.8-27B (NVFP4), Qwen-Image-2.1, BiRefNet, Idol, ACE-Step 1.5, Stable Audio 3; for the Roblox
target also TRELLIS.2 and LTX-2.5. Kokoro TTS is used only for the demo video's voiceover. No partner nodes, no
closed APIs. Cost: $0 per generation; the one rented RTX 5090 was $0.68/hour.

## Social post (draft)

> Higgsfield sells AI games and trailers. We built the open-source version that makes the game and checks its own
> work. Blocksfield: one pitch -> a playable game (in your browser, on your phone, or as a Roblox place), built by a
> local 27B model that plays it, looks at it and fixes it. ComfyUI makes the art, 3D splat props, music and SFX. All
> open weights, one RTX 5090, $0 per generation. Play: hcoder10.github.io/blocksfield #OpenSourceHiggsfield @ComfyUI
> [video link] github.com/Hcoder10/blocksfield

## Honest notes

- **Operator interventions are recorded per game.** Every web game's `about.json` lists any hand action
  (`operator_interventions`), and its gallery page shows the count and the list. Most were re-running a stage after an
  LLM outage or a pipeline fix (`--redo`, `--backfill-assets`); one sky was re-made by hand with the pipeline's fixed
  panorama code. Neon Drift Circuit, both Neon Arena runs and Lantern Lane have none.
- **Untouched games come first.** The demo video picks games with zero interventions first (`blocksfield/promo_v3.py`).
  Pitches are also re-run fresh, with no hand edits (`neon_arena2` is done; `starbloom_isles2` was building at the time
  of writing). A finished re-run that is marked as the replacement (`superseded_by` in the original's `about.json`)
  takes the original's place in the gallery; until then both stay listed with their own intervention records.
- **The judge is a 27B model.** Its absolute vision scores are noisy (the same scaffold has scored 6 and 7), so
  version selection uses the playtest first and a pairwise A/B judge for close calls. Scores are comparable within a
  game, not across games.
- **Roblox target.** The Roblox demo game (Starbloom Peaks) was built by the pipeline from one paragraph; operator
  edits during that night are logged in the run's `OPERATOR_NOTES.md` and the cybus-harness history. Studio could not
  be saved headless, so the place was exported from the open Studio and rebuilt with rojo.
- **Prices** on the video's price card (if shown): higgsfield.ai/pricing, Oct 30 2026, excl. VAT ($19 / $59 / $129 a month for
  270 / 1,200 / 3,000 credits).
- **Licences** differ per model (Qwen-Image-2.1 is non-commercial; others are permissive or community licences; see
  README).
