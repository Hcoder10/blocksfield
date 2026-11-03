# Blocksfield: submission (Comfy "Open Source Higgsfield", closes Nov 3 2026, 9:00 AM PT)

## Checklist against the contest rules (comfy.org/open-source-higgsfield, "How to enter")

| Rule | Status |
|---|---|
| Built with ComfyUI | Yes: every image, prop, music and sound job is a ComfyUI workflow (`workflows/api/`) run through the arbiter, plus a custom node (`comfy_nodes/idol`) |
| Repo with an open-source licence and enough setup detail to run it locally | MIT `LICENSE` in all three repos; README "Web games: Run it (web)", "Run it (Roblox)" (GPU box + laptop) and "Try the Roblox demo game" |
| Repo holds app code, workflow files, licence, local run instructions | Yes: pipeline (`blocksfield/`), ThreeKit (`web/kit/`), Studio app (`web/studio/`, `blocksfield/studio.py`), workflows, licence, README |
| Demo video, two minutes max | `video/promo_v3.mp4` (1:59.8, 1080p30), rendered by `blocksfield/promo_v3.py`. Kokoro TTS voiceover (the operator had COVID; noted in the video) |
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

| Game | Genre | Judge score | Build time | Operator interventions | Model-made level / mechanics | Cutscenes |
|---|---|---|---|---|---|---|
| Neon Drift Circuit (`neon_drift`) | Synthwave arcade kart racing | 7.0 | 35 min | 0 | - | intro, win, lose |
| Cloudhop Meadows (`cloudhop2`) | 3D platformer / collect-and-climb | 7.0 | 40 min | 0 | - | intro, win |
| Frostbeak (`frostbeak2`) | Cozy platformer | 6.5 | 27 min | 0 | - | intro |
| Turbo Treats (`turbo_treats`) | Candy arcade kart racer | 6.5 | 78 min | 0 | rule (Sugar Rush), 2 custom (oil-slick spin-outs, leader's gumdrop trail) | - |
| Crystal Hollow (`crystal_hollow`) | Dark fantasy first-person arena survival | 6.5 | 33 min | 0 | - | intro, win, lose |
| Bumble Dash (`bumble_dash`) | Bouncy obstacle-course platformer | 6.5 | 39 min | 0 | - | intro, win |
| Dune Raiders (`dune_raiders`) | Top-down action treasure hunt | 6.5 | 27 min | 0 | - | intro, win |
| Starbloom Isles (`starbloom_isles2`) | Toon 3D platformer | 6.3 | 35 min | 0 | - | intro, win, lose |
| Neon Arena (`neon_arena2`) | Top-down synthwave arena shooter | 6.29 | 33 min | 0 | - | intro, win, lose |
| Canyon Runner (`canyon_runner2`) | Arcade hover-bike time trial | 6.17 | 30 min | 0 | - | intro, win, lose |
| Spire Climb (`spire_climb2`) | Cozy 3D platformer | 6.0 | 72 min | 0 | `Level.compose`; tuning, glide power-ups, a rule | - |
| Lantern Lane (`lantern_lane2`) | Cozy village collect and quest | 6.0 | 34 min | 0 | - | intro |
| Riverbend Canyon (`riverbend_canyon2`) | Stylised 3D platformer | 5.89 | 79 min | 0 | `Level.compose`; tuning, zones, 2 rules, custom (rideable log rafts) | - |
| Vault Hopper (`vault_hopper`) | Toon 3D platformer heist | 5.6 | 76 min | 0 | keys and doors, switch gate, crates, magnet, 4 rules (floor is lava, guard waves...) | - |
| Lagoon Rush (`lagoon_rush2`) | Arcade boat racing | 5.42 | 41 min | 0 | - | intro |

These are the 15 games in the gallery (`web/games/index.json`). Every one is a fresh run with zero operator
interventions. Nine earlier runs (`canyon_runner`, `cloudhop`, `frostbeak`, `lagoon_rush`, `lantern_lane`,
`neon_arena`, `riverbend_canyon`, `spire_climb`, `starbloom_isles`) are superseded by re-runs of the same pitch and
are no longer listed; five of them had interventions, still recorded in their `about.json`. After the kit was frozen
(`64143bb`), every listed game was re-recorded and re-scored the same way, and the scores above are from that pass.

How to read the table:
- **Build time** is the minutes recorded in the index.
- **Judge score** is the mean of the autopilot play score and the vision judge's score against the concept board,
  out of 10.
- **Model-made level / mechanics** is what the game's own code calls (`K.Level.compose`, `K.Mechanics.*`), also
  listed in `about.json` (`mechanics`).
- **Cutscenes** are the LTX-2.5 clips that passed the agent's frame-sheet review.

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
ships with a thumbnail, a gameplay video, LTX-2.5 cutscenes and a "How it was made" page. The 15 games in the
gallery (https://hcoder10.github.io/blocksfield/) were all made this way with zero operator interventions. Blocksfield Studio, a local web app, shows the
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
   world, level, mechanics, player, camera, gameplay, UI, FX, audio, cutscene, assist, debug, touch; one tested module each, with docs written for
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
6. **The model lays out its own levels and invents mechanics.** Beyond the preset level kinds,
   `Level.compose` lets the model build a level from route pieces in its own order and shape. In Riverbend Canyon
   the builder laid out all 21 pieces; in Spire Climb it changed 6 of the scaffold's 14. `Mechanics` lets it add or change mechanics, each from one call:
   - tuning: speed, jump, air jumps, dash, glide, size;
   - power-ups;
   - interactables: keys and doors, switches, crates, zones;
   - trigger -> effect rules;
   - a sandboxed custom hook for anything else.

   The games that use it are Turbo Treats, Spire Climb, Riverbend Canyon and Vault Hopper. Turbo Treats' oil
   slicks and Riverbend Canyon's rideable rafts are model-written custom code. The UI shows each mechanic as it
   fires.
7. **Cutscenes as a pipeline stage.** After the build, LTX-2.5 (image-to-video in ComfyUI) animates concept frames
   into intro, win and lose clips. The kit plays them and they can be skipped. An agent reviews a frame sheet of
   every clip and drops any with garbled lettering or an off-model character. 11 of the 15 games ship clips.
8. **Playable by anyone.** Every game gets the same extras from the kit:
   - touch controls on phones;
   - a reset assist: `R` or a button, and karts and boats that get stuck are put back on their own;
   - graphics quality tiers picked from the frame rate measured during play.
9. **Export and publish.** Each web game is a static folder (`web/games/<id>/`) published to GitHub Pages with its
   making-of record; on Roblox the Studio-built world is exported to a `.rbxlx` place.

**Open weights.** Qwen3.8-27B (NVFP4), Qwen-Image-2.1, BiRefNet, Idol, ACE-Step 1.5, Stable Audio 3, LTX-2.5 (web
cutscenes and the Roblox trailer); for the Roblox target also TRELLIS.2. Kokoro TTS is used only for the demo video's voiceover. No partner nodes, no
closed APIs. Cost: $0 per generation; the one rented RTX 5090 was $0.68/hour.

## Social post (draft)

> Higgsfield sells AI games and trailers. We built the open-source version that makes the game and checks its own
> work. Blocksfield: one pitch -> a playable game (in your browser, on your phone, or as a Roblox place), built by a
> local 27B model that plays it, looks at it and fixes it. ComfyUI makes the art, 3D splat props, music and SFX. All
> open weights, one RTX 5090, $0 per generation. Play: hcoder10.github.io/blocksfield #OpenSourceHiggsfield @ComfyUI
> [video link] github.com/Hcoder10/blocksfield

## Honest notes

- **Operator interventions are recorded per game.** Every web game's `about.json` lists any hand action
  (`operator_interventions`), and its gallery page shows the count and the list. All 15 games in the gallery have
  zero.
- **Incidents are recorded separately.** Four games record an incident in `about.json` (`incidents`): Turbo Treats,
  Spire Climb, Riverbend Canyon and Vault Hopper. A duplicate builder process of the same pipeline ran on their run
  directories from 04:48 to 04:52 and was killed.
  - Turbo Treats and Spire Climb: `game.js` was not written during that window.
  - Riverbend Canyon and Vault Hopper: `game.js` was written during it, so it may include writes from the duplicate.
  
  Either way, it was the pipeline's own builder, not a person.
- **Superseded runs.** Nine earlier runs are superseded (`superseded_by` in their `about.json`) by fresh re-runs of
  the same pitch, and only the re-runs are listed. Five of the nine had interventions, mostly re-running a stage after
  an LLM outage or a pipeline fix (`--redo`, `--backfill-assets`); one sky was re-made by hand with the pipeline's
  fixed panorama code. Their folders and records stay in `web/games/`.
- **Cutscene review is an agent's, not a person's.** The frame-sheet check that decides which LTX-2.5 clips ship was
  done by an agent (the kit-ui-fx agent), not by a human.
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
