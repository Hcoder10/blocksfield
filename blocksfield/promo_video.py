"""The hackathon promo cut (2:00-2:30): the paid creator workflow, its price, then the same workflow run locally.

    python -m blocksfield.promo_video --run runs/starbloom_kits --out video/promo_draft.mp4

Also writes <out stem>_nomusic.mp4 (creator audio only), promo_timing.md (each section's start/end and on-screen text,
for writing the voiceover) and <out stem>_sheet.jpg (one frame every 5 s). Sections:

1. cold open: why it is new (default), or with --creators the Higgsfield-sponsored creator clips from video/source
2. price card: Higgsfield plans vs Blocksfield (figures from NOTES.md only)
3. the pipeline: pitch -> concept board -> GPU timeline -> Studio look loop -> generated art -> Idol props -> kits -> models
4. the game: video/game_footage/ (mp4 clips and/or stills, by name), else the run's latest Studio captures
5. close

Every frame is drawn in PIL and piped to one ffmpeg encode; video sources are decoded through ffmpeg pipes.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
VIDEO = ROOT / "video"
SOURCE = VIDEO / "source"
FOOTAGE = VIDEO / "game_footage"
BUILD = VIDEO / "build"
KITDEMO = ROOT / "runs" / "_kitdemo"
IDOL_EXTRA = SOURCE / "idol"            # Idol previews from the prop experiments (copied out of a scratch dir)

REPO_URL = "github.com/Hcoder10/blocksfield"
HASHTAG = "#OpenSourceHiggsfield"

W, H, FPS = 1920, 1080, 30
BG = (11, 13, 18)
FG = (244, 246, 250)
MUTED = (156, 164, 180)
ACCENT = (255, 184, 64)
PANEL = (22, 26, 34)

# Creator clips (video/source/NOTES.md). Trims and caption times come from word timestamps (faster-whisper base.en,
# checked against the NOTES transcripts); caption times are relative to the start of each piece.
COLE = ("Cole  ·  @ColeMNTY on YouTube", "Sponsored by Higgsfield, disclosed in the video")
FAYYAZ = ("Fayyaz Ahmed  ·  @f4fayyax on YouTube", "Higgsfield affiliate link, disclosed in the description")
CLIPS = [
    ("clip_01_colemnty.mp4", 1.80, 9.55, COLE, [
        (0.05, 2.66, "We need to do something about this cover, because nobody's clicking on this"),
        (2.66, 5.20, "and I'd love to add in a little trailer too, because I think that'd be insane."),
        (5.60, 7.75, "And that's where today's sponsor comes in: Higgsfield."),
    ]),
    ("clip_02_colemnty_trailer.mp4", 0.25, 2.20, COLE, [
        (0.10, 1.95, "Bro, that trailer was actually insane."),
    ]),
    ("clip_02_colemnty_trailer.mp4", 8.92, 14.90, COLE, [
        (0.05, 3.04, "I didn't even open the game. This thing screen-recorded it, put it all together,"),
        (3.04, 5.98, "made it cinematic, added in the music. My mind is blown."),
    ]),
    ("clip_05_f4fayyax_higgsfield.mp4", 0.80, 5.50, FAYYAZ, [
        (0.10, 2.40, "Now go to Higgsfield, click on Image"),
        (2.40, 4.70, "and then select Create Image."),
    ]),
]

# Kit showcase stills in runs/_kitdemo (full Studio window screenshots; KIT_VIEWPORT crops to the game view).
KIT_VIEWPORT = (8, 280, 1971, 1384)
KIT_SHOTS = [
    ("LookKit", [0, 2, 3, 5, 8, 9, 11, 13], 0.55, "LookKit", "One call sets the art direction: toon, neon, candy, dark fantasy…"),
    ("WorldKit2", [6, 7, 8, 13, 16, 19], 0.75, "WorldKit2", "Sculpted islands, peaks, race tracks, N64-style courses"),
    ("UIKit", [0, 4, 6, 8], 0.9, "UIKit", "Animated, themed HUD and menus"),
]

MODELS = [
    ("Qwen3.8-27B NVFP4", "game design, Luau code, vision judge"),
    ("Qwen-Image-2.1", "concept art, UI art, icons, textures, skyboxes"),
    ("BiRefNet", "cut-outs for icons and UI art"),
    ("TRELLIS.2", "textured 3D props"),
    ("Idol", "image to Gaussian splat to Roblox Parts"),
    ("ACE-Step 1.5", "music"),
    ("Stable Audio 3", "sound effects"),
]
TRAILER_MODEL = ("LTX-2.5", "trailer shots from gameplay captures")


# ---------------------------------------------------------------- drawing helpers

_fonts: dict = {}


def font(size: int, weight: str = "Semibold") -> ImageFont.FreeTypeFont:
    """Segoe UI Variable Display at a named weight (Light/Semilight/Regular/Semibold/Bold)."""
    key = (size, weight)
    if key not in _fonts:
        var = Path("C:/Windows/Fonts/SegUIVar.ttf")
        if var.exists():
            f = ImageFont.truetype(str(var), size)
            f.set_variation_by_name(f"{weight} Display")
        else:
            f = ImageFont.truetype("segoeuib.ttf" if weight in ("Semibold", "Bold") else "segoeui.ttf", size)
        _fonts[key] = f
    return _fonts[key]


def ease(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def ramp(t: float, start: float, dur: float = 0.45) -> float:
    return ease((t - start) / dur) if dur > 0 else float(t >= start)


def rgba(c: tuple, a: float) -> tuple:
    return (*c[:3], int(255 * max(0.0, min(1.0, a))))


def text(d: ImageDraw.ImageDraw, xy, s: str, f, color=FG, alpha=1.0, anchor="la", tracking: float = 0,
         stroke: int = 0):
    if alpha <= 0:
        return
    if not tracking:
        d.text(xy, s, font=f, fill=rgba(color, alpha), anchor=anchor, stroke_width=stroke,
               stroke_fill=(0, 0, 0, int(160 * alpha)))
        return
    x, y = xy
    if anchor[0] == "r":
        x -= tracked_width(s, f, tracking)
    for ch in s:
        d.text((x, y), ch, font=f, fill=rgba(color, alpha), anchor="l" + anchor[1])
        x += f.getlength(ch) + tracking


def tracked_width(s: str, f, tracking: float) -> float:
    return sum(f.getlength(ch) + tracking for ch in s) - tracking


def kicker(d, xy, s: str, alpha=1.0, size=26, color=ACCENT, anchor="la"):
    text(d, xy, s.upper(), font(size, "Bold"), color, alpha, anchor=anchor, tracking=size * 0.14)


def wrap(s: str, f, width: float) -> list[str]:
    lines, cur = [], ""
    for word in s.split():
        trial = f"{cur} {word}".strip()
        if f.getlength(trial) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    return lines + ([cur] if cur else [])


def balanced(s: str, f, width: float) -> list[str]:
    """Wrap to as few lines as `wrap`, but with even line lengths (no one-word last line)."""
    lines = wrap(s, f, width)
    if len(lines) != 2:
        return lines
    words = s.split()
    best = min(range(1, len(words)), key=lambda k: max(f.getlength(" ".join(words[:k])),
                                                       f.getlength(" ".join(words[k:]))))
    return [" ".join(words[:best]), " ".join(words[best:])]


def canvas(color=BG) -> Image.Image:
    return Image.new("RGBA", (W, H), (*color, 255))


def cover(img: Image.Image, w: int = W, h: int = H, margin: float = 1.0) -> Image.Image:
    """Scale to cover w x h (times margin, the head-room Ken Burns pans into)."""
    img = img.convert("RGB")
    s = max(w / img.width, h / img.height) * margin
    return img.resize((max(w, round(img.width * s)), max(h, round(img.height * s))), Image.LANCZOS)


def contain(img: Image.Image, w: int, h: int) -> Image.Image:
    s = min(w / img.width, h / img.height)
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


def kenburns(big: Image.Image, u: float, zoom=(1.0, 1.08), pan=(0.0, 0.0), w: int = W, h: int = H) -> Image.Image:
    """A w x h view of `big` at progress u in [0, 1]: zoom in (or out) and drift by pan (fractions of the slack)."""
    u = 0.5 - 0.5 * math.cos(math.pi * min(1.0, max(0.0, u)))
    z = zoom[0] + (zoom[1] - zoom[0]) * u
    base = min(big.width / w, big.height / h)
    cw, ch = w * base / z, h * base / z
    cx = big.width / 2 + pan[0] * (big.width - cw) / 2 * (2 * u - 1)
    cy = big.height / 2 + pan[1] * (big.height - ch) / 2 * (2 * u - 1)
    box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
    return big.resize((w, h), Image.BILINEAR, box=box).convert("RGBA")


_shades: dict = {}


def shade(top: int, strength=0.88, bottom=True) -> Image.Image:
    """A full-frame RGBA gradient darkening the bottom (or top) `top` pixels, for text over footage."""
    key = (top, strength, bottom)
    if key not in _shades:
        g = Image.new("L", (1, top))
        g.putdata([int(255 * strength * ((i / (top - 1)) ** 1.6 if bottom else (1 - i / (top - 1)) ** 1.6))
                   for i in range(top)])
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        black = Image.new("RGBA", (W, top), (0, 0, 0, 255))
        black.putalpha(g.resize((W, top)))
        layer.paste(black, (0, H - top if bottom else 0))
        _shades[key] = layer
    return _shades[key]


def caption(frame: Image.Image, t: float, k: str, headline: str, sub: str = "", right: str = "", intro=True):
    """The pipeline's caption: accent kicker + headline (+ sub) on a bottom gradient."""
    frame.alpha_composite(shade(340))
    d = ImageDraw.Draw(frame, "RGBA")
    a1, a2 = (ramp(t, 0.05), ramp(t, 0.18)) if intro else (1, 1)
    y = H - (176 if sub else 136)
    kicker(d, (96, y), k, a1)
    text(d, (96 - 12 * (1 - a2), y + 40), headline, font(50, "Semibold"), FG, a2)
    if sub:
        text(d, (96, y + 106), sub, font(30, "Regular"), MUTED, a2)
    if right:
        kicker(d, (W - 96, y), right, a1, color=MUTED, anchor="ra")


def load(p: Path) -> Image.Image:
    img = Image.open(p)
    img.load()
    if p.parent.parent.name == "_kitdemo" and img.size == (2560, 1494):
        img = img.crop(KIT_VIEWPORT)
    return img


# ---------------------------------------------------------------- video sources

class VideoReader:
    """Sequential RGB frames of [start, start + dur) of a video, scaled to cover the frame."""

    def __init__(self, path: Path, start: float, dur: float) -> None:
        self.n = 0
        self.last: Image.Image | None = None
        self.proc = subprocess.Popen(
            ["ffmpeg", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", str(path), "-t", f"{dur:.3f}", "-an",
             "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS}",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def frame(self, i: int) -> Image.Image:
        while self.n <= i:
            buf = self.proc.stdout.read(W * H * 3)
            if len(buf) < W * H * 3:
                break
            self.last = Image.frombytes("RGB", (W, H), buf)
            self.n += 1
        return (self.last or Image.new("RGB", (W, H), BG)).convert("RGBA")

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()                   # stopped early: the decoder would only complain about the pipe
        self.proc.stdout.close()
        self.proc.wait()


def probe(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json",
                        str(path)], capture_output=True, text=True)
    j = json.loads(r.stdout or "{}")
    return {"dur": float(j.get("format", {}).get("duration", 0) or 0),
            "audio": any(s.get("codec_type") == "audio" for s in j.get("streams", []))}


_lufs: dict = {}


def lufs(path: Path) -> float:
    if path not in _lufs:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                           capture_output=True, text=True)
        m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
        _lufs[path] = float(m[-1]) if m else -20.0
    return _lufs[path]


# ---------------------------------------------------------------- the timeline

@dataclass
class Seg:
    section: str
    label: str
    dur: float
    draw: Callable[[float, int], Image.Image]      # (local seconds, local frame index) -> RGBA frame
    onscreen: list[str] = field(default_factory=list)
    audio: list[tuple] = field(default_factory=list)  # (path, src_in, src_out, offset_in_seg, gain_db)
    fade_in: float = 0.0
    fade_out: float = 0.0
    setup: Callable[[], None] | None = None
    teardown: Callable[[], None] | None = None


def creator_clip(name: str, t_in: float, t_out: float, credit, caps, opening: bool, new_credit: bool) -> Seg:
    path = SOURCE / name
    dur = t_out - t_in
    st: dict = {}

    def setup():
        st["r"] = VideoReader(path, t_in, dur)

    def draw(t, i):
        f = st["r"].frame(i)
        f.alpha_composite(shade(420, 0.8))
        f.alpha_composite(shade(180, 0.55, bottom=False))
        d = ImageDraw.Draw(f, "RGBA")
        k = ramp(t, 0.15) if opening else 1.0
        kw = tracked_width("THE PAID WORKFLOW", font(26, "Bold"), 26 * 0.14)
        d.rounded_rectangle([76, 60, 116 + kw, 108], 24, fill=(8, 10, 14, int(200 * k)))
        kicker(d, (96, 85), "The paid workflow", k, anchor="lm")
        # credit: a dark panel with an accent bar, the creator and how the sponsorship is disclosed
        a = ramp(t, 0.15) if new_credit else 1.0
        x, y = 96 - 16 * (1 - a), H - 270
        pw = max(font(36, "Semibold").getlength(credit[0]), font(28, "Regular").getlength(credit[1])) + 64
        d.rounded_rectangle([x, y, x + pw, y + 104], 14, fill=(8, 10, 14, int(205 * a)))
        d.rectangle([x, y + 14, x + 6, y + 90], fill=rgba(ACCENT, a))
        text(d, (x + 30, y + 10), credit[0], font(36, "Semibold"), FG, a)
        text(d, (x + 30, y + 58), credit[1], font(28, "Regular"), (205, 210, 220), a)
        for c0, c1, s in caps:
            if c0 <= t < c1:
                ca = min(1.0, (t - c0) / 0.12, (c1 - t) / 0.12 if c1 < dur - 0.05 else 1.0)
                for k, line in enumerate(balanced(s, font(44, "Semibold"), 1500)[::-1]):
                    text(d, (W // 2, H - 84 - k * 56), line, font(44, "Semibold"), FG, ca, anchor="ms", stroke=2)
        return f

    onscreen = (["THE PAID WORKFLOW"] if opening else []) + ([f"Credit: {credit[0]} / {credit[1]}"] if new_credit else [])
    onscreen += [f'Caption: "{s}"' for _, _, s in caps]
    gain = -16.0 - lufs(path)
    return Seg("1. Cold open", f"{name} {t_in:.2f}-{t_out:.2f} s", dur, draw, onscreen,
               audio=[(path, t_in, t_out, 0.0, gain)], setup=setup, teardown=lambda: st["r"].close(),
               fade_in=0.25 if opening else 0.0)


def price_card() -> Seg:
    plans = [("Starter", "$19", "270 credits"), ("Plus", "$59", "1,200 credits"), ("Ultra", "$129", "3,000 credits")]
    reveal = 4.6

    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (140, 104), "What the paid workflow costs", ramp(t, 0.0))
        text(d, (140, 150), "Higgsfield", font(66, "Bold"), FG, ramp(t, 0.1))
        y = 290
        for k, (name, price, credits) in enumerate(plans):
            a = ramp(t, 0.35 + 0.18 * k)
            text(d, (140, y), name, font(40, "Semibold"), FG, a)
            text(d, (400, y), price, font(40, "Semibold"), FG, a)
            text(d, (520, y + 6), "/ month", font(30, "Regular"), MUTED, a)
            text(d, (690, y + 6), credits, font(30, "Regular"), MUTED, a)
            y += 72
        a = ramp(t, 1.4)
        d.line([140, y + 18, 900, y + 18], fill=rgba((60, 66, 80), a), width=2)
        y += 52
        for s in ["A game build starts at ~70 credits.",
                  "One game + thumbnail + two 1080p trailers:",
                  "~806 credits, about 67% of a Plus month."]:
            text(d, (140, y), s, font(34, "Regular"), (215, 220, 230), a)
            y += 50
        # Blocksfield column
        b = ramp(t, reveal, 0.6)
        d.line([1010, 150, 1010, 860], fill=rgba((48, 54, 68), b), width=2)
        x = 1100 + 30 * (1 - b)
        text(d, (x, 150), "Blocksfield", font(66, "Bold"), ACCENT, b)
        text(d, (x - 8, 250), "$0", font(250, "Bold"), FG, b)
        text(d, (x, 540), "per generation", font(46, "Semibold"), FG, b)
        b2 = ramp(t, reveal + 0.5, 0.6)
        text(d, (x, 640), "Open-weight models, no credits.", font(36, "Regular"), (215, 220, 230), b2)
        text(d, (x, 692), "One rented RTX 5090 at $0.68/hr.", font(36, "Regular"), (215, 220, 230), b2)
        text(d, (140, H - 92), "Prices from higgsfield.ai/pricing, Oct 30 2026, excl. VAT.  Trailer workflow is an "
             "estimate: 1 game + 8 images + two 30 s Seedance 2.0 1080p trailers, at the page's credit rates.",
             font(22, "Regular"), (120, 128, 144), ramp(t, 0.6))
        return f

    return Seg("2. Price", "price card", 11.0, draw, [
        "WHAT THE PAID WORKFLOW COSTS / Higgsfield: Starter $19/month 270 credits; Plus $59/month 1,200 credits; "
        "Ultra $129/month 3,000 credits",
        "A game build starts at ~70 credits. One game + thumbnail + two 1080p trailers: ~806 credits, about 67% of a "
        "Plus month.",
        f"(at {reveal:.1f} s) Blocksfield: $0 per generation. Open-weight models, no credits. One rented RTX 5090 at "
        "$0.68/hr.",
        "Small print: Prices from higgsfield.ai/pricing, Oct 30 2026, excl. VAT. Trailer workflow is an estimate."],
        fade_in=0.2, fade_out=0.2)


def why_card() -> Seg:
    """The submission's cold open (the contest bars unlicensed likenesses, so no creator clips): why it is new."""
    points = [
        ("Pitch in, a real Roblox place out.", "Not a cover or a trailer of a game: the game itself, playable."),
        ("It builds in Roblox Studio and looks at its own work.", "Surveys the world from any camera, judges it "
         "against its concept art, fixes it."),
        ("ComfyUI makes everything it sees.", "Concept art, icons, skies, props as Roblox Parts, music, sound."),
        ("Every model open-weight, on one RTX 5090.", "The LLM sleeps to host RAM while ComfyUI takes the card."),
    ]

    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (140, 150), "Why this is new", ramp(t, 0.0))
        text(d, (140, 196), "Higgsfield's Roblox workflow makes the cover and the trailer.", font(54, "Bold"), FG,
             ramp(t, 0.15))
        text(d, (140, 266), "Blocksfield makes the game.", font(54, "Bold"), ACCENT, ramp(t, 0.9))
        y = 420
        for k, (head, sub) in enumerate(points):
            a = ramp(t, 1.6 + 0.7 * k)
            d.rectangle([140, y + 8, 148, y + 92], fill=rgba(ACCENT, a))
            text(d, (180 + 20 * (1 - a), y), head, font(42, "Semibold"), FG, a)
            text(d, (180 + 20 * (1 - a), y + 56), sub, font(30, "Regular"), (190, 196, 210), a)
            y += 140
        return f

    return Seg("1. Why it's new", "why card", 9.0, draw, [
        "WHY THIS IS NEW / Higgsfield's Roblox workflow makes the cover and the trailer. Blocksfield makes the game."]
        + [f"{h} {s}" for h, s in points], fade_in=0.3, fade_out=0.2)


def title_card() -> Seg:
    lines = [("Same workflow.", FG), ("Fully local.", FG), ("One GPU.", ACCENT)]

    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (140, 300), "Blocksfield", ramp(t, 0.0))
        for k, (s, c) in enumerate(lines):
            a = ramp(t, 0.15 + 0.45 * k, 0.5)
            text(d, (140, 350 + k * 132 + 20 * (1 - a)), s, font(118, "Bold"), c, a)
        return f

    return Seg("3. Pipeline", "section title", 3.6, draw, ["BLOCKSFIELD / Same workflow. Fully local. One GPU."],
               fade_in=0.2)


def pitch_card(idea: dict) -> Seg:
    pitch = idea.get("pitch", "")
    title = idea.get("title", "")
    if title and pitch.startswith(title + ":"):
        pitch = pitch[len(title) + 1:].strip()
    f_body = font(40, "Regular")
    lines = wrap(pitch, f_body, 1560)
    total = sum(len(s) for s in lines)

    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (140, 190), "Step 1  ·  The pitch", ramp(t, 0.0))
        text(d, (140, 236), title, font(84, "Bold"), FG, ramp(t, 0.1))
        shown = int(total * min(1.0, max(0.0, (t - 0.4) / 2.6)))
        y = 380
        for s in lines:
            text(d, (140, y), s[:max(0, shown)], f_body, (215, 220, 230))
            shown -= len(s)
            y += 58
        text(d, (140, y + 40), "One prompt in. A real Roblox place out.", font(34, "Semibold"), ACCENT, ramp(t, 3.2))
        return f

    return Seg("3. Pipeline", "pitch", 5.4, draw, [f"STEP 1 · THE PITCH / {title}", f"(typed) {pitch}",
                                                  "One prompt in. A real Roblox place out."], fade_in=0.15)


def stills(section: str, label: str, imgs: list[Image.Image], each: float, k: str, headline: str, sub: str = "",
           zoom=(1.0, 1.07), counter: bool = False) -> Seg:
    bigs = [cover(im, margin=1.0) for im in imgs]
    pans = [(0.6, 0.2), (-0.6, 0.0), (0.0, -0.5), (0.5, 0.4), (-0.4, -0.3)]

    def draw(t, i):
        n = min(len(bigs) - 1, int(t / each))
        u = (t - n * each) / each
        f = kenburns(bigs[n], u, zoom, pans[n % len(pans)])
        caption(f, t, k, headline, sub, f"{n + 1:02d} / {len(bigs):02d}" if counter else "")
        return f

    return Seg(section, label, each * len(bigs), draw, [f"{k.upper()} / {headline}" + (f" / {sub}" if sub else "")])


def dashboard(run: Path, dur: float) -> Seg | None:
    frames = sorted((run / "dashboard").glob("dash_*.png"))
    if len(frames) < 10:
        return None
    first = Image.open(frames[0]).convert("RGB")
    bgc = first.getpixel((8, first.height - 8))
    st: dict = {}

    def draw(t, i):
        k = min(len(frames) - 1, int(t / dur * len(frames)))
        if st.get("k") != k:
            img = Image.open(frames[k]).convert("RGB").crop((0, 0, 1920, 830))
            st["k"], st["img"] = k, img
        f = canvas(bgc)
        z = 1.0 + 0.04 * ease(t / dur)
        img = st["img"]
        f.paste(img.resize((round(W * z), round(830 * z)), Image.BILINEAR).crop((0, 0, W, 830)), (0, 30))
        caption(f, t, "Step 3  ·  One GPU, taking turns",
                "The LLM writes and judges; ComfyUI paints, models and scores",
                "Qwen3.8-27B sleeps to host RAM in seconds while the art models take the card.",
                right=f"{len(frames) // 2} min of the live dashboard")
        return f

    return Seg("3. Pipeline", "GPU dashboard timelapse", dur, draw, [
        "STEP 3 · ONE GPU, TAKING TURNS / The LLM writes and judges; ComfyUI paints, models and scores",
        "Qwen3.8-27B sleeps to host RAM in seconds while the art models take the card.",
        "(footage: live arbiter dashboard, one screenshot every 30 s)"])


def look_passes(run: Path) -> list[tuple[str, list[Path]]]:
    """Studio survey captures grouped per look pass: [(label, [player, overview, side, top])], in run order."""
    dirs = sorted(run.glob("work.attempt*/captures"), key=lambda p: int(re.sub(r"\D", "", p.parent.name) or 0))
    dirs.append(run / "work" / "captures")
    passes = []
    for d in dirs:
        groups: dict = {}
        for p in sorted(d.glob("*_look*_*.jpg")):
            m = re.match(r"\d+_.*?_(look\d+)_(player|overview|side|top)_", p.name)
            if m:
                groups.setdefault(m.group(1), []).append(p)
        # a look name can recur later in the same folder (look1 again after a rebuild): split on index gaps
        for key in groups:
            run_of: list[Path] = []
            for p in groups[key]:
                if run_of and int(p.name[:4]) - int(run_of[-1].name[:4]) > 1:
                    passes.append((key, run_of))
                    run_of = []
                run_of.append(p)
            passes.append((key, run_of))
    passes = [(k, ps[:4]) for k, ps in passes if len(ps) >= 3]
    passes.sort(key=lambda kp: (dirs.index(kp[1][0].parent), kp[1][0].name))
    return passes


def look_loop(run: Path, each: float = 0.85, most: int = 14) -> Seg | None:
    passes = look_passes(run)
    if not passes:
        return None
    if len(passes) > most:                     # a long run: an even sample that keeps the first and the last pass
        passes = [passes[round(k * (len(passes) - 1) / (most - 1))] for k in range(most)]
    tw, th, gap = 760, 428, 14
    x0, y0 = (W - 2 * tw - gap) // 2, 34
    grids = []
    for _, paths in passes:
        g = canvas()
        for k, p in enumerate(paths):
            tile = cover(Image.open(p), tw, th).crop((0, 0, tw, th))
            g.paste(tile, (x0 + (k % 2) * (tw + gap), y0 + (k // 2) * (th + gap)))
            view = re.search(r"_(player|overview|side|top|hub_view)_", p.name).group(1).replace("_", " ")
            dd = ImageDraw.Draw(g, "RGBA")
            px, py = x0 + (k % 2) * (tw + gap) + 14, y0 + (k // 2) * (th + gap) + th - 46
            dd.rounded_rectangle([px, py, px + font(22, "Semibold").getlength(view) + 24, py + 34], 8,
                                 fill=(0, 0, 0, 150))
            text(dd, (px + 12, py + 4), view, font(22, "Semibold"), FG)
        grids.append(g)

    def draw(t, i):
        n = min(len(grids) - 1, int(t / each))
        f = grids[n].copy()
        caption(f, t, "Step 4  ·  It looks at its own world",
                "Builds in Roblox Studio, surveys it from four cameras, judges, rebuilds",
                right=f"pass {n + 1:02d} / {len(grids):02d}")
        return f

    return Seg("3. Pipeline", f"Studio look loop ({len(grids)} passes)", each * len(grids), draw, [
        "STEP 4 · IT LOOKS AT ITS OWN WORLD / Builds in Roblox Studio, surveys it from four cameras, judges, rebuilds",
        f"(2x2 grids of player / overview / side / top captures, one per pass, {len(grids)} passes)"])


def usable_art(p: Path) -> bool:
    try:
        im = Image.open(p)
        if max(im.size) < 200 or min(im.size) < 96:
            return False
        rgb = im.convert("RGBA")
        small = rgb.resize((32, 32))
        px = [c for c in small.getdata() if c[3] > 40]
        if len(px) < 60:
            return False
        lum = [0.3 * r + 0.59 * g + 0.11 * b for r, g, b, _ in px]
        mean = sum(lum) / len(lum)
        return (sum((v - mean) ** 2 for v in lum) / len(lum)) ** 0.5 > 18 and mean < 235
    except Exception:
        return False


def art_grid(arts: list[Image.Image], dur: float = 6.0) -> Seg | None:
    if len(arts) < 4:
        return None
    arts = arts[:12]
    cols = min(6, max(3, (len(arts) + 1) // 2))
    rows = (len(arts) + cols - 1) // cols
    ts, gap = 250, 26
    x0 = (W - cols * ts - (cols - 1) * gap) // 2
    y0 = 130 + (2 - rows) * (ts + gap) // 2
    tiles = []
    for im in arts:
        im = im.convert("RGBA")
        tile = Image.new("RGBA", (ts, ts), (*PANEL, 255))
        fit = contain(im, ts - 36, ts - 36)
        tile.alpha_composite(fit, ((ts - fit.width) // 2, (ts - fit.height) // 2))
        mask = Image.new("L", (ts, ts), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, ts - 1, ts - 1], 22, fill=255)
        tile.putalpha(mask)
        tiles.append(tile)

    def draw(t, i):
        f = canvas()
        for k, tile in enumerate(tiles):
            a = ramp(t, 0.1 + 0.07 * k, 0.4)
            if a <= 0:
                continue
            s = 0.9 + 0.1 * a
            tl = tile.resize((round(ts * s), round(ts * s)), Image.BILINEAR)
            tl.putalpha(tl.getchannel("A").point(lambda v: int(v * a)))
            cx = x0 + (k % cols) * (ts + gap) + ts // 2
            cy = y0 + (k // cols) * (ts + gap) + ts // 2
            f.alpha_composite(tl, (cx - tl.width // 2, cy - tl.height // 2))
        caption(f, t, "Step 5  ·  Generated art", "Icons, UI art, textures and skies in the game's own style",
                "Qwen-Image-2.1 + BiRefNet cut-outs in ComfyUI, installed straight into the place")
        return f

    return Seg("3. Pipeline", "generated art grid", dur, draw, [
        "STEP 5 · GENERATED ART / Icons, UI art, textures and skies in the game's own style",
        "Qwen-Image-2.1 + BiRefNet cut-outs in ComfyUI, installed straight into the place"])


def props(previews: list[Path], each: float = 2.2) -> Seg | None:
    if not previews:
        return None
    imgs = [contain(Image.open(p).convert("RGB"), 1800, 600) for p in previews]
    labels = ["Generated image", "Roblox Parts", "Another angle"]

    def draw(t, i):
        n = min(len(imgs) - 1, int(t / each))
        u = (t - n * each) / each
        f = canvas()
        im = imgs[n]
        z = 1.0 + 0.03 * u
        im2 = im.resize((round(im.width * z), round(im.height * z)), Image.BILINEAR)
        f.paste(im2, ((W - im2.width) // 2, 200 - (im2.height - im.height) // 2))
        d = ImageDraw.Draw(f, "RGBA")
        for k, s in enumerate(labels):
            kicker(d, ((W - im.width) // 2 + k * im.width // 3 + im.width // 6, 150), s, 1.0, 22, MUTED, anchor="ma")
        caption(f, t, "Step 6  ·  Procedural props", "Image → Idol Gaussian splat → editable Roblox Parts",
                "Idol lifts a generated prop to a splat in about 2 s; it lands in the place as a plain Luau module")
        return f

    return Seg("3. Pipeline", "Idol props", each * len(imgs), draw, [
        "STEP 6 · PROCEDURAL PROPS / Image → Idol Gaussian splat → editable Roblox Parts",
        "Idol lifts a generated prop to a splat in about 2 s; it lands in the place as a plain Luau module",
        "(column labels: Generated image / Roblox Parts / Another angle)"])


def kits() -> list[Seg]:
    segs = []
    for folder, idx, each, name, line in KIT_SHOTS:
        paths = [KITDEMO / folder / f"shot_{n:03d}.png" for n in idx]
        paths = [p for p in paths if p.exists()]
        if paths:
            s = stills("3. Pipeline", f"kit showcase: {name}", [load(p) for p in paths], each,
                       f"Step 7  ·  Kits it composes  ·  {name}", line, zoom=(1.0, 1.04))
            segs.append(s)
    return segs


def models_card(has_trailer: bool) -> Seg:
    rows = MODELS + ([TRAILER_MODEL] if has_trailer else [])

    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (140, 200), "Every model open-weight", ramp(t, 0.0))
        text(d, (140, 244), "All on one RTX 5090", font(80, "Bold"), FG, ramp(t, 0.1))
        y = 396
        for k, (m, role) in enumerate(rows):
            a = ramp(t, 0.4 + 0.12 * k)
            text(d, (140 + 14 * (1 - a), y), m, font(42, "Semibold"), FG, a)
            text(d, (700 + 14 * (1 - a), y + 6), role, font(34, "Regular"), MUTED, a)
            y += 70
        a = ramp(t, 0.6 + 0.12 * len(rows))
        d.line([140, y + 14, W - 140, y + 14], fill=rgba((48, 54, 68), a), width=2)
        text(d, (140, y + 40), "A GPU arbiter time-slices the card: vLLM sleeps to host RAM while ComfyUI runs, then "
             "wakes.", font(32, "Regular"), (215, 220, 230), a)
        return f

    return Seg("3. Pipeline", "models card", 7.0, draw, [
        "EVERY MODEL OPEN-WEIGHT / All on one RTX 5090",
        "; ".join(f"{m}: {r}" for m, r in rows),
        "A GPU arbiter time-slices the card: vLLM sleeps to host RAM while ComfyUI runs, then wakes."],
        fade_in=0.2, fade_out=0.2)


def game_section(run: Path, idea: dict, target: float = 28.0) -> list[Seg]:
    title = idea.get("title", run.name)
    files = sorted(p for p in FOOTAGE.glob("*") if p.suffix.lower() in (".mp4", ".mov", ".mkv", ".png", ".jpg"))
    source = "video/game_footage"
    if not files:
        caps = [p for p in sorted((run / "work" / "captures").glob("*.jpg")) if "_top_" not in p.name]
        files = sorted(sorted(caps, key=vividness, reverse=True)[:7], key=lambda p: p.name)
        source = f"{run.name}/work/captures (fallback: no game footage yet)"
    segs: list[Seg] = []
    left = target
    for k, p in enumerate(files):
        if left < 1.0:
            break
        first = k == 0
        if p.suffix.lower() in (".png", ".jpg"):
            dur = min(left, 3.8)
            big = cover(Image.open(p), margin=1.0)
            pan = [(0.5, 0.2), (-0.5, 0.0), (0.0, -0.4)][k % 3]

            def draw(t, i, big=big, pan=pan, dur=dur, first=first):
                f = kenburns(big, t / dur, (1.0, 1.07), pan)
                game_overlay(f, t, first, title)
                return f
            segs.append(Seg("4. The game", p.name, dur, draw, [], fade_in=0.25 if first else 0))
        else:
            info = probe(p)
            dur = min(left, info["dur"])
            st: dict = {}

            def draw(t, i, st=st, first=first):
                f = st["r"].frame(i)
                game_overlay(f, t, first, title)
                return f
            segs.append(Seg("4. The game", p.name, dur, draw, [],
                            audio=[(p, 0.0, dur, 0.0, -6.0)] if info["audio"] else [],
                            setup=lambda st=st, p=p, dur=dur: st.__setitem__("r", VideoReader(p, 0.0, dur)),
                            teardown=lambda st=st: st["r"].close(), fade_in=0.25 if first else 0))
        left -= dur
    if segs:
        segs[0].onscreen = [f"THE GAME / {title} / Built from one pitch. Opens and plays in Roblox Studio.",
                            f"(footage: {source})"]
    return segs


def vividness(p: Path) -> float:
    """Contrast plus saturation: ranks a clear, colourful capture above a fogged or empty one."""
    im = Image.open(p).convert("RGB").resize((96, 54))
    lum = [0.3 * r + 0.59 * g + 0.11 * b for r, g, b in im.getdata()]
    mean = sum(lum) / len(lum)
    sat = sum(px[1] for px in im.convert("HSV").getdata()) / len(lum)
    return (sum((v - mean) ** 2 for v in lum) / len(lum)) ** 0.5 + 0.5 * sat


def game_overlay(f: Image.Image, t: float, first: bool, title: str) -> None:
    f.alpha_composite(shade(300, 0.82, bottom=False))
    d = ImageDraw.Draw(f, "RGBA")
    a = ramp(t, 0.2) if first else 1.0
    kicker(d, (96, 70), "The game", a)
    text(d, (96, 108), title, font(60, "Bold"), FG, a)
    if first:
        b = ramp(t, 0.6) * (1 - ramp(t, 5.0, 0.5))
        text(d, (96, 186), "Built from one pitch. Opens and plays in Roblox Studio.", font(32, "Regular"),
             (220, 225, 235), b)


def close_card() -> Seg:
    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        text(d, (W // 2, 330), "Blocksfield", font(150, "Bold"), FG, ramp(t, 0.1, 0.6), anchor="ms")
        text(d, (W // 2, 430), "Open-source Higgsfield for Roblox.", font(52, "Semibold"), FG, ramp(t, 0.6), anchor="ms")
        text(d, (W // 2, 520), "Every model open-weight.   One GPU.   $0 per generation.", font(40, "Regular"),
             (215, 220, 230), ramp(t, 1.1), anchor="ms")
        text(d, (W // 2, 660), HASHTAG, font(56, "Bold"), ACCENT, ramp(t, 1.7), anchor="ms")
        text(d, (W // 2, 760), REPO_URL, font(34, "Regular"), MUTED, ramp(t, 2.1), anchor="ms")
        return f

    return Seg("5. Close", "close card", 11.0, draw, [
        "Blocksfield / Open-source Higgsfield for Roblox.",
        "Every model open-weight. One GPU. $0 per generation.", HASHTAG, REPO_URL],
        fade_in=0.3, fade_out=1.0)


# ---------------------------------------------------------------- assembling

def same_idea_runs(run: Path) -> list[Path]:
    """The run itself, then other runs of the same idea id (they share art and music)."""
    try:
        rid = json.loads((run / "idea.json").read_text(encoding="utf-8")).get("id")
    except Exception:
        rid = None
    others = []
    for r in sorted(run.parent.iterdir()):
        if r != run and (r / "idea.json").exists():
            try:
                if json.loads((r / "idea.json").read_text(encoding="utf-8")).get("id") == rid:
                    others.append(r)
            except Exception:
                pass
    return [run] + others


def music(runs: list[Path]) -> tuple[list[Path], Path | None]:
    beds, stings = [], []
    for r in runs:
        for aj in [r / "art" / "audio" / "audio.json"]:
            if not aj.exists():
                continue
            for name, meta in json.loads(aj.read_text(encoding="utf-8")).items():
                p = aj.parent / name
                if meta.get("kind") != "music" or not p.exists():
                    continue
                if "fanfare" in name or "fanfare" in meta.get("prompt", ""):
                    stings.append(p)
                elif probe(p)["dur"] >= 20:
                    beds.append(p)
    return beds, (stings[0] if stings else None)


def build(run: Path, creators: bool = False) -> list[Seg]:
    idea = json.loads((run / "idea.json").read_text(encoding="utf-8"))
    runs = same_idea_runs(run)
    segs: list[Seg] = []
    # 1. cold open
    if creators:
        for k, (name, a, b, credit, caps) in enumerate(CLIPS):
            segs.append(creator_clip(name, a, b, credit, caps, opening=k == 0,
                                     new_credit=k == 0 or CLIPS[k - 1][3] != credit))
    else:
        segs.append(why_card())
    # 2. price
    segs.append(price_card())
    # 3. pipeline
    segs.append(title_card())
    segs.append(pitch_card(idea))
    refs = []
    for r in runs:
        refs = sorted((r / "refs").glob("*.png"))
        if refs:
            break
    if refs:
        segs.append(stills("3. Pipeline", "concept board", [Image.open(p) for p in refs], 2.6,
                           "Step 2  ·  Concept board",
                           "Qwen-Image-2.1 paints the targets the build is judged against", zoom=(1.02, 1.1)))
    for s in (dashboard(run, 11.0), look_loop(run)):
        if s:
            segs.append(s)
    arts, sources = [], []
    for r in runs:
        arts += [Image.open(p) for p in sorted((r / "art").glob("*.png")) if usable_art(p)]
        # the generated source image is the left third of each prop preview
        sources += [Image.open(p).crop((0, 24, 384, 384)) for p in sorted((r / "art" / "props").glob("*_preview.png"))]
    s = art_grid([x for pair in zip(arts, sources) for x in pair] + arts[len(sources):] + sources[len(arts):])
    if s:
        segs.append(s)
    own = []
    for r in runs:
        own += sorted((r / "art" / "props").glob("*_preview.png"))
    extra = [IDOL_EXTRA / f"{n}_preview_v2.png" for n in ("Toadstool", "TreasureChest", "StreetLamp")]
    extra = [p for p in extra if p.exists()]
    s = props((own[:1] + extra[:2]) if extra else own[:3])
    if s:
        segs.append(s)
    segs += kits()
    has_trailer = any((r / "marketing" / "trailer.mp4").exists() for r in runs)
    segs.append(models_card(has_trailer))
    # 4. the game, 5. close
    segs += game_section(run, idea)
    segs.append(close_card())
    return segs


def render_video(segs: list[Seg], out: Path) -> None:
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS),
         str(out)], stdin=subprocess.PIPE)
    clock = 0.0
    written = 0
    for s in segs:
        if s.setup:
            s.setup()
        end = clock + s.dur
        n = round(end * FPS) - written         # frame count from the global clock, so rounding never drifts
        for i in range(n):
            t = i / FPS
            f = s.draw(t, i)
            fade = 1.0
            if s.fade_in:
                fade = min(fade, t / s.fade_in)
            if s.fade_out:
                fade = min(fade, (s.dur - t) / s.fade_out)
            rgb = f.convert("RGB")
            if fade < 1.0:
                rgb = Image.blend(Image.new("RGB", (W, H), BG), rgb, max(0.0, fade))
            enc.stdin.write(rgb.tobytes())
        written += n
        clock = end
        if s.teardown:
            s.teardown()
        print(f"  {s.section:<14} {s.label:<44} {s.dur:5.2f}s  -> {clock:6.2f}s", flush=True)
    enc.stdin.close()
    enc.wait()


def render_audio(segs: list[Seg], total: float, beds: list[Path], sting: Path | None, out: Path,
                 with_music: bool) -> None:
    inputs: list[list[str]] = []
    chains: list[str] = []
    mixes: list[str] = []

    def add(p: Path) -> int:
        inputs.append(["-i", str(p)])
        return len(inputs) - 1

    clock = 0.0
    duck_end = 0.0
    close_at = total
    for s in segs:
        for (p, a, b, off, gain) in s.audio:
            k = add(p)
            ms = int((clock + off) * 1000)
            chains.append(f"[{k}:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:"
                          f"channel_layouts=stereo,afade=t=in:d=0.03,afade=t=out:st={b - a - 0.04:.3f}:d=0.04,"
                          f"volume={gain:.2f}dB,adelay={ms}|{ms}[c{k}]")
            mixes.append(f"[c{k}]")
        if s.section.startswith("1."):
            duck_end = clock + s.dur
        if s.section.startswith("5.") and close_at == total:
            close_at = clock
        clock += s.dur
    if with_music and beds:
        # loop the beds (crossfaded) to cover everything up to the close, at -26 LUFS, ducked to -36 under the clips
        need = close_at + 2.0
        seq, length = [], 0.0
        while length < need:
            p = beds[len(seq) % len(beds)]
            seq.append(p)
            length += probe(p)["dur"] - (3.0 if len(seq) > 1 else 0)
        ids = [add(p) for p in seq]
        for j, (k, p) in enumerate(zip(ids, seq)):
            chains.append(f"[{k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={-26 - lufs(p):.2f}dB[m{j}]")
        cur = "[m0]"
        for j in range(1, len(ids)):
            chains.append(f"{cur}[m{j}]acrossfade=d=3[x{j}]")
            cur = f"[x{j}]"
        lo, hi = 10 ** (-10 / 20), 1.0
        chains.append(f"{cur}atrim=0:{need:.3f},volume='{lo}+({hi}-{lo})*clip((t-{duck_end - 0.3:.3f})/1.2,0,1)'"
                      f":eval=frame,afade=t=in:d=1.0,afade=t=out:st={close_at - 0.5:.3f}:d=2.5[bed]")
        mixes.append("[bed]")
        if sting:
            k = add(sting)
            ms = int(close_at * 1000)
            chains.append(f"[{k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={-21 - lufs(sting):.2f}dB,"
                          f"afade=t=out:st={max(0.0, total - close_at - 2.0):.3f}:d=2.0,adelay={ms}|{ms}[sting]")
            mixes.append("[sting]")
    inputs.append(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])     # silence sets the full length
    chains.append(f"[{len(inputs) - 1}:a]atrim=0:{total:.3f}[sil]")
    mixes.append("[sil]")
    graph = ";".join(chains) + f";{''.join(mixes)}amix=inputs={len(mixes)}:normalize=0:duration=longest," \
        f"atrim=0:{total:.3f},alimiter=limit=0.89[out]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *[x for i in inputs for x in i], "-filter_complex", graph,
                    "-map", "[out]", "-c:a", "aac", "-b:a", "192k", str(out)], check=True)


def mux(video: Path, audio: Path, out: Path) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio), "-map", "0:v", "-map",
                    "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", str(out)],
                   check=True)


def timing_sheet(segs: list[Seg], out_md: Path, video: Path, beds: list[Path], sting: Path | None) -> None:
    def mmss(x: float) -> str:
        return f"{int(x // 60)}:{x % 60:05.2f}"

    sections: dict = {}
    clock = 0.0
    rows = []
    for s in segs:
        sections.setdefault(s.section, [clock, clock])
        sections[s.section][1] = clock + s.dur
        rows.append((clock, clock + s.dur, s))
        clock += s.dur
    lines = [f"# Promo timing: `{video.name}`", "",
             f"Total **{mmss(clock)}** ({clock:.1f} s), {W}x{H} at {FPS} fps. Generated by `blocksfield/promo_video.py`; "
             "re-running it rewrites this file.", "",
             "Music: " + (", ".join(p.name for p in beds) or "none") + (f"; close sting {sting.name}" if sting else "")
             + ". The bed sits at about -26 LUFS (-36 under the creator clips) so a voiceover at -16 LUFS sits on top.",
             "", "## Sections", "", "| Section | Start | End | Length |", "|---|---|---|---|"]
    for name, (a, b) in sections.items():
        lines.append(f"| {name} | {mmss(a)} | {mmss(b)} | {b - a:.1f} s |")
    lines += ["", "## Shots and on-screen text", ""]
    cur = None
    for a, b, s in rows:
        if s.section != cur:
            cur = s.section
            lines += ["", f"### {cur}", ""]
        lines.append(f"- **{mmss(a)} to {mmss(b)}** ({s.dur:.1f} s), {s.label}")
        for o in s.onscreen:
            lines.append(f"  - {o}")
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def contact_sheet(video: Path, total: float, out: Path, every: float = 5.0) -> None:
    times = [x * every + 0.5 for x in range(int(total // every) + 1) if x * every + 0.5 < total]
    tw, th, cols = 480, 270, 5
    rows = (len(times) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 24)), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for k, t in enumerate(times):
        r = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
                            "-vf", f"scale={tw}:{th}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           capture_output=True)
        if len(r.stdout) == tw * th * 3:
            sheet.paste(Image.frombytes("RGB", (tw, th), r.stdout), ((k % cols) * tw, (k // cols) * (th + 24)))
        d.text(((k % cols) * tw + 6, (k // cols) * (th + 24) + th + 4), f"{t:6.1f}s", fill=(220, 220, 220),
               font=font(16, "Regular"))
    sheet.save(out, quality=88)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", required=True, help="the run dir, e.g. runs/starbloom_kits")
    ap.add_argument("--out", default=str(VIDEO / "promo_draft.mp4"))
    ap.add_argument("--keep", action="store_true", help="keep the intermediates in video/build")
    ap.add_argument("--preview", action="store_true", help="only write one still per shot to video/build")
    ap.add_argument("--creators", action="store_true",
                    help="open with the sponsored creator clips (not for the contest cut: it bars unlicensed likenesses)")
    a = ap.parse_args()
    run = Path(a.run).resolve()
    out = Path(a.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    segs = build(run, creators=a.creators)
    total = sum(s.dur for s in segs)
    beds, sting = music(same_idea_runs(run))
    print(f"{len(segs)} shots, {total:.1f} s; music: {[p.name for p in beds]} sting: {sting and sting.name}")
    if a.preview:
        # one frame per shot, late enough that its text has animated in
        for k, s in enumerate(segs):
            if s.setup:
                s.setup()
            t = min(s.dur - 0.05, max(s.dur * 0.6, min(s.dur - 0.05, 3.0)))
            s.draw(t, int(t * FPS)).convert("RGB").save(BUILD / f"preview_{k:02d}.jpg", quality=90)
            if s.teardown:
                s.teardown()
        print(BUILD)
        return 0
    silent = BUILD / "video_only.mp4"
    render_video(segs, silent)
    mix, dry = BUILD / "mix.m4a", BUILD / "mix_nomusic.m4a"
    render_audio(segs, total, beds, sting, mix, with_music=True)
    render_audio(segs, total, beds, sting, dry, with_music=False)
    nomusic = out.with_name(out.stem + "_nomusic" + out.suffix)
    mux(silent, mix, out)
    mux(silent, dry, nomusic)
    timing_sheet(segs, out.parent / "promo_timing.md", out, beds, sting)
    contact_sheet(out, total, out.with_name(out.stem + "_sheet.jpg"))
    if not a.keep:
        for p in (silent, mix, dry):
            p.unlink(missing_ok=True)
    print(out, nomusic, out.parent / "promo_timing.md", out.with_name(out.stem + "_sheet.jpg"), sep="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
