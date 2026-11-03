"""The v3 demo video (<= 2:00, 1080p30): real web games first, then the paid workflow, the Studio app, how it works,
the games, Roblox, the close. Reuses promo_video's drawing/rendering helpers.

    python -m blocksfield.promo_v3 [--out video/promo_v3.mp4] [--games id,id,...] [--no-vo] [--preview]
    bash web/tools/record_clips.sh <game id> ...     # 1080p gameplay/orbit clips (web/tools/record.py), before rendering

Writes <out>, <out stem>_sheet.jpg (a frame every 4 s), video/v3/vo_script.md (VO lines with start times and room),
video/v3/timing.md. Every section length and VO line lives in SECTIONS / VO below; the games section stretches or
shrinks to keep the total <= LIMIT. Footage per game, best first: video/v3/clips/<id>_play.mp4 + <id>_orbit.mp4,
else web/games/<id>/gameplay.mp4. Honesty rule: captions only show what the shown game has (its pitch, genre, score).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from blocksfield import promo_video as pv
from blocksfield.promo_video import (ACCENT, BG, FG, FPS, H, MUTED, W, Seg, VideoReader, balanced, canvas, contain,
                                     cover, font, kenburns, kicker, lufs, probe, ramp, rgba, shade, text, wrap)

ROOT = pv.ROOT
GAMES = ROOT / "web" / "games"
V3 = ROOT / "video" / "v3"
CLIPS_DIR = V3 / "clips"
LIMIT = 120.0
PAGES_URL = "hcoder10.github.io/blocksfield"
NOTE = "Voiceover is local TTS (Kokoro): I caught COVID and couldn't record it myself, sorry!"
TITLE = "Type a pitch. Get a game."

# Section lengths (seconds). "games" is the remainder up to LIMIT, clamped per game to GAME_EACH.
SECTIONS = {"open": 8.0, "paid": 12.5, "studio": 15.0, "how": 21.0, "games": None, "roblox": 11.5, "close": 12.5}
GAME_EACH = (6.0, 8.0)
CREATOR_CUT = [pv.CLIPS[0], pv.CLIPS[1]]          # ~9.7 s: "...that's where today's sponsor comes in" + "insane"

# Voiceover: (section, seconds after the section starts, text). Plain and confident; no claims a shown game lacks.
VO = [
    ("open", 0.6, "Type a pitch. Get a game. A real game you can play in the browser, made by open models on one GPU."),
    ("paid", "shot:2", "That workflow runs on credits. Blocksfield costs nothing per generation."),
    ("studio", 0.4, "This is Blocksfield Studio. You type one paragraph, and watch the whole build live: "
                    "the plan, the concept art, the GPU at work."),
    ("how", "shot:0", "ComfyUI paints a concept board, the target the game is judged against."),
    ("how", "shot:1", "Then the sky, the icons, the music and the sound effects."),
    ("how", "shot:2", "Prop images become Gaussian splats with Idol, right in the game."),
    ("how", "shot:3", "A twenty-seven billion parameter model writes the game from tested kits."),
    ("how", "shot:4", "Then it plays its own game. A vision model scores each version; the best one ships."),
    ("games", 0.4, "Each of these games came from a single pitch."),
    ("games", -9.0, "They run in the browser. Nothing to install."),       # negative: from the section's end
    ("roblox", 0.4, "And the same pipeline builds real Roblox places, inside Roblox Studio."),
    ("close", 0.6, "Every model is open weight. It runs on one RTX fifty ninety, for zero dollars per generation. "
                   "Blocksfield is open source."),
]
VOICE, SPEED = "af_heart", 1.06
SHOT_PAD = 0.7          # a "shot:k" VO line starts 0.3 s into its shot; the shot lasts at least line + this

_vo_cache: dict = {}
_pipe = None


def vo_audio(txt: str):
    """Kokoro audio for one line (cached in memory and in video/v3/vo_cache)."""
    global _pipe
    import hashlib
    import numpy as np
    if txt in _vo_cache:
        return _vo_cache[txt]
    f = V3 / "vo_cache" / (hashlib.sha1(f"{VOICE}|{SPEED}|{txt}".encode()).hexdigest()[:16] + ".npy")
    if f.exists():
        _vo_cache[txt] = np.load(f)
        return _vo_cache[txt]
    os.environ.setdefault("HF_HOME", str(Path.home() / ".cache" / "kokoro_hf"))
    if _pipe is None:
        from kokoro import KPipeline
        _pipe = KPipeline(lang_code="a", device="cpu", repo_id="hexgrad/Kokoro-82M")
    a = np.concatenate([np.asarray(x, dtype=np.float32) for _, _, x in _pipe(txt, voice=VOICE, speed=SPEED)])
    f.parent.mkdir(parents=True, exist_ok=True)
    np.save(f, a)
    _vo_cache[txt] = a
    return a


USE_VO = True


def vo_len(txt: str) -> float:
    return len(vo_audio(txt)) / 24000 if USE_VO else len(txt) / 14.5


def shot_len(section: str, k: int, base: float) -> float:
    for sec, off, txt in VO:
        if sec == section and off == f"shot:{k}":
            return max(base, vo_len(txt) + SHOT_PAD)
    return base


# ---------------------------------------------------------------- data

def games(only: list[str] | None = None) -> list[dict]:
    idx = json.loads((GAMES / "index.json").read_text(encoding="utf-8"))
    out = []
    for g in idx.get("games", []):
        if g.get("dry_run") or g["id"].startswith("_") or (only and g["id"] not in only):
            continue
        d = GAMES / g["id"]
        s = g.get("score")
        g["score_n"] = float(s.get("score", 0) if isinstance(s, dict) else (s or 0))
        play, orbit = CLIPS_DIR / f"{g['id']}_play.mp4", CLIPS_DIR / f"{g['id']}_orbit.mp4"
        g["play"] = play if play.exists() else (d / "gameplay.mp4" if (d / "gameplay.mp4").exists() else None)
        g["orbit"] = orbit if orbit.exists() else None
        about = d / "about.json"
        g["about"] = json.loads(about.read_text(encoding="utf-8")) if about.exists() else {}
        g["dir"] = d
        if g["play"]:
            out.append(g)
    out.sort(key=lambda g: -g["score_n"])
    if only:
        out.sort(key=lambda g: only.index(g["id"]))
    return out


def mono(size: int, bold=False) -> ImageFont.FreeTypeFont:
    key = ("mono", size, bold)
    if key not in pv._fonts:
        for n in (["CascadiaMono.ttf", "consolab.ttf" if bold else "consola.ttf"]):
            p = Path("C:/Windows/Fonts") / n
            if p.exists():
                pv._fonts[key] = ImageFont.truetype(str(p), size)
                break
        else:
            pv._fonts[key] = font(size, "Regular")
    return pv._fonts[key]


def chip(d: ImageDraw.ImageDraw, x: float, y: float, s: str, a: float, fill=ACCENT, fg=(20, 16, 10), size=26):
    f = font(size, "Bold")
    w = f.getlength(s.upper()) + size * 0.14 * len(s) + 36
    d.rounded_rectangle([x, y, x + w, y + size + 22], (size + 22) // 2, fill=rgba(fill, a))
    text(d, (x + 18, y + (size + 22) / 2), s.upper(), f, fg, a, anchor="lm", tracking=size * 0.14)
    return w


def video_seg(section: str, label: str, path: Path, start: float, dur: float, overlay=None, audio_gain=None,
              fade_in=0.0, fade_out=0.0, onscreen=None) -> Seg:
    st: dict = {}

    def draw(t, i):
        f = st["r"].frame(i)
        if overlay:
            overlay(f, t)
        return f
    audio = [(path, start, start + dur, 0.0, audio_gain)] if audio_gain is not None else []
    return Seg(section, label, dur, draw, onscreen or [], audio=audio,
               setup=lambda: st.__setitem__("r", VideoReader(path, start, dur)), teardown=lambda: st["r"].close(),
               fade_in=fade_in, fade_out=fade_out)


# ---------------------------------------------------------------- 1. cold open

def cold_open(gs: list[dict], dur: float) -> list[Seg]:
    cuts = []
    srcs = [(g, g["play"], 3.0) for g in gs] + [(g, g["orbit"], 0.5) for g in gs if g["orbit"]]
    srcs += [(None, p, 0.3) for p in sorted(pv.FOOTAGE.glob("clip_0*.mp4"))[:1]]
    n = max(4, round(dur / 1.15))
    each = dur / n
    for k in range(n):
        g, p, off = srcs[k % len(srcs)]
        start = off + (k // len(srcs)) * 2.2

        def ov(f, t, k=k):
            gt = k * each + t                       # time in the montage
            f.alpha_composite(shade(520, 0.78))
            d = ImageDraw.Draw(f, "RGBA")
            a = ramp(gt, 1.0, 0.6)
            text(d, (W // 2, H - 170), TITLE, font(104, "Bold"), FG, a, anchor="ms", stroke=3)
            text(d, (W // 2, H - 96), "Real browser games, made end to end by open models on one GPU.",
                 font(36, "Regular"), (225, 230, 240), ramp(gt, 2.0, 0.6), anchor="ms", stroke=1)
        cuts.append(video_seg("1. Cold open", f"montage {p.parent.name}/{p.name} @{start:.1f}", p, start, each,
                              overlay=ov, fade_in=0.3 if k == 0 else 0))
    cuts[0].onscreen = [f'TITLE: "{TITLE}"', "Sub: Real browser games, made end to end by open models on one GPU.",
                        "Footage: " + ", ".join(sorted({c.label.split()[1].split('@')[0] for c in cuts}))]
    return cuts


# ---------------------------------------------------------------- 2. paid workflow

def price_short(dur: float) -> Seg:
    plans = [("Starter", "$19"), ("Plus", "$59"), ("Ultra", "$129")]

    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (160, 250), "The paid workflow", ramp(t, 0.0))
        text(d, (160, 296), "Higgsfield", font(72, "Bold"), FG, ramp(t, 0.1))
        y = 430
        for k, (name, price) in enumerate(plans):
            a = ramp(t, 0.3 + 0.15 * k)
            text(d, (160, y), name, font(46, "Semibold"), FG, a)
            text(d, (420, y), price, font(46, "Semibold"), FG, a)
            text(d, (560, y + 8), "/ month, in credits", font(32, "Regular"), MUTED, a)
            y += 84
        b = ramp(t, 1.4, 0.6)
        d.line([1060, 250, 1060, 780], fill=rgba((48, 54, 68), b), width=2)
        x = 1150 + 30 * (1 - b)
        text(d, (x, 296), "Blocksfield", font(72, "Bold"), ACCENT, b)
        text(d, (x - 8, 380), "$0", font(250, "Bold"), FG, b)
        text(d, (x, 680), "per generation", font(48, "Semibold"), FG, ramp(t, 1.8))
        text(d, (160, H - 92), "Prices from higgsfield.ai/pricing, Oct 30 2026, excl. VAT.", font(24, "Regular"),
             (120, 128, 144), ramp(t, 0.6))
        return f
    return Seg("2. Paid workflow", "price card (short)", dur, draw, [
        "THE PAID WORKFLOW / Higgsfield: Starter $19, Plus $59, Ultra $129 per month, in credits",
        "Blocksfield: $0 per generation", "Small print: Prices from higgsfield.ai/pricing, Oct 30 2026, excl. VAT."],
        fade_in=0.2, fade_out=0.2)


def paid(dur: float) -> list[Seg]:
    segs = []
    for k, (name, a, b, credit, caps) in enumerate(CREATOR_CUT):
        s = pv.creator_clip(name, a, b, credit, caps, opening=k == 0,
                            new_credit=k == 0 or CREATOR_CUT[k - 1][3] != credit)
        s.section = "2. Paid workflow"
        segs.append(s)
    used = sum(s.dur for s in segs)
    segs.append(price_short(shot_len("paid", 2, max(4.0, dur - used))))
    return segs


# ---------------------------------------------------------------- 3. studio

def studio(gs: list[dict], dur: float) -> list[Seg]:
    clip = CLIPS_DIR / "studio.mp4"
    if clip.exists():
        info = probe(clip)

        def ov(f, t):
            d = ImageDraw.Draw(f, "RGBA")
            a = ramp(t, 0.2) * (1 - ramp(t, 5.0, 0.5))
            d.rounded_rectangle([60, H - 150, 760, H - 60], 18, fill=(8, 10, 14, int(210 * a)))
            kicker(d, (90, H - 128), "Blocksfield Studio  ·  our app", a)
            text(d, (90, H - 96), "One pitch in, the whole build live", font(36, "Semibold"), FG, a)
        return [video_seg("3. Studio", "studio.mp4", clip, 0.0, min(dur, info["dur"]), overlay=ov, fade_in=0.2,
                          onscreen=["BLOCKSFIELD STUDIO · OUR APP / One pitch in, the whole build live"])]
    # placeholder until the Studio recording exists: the run's pitch typed, over the game's concept art
    g = gs[0]
    concepts = [g["dir"] / c for c in g["about"].get("concepts", [])]
    big = cover(Image.open(concepts[0]), margin=1.1) if concepts and concepts[0].exists() else None
    pitch = g.get("pitch", "")
    if pitch.startswith(g.get("title", "") + ":"):
        pitch = pitch[len(g["title"]) + 1:].strip()
    lines = wrap(pitch, font(40, "Regular"), 1500)
    total = sum(len(s) for s in lines)

    def draw(t, i):
        f = kenburns(big, t / dur, (1.0, 1.06)) if big else canvas()
        f.alpha_composite(Image.new("RGBA", (W, H), (8, 10, 14, 190)))
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (160, 220), "Blocksfield Studio  ·  (recording pending)", ramp(t, 0.0))
        text(d, (160, 266), g["title"], font(84, "Bold"), FG, ramp(t, 0.1))
        shown = int(total * min(1.0, max(0.0, (t - 0.6) / 4.0)))
        y = 400
        for s in lines:
            text(d, (160, y), s[:max(0, shown)], font(40, "Regular"), (220, 225, 235))
            shown -= len(s)
            y += 58
        return f
    return [Seg("3. Studio", "studio placeholder (pitch typed)", dur, draw,
                ["BLOCKSFIELD STUDIO (placeholder until the app recording lands)", f"(typed) {pitch}"],
                fade_in=0.2, fade_out=0.2)]


# ---------------------------------------------------------------- 4. how it works

def waveform(mp3: Path, n: int = 220) -> list[float]:
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(mp3), "-t", "40", "-ac", "1", "-ar", "4000", "-f",
                        "s16le", "-"], capture_output=True)
    import array
    a = array.array("h", r.stdout)
    if not a:
        return [0.0] * n
    step = max(1, len(a) // n)
    peaks = [max(abs(x) for x in a[i:i + step]) / 32768 for i in range(0, step * n, step)]
    m = max(peaks) or 1
    return [p / m for p in peaks]


def how(gs: list[dict], dur: float) -> list[Seg]:
    g = gs[0]
    lens = [shot_len("how", k, dur / 5) for k in range(5)]
    each = lens[0]
    segs = []
    # a) concept board
    cpaths = [g["dir"] / c for c in g["about"].get("concepts", []) if (g["dir"] / c).exists()]
    if cpaths:
        ims = [Image.open(p).convert("RGB") for p in cpaths[:3]]

        def draw_a(t, i):
            f = canvas()
            d = ImageDraw.Draw(f, "RGBA")
            kicker(d, (120, 96), "1  ·  Concept board", ramp(t, 0.0))
            text(d, (120, 134), "ComfyUI paints the target the game is judged against", font(48, "Semibold"), FG,
                 ramp(t, 0.1))
            tw = (W - 240 - 40 * (len(ims) - 1)) // len(ims)
            for k, im in enumerate(ims):
                a = ramp(t, 0.35 + 0.35 * k, 0.4)
                th = contain(im, tw, 620)
                x = 120 + k * (tw + 40) + (tw - th.width) // 2
                y = 260 + (620 - th.height) // 2 + int(40 * (1 - a))
                if a > 0:
                    th = th.convert("RGBA")
                    th.putalpha(int(255 * a))
                    f.alpha_composite(th, (x, y))
            text(d, (120, H - 110), f"{g['title']}  ·  Qwen-Image", font(28, "Regular"), MUTED, ramp(t, 1.2))
            return f
        segs.append(Seg("4. How it works", "concept board", lens[0], draw_a,
                        ["1 · CONCEPT BOARD / ComfyUI paints the target the game is judged against",
                         f"{g['title']} · Qwen-Image ({len(ims)} images)"], fade_in=0.15))
    # b) generated assets: sky, icons, music waveform
    man = json.loads((g["dir"] / "assets" / "assets.json").read_text(encoding="utf-8"))
    sky = next((g["dir"] / "assets" / e["file"] for e in man.values() if e.get("kind") == "sky"), None)
    icons = [g["dir"] / "assets" / e["file"] for e in man.values() if e.get("kind") == "icon"][:4]
    mus = next((g["dir"] / "assets" / e["file"] for e in man.values() if e.get("kind") == "music"), None)
    nsfx = sum(1 for e in man.values() if e.get("kind") == "sfx")
    sky_im = Image.open(sky).convert("RGB") if sky and sky.exists() else None
    icon_ims = [Image.open(p).convert("RGBA") for p in icons if p.exists()]
    wave = waveform(mus) if mus and mus.exists() else []

    each = lens[1]

    def draw_b(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (120, 96), "2  ·  Generated assets", ramp(t, 0.0))
        text(d, (120, 134), "Sky, icons, music and sound, generated for this game", font(48, "Semibold"), FG,
             ramp(t, 0.1))
        if sky_im:
            band = sky_im.crop((0, int(sky_im.height * 0.18), sky_im.width, int(sky_im.height * 0.6)))
            bw = int(band.width * 430 / band.height)
            band = band.resize((bw, 430))
            off = int((bw - (W - 240)) * min(1, t / each))
            view = band.crop((off, 0, off + W - 240, 430)).convert("RGBA")
            view.putalpha(int(255 * ramp(t, 0.2)))
            f.alpha_composite(view, (120, 230))
            text(d, (130, 640), "sky panorama", font(24, "Regular"), (230, 235, 245), ramp(t, 0.4))
        for k, im in enumerate(icon_ims):
            a = ramp(t, 0.6 + 0.2 * k, 0.35)
            th = contain(im, 150, 150)
            if a > 0:
                th.putalpha(Image.eval(th.getchannel("A"), lambda v, a=a: int(v * a)))
                f.alpha_composite(th, (120 + k * 175, 720 + int(20 * (1 - a))))
        if wave:
            a = ramp(t, 1.0)
            x0, x1, yc = 860, W - 120, 800
            n = len(wave)
            shown = int(n * min(1.0, max(0.0, (t - 1.0) / 1.6)))
            for k in range(shown):
                x = x0 + (x1 - x0) * k / n
                hgt = 6 + wave[k] * 110
                d.rounded_rectangle([x, yc - hgt / 2, x + (x1 - x0) / n * 0.6, yc + hgt / 2], 2, fill=rgba(ACCENT, a))
            text(d, (x0, 900), f"music (ACE-Step){'  +  ' + str(nsfx) + ' sound effects' if nsfx else ''}",
                 font(24, "Regular"), MUTED, a)
        return f
    segs.append(Seg("4. How it works", "generated assets", lens[1], draw_b,
                    ["2 · GENERATED ASSETS / Sky, icons, music and sound, generated for this game",
                     f"sky panorama; {len(icon_ims)} icons; music waveform; {nsfx} sfx"]))
    # c) Idol image -> Gaussian splat in game
    splat = CLIPS_DIR / "_splat.mp4"
    previews = sorted(g["dir"].glob("about/prop_*_preview.png")) or sorted(GAMES.glob("*/about/prop_*_preview.png"))
    src = Image.open(previews[0]).convert("RGB") if previews else None
    if src:
        src = src.crop((0, 24, src.height - 24, src.height)) if src.width > src.height * 2 else src
    st: dict = {}
    each = lens[2]

    def draw_c(t, i):
        f = st["r"].frame(i) if "r" in st else canvas()
        d = ImageDraw.Draw(f, "RGBA")
        if src:
            a = ramp(t, 0.1)
            th = contain(src, 330, 330).convert("RGBA")
            d.rounded_rectangle([80, 230, 80 + 370, 230 + 420], 18, fill=(8, 10, 14, int(215 * a)))
            th.putalpha(int(255 * a))
            f.alpha_composite(th, (100, 250))
            text(d, (100, 600), "prop image  →  Idol splat", font(28, "Semibold"), FG, a)
        f.alpha_composite(shade(240, 0.8, bottom=False))
        kicker(d, (120, 70), "3  ·  Image to Gaussian splat", ramp(t, 0.0))
        text(d, (120, 108), "Idol turns prop images into splats, rendered in the game", font(48, "Semibold"), FG,
             ramp(t, 0.1))
        return f
    segs.append(Seg("4. How it works", "Idol image -> splat in game", lens[2], draw_c,
                    ["3 · IMAGE TO GAUSSIAN SPLAT / Idol turns prop images into splats, rendered in the game",
                     f"(inset: {previews[0].name if previews else 'none'}; footage: splat_test.html, real Idol splats)"],
                    setup=(lambda: st.__setitem__("r", VideoReader(splat, 0.0, each))) if splat.exists() else None,
                    teardown=(lambda: st["r"].close()) if splat.exists() else None))
    # d) the builder writes game.js (real file, scrolling)
    code = (g["dir"] / "game.js").read_text(encoding="utf-8").splitlines()
    fm = mono(25)
    lh = 34
    each = lens[3]

    def color_of(line: str):
        s = line.strip()
        if s.startswith("//"):
            return (120, 130, 150)
        if "K." in s:
            return (255, 214, 140)
        return (210, 216, 228)

    def draw_d(t, i):
        f = canvas((14, 16, 22))
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (120, 96), "4  ·  The builder writes the game", ramp(t, 0.0))
        text(d, (120, 134), "Qwen3.8-27B composes tested kits: look, level, player, gameplay, UI",
             font(44, "Semibold"), FG, ramp(t, 0.1))
        d.rounded_rectangle([110, 230, W - 110, H - 70], 16, fill=(22, 26, 34, 255))
        text(d, (140, 246), f"web/games/{g['id']}/game.js  ·  {len(code)} lines", font(24, "Regular"), MUTED)
        rows = (H - 70 - 300) // lh
        scroll = max(0, len(code) - rows) * min(1.0, max(0.0, (t - 0.6) / (each - 1.0)))
        first = int(scroll)
        dy = (scroll - first) * lh
        for k in range(rows + 1):
            n = first + k
            if n >= len(code):
                break
            y = 292 + k * lh - dy
            if y < 286 or y > H - 100:
                continue
            text(d, (140, y), f"{n + 1:>3}", fm, (80, 88, 104))
            text(d, (220, y), code[n][:118], fm, color_of(code[n]))
        return f
    segs.append(Seg("4. How it works", "game.js scroll", lens[3], draw_d,
                    ["4 · THE BUILDER WRITES THE GAME / Qwen3.8-27B composes tested kits: look, level, player, gameplay, UI",
                     f"(real file: web/games/{g['id']}/game.js, {len(code)} lines)"]))
    # e) playtest + vision judge: survey sheet + per-version scores
    survey = g["dir"] / g["about"].get("survey", "about/survey.jpg")
    sv = Image.open(survey).convert("RGB") if survey.exists() else None
    sc = g["about"].get("score") if isinstance(g["about"].get("score"), dict) else {}
    vers = sc.get("versions", [])
    best = sc.get("best")

    def draw_e(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (120, 96), "5  ·  Playtest and judge", ramp(t, 0.0))
        text(d, (120, 134), "Autopilot plays it, a vision model scores it, the best version ships",
             font(44, "Semibold"), FG, ramp(t, 0.1))
        if sv:
            th = contain(sv, 1040, 720).convert("RGBA")
            th.putalpha(int(255 * ramp(t, 0.2)))
            f.alpha_composite(th, (120, 240))
        x0 = 1240
        text(d, (x0, 250), "score per version (0-10)", font(28, "Regular"), MUTED, ramp(t, 0.4))
        for k, v in enumerate(vers[-6:]):
            a = ramp(t, 0.6 + 0.3 * k, 0.4)
            y = 310 + k * 92
            win = v.get("tag") == best
            col = ACCENT if win else (120, 132, 156)
            text(d, (x0, y + 4), v.get("tag", "?"), font(32, "Semibold"), FG, a)
            wbar = 440 * min(1.0, float(v.get("score", 0)) / 10) * a
            d.rounded_rectangle([x0 + 80, y, x0 + 80 + max(8, wbar), y + 44], 10, fill=rgba(col, a))
            text(d, (x0 + 96 + wbar, y + 22), f"{float(v.get('score', 0)):.2f}", font(30, "Semibold"), FG, a,
                 anchor="lm")
            if win:
                chip(d, x0 + 80, y + 52, "ships", ramp(t, 0.6 + 0.3 * len(vers[-6:]), 0.4), size=20)
        return f
    segs.append(Seg("4. How it works", "playtest + judge", lens[4], draw_e,
                    ["5 · PLAYTEST AND JUDGE / Autopilot plays it, a vision model scores it, the best version ships",
                     f"(survey sheet of {g['title']}; scores " + ", ".join(f"{v.get('tag')} {float(v.get('score', 0)):.2f}"
                                                                    for v in vers) + f"; best {best})"],
                    fade_out=0.15))
    return segs


# ---------------------------------------------------------------- 5. games

def game_segs(g: dict, dur: float) -> list[Seg]:
    pitch = g.get("pitch", "")
    if pitch.startswith(g.get("title", "") + ":"):
        pitch = pitch[len(g["title"]) + 1:].strip()
    pitch_lines = balanced(pitch, font(34, "Regular"), 1120) if len(wrap(pitch, font(34, "Regular"), 1120)) <= 2 \
        else wrap(pitch, font(34, "Regular"), 1120)[:3]
    total_chars = sum(len(s) for s in pitch_lines)
    orbit_d = 2.4 if g["orbit"] and dur >= 6.5 else 0.0
    play_d = dur - orbit_d

    def ov(f, t, base=0.0):
        # the game's own HUD owns the corners (counter top-left, objective top-centre, lives top-right, minimap
        # bottom-left), so the caption sits in a bottom band to the right of the minimap
        gt = base + t
        f.alpha_composite(shade(460, 0.96))
        d = ImageDraw.Draw(f, "RGBA")
        a = ramp(gt, 0.1)
        x0 = 400
        y0 = H - 92 - 46 * len(pitch_lines) - 96
        text(d, (x0, y0), g["title"], font(60, "Bold"), FG, a, stroke=1)
        x = x0 + font(60, "Bold").getlength(g["title"]) + 28
        x += chip(d, x, y0 + 14, g.get("genre", ""), a) + 12
        chip(d, x, y0 + 14, f"judge score {g['score_n']:.1f} / 10", a, fill=(30, 36, 48), fg=FG)
        shown = int(total_chars * min(1.0, max(0.0, (gt - 0.4) / 2.6)))
        pa = 1 - ramp(gt, 5.2, 0.6)
        y = y0 + 92
        for s in pitch_lines:
            text(d, (x0, y), s[:max(0, shown)], font(34, "Regular"), (230, 234, 242), pa, stroke=1)
            shown -= len(s)
            y += 46
    play_start = 3.5 if g["play"].parent == CLIPS_DIR else 1.5
    segs = [video_seg("5. The games", f"{g['id']} play ({g['play'].name})", g["play"], play_start,
                      min(play_d, probe(g["play"])["dur"] - play_start), overlay=ov, fade_in=0.2,
                      onscreen=[f"{g['title']} [{g.get('genre', '')}] judge score {g['score_n']:.1f}/10",
                                f"(typed) {pitch}"])]
    if orbit_d:
        segs.append(video_seg("5. The games", f"{g['id']} orbit", g["orbit"], 0.3, orbit_d,
                              overlay=lambda f, t, b=segs[0].dur: ov(f, t, b), fade_out=0.15))
    return segs


# ---------------------------------------------------------------- 6. roblox, 7. close

def roblox(dur: float) -> list[Seg]:
    clips = sorted(pv.FOOTAGE.glob("clip_0*.mp4"))
    if not clips:
        return []
    each = dur / len(clips)
    segs = []
    for k, p in enumerate(clips):
        def ov(f, t, k=k):
            gt = k * each + t
            f.alpha_composite(shade(300, 0.85))
            d = ImageDraw.Draw(f, "RGBA")
            kicker(d, (96, H - 176), "Roblox too", ramp(gt, 0.1))
            text(d, (96, H - 136), "The same pipeline builds real Roblox places in Studio", font(50, "Semibold"), FG,
                 ramp(gt, 0.25))
            text(d, (96, H - 70), "Starbloom Peaks  ·  a Roblox place built from one pitch", font(30, "Regular"),
                 MUTED, ramp(gt, 0.5))
        segs.append(video_seg("6. Roblox", p.name, p, 0.0, min(each, probe(p)["dur"]), overlay=ov,
                              fade_in=0.2 if k == 0 else 0))
    segs[0].onscreen = ["ROBLOX TOO / The same pipeline builds real Roblox places in Studio",
                        "Starbloom Peaks · a Roblox place built from one pitch"]
    return segs


def close(dur: float) -> Seg:
    def draw(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        text(d, (W // 2, 270), "Blocksfield", font(150, "Bold"), FG, ramp(t, 0.1, 0.6), anchor="ms")
        text(d, (W // 2, 360), TITLE, font(52, "Semibold"), ACCENT, ramp(t, 0.5), anchor="ms")
        text(d, (W // 2, 460), "Every model open-weight   ·   One RTX 5090   ·   $0 per generation", font(40, "Regular"),
             (215, 220, 230), ramp(t, 1.0), anchor="ms")
        text(d, (W // 2, 590), pv.HASHTAG, font(56, "Bold"), ACCENT, ramp(t, 1.6), anchor="ms")
        text(d, (W // 2, 680), pv.REPO_URL, font(38, "Semibold"), FG, ramp(t, 2.0), anchor="ms")
        text(d, (W // 2, 736), PAGES_URL, font(38, "Semibold"), FG, ramp(t, 2.2), anchor="ms")
        text(d, (W // 2, H - 70), NOTE, font(26, "Regular"), (130, 138, 154), ramp(t, 2.8), anchor="ms")
        return f
    return Seg("7. Close", "close card", dur, draw, [
        f"Blocksfield / {TITLE}", "Every model open-weight · One RTX 5090 · $0 per generation", pv.HASHTAG,
        pv.REPO_URL, PAGES_URL, f"Small print: {NOTE}"], fade_in=0.3, fade_out=1.0)


# ---------------------------------------------------------------- assembly

def build(gs: list[dict]) -> list[Seg]:
    head = cold_open(gs, SECTIONS["open"]) + paid(SECTIONS["paid"]) + studio(gs, SECTIONS["studio"]) + how(gs, SECTIONS["how"])
    tail = roblox(SECTIONS["roblox"]) + [close(SECTIONS["close"])]
    left = LIMIT - sum(s.dur for s in head + tail) - 0.05
    n = max(1, len(gs))
    each = min(GAME_EACH[1], left / n)
    if each < GAME_EACH[0]:                     # too many games for the time: show the best that fit
        n = max(1, int(left // GAME_EACH[0]))
        each = min(GAME_EACH[1], left / n)
    mid = []
    for g in gs[:n]:
        mid += game_segs(g, each)
    return head + mid + tail


def section_spans(segs: list[Seg]) -> dict:
    spans, clock = {}, 0.0
    for s in segs:
        key = s.section.split(". ", 1)[1] if ". " in s.section else s.section
        spans.setdefault(key, [clock, clock])
        spans[key][1] = clock + s.dur
        clock += s.dur
    return spans


SEC_KEY = {"open": "Cold open", "paid": "Paid workflow", "studio": "Studio", "how": "How it works", "games": "The games",
           "roblox": "Roblox", "close": "Close"}


def vo_placements(segs: list[Seg]) -> list[tuple[float, float, str]]:
    spans = section_spans(segs)
    shots: dict = {}
    clock = 0.0
    for s in segs:
        key = s.section.split(". ", 1)[1] if ". " in s.section else s.section
        shots.setdefault(key, []).append(clock)
        clock += s.dur
    out = []
    for sec, off, line in VO:
        a, b = spans.get(SEC_KEY[sec], (None, None))
        if a is None:
            continue
        if isinstance(off, str):
            k = int(off.split(":")[1])
            lst = shots[SEC_KEY[sec]]
            if k >= len(lst):
                continue
            start = lst[k] + 0.3
        else:
            start = a + off if off >= 0 else b + off
        out.append((start, b, line))
    out.sort()
    # a line may run until the next line starts or its section ends, whichever is first
    return [(s, min(lim, out[k + 1][0] - 0.2) if k + 1 < len(out) else lim, ln) for k, (s, lim, ln) in enumerate(out)]


def synth_vo(lines, total: float, out: Path) -> list[dict]:
    import numpy as np
    import soundfile as sf
    sr = 24000
    track = np.zeros(int((total + 1) * sr), dtype=np.float32)
    report = []
    for start, limit, txt in lines:
        audio = vo_audio(txt)
        d = len(audio) / sr
        i = int(start * sr)
        seg = audio[: len(track) - i]
        track[i:i + len(seg)] += seg
        report.append({"start": start, "dur": d, "room": limit - start, "over": max(0.0, start + d - limit), "text": txt})
    sf.write(str(out), track, sr)
    return report


def write_vo_script(report: list[dict], out: Path) -> None:
    def mmss(x): return f"{int(x // 60)}:{x % 60:05.2f}"
    lines = ["# v3 voiceover script", "", f"Voice: Kokoro `{VOICE}` at speed {SPEED}, local TTS. Generated by "
             "`blocksfield/promo_v3.py` (edit `VO` there; starts follow the sections).", "",
             "| Start | Length | Room | Line |", "|---|---|---|---|"]
    for r in report:
        flag = f" **OVER {r['over']:.2f} s**" if r["over"] > 0 else ""
        lines.append(f"| {mmss(r['start'])} | {r['dur']:.1f} s | {r['room']:.1f} s{flag} | {r['text']} |")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def render_audio(segs: list[Seg], total: float, bed: Path | None, vo: Path | None, out: Path) -> None:
    inputs, chains, mixes = [], [], []

    def add(p):
        inputs.append(["-i", str(p)])
        return len(inputs) - 1
    clock = 0.0
    duck = []                                   # (start, end) spans with source audio (creator clips)
    close_at = total
    for s in segs:
        for (p, a, b, off, gain) in s.audio:
            k = add(p)
            ms = int((clock + off) * 1000)
            chains.append(f"[{k}:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:"
                          f"channel_layouts=stereo,afade=t=in:d=0.03,afade=t=out:st={b - a - 0.04:.3f}:d=0.04,"
                          f"volume={gain:.2f}dB,adelay={ms}|{ms}:all=1,asetpts=N/SR/TB[c{k}]")
            mixes.append(f"[c{k}]")
            duck.append((clock, clock + s.dur))
        if s.section.startswith("7.") and close_at == total:
            close_at = clock
        clock += s.dur
    if vo:
        k = add(vo)
        chains.append(f"[{k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={-16 - lufs(vo):.2f}dB[vo]")
        mixes.append("[vo]")
    if bed:
        k = add(bed)
        dur = probe(bed)["dur"]
        loops = int(total // max(1, dur - 3)) + 1
        expr = "+".join(f"between(t,{a - 0.3:.2f},{b + 0.3:.2f})" for a, b in duck) or "0"
        lo = 10 ** (-10 / 20)
        chains.append(f"[{k}:a]aloop=loop={loops}:size={int(dur * 48000)},aresample=48000,"
                      f"aformat=sample_rates=48000:channel_layouts=stereo,volume={-26 - lufs(bed):.2f}dB,"
                      f"atrim=0:{total:.3f},volume='if(gt({expr},0),{lo},1)':eval=frame,"
                      f"afade=t=in:d=1.0,afade=t=out:st={total - 2.5:.3f}:d=2.5[bed]")
        mixes.append("[bed]")
    inputs.append(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
    chains.append(f"[{len(inputs) - 1}:a]atrim=0:{total:.3f}[sil]")
    mixes.append("[sil]")
    graph = ";".join(chains) + f";{''.join(mixes)}amix=inputs={len(mixes)}:normalize=0:duration=longest," \
        f"asetpts=N/SR/TB,apad=whole_dur={total:.3f},atrim=0:{total:.3f},alimiter=limit=0.89[out]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *[x for i in inputs for x in i], "-filter_complex", graph,
                    "-map", "[out]", "-c:a", "aac", "-b:a", "192k", str(out)], check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(ROOT / "video" / "promo_v3.mp4"))
    ap.add_argument("--games", default="", help="comma-separated game ids in order (default: by judge score)")
    ap.add_argument("--music", default="", help="music bed (default: the top game's music_main.mp3)")
    ap.add_argument("--no-vo", action="store_true")
    ap.add_argument("--preview", action="store_true", help="one still per shot to video/v3/preview_*.jpg")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    V3.mkdir(parents=True, exist_ok=True)
    global USE_VO
    USE_VO = not a.no_vo and not a.preview
    gs = games([x for x in a.games.split(",") if x] or None)
    if not gs:
        print("no games with footage in web/games/index.json")
        return 1
    segs = build(gs)
    total = sum(s.dur for s in segs)
    print(f"{len(segs)} shots, {total:.1f} s, games: {[g['id'] for g in gs]}")
    if total > LIMIT + 0.01:
        print(f"WARNING: {total:.1f} s is over the {LIMIT:.0f} s limit")
    if a.preview:
        for k, s in enumerate(segs):
            if s.setup:
                s.setup()
            t = min(s.dur - 0.05, max(s.dur * 0.6, 0.1))
            s.draw(t, int(t * FPS)).convert("RGB").save(V3 / f"preview_{k:02d}.jpg", quality=88)
            if s.teardown:
                s.teardown()
        return 0
    vo = None
    if not a.no_vo:
        vo = V3 / "vo.wav"
        report = synth_vo(vo_placements(segs), total, vo)
        write_vo_script(report, V3 / "vo_script.md")
        for r in report:
            print(f"  VO {r['start']:6.1f}s {r['dur']:5.2f}s room {r['room']:5.2f}{'  OVER' if r['over'] > 0 else ''}"
                  f"  {r['text'][:60]}")
    silent = V3 / "video_only.mp4"
    pv.render_video(segs, silent)
    bed = Path(a.music) if a.music else next((g["dir"] / "assets" / "music_main.mp3" for g in gs
                                              if (g["dir"] / "assets" / "music_main.mp3").exists()), None)
    mix = V3 / "mix.m4a"
    render_audio(segs, total, bed, vo, mix)
    pv.mux(silent, mix, out)
    pv.timing_sheet(segs, V3 / "timing.md", out, [bed] if bed else [], None)
    pv.contact_sheet(out, total, out.with_name(out.stem + "_sheet.jpg"), every=4.0)
    silent.unlink(missing_ok=True)
    print(out, out.with_name(out.stem + "_sheet.jpg"), V3 / "vo_script.md", V3 / "timing.md", sep="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
