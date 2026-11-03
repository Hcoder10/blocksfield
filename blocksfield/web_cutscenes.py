"""Cutscenes for a shipped web game: intro / win / lose clips made with LTX-2.5 (image-to-video with its own audio).

    python -m blocksfield.web_cutscenes --id neon_drift [--when intro,win,lose] [--seconds 5] [--dry-run]

A uniform post stage after the build, run the same way on every shipped game (recorded in about.json "post_stages",
not as an operator intervention). Per clip:
  intro  the game's concept image (the judge's target) + "camera pushes in over the world, the hero appears"
  win    the concept with the finish/goal (or a late gameplay frame) + "celebration"
  lose   a gameplay frame + "a gentle comedic fail" in the game's tone
Each clip goes through the arbiter (workflow "trailer_clip": LTX-2.5 distilled, 2-stage, 1280x736, generated audio),
is cropped to 1280x720, loudness-normalised to -20 LUFS and written to web/games/<id>/assets/cutscene_<when>.mp4 with a
manifest entry {"kind":"cutscene","file":...,"when":...}. The kit plays them automatically (web/kit/cutscene.js).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from PIL import Image

from blocksfield.asset_tools import ARBITER

ROOT = Path(__file__).resolve().parents[1]
GAMES = ROOT / "web" / "games"
W, H = 1280, 736                     # the workflow's native size (multiple of 32); delivered as 1280x720
NEG = "blurry, low quality, distorted, warped, text, letters, watermark, logo, user interface, HUD, black frames, glitch"
STYLE = "stylised 3D video game cinematic, same characters, world and art style as the image, smooth camera, vivid colour"


def cover(img: Image.Image, w: int = W, h: int = H) -> Image.Image:
    img = img.convert("RGB")
    s = max(w / img.width, h / img.height)
    img = img.resize((max(w, round(img.width * s)), max(h, round(img.height * s))), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def video_frame(path: Path, frac: float) -> Image.Image | None:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        dur = float(r.stdout.strip())
    except ValueError:
        return None
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{dur * frac:.2f}", "-i", str(path), "-frames:v", "1",
                        "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
    return Image.open(io.BytesIO(r.stdout)).copy() if r.stdout else None


def colourfulness(img: Image.Image) -> float:
    im = img.convert("RGB").resize((96, 54))
    hsv = im.convert("HSV")
    lum = [0.3 * r + 0.59 * g + 0.11 * b for r, g, b in im.get_flattened_data()]
    mean = sum(lum) / len(lum)
    return (sum((v - mean) ** 2 for v in lum) / len(lum)) ** 0.5 + 0.5 * sum(p[1] for p in hsv.get_flattened_data()) / len(lum)


def plan_of(about: dict) -> dict:
    p = about.get("plan") or {}
    return {"title": about.get("title") or p.get("title", "the game"), "genre": about.get("genre") or p.get("genre", ""),
            "art": (p.get("art_direction") or about.get("tagline") or "")[:260], "loop": (p.get("core_loop") or "")[:200],
            "pitch": about.get("pitch", "")[:300]}


def shots(game_dir: Path, about: dict) -> dict:
    """{when: (image, prompt)} for intro / win / lose."""
    pl = plan_of(about)
    concepts = [game_dir / c for c in about.get("concepts", []) if (game_dir / c).exists()]
    cims = [Image.open(c).convert("RGB") for c in concepts]
    gp = game_dir / "gameplay.mp4"
    # concept images have no HUD (LTX copies HUD text from gameplay frames into garbled digits), so prefer them:
    # win = the last concept (the planner draws the finish / goal last), intro = the most colourful of the others,
    # lose = a remaining one; gameplay frames only when the game has fewer concepts
    win_img = cims[-1] if cims else video_frame(gp, 0.85)
    rest = cims[:-1]
    intro_img = max(rest, key=colourfulness) if rest else (cims[0] if cims else video_frame(gp, 0.15))
    left = [c for c in rest if c is not intro_img]
    lose_img = left[0] if left else (intro_img if rest else video_frame(gp, 0.45))
    tone = pl["art"].split(".")[0]
    g = pl["genre"].strip().rstrip(".")
    world = f'the world of "{pl["title"]}", a {g[:1].lower() + g[1:]}{"" if g.lower().endswith("game") else " game"}'
    ptype = ((about.get("plan") or {}).get("player_type") or "").lower()
    vehicle = ptype in ("kart", "boat") or any(k in g.lower() for k in ("kart", "racing", "racer", "boat"))
    fail = ("the vehicle spins out in a cartoon puff of smoke and comes to a wobbly stop, the driver pops up dazed with "
            "little stars circling, then shakes it off" if vehicle else
            "the hero slips, tumbles playfully, sits up dazed with little stars circling, then shrugs it off")
    return {
        "intro": (intro_img, f"Opening cutscene of {world}. The camera slowly pushes in and glides over the world, "
                             f"revealing the level, then the hero character appears and strikes a confident pose. "
                             f"{tone}. {STYLE}. Upbeat adventurous music."),
        "win": (win_img, f"Victory cutscene of {world}. The hero celebrates the win, jumping and cheering, confetti and "
                         f"sparkles burst around, warm triumphant light, the camera circles slowly. {tone}. {STYLE}. "
                         f"Joyful fanfare."),
        "lose": (lose_img, f"A gentle comedic fail moment in {world}: {fail}. Light-hearted and cute, never violent. {tone}. "
                           f"{STYLE}. Playful 'womp womp' cartoon sound."),
    }


async def upload(http: httpx.AsyncClient, img: Image.Image, name: str, patience: float = 900) -> str:
    """Put the source image in ComfyUI's input folder. The arbiter forwards uploads straight to ComfyUI, which is only
    up while the box is in art mode; while the LLM holds the card we retry, and after a while ask for a tiny art job
    (through the arbiter's queue, like any build) so ComfyUI wakes."""
    buf = io.BytesIO()
    img.save(buf, "PNG")
    body = {"filename": name, "b64": base64.b64encode(buf.getvalue()).decode()}
    t0, woke = time.time(), False
    while True:
        try:
            r = await http.post(f"{ARBITER}/upload", json=body)
            if r.status_code < 400:
                return r.json().get("name", name)
            err = r.text[:200]
        except httpx.HTTPError as e:            # noqa: PERF203
            err = str(e)
        if time.time() - t0 > patience:
            raise RuntimeError(f"upload failed for {patience:.0f} s: {err}")
        if not woke and time.time() - t0 > 60:
            woke = True
            print("  ComfyUI asleep: queueing a tiny image job to wake it", flush=True)
            try:
                await http.post(f"{ARBITER}/job", json={"workflow": "image", "params": {
                    "prompt": "a plain grey square", "width": 256, "height": 256, "seed": 1}})
            except httpx.HTTPError:
                pass
            continue
        await asyncio.sleep(8)


async def clip(http: httpx.AsyncClient, img: Image.Image, prompt: str, name: str, seconds: float) -> bytes:
    uploaded = await upload(http, cover(img), name)
    r = await http.post(f"{ARBITER}/job", json={"workflow": "trailer_clip", "params": {
        "image": uploaded, "prompt": prompt, "negative": NEG, "seconds": seconds, "width": W, "height": H, "seed": -1}})
    if r.status_code >= 400:
        raise RuntimeError(f"trailer_clip failed ({r.status_code}): {r.text[:400]}")
    f = next((f for f in r.json()["files"] if f["filename"].lower().endswith((".mp4", ".webm", ".mov"))), None)
    if f is None:
        raise RuntimeError("trailer_clip produced no video")
    return base64.b64decode(f["b64"])


def finish(raw: Path, out: Path) -> None:
    """1280x720, 24 fps h264, audio loudness-normalised to -20 LUFS (silent track if the clip has none)."""
    has_audio = "audio" in subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0",
                                           str(raw)], capture_output=True, text=True).stdout
    vf = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=24,fade=t=in:d=0.25"
    if has_audio:
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-vf", vf, "-af", "loudnorm=I=-20:TP=-2:LRA=11",
               "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
               "-movflags", "+faststart", str(out)]
    else:
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
               "-shortest", "-vf", vf, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac",
               "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)


async def run(gid: str, whens: list[str], seconds: float, dry: bool) -> int:
    d = GAMES / gid
    about_p = d / "about.json"
    if not about_p.exists():
        print(f"no such game: {d}")
        return 1
    about = json.loads(about_p.read_text(encoding="utf-8"))
    plan = shots(d, about)
    if dry:
        tmp = ROOT / "runs" / f"cutscenes_{gid}"
        tmp.mkdir(parents=True, exist_ok=True)
        for w in whens:
            img, prompt = plan[w]
            cover(img).save(tmp / f"{w}_source.png")
            print(f"[{w}] {tmp / (w + '_source.png')}\n  {prompt}")
        return 0
    assets = d / "assets"
    man_p = assets / "assets.json"
    man = json.loads(man_p.read_text(encoding="utf-8")) if man_p.exists() else {}
    made = []
    async with httpx.AsyncClient(timeout=1800) as http:
        for w in whens:
            img, prompt = plan[w]
            t0 = time.time()
            data = await clip(http, img, prompt, f"bf_cut_{gid}_{w}.png", seconds)
            with tempfile.TemporaryDirectory() as td:
                raw = Path(td) / "raw.mp4"
                raw.write_bytes(data)
                finish(raw, assets / f"cutscene_{w}.mp4")
            cover(img).save(assets / f"cutscene_{w}_source.jpg", quality=88)
            man[f"cutscene_{w}"] = {"kind": "cutscene", "file": f"cutscene_{w}.mp4", "when": w, "model": "LTX-2.5",
                                    "source": f"cutscene_{w}_source.jpg", "prompt": prompt}
            made.append(w)
            print(f"[{w}] {assets / f'cutscene_{w}.mp4'}  ({time.time() - t0:.0f} s)", flush=True)
    man_p.write_text(json.dumps(man, indent=1), encoding="utf-8")
    stages = [s for s in about.get("post_stages", []) if s.get("stage") != "cutscenes"]
    stages.append({"stage": "cutscenes", "model": "LTX-2.5", "run": "uniform pipeline stage after build",
                   "clips": made, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    about["post_stages"] = stages
    about_p.write_text(json.dumps(about, indent=1), encoding="utf-8")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--id", required=True)
    ap.add_argument("--when", default="intro,win,lose")
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--dry-run", action="store_true", help="only write the source frames and print the prompts")
    a = ap.parse_args()
    whens = [w for w in a.when.split(",") if w in ("intro", "win", "lose")]
    if not shutil.which("ffmpeg"):
        print("ffmpeg is required")
        return 1
    return asyncio.run(run(a.id, whens, a.seconds, a.dry_run))


if __name__ == "__main__":
    sys.exit(main())
