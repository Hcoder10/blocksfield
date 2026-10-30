# Blocksfield: submission (Comfy "Open Source Higgsfield", closes Oct 30 2026, 9:00 AM PT)

## Checklist against the contest rules (comfy.org/open-source-higgsfield, "How to enter")

| Rule | Status |
|---|---|
| Built with ComfyUI | Yes: every image, prop, music and sound job is a ComfyUI workflow (`workflows/api/`) plus a custom node (`comfy_nodes/idol`) |
| Repo with an open-source licence and enough setup detail to run it locally | MIT `LICENSE` in all three repos; README "Run it" (GPU box + Studio machine) and "Try the demo game" |
| Repo holds app code, workflow files, licence, local run instructions | Yes |
| Demo video, two minutes max | `video/promo_final.mp4`, **1:54**, 1080p |
| Other tools/models explained in the demo video | Models card (every model and what it does) + pipeline steps |
| Lawful, SFW, no unlicensed IP or likenesses | The contest cut has **no creator clips** (they were in the draft; removed for this rule). Game art is generated; Roblox Studio is shown as the platform |
| Most Innovative: video must explain why it is innovative | Opening card "Why this is new" |
| Social post linking the demo video, tagging #OpenSourceHiggsfield | Draft below; post on X / YT / LI / Reddit / IG / TikTok |
| Link to try it (optional) | `examples/starbloom_peaks.rbxlx` in the repo |
| One submission per person | One entry |

## Links

- Repo: https://github.com/Hcoder10/blocksfield
- Build harness: https://github.com/Hcoder10/cybus-harness (branch `blocksfield`)
- Studio Bridge (Studio plugin + server the harness drives): https://github.com/Hcoder10/roblox-studio-mcp
- Video: `video/promo_final.mp4` (upload to YouTube, unlisted or public, and use that link)
- Thumbnail: `examples/starbloom_peaks_thumbnail.png`
- Categories: Most Innovative, Open Weights Only (Best Overall is automatic)

## Form answers (paste-ready)

**Project name.** Blocksfield

**One line.** Open-source Higgsfield for Roblox: type a pitch and get a real, playable Roblox game, built in Roblox
Studio by a local 27B model that looks at its own world and fixes it, with ComfyUI making the art, props, music and
sound. Every model open-weight, on one RTX 5090, $0 per generation.

**What it does.** Higgsfield's Roblox workflow (promoted by sponsored creators) makes a cover and a trailer for a
game you already built. Blocksfield makes the game. A pitch becomes a plan, a style guide and a concept board
(Qwen-Image-2.1 in ComfyUI). Qwen3.8-27B then builds the world *in Roblox Studio* (real instances, edit mode),
plays it, surveys it from four cameras, has a vision judge score it against the concept board, and repairs it. A kit
library (LevelKit, LookKit, WorldKit2, UIKit, FXKit, PropKit, ...) lets a 27B model compose good-looking levels in a
few calls. ComfyUI makes icons, UI art and skies (Qwen-Image-2.1 + BiRefNet), props (Idol image -> Gaussian splat ->
editable Roblox Parts; TRELLIS.2 -> mesh), music (ACE-Step 1.5) and sound effects (Stable Audio 3).

**Why it is innovative.** There is no open (or closed) tool that turns a prompt into a real Roblox place the model
has inspected with its own eyes. It builds inside Studio rather than emitting a runtime script, closes the loop with
camera surveys and a judge against ComfyUI concept art, converts generated props into native Roblox Parts through a
custom Idol node, and time-slices one GPU between the LLM (vLLM sleep mode, ~4 s to host RAM) and ComfyUI.

**Open weights.** Qwen3.8-27B (NVFP4), Qwen-Image-2.1, BiRefNet, TRELLIS.2, Idol, ACE-Step 1.5, Stable Audio 3. No
partner nodes, no closed APIs. Cost: $0 per generation; the one rented RTX 5090 was $0.68/hour.

## Social post (draft)

> Higgsfield sells AI covers and trailers for Roblox games. We built the open-source version that makes the game.
> Blocksfield: one pitch -> a playable Roblox place, built in Studio by a local 27B model that looks at its own
> world and fixes it. ComfyUI makes the art, props, music and SFX. All open weights, one RTX 5090, $0 per
> generation. #OpenSourceHiggsfield @ComfyUI
> [video link] github.com/Hcoder10/blocksfield

## Honest notes

- The demo game (Starbloom Peaks) was built by the pipeline from one paragraph; the operator chose the run settings
  and fixed harness/kit bugs during the night. Every intervention is logged in the run's `OPERATOR_NOTES.md` and the
  cybus-harness history. The world started from the LevelKit sky-islands preset, which the model chose and customised.
- Studio could not be saved headless, so the final place was exported from the open Studio and rebuilt with rojo;
  terrain and tags are restored at start by a generated module.
- Gameplay is the weak part: the scripted run in our footage could not clear the jumps, and the landing-dust effect is
  oversized. The world, HUD and pipeline are what the video shows.
- Prices on the price card: higgsfield.ai/pricing, Oct 30 2026, excl. VAT ($19 / $59 / $129 a month for
  270 / 1,200 / 3,000 credits); the trailer workflow total is our estimate at the page's credit rates.
- Licences differ per model (Qwen-Image-2.1 is non-commercial; others permissive or community licences; see README).
