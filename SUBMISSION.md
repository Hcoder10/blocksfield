# Blocksfield: submission draft (Comfy "Open Source Higgsfield")

**One line.** Open-source Higgsfield for Roblox: type a pitch, and a local 27B model builds a real Roblox place in
Roblox Studio, looks at what it built from any camera, and keeps fixing it, while ComfyUI makes the art, sound and
music. Every model is open-weight, and they all take turns on one RTX 5090. $0 per generation.

**Video:** `video/promo_v2.mp4` (2:06; voiceover version to follow). **Thumbnail:** `runs/starbloom_final/marketing/thumbnail_real.png`.
**Repos:** github.com/… (blocksfield) and github.com/… (cybus-harness, branch `blocksfield`). **Tag:** #OpenSourceHiggsfield

## What it does
- **Pitch to playable place.** Plan, style guide and concept art; an architect splits the game into items; builders
  write Luau; the world is built *in Roblox Studio* (edit mode, real instances), not by a runtime script.
- **It looks at its own work.** After each step the model plays the game and sees the player's view plus a framed
  overview, side and top-down survey (or any camera it picks), with runtime errors and a judge's score against the
  concept art, and repairs what is wrong.
- **Kits make 27B output look good.** LevelKit builds a whole dressed, gameplay-tagged level in one call (sky islands,
  meadow course, arena, town) in any look; LookKit, WorldKit/WorldKit2, ControllerKit, GameplayKit, UIKit, FXKit and
  PropKit cover the rest. The model composes and customises.
- **ComfyUI makes the assets.** Qwen-Image-2.1 (concept art, UI art, icons, textures, skyboxes) with BiRefNet
  cut-outs, TRELLIS.2 and Idol (image → Gaussian splat → editable Roblox Parts) for props, ACE-Step for music,
  Stable Audio 3 for sound effects.
- **One GPU.** A small arbiter time-slices the 5090: vLLM sleeps the 27B model to host RAM in ~4 s while ComfyUI runs
  an art job, then wakes it. The live dashboard shows who holds the card.

## Versus the paid workflow
Creators promote Higgsfield for Roblox covers and trailers (disclosed sponsorships, credited in the video). Its plans
are $19 / $59 / $129 a month for 270 / 1,200 / 3,000 credits; a game build starts around 70 credits and a trailer-heavy
workflow runs ~800 credits (higgsfield.ai/pricing, Oct 30 2026, excl. VAT). Blocksfield: open weights, $0 per
generation, one rented 5090 at $0.68/hour, and the output is a real Roblox place, not a hosted demo.

## Honest notes
- The demo game (Starbloom Peaks) was built by the pipeline from one paragraph; the operator chose the run settings
  and fixed harness/kit bugs during the night. Every intervention is logged in the run's `OPERATOR_NOTES.md` and the
  cybus-harness history. The world started from the LevelKit sky-islands preset, which the model chose and customised.
- Studio could not be saved headless, so the final place was exported from the open Studio and rebuilt with rojo;
  terrain and tags are restored at start by a generated module.
- Gameplay is the weak part: the scripted run in our footage could not clear the jumps, and the landing-dust effect is
  oversized. The world, HUD and pipeline are what the video shows.
- Licences differ per model (Qwen-Image-2.1 is non-commercial; others permissive or community licences; see README).
