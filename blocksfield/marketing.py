"""After a build: the creator kit Higgsfield is used for in Roblox videos -- thumbnail, icon and a scored trailer --
made from what the built game actually looks like (Studio captures), on the same GPU.

    python -m blocksfield.marketing runs/<game>            # all of it
    python -m blocksfield.marketing runs/<game> --only thumbnail,icon

1. The LLM (it sees images) picks the strongest captures and writes the title, tagline, the music brief and one
   camera move per shot.
2. Thumbnail (16:9) and icon (1:1): Qwen-Image-2.1 edit, seeded with real captures, title text rendered in.
3. Trailer: LTX-2.5 animates each chosen capture (image-to-video), ACE-Step scores it, ffmpeg cuts it together and
   ends on the thumbnail.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
from PIL import Image

ARBITER = os.environ.get("BLOCKSFIELD_ARBITER", "http://127.0.0.1:8100")
MODEL = os.environ.get("BLOCKSFIELD_MODEL", "cybus")

DIRECTOR = """You are the trailer director for a Roblox game that was just built. You are shown numbered screenshots
captured from the running game. Pick the {n} strongest shots for a trailer (most striking, most varied: world,
action, characters, UI moments; skip broken, empty or near-duplicate frames) in the order they should play.

Game: {title}
Pitch: {pitch}

Answer with JSON only:
{{"title": "<the game's title, 1-4 words>", "tagline": "<punchy, under 9 words>",
  "music": "<ACE-Step tags: genre, instruments, mood, tempo, e.g. 'upbeat synthwave, punchy drums, bright arps, 128 bpm'>",
  "shots": [{{"capture": <number>, "motion": "<one sentence: the camera move and what animates in this shot,
  e.g. 'slow push-in toward the glowing gate as sparks drift upward'>"}}, ...],
  "thumbnail_capture": <number>, "icon_capture": <number>}}"""


def captures(run_dir: Path) -> list[Path]:
    shots = sorted([p for ext in ("*.png", "*.jpg") for p in (run_dir / "work" / "captures").rglob(ext)],
                   key=lambda p: p.stat().st_mtime)            # captures are saved as JPEG
    good = []
    for p in shots:
        try:
            with Image.open(p) as im:
                if im.width >= 640 and im.height >= 360:
                    good.append(p)
        except OSError:
            pass
    return good[-60:]                       # the latest ones show the finished game


def b64_png(path: Path, max_side: int = 768) -> str:
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


async def direct(http: httpx.AsyncClient, run_dir: Path, shots: list[Path], n: int) -> dict:
    idea = json.loads((run_dir / "idea.json").read_text(encoding="utf-8")) if (run_dir / "idea.json").exists() else {}
    pick = shots if len(shots) <= 16 else [shots[round(i * (len(shots) - 1) / 15)] for i in range(16)]
    content = [{"type": "text", "text": DIRECTOR.format(n=n, title=idea.get("title", ""), pitch=idea.get("pitch", ""))}]
    for i, p in enumerate(pick, 1):
        content += [{"type": "text", "text": f"Screenshot {i}:"},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_png(p)}"}}]
    r = await http.post(f"{ARBITER}/v1/chat/completions", json={
        "model": MODEL, "messages": [{"role": "user", "content": content}], "max_tokens": 2000,
        "temperature": 0.4, "chat_template_kwargs": {"enable_thinking": False}})
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"]
    plan = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
    def at(k: int) -> Path:
        return pick[max(0, min(len(pick) - 1, int(k) - 1))]
    plan["shot_paths"] = [str(at(s["capture"])) for s in plan.get("shots", [])][:n]
    plan["thumbnail_path"] = str(at(plan.get("thumbnail_capture", 1)))
    plan["icon_path"] = str(at(plan.get("icon_capture", 1)))
    return plan


async def upload(http: httpx.AsyncClient, path: Path, name: str) -> str:
    with Image.open(path) as im:
        im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, "PNG")
    r = await http.post(f"{ARBITER}/upload", json={"filename": name, "b64": base64.b64encode(buf.getvalue()).decode()})
    r.raise_for_status()
    return r.json().get("name", name)


async def job(http: httpx.AsyncClient, workflow: str, **params) -> list[dict]:
    r = await http.post(f"{ARBITER}/job", json={"workflow": workflow, "params": params})
    if r.status_code >= 400:
        raise RuntimeError(f"{workflow}: {r.text[:500]}")
    return r.json()["files"]


def save_first(files: list[dict], exts: tuple[str, ...], out: Path) -> Path | None:
    f = next((f for f in files if f["filename"].lower().endswith(exts)), None)
    if f is None:
        return None
    out.write_bytes(base64.b64decode(f["b64"]))
    return out


async def thumbnail_and_icon(http, plan: dict, out: Path, ref_a: str, ref_b: str) -> None:
    title, tag = plan["title"], plan.get("tagline", "")
    files = await job(http, "edit", image_1=ref_a, image_2=ref_b, width=2752, height=1536, prompt=(
        f"A high-energy Roblox game thumbnail for the game \"{title}\". Recompose the scene from the reference "
        f"screenshots into one dramatic hero shot with a strong focal point, saturated colours and cinematic "
        f"lighting, keeping the exact Roblox art style, characters and world of the references. Huge bold 3D "
        f"title text reading \"{title.upper()}\" with a thick dark outline and glow, spelled exactly. "
        f"No other text, no watermark, no user interface."))
    p = save_first(files, (".png",), out / "thumbnail_2k.png")
    if p:
        with Image.open(p) as im:
            im.convert("RGB").resize((1920, 1080), Image.LANCZOS).save(out / "thumbnail.png")
    files = await job(http, "edit", image_1=ref_b, image_2=ref_a, width=2048, height=2048, prompt=(
        f"A Roblox game icon for \"{title}\": one iconic subject from the reference screenshots, close-up, filling "
        f"the square frame, bold readable silhouette, vivid colours, glossy Roblox 3D render style, simple bright "
        f"background. No text, no border, no user interface."))
    p = save_first(files, (".png",), out / "icon_2k.png")
    if p:
        with Image.open(p) as im:
            im.convert("RGB").resize((512, 512), Image.LANCZOS).save(out / "icon.png")


async def trailer(http, plan: dict, out: Path, seconds: float = 4.0) -> Path | None:
    ffmpeg = shutil.which("ffmpeg")
    clips = []
    for i, (path, shot) in enumerate(zip(plan["shot_paths"], plan["shots"])):
        name = await upload(http, Path(path), f"bf_shot_{out.parent.name}_{i}.png")
        files = await job(http, "trailer_clip", image=name, seconds=seconds, prompt=(
            f"{shot['motion']}. A Roblox game, smooth cinematic camera, stylised 3D, vivid colours, no text."))
        clip = save_first(files, (".mp4", ".webm", ".mov"), out / f"clip_{i:02d}.mp4")
        if clip:
            clips.append(clip)
    music = None
    try:
        files = await job(http, "music", tags=plan.get("music", "epic upbeat game trailer music"),
                          seconds=max(20, int(len(clips) * seconds + 6)))
        music = save_first(files, (".mp3", ".flac", ".wav", ".ogg"), out / "music.mp3")
    except Exception as e:  # noqa: BLE001
        print("music failed:", e)
    if not clips or not ffmpeg:
        return None
    end_card = out / "thumbnail.png"
    with tempfile.TemporaryDirectory() as d:
        parts = []
        for i, c in enumerate(clips):           # normalise every clip: 1280x720, 30 fps, no audio
            p = Path(d) / f"p{i}.mp4"
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(c), "-an", "-vf",
                            "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(p)], check=True)
            parts.append(p)
        if end_card.exists():
            p = Path(d) / "end.mp4"
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-loop", "1", "-t", "3", "-i", str(end_card), "-vf",
                            "scale=1280:720,fps=30,fade=t=in:st=0:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                            str(p)], check=True)
            parts.append(p)
        lst = Path(d) / "list.txt"
        lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
        silent = Path(d) / "silent.mp4"
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-c", "copy", str(silent)], check=True)
        final = out / "trailer.mp4"
        if music:
            total = len(clips) * seconds + (3 if end_card.exists() else 0)
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(silent), "-i", str(music), "-map", "0:v",
                            "-map", "1:a", "-af", f"afade=t=out:st={max(0, total - 2):.1f}:d=2", "-c:v", "copy",
                            "-c:a", "aac", "-shortest", str(final)], check=True)
        else:
            shutil.copyfile(silent, final)
    return final


async def main_async(run_dir: Path, only: set[str], shots: int) -> None:
    out = run_dir / "marketing"
    out.mkdir(exist_ok=True)
    caps = captures(run_dir)
    if not caps:
        raise SystemExit(f"no captures under {run_dir}/work/captures")
    async with httpx.AsyncClient(timeout=3600) as http:
        plan_path = out / "plan.json"
        plan = json.loads(plan_path.read_text(encoding="utf-8")) if plan_path.exists() else await direct(http, run_dir, caps, shots)
        plan_path.write_text(json.dumps(plan, indent=1), encoding="utf-8")
        print("plan:", plan["title"], "|", plan.get("tagline"), "|", len(plan["shot_paths"]), "shots")
        if not only or only & {"thumbnail", "icon"}:
            a = await upload(http, Path(plan["thumbnail_path"]), f"bf_thumb_{run_dir.name}.png")
            b = await upload(http, Path(plan["icon_path"]), f"bf_icon_{run_dir.name}.png")
            await thumbnail_and_icon(http, plan, out, a, b)
            print("thumbnail + icon:", out)
        if not only or "trailer" in only:
            print("trailer:", await trailer(http, plan, out))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--only", default="", help="comma list: thumbnail,icon,trailer")
    ap.add_argument("--shots", type=int, default=6)
    a = ap.parse_args()
    asyncio.run(main_async(Path(a.run_dir), set(filter(None, a.only.split(","))), a.shots))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
