"""Cut the <=2 minute submission video from a finished run: everything in it is a real artifact of the run.

    python -m blocksfield.demo_video runs/<game> [--gameplay clip.mp4] [--out demo.mp4]

Sections: title -> the pitch -> the GPU timeline (dashboard timelapse) -> the concept board -> the build as the model
saw it (Studio captures, in order) -> the finished game (gameplay clip, else the last captures) -> the creator kit
(thumbnail, icon, trailer) -> the model list.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
BG = (13, 15, 20)
ACCENT = (255, 177, 61)
FONT_DIRS = [Path("C:/Windows/Fonts")]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        for d in FONT_DIRS:
            if (d / name).exists():
                return ImageFont.truetype(str(d / name), size)
    return ImageFont.load_default()


def fit(img: Image.Image) -> Image.Image:
    """Letterbox any image into the 1920x1080 frame over a blurred copy of itself."""
    img = img.convert("RGB")
    bg = img.resize((W, H)).filter(ImageFilter.GaussianBlur(40)).point(lambda v: int(v * 0.35))
    s = min(W / img.width, H / img.height)
    fg = img.resize((int(img.width * s), int(img.height * s)), Image.LANCZOS)
    bg.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
    return bg


def caption(img: Image.Image, text: str, sub: str = "") -> Image.Image:
    img = img.copy()
    d = ImageDraw.Draw(img, "RGBA")
    d.rectangle([0, H - 150, W, H], fill=(0, 0, 0, 170))
    d.text((60, H - 132), text, font=font(46, True), fill=(255, 255, 255))
    if sub:
        d.text((60, H - 70), sub, font=font(30), fill=(200, 205, 215))
    return img


def card(title: str, lines: list[str], kicker: str = "") -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 300
    if kicker:
        d.text((140, y - 70), kicker.upper(), font=font(30, True), fill=ACCENT)
    d.text((140, y), title, font=font(92, True), fill=(255, 255, 255))
    y += 150
    for line in lines:
        for wrapped in textwrap.wrap(line, 70) or [""]:
            d.text((140, y), wrapped, font=font(40), fill=(200, 205, 215))
            y += 58
        y += 14
    return img


class Cut:
    def __init__(self, tmp: Path, ffmpeg: str) -> None:
        self.tmp, self.ff, self.parts = tmp, ffmpeg, []

    def still(self, img: Image.Image, seconds: float) -> None:
        i = len(self.parts)
        png = self.tmp / f"s{i}.png"
        img.save(png)
        out = self.tmp / f"p{i:03d}.mp4"
        subprocess.run([self.ff, "-y", "-loglevel", "error", "-loop", "1", "-t", f"{seconds}", "-i", str(png), "-vf",
                        f"fps={FPS},format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", str(out)], check=True)
        self.parts.append(out)

    def sequence(self, imgs: list[Image.Image], seconds_each: float) -> None:
        if not imgs:
            return
        i = len(self.parts)
        d = self.tmp / f"seq{i}"
        d.mkdir()
        for k, im in enumerate(imgs):
            im.save(d / f"{k:05d}.png")
        out = self.tmp / f"p{i:03d}.mp4"
        subprocess.run([self.ff, "-y", "-loglevel", "error", "-framerate", f"{1 / seconds_each}", "-i",
                        str(d / "%05d.png"), "-vf", f"fps={FPS},format=yuv420p", "-c:v", "libx264", "-preset",
                        "veryfast", str(out)], check=True)
        self.parts.append(out)

    def clip(self, path: Path, seconds: float, text: str = "") -> None:
        i = len(self.parts)
        out = self.tmp / f"p{i:03d}.mp4"
        vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p"
        if text:
            safe = text.replace(":", "\\:").replace("'", "")
            vf += (f",drawbox=y=ih-150:w=iw:h=150:color=black@0.65:t=fill,drawtext=text='{safe}':x=60:y=h-120:"
                   f"fontsize=46:fontcolor=white:fontfile='C\\:/Windows/Fonts/segoeuib.ttf'")
        subprocess.run([self.ff, "-y", "-loglevel", "error", "-i", str(path), "-t", f"{seconds}", "-an", "-vf", vf,
                        "-c:v", "libx264", "-preset", "veryfast", str(out)], check=True)
        self.parts.append(out)

    def render(self, out: Path, music: Path | None) -> None:
        lst = self.tmp / "list.txt"
        lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in self.parts), encoding="utf-8")
        silent = self.tmp / "silent.mp4"
        subprocess.run([self.ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                        str(silent)], check=True)
        if music and music.exists():
            subprocess.run([self.ff, "-y", "-loglevel", "error", "-i", str(silent), "-stream_loop", "-1", "-i",
                            str(music), "-map", "0:v", "-map", "1:a", "-af", "volume=0.6", "-c:v", "copy", "-c:a",
                            "aac", "-shortest", str(out)], check=True)
        else:
            shutil.copyfile(silent, out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--gameplay", help="an mp4 of the finished game being played")
    ap.add_argument("--out")
    a = ap.parse_args()
    run = Path(a.run_dir)
    ff = shutil.which("ffmpeg")
    idea = json.loads((run / "idea.json").read_text(encoding="utf-8"))
    mk = run / "marketing"
    caps = sorted((run / "work" / "captures").glob("*.jpg")) + sorted((run / "work" / "captures").glob("*.png"))
    caps = [p for p in sorted(caps, key=lambda p: p.name) if not p.name.startswith("_")]
    dash = sorted((run / "dashboard").glob("dash_*.png"))
    refs = sorted((run / "refs").glob("*.png"))
    with tempfile.TemporaryDirectory() as td:
        cut = Cut(Path(td), ff)
        cut.still(card("Blocksfield", ["One prompt -> a real, playable Roblox game.",
                                       "Every model open-weight. All of them on one RTX 5090."],
                       kicker="Open-source Higgsfield Games, for Roblox"), 5)
        cut.still(card(idea.get("title", "The pitch"), [idea["pitch"]], kicker="The prompt"), 6)
        if dash:
            step = max(1, len(dash) // 60)
            cut.sequence([caption(fit(Image.open(p)), "One GPU, six models, taking turns",
                                  "Qwen3.8-27B writes and judges the game; it sleeps to RAM in 4 s while Qwen-Image, "
                                  "TRELLIS.2, LTX and ACE-Step take the card") for p in dash[::step][:60]], 0.25)
        if refs:
            cut.sequence([caption(fit(Image.open(p)), "Look-dev first: a concept board",
                                  "Qwen-Image-2.1 paints the targets the build is judged against") for p in refs], 3)
        if caps:
            step = max(1, len(caps) // 80)
            cut.sequence([caption(fit(Image.open(p)), "It plays its own game in Studio",
                                  "Every piece is captured, judged by the vision model against the board, and repaired")
                          for p in caps[::step][:80]], 0.3)
        if a.gameplay:
            cut.clip(Path(a.gameplay), 25, "The finished game")
        elif caps:
            cut.sequence([caption(fit(Image.open(p)), "The finished game") for p in caps[-6:]], 2.5)
        for name, label in (("thumbnail.png", "Thumbnail, from real captures"), ("icon.png", "Icon")):
            if (mk / name).exists():
                cut.still(caption(fit(Image.open(mk / name)), label, "Qwen-Image-2.1 edit, seeded with the game"), 3.5)
        if (mk / "trailer.mp4").exists():
            cut.clip(mk / "trailer.mp4", 15, "Trailer: LTX-2.5 + ACE-Step")
        cut.still(card("All local. All open.", [
            "Qwen3.8-27B NVFP4 (vLLM)  -  game design, Luau, vision judge",
            "Qwen-Image-2.1  -  concept art, UI art, thumbnails",
            "TRELLIS.2  -  textured 3D props   |   LTX-2.5  -  trailer   |   ACE-Step 1.5  -  music",
            "ComfyUI workflows + a GPU arbiter that time-slices one RTX 5090",
            "#OpenSourceHiggsfield"], kicker="Blocksfield"), 7)
        out = Path(a.out) if a.out else run / "demo.mp4"
        music = next(iter(sorted(mk.glob("music*.mp3"))), None) if mk.exists() else None
        cut.render(out, music)
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
