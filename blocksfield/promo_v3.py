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
SECTIONS = {"open": 7.0, "paid": 12.5, "studio": 15.0, "how": 21.0, "games": None, "roblox": 8.0, "close": 10.0}
MAPPING_GAME = "canyon_runner"     # the off-template pitch whose mapping notes the VO line describes
GAME_EACH = (6.0, 8.0)
# ~7.4 s: the cover/trailer wish + "that trailer was actually insane". The sponsor line ("that's where today's
# sponsor comes in") and its on-screen ad are cut, per the user: keep the creator clips, drop the paid/sponsor text.
CREATOR_CUT = [(pv.CLIPS[0][0], pv.CLIPS[0][1], 7.15, pv.CLIPS[0][3], pv.CLIPS[0][4][:2]), pv.CLIPS[1]]

# Voiceover: (section, seconds after the section starts, text). Plain and confident; no claims a shown game lacks.
VO = [
    ("open", 0.5, "Type a pitch. Get a game. A real browser game, made by open models on one GPU."),
    ("paid", "at:price card (short)", "That workflow runs on credits. Blocksfield costs nothing per generation."),
    ("studio", 0.4, "This is Blocksfield Studio. You type one paragraph, and watch the whole build live: "
                    "the plan, the concept art, the GPU at work."),
    ("how", "at:concept board", "ComfyUI paints a concept board, the target the game is judged against."),
    ("how", "at:generated assets", "Then the sky, the icons, the music and the sound effects."),
    ("how", "at:Idol image -> splat in game", "Prop images become Gaussian splats with Idol, right in the game."),
    ("how", "at:game.js scroll", "A twenty-seven billion parameter model writes the game from tested kits."),
    ("how", "at:pitch -> kit mapping", "Off-template pitches work too: no hover bike or canyon in the kits, so it chose a kart, a race track and the sunset look."),
    ("how", "at:playtest + judge", "Then it plays its own game. A vision model scores each version; the best one ships."),
    ("games", 0.4, "Each of these games came from a single pitch."),
    ("games", -9.0, "They run in the browser. Nothing to install."),       # negative: from the section's end
    ("ltx", "at:ltx beat", "Intro and victory cutscenes are made with LTX two point five."),
    ("mechanics", "at:mechanics beat", "It can write new mechanics too, on top of the kits."),
    ("roblox", 0.4, "And the same pipeline builds real Roblox places, inside Roblox Studio."),
    ("close", 0.6, "Every model is open weight. It runs on one RTX fifty ninety, for zero dollars per generation. "
                   "Blocksfield is open source."),
]
VOICE, SPEED = "af_heart", 1.06
SHOT_PAD = 0.5          # an "at:<shot label>" VO line starts 0.3 s into its shot; the shot lasts at least line + this

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


def shot_len(section: str, label: str, base: float) -> float:
    for sec, off, txt in VO:
        if sec == section and off == f"at:{label}":
            return max(base, vo_len(txt) + SHOT_PAD)
    return base


# ---------------------------------------------------------------- data

SKIP: set = set()            # ids to leave out (--skip); superseded games are already hidden by index.json
MAX_GAMES, MIN_CLEAN = 5, 4   # at most 5 games; if fewer than 4 have zero operator interventions, fill by score


def games(only: list[str] | None = None, skip: set | None = None) -> list[dict]:
    """The games to show, chosen at render time from web/games/index.json (the gallery generator's list, which hides
    superseded runs): real generated games only, zero operator interventions first, best judge score first, and the
    most varied genres (each new player type + level kind is picked before a second game of the same kind).
    Every game in the result has footage. `only` forces an explicit list in that order."""
    skip = SKIP if skip is None else skip
    idx = json.loads((GAMES / "index.json").read_text(encoding="utf-8"))
    pool = []
    for g in idx.get("games", []):
        if g.get("dry_run") or g["id"].startswith("_") or g["id"] in skip or (only and g["id"] not in only):
            continue
        d = GAMES / g["id"]
        s = g.get("score")
        g["score_n"] = float(s.get("score", 0) if isinstance(s, dict) else (s or 0))
        play, orbit = CLIPS_DIR / f"{g['id']}_play.mp4", CLIPS_DIR / f"{g['id']}_orbit.mp4"
        g["play"] = play if play.exists() else (d / "gameplay.mp4" if (d / "gameplay.mp4").exists() else None)
        g["orbit"] = orbit if orbit.exists() else None
        about = d / "about.json"
        g["about"] = json.loads(about.read_text(encoding="utf-8")) if about.exists() else {}
        g["interventions"] = len(g["about"].get("operator_interventions") or [])
        g["dir"] = d
        js = (d / "game.js").read_text(encoding="utf-8") if (d / "game.js").exists() else ""
        g["composed"] = "Level.compose(" in js or g.get("level_kind") == "custom"
        g["mechanics"] = mechanics_snippet(js)
        if g["play"]:
            pool.append(g)
    if only:
        return sorted(pool, key=lambda g: only.index(g["id"]))
    pool.sort(key=lambda g: -g["score_n"])
    clean = [g for g in pool if g["interventions"] == 0]
    ranked = clean + ([g for g in pool if g["interventions"] > 0] if len(clean) < MIN_CLEAN else [])
    picked, kinds = [], set()
    comp = next((g for g in pool if g["composed"]), None)   # a model-laid-out level is the best generalization proof
    if comp:
        picked.append(comp); kinds.add(comp.get("player_type"))
    for g in ranked:                                   # pass 1: one game per player type (platformer, kart, boat, ...)
        k = g.get("player_type")
        if k not in kinds:
            picked.append(g); kinds.add(k)
    for g in ranked:                                   # pass 2: fill by score
        if g not in picked:
            picked.append(g)
    picked = picked[:MAX_GAMES]
    picked.sort(key=lambda g: (g["interventions"] > 0, -g["score_n"]))
    return picked


def mechanics_snippet(js: str) -> list[str] | None:
    """The first K.Mechanics.<fn>(...) call in a game.js, as source lines (balanced parentheses, at most 14 lines)."""
    m = re.search(r"^[^\n]*\bMechanics\.\w+\(", js, re.M)
    if not m:
        return None
    i, depth, started = m.start(), 0, False
    end = len(js)
    for k in range(m.start(), len(js)):
        c = js[k]
        if c == "(":
            depth += 1; started = True
        elif c == ")":
            depth -= 1
            if started and depth == 0:
                end = js.find("\n", k)
                end = len(js) if end < 0 else end
                break
    lines = js[i:end].splitlines()
    # include one leading comment line if the call has one
    before = js[:i].rstrip("\n").splitlines()
    if before and before[-1].strip().startswith("//"):
        lines = [before[-1]] + lines
    if len(lines) > 14:
        lines = lines[:13] + ["  …"]
    ind = min((len(x) - len(x.lstrip()) for x in lines if x.strip()), default=0)
    return [x[ind:] for x in lines]


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
        kicker(d, (110, 130), "The paid workflow", ramp(t, 0.0), size=34)
        text(d, (110, 180), "Higgsfield", font(110, "Bold"), FG, ramp(t, 0.1))
        y = 380
        for k, (name, price) in enumerate(plans):
            a = ramp(t, 0.3 + 0.15 * k)
            text(d, (110, y), name, font(72, "Semibold"), FG, a)
            text(d, (450, y), price, font(72, "Bold"), FG, a)
            y += 120
        text(d, (110, y + 10), "per month, in credits", font(46, "Regular"), MUTED, ramp(t, 0.8))
        b = ramp(t, 1.4, 0.6)
        d.line([960, 140, 960, 900], fill=rgba((48, 54, 68), b), width=3)
        x = 1040 + 30 * (1 - b)
        text(d, (x, 180), "Blocksfield", font(110, "Bold"), ACCENT, b)
        text(d, (x - 12, 290), "$0", font(420, "Bold"), FG, b)
        text(d, (x, 760), "per generation", font(78, "Semibold"), FG, ramp(t, 1.8))
        text(d, (110, H - 60), "Prices from higgsfield.ai/pricing, Oct 30 2026, excl. VAT.", font(28, "Regular"),
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
    segs.append(price_short(shot_len("paid", "price card (short)", max(4.0, dur - used))))
    return segs


# ---------------------------------------------------------------- 3. studio

def studio(gs: list[dict], dur: float) -> list[Seg]:
    """The Studio app recording (kit-ui-fx: video/studio_take.mp4 -> video/v3/clips/studio.mp4), full frame. It carries
    its own "replayed at N x" tag; only a small label is added in the first seconds, clear of the docked GPU strip."""
    clip = CLIPS_DIR / "studio.mp4"
    if not clip.exists() and (ROOT / "video" / "studio_take.mp4").exists():
        clip = ROOT / "video" / "studio_take.mp4"
    if clip.exists():
        info = probe(clip)

        return [video_seg("3. Studio", clip.name, clip, 0.0, min(dur, info["dur"] - 0.05), fade_in=0.2,
                          onscreen=["BLOCKSFIELD STUDIO · OUR APP / One pitch in, the whole build live",
                                    "(app recording; its own 'replayed at N x' tag stays visible)"])]
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
    """Full-bleed cards built from the top game's real artifacts (concept board, assets, game.js, judge scores), the
    real Idol splat footage, and (if a game has one) its pitch -> kit mapping notes."""
    g = gs[0]
    base = dur / 6
    segs = []

    def cap(f, t, k, head, sub=""):
        pv.caption(f, t, k, head, sub)

    # a) concept board: a full-height triptych
    cpaths = [g["dir"] / c for c in g["about"].get("concepts", []) if (g["dir"] / c).exists()][:3]
    if cpaths:
        n = len(cpaths)
        gap = 10
        tw = (W - gap * (n - 1)) // n
        tiles = [cover(Image.open(p), tw, H, margin=1.06) for p in cpaths]
        L_a = shot_len("how", "concept board", base)

        def draw_a(t, i):
            f = canvas((6, 7, 10))
            for k, im in enumerate(tiles):
                a = ramp(t, 0.1 + 0.25 * k, 0.45)
                if a <= 0:
                    continue
                v = kenburns(im, t / L_a, (1.0, 1.05), (0.3 * (k - 1), 0.0), w=tw, h=H)
                v.putalpha(int(255 * a))
                f.alpha_composite(v, (k * (tw + gap), int(60 * (1 - a))))
            cap(f, t, "1  ·  Concept board  ·  Qwen-Image", "The target the game is judged against", g["title"])
            return f
        segs.append(Seg("4. How it works", "concept board", L_a, draw_a,
                        ["1 · CONCEPT BOARD · QWEN-IMAGE / The target the game is judged against", g["title"]],
                        fade_in=0.15))
    # b) generated assets: the sky panorama full frame, icons and the music waveform large on top
    man = json.loads((g["dir"] / "assets" / "assets.json").read_text(encoding="utf-8"))
    sky = next((g["dir"] / "assets" / e["file"] for e in man.values() if e.get("kind") == "sky"), None)
    icons = [g["dir"] / "assets" / e["file"] for e in man.values() if e.get("kind") == "icon"][:4]
    mus = next((g["dir"] / "assets" / e["file"] for e in man.values() if e.get("kind") == "music"), None)
    sfx_names = [(e.get("event") or k.replace("sfx_", "")).replace("_", " ") for k, e in man.items() if e.get("kind") == "sfx"]
    nsfx = len(sfx_names)
    sky_big = None
    if sky and sky.exists():
        im = Image.open(sky).convert("RGB")
        # the most interesting band of the panorama: highest detail (row-to-row change) + brightness, 40% tall
        small = im.convert("L").resize((128, 64))
        px = list(small.getdata())
        rows = [px[r * 128:(r + 1) * 128] for r in range(64)]
        def score(r0, r1):
            lum = sum(sum(rw) for rw in rows[r0:r1]) / ((r1 - r0) * 128 * 255)
            det = sum(abs(a - b) for k in range(r0, r1 - 1) for a, b in zip(rows[k], rows[k + 1])) / ((r1 - r0) * 128 * 255)
            return det * 4 + lum
        span = 26
        r0 = max(range(4, 64 - span - 4), key=lambda r: score(r, r + span))
        band = im.crop((0, int(im.height * r0 / 64), im.width, int(im.height * (r0 + span) / 64)))
        from PIL import ImageEnhance, ImageStat
        mean = sum(ImageStat.Stat(band.convert("L")).mean) / 255
        if mean < 0.42:                                  # night skies: lift so the card is not a black frame
            band = ImageEnhance.Brightness(band).enhance(min(2.2, 0.42 / max(mean, 0.05)))
        sky_big = band.resize((max(W + 400, int(band.width * H / band.height)), H), Image.LANCZOS)
    icon_ims = [Image.open(p).convert("RGBA") for p in icons if p.exists()]
    wave = waveform(mus, 160) if mus and mus.exists() else []
    L_b = shot_len("how", "generated assets", base)

    def draw_b(t, i):
        if sky_big:
            off = int((sky_big.width - W) * min(1.0, t / L_b))
            f = sky_big.crop((off, 0, off + W, H)).convert("RGBA")
        else:
            f = canvas()
        f.alpha_composite(shade(260, 0.8, bottom=False))
        f.alpha_composite(shade(560, 0.88))
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (96, 64), "2  ·  Generated assets  ·  ComfyUI", ramp(t, 0.0), size=30)
        text(d, (96, 106), "Sky, icons, music and sound, made for this game", font(60, "Semibold"), FG, ramp(t, 0.1),
             stroke=2)
        x = 96
        for k, im in enumerate(icon_ims):
            a = ramp(t, 0.4 + 0.2 * k, 0.35)
            th = contain(im, 190, 190)
            if a > 0:
                d.rounded_rectangle([x - 12, H - 560 - 12 + int(30 * (1 - a)), x + 202, H - 560 + 202 + int(30 * (1 - a))],
                                    26, fill=(10, 12, 18, int(170 * a)))
                th.putalpha(Image.eval(th.getchannel("A"), lambda v, a=a: int(v * a)))
                f.alpha_composite(th, (x + (190 - th.width) // 2, H - 560 + int(30 * (1 - a))))
            x += 230
        if wave:
            a = ramp(t, 0.9)
            x0, x1, yc = 96, W - 96, H - 150
            n = len(wave)
            shown = int(n * min(1.0, max(0.0, (t - 0.9) / 1.4)))
            bw = (x1 - x0) / n
            for k in range(shown):
                hgt = 10 + wave[k] * 190
                d.rounded_rectangle([x0 + k * bw, yc - hgt / 2, x0 + k * bw + bw * 0.62, yc + hgt / 2], 3,
                                    fill=rgba(ACCENT, a))
            text(d, (W - 96, H - 560), "music  ·  ACE-Step", font(56, "Bold"), FG, a, anchor="ra", stroke=2)
            xs = W - 96
            for k2, nm in enumerate(sfx_names[:3][::-1]):
                w2 = font(30, "Bold").getlength(nm.upper()) + 30 * 0.14 * len(nm) + 36
                xs -= w2 + 12
                chip(d, xs, H - 470, nm, ramp(t, 1.2 + 0.12 * k2), fill=(30, 36, 48), fg=FG, size=30)
            if sfx_names:
                text(d, (W - 96, H - 400), "sound effects  ·  Stable Audio", font(30, "Semibold"), (220, 225, 235),
                     ramp(t, 1.4), anchor="ra", stroke=1)
        return f
    segs.append(Seg("4. How it works", "generated assets", L_b, draw_b,
                    ["2 · GENERATED ASSETS · COMFYUI / Sky, icons, music and sound, made for this game",
                     f"({g['title']}: sky panorama full frame; {len(icon_ims)} icons; music waveform; {nsfx} sfx)"]))
    # c) Idol image -> Gaussian splat in game (real Idol splats, the kit's splat test scene)
    splat = CLIPS_DIR / "_splat.mp4"
    previews = sorted(g["dir"].glob("about/prop_*_preview.png")) or sorted(GAMES.glob("*/about/prop_*_preview.png"))
    src = Image.open(previews[0]).convert("RGB") if previews else None
    if src and src.width > src.height * 2:
        src = src.crop((0, 24, src.height - 24, src.height))
    st: dict = {}
    L_c = shot_len("how", "Idol image -> splat in game", base)

    def draw_c(t, i):
        f = st["r"].frame(i) if "r" in st else canvas()
        d = ImageDraw.Draw(f, "RGBA")
        if src:
            a = ramp(t, 0.1)
            th = contain(src, 400, 400).convert("RGBA")
            d.rounded_rectangle([70, 250, 70 + 440, 250 + 500], 22, fill=(8, 10, 14, int(220 * a)))
            th.putalpha(int(255 * a))
            f.alpha_composite(th, (90, 270))
            text(d, (90, 690), "prop image  →  splat", font(34, "Semibold"), FG, a)
        f.alpha_composite(shade(260, 0.8, bottom=False))
        kicker(d, (96, 64), "3  ·  Image to Gaussian splat  ·  Idol", ramp(t, 0.0), size=30)
        text(d, (96, 106), "Prop images become 3D splats, drawn right in the game", font(60, "Semibold"), FG,
             ramp(t, 0.1), stroke=2)
        return f
    segs.append(Seg("4. How it works", "Idol image -> splat in game", L_c, draw_c,
                    ["3 · IMAGE TO GAUSSIAN SPLAT · IDOL / Prop images become 3D splats, drawn right in the game",
                     f"(inset: {previews[0].name if previews else 'none'}; footage: kit splat demo with real Idol splats)"],
                    setup=(lambda: st.__setitem__("r", VideoReader(splat, 0.0, L_c))) if splat.exists() else None,
                    teardown=(lambda: st["r"].close()) if splat.exists() else None))
    # d) the builder writes game.js: the real file, scrolling, large
    code = (g["dir"] / "game.js").read_text(encoding="utf-8").splitlines()
    fm = mono(36)
    lh = 50
    L_d = shot_len("how", "game.js scroll", base)

    def color_of(line: str):
        s = line.strip()
        if s.startswith("//"):
            return (125, 135, 156)
        if "K." in s:
            return (255, 210, 130)
        return (214, 220, 232)

    def draw_d(t, i):
        f = canvas((16, 18, 25))
        d = ImageDraw.Draw(f, "RGBA")
        top = 200
        rows = (H - top) // lh
        scroll = max(0, len(code) - rows) * min(1.0, max(0.0, (t - 0.5) / (L_d - 0.8)))
        first = int(scroll)
        dy = (scroll - first) * lh
        for k in range(rows + 2):
            n = first + k
            if n >= len(code):
                break
            y = top + k * lh - dy
            if y < top - lh or y > H:
                continue
            text(d, (60, y), f"{n + 1:>3}", fm, (78, 86, 104))
            text(d, (170, y), code[n][:84], fm, color_of(code[n]))
        f.alpha_composite(shade(240, 0.96, bottom=False))
        kicker(d, (96, 50), f"4  ·  The builder writes the game  ·  web/games/{g['id']}/game.js, {len(code)} lines",
               ramp(t, 0.0), size=28)
        text(d, (96, 90), "Qwen3.8-27B composes tested kits: look, level, player, gameplay, UI", font(56, "Semibold"),
             FG, ramp(t, 0.1))
        return f
    segs.append(Seg("4. How it works", "game.js scroll", L_d, draw_d,
                    ["4 · THE BUILDER WRITES THE GAME / Qwen3.8-27B composes tested kits: look, level, player, gameplay, UI",
                     f"(real file: web/games/{g['id']}/game.js, {len(code)} lines)"]))
    # e) pitch -> kit choices, for an off-template pitch (the game's own mapping notes)
    cand = [x for x in gs if x["id"] == MAPPING_GAME] or games(only=[MAPPING_GAME])     # may not be in the games section
    gm = next((x for x in cand if "→" in (x["about"].get("mapping") or {}).get("notes", "")), None)
    if gm:
        mp = gm["about"]["mapping"]
        rows = []
        for part in re.split(r"(?<=\.)\s+", mp["notes"]):
            if "→" in part:
                left, right = [x.strip() for x in part.split("→", 1)]
                right = re.split(r"[;—]| \(|, since|, and the| rather than", right)[0].strip().rstrip(".")
                right = re.sub(r"^the kit's closest vehicle is ", "", right)
                lines = wrap(right, font(38, "Regular"), W - 640 - 96)
                if len(lines) > 2:                       # keep whole words, end at a clause boundary
                    lines = lines[:2]
                    lines[1] = re.sub(r"[,;:]?\s+\S*$", "", lines[1]) if len(lines[1]) > 20 else lines[1]
                rows.append((left, lines))
        rows = rows[:4]
        chosen = mp.get("chosen", {})
        chips = [f"{k.replace('_', ' ')}: {chosen[k]}" for k in ("level_kind", "player_type", "look", "camera") if k in chosen]
        pitch = gm.get("pitch", "")
        if pitch.startswith(gm.get("title", "") + ":"):
            pitch = pitch[len(gm["title"]) + 1:].strip()
        hook = pitch.split(".")[0]
        L_e = shot_len("how", "pitch -> kit mapping", base)
        st2: dict = {}

        def draw_e(t, i):
            f = st2["r"].frame(i) if "r" in st2 else canvas()
            f.alpha_composite(Image.new("RGBA", (W, H), (8, 10, 14, 205)))
            d = ImageDraw.Draw(f, "RGBA")
            kicker(d, (96, 64), f"5  ·  Off-template pitch  ·  {gm['title']}", ramp(t, 0.0), size=30)
            for k, line in enumerate(wrap(f"“{hook}.”", font(58, "Semibold"), W - 200)[:2]):
                text(d, (96, 110 + k * 70), line, font(58, "Semibold"), FG, ramp(t, 0.1))
            y = 330
            for k, (l, r) in enumerate(rows):
                a = ramp(t, 0.5 + 0.35 * k, 0.4)
                text(d, (96, y), l, font(46, "Bold"), ACCENT, a)
                text(d, (560, y), "→", font(46, "Bold"), MUTED, a)
                for li, ln in enumerate(r):
                    text(d, (640, y + 4 + li * 48), ln, font(38, "Regular"), (225, 230, 240), a)
                y += 60 + 48 * len(r)
            x = 96
            for k, c in enumerate(chips):
                x += chip(d, x, H - 120, c, ramp(t, 0.6 + 0.35 * len(rows) + 0.15 * k), size=28) + 16
            text(d, (W - 96, H - 92), "the plan's own notes", font(28, "Regular"), MUTED, ramp(t, 1.0), anchor="ra")
            return f
        segs.append(Seg("4. How it works", "pitch -> kit mapping", L_e, draw_e,
                        [f"5 · OFF-TEMPLATE PITCH · {gm['title']} / “{hook}.”"] + [f"{l} → {' '.join(r)}" for l, r in rows] + chips
                        + ["(from about.json mapping.notes, the plan's own words)"],
                        setup=lambda: st2.__setitem__("r", VideoReader(gm["play"], 2.0, L_e)),
                        teardown=lambda: st2["r"].close()))
    # f) playtest + vision judge: survey cameras full width, big per-version scores
    survey = g["dir"] / g["about"].get("survey", "about/survey.jpg")
    sv = Image.open(survey).convert("RGB") if survey.exists() else None
    sc = g["about"].get("score") if isinstance(g["about"].get("score"), dict) else {}
    vers = sc.get("versions", [])[-5:]
    best = sc.get("best")
    L_f = shot_len("how", "playtest + judge", base)
    sv_big = cover(sv, W, int(W * sv.height / sv.width), margin=1.0) if sv else None

    def draw_f(t, i):
        f = canvas()
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (96, 50), "6  ·  Playtest and judge", ramp(t, 0.0), size=30)
        text(d, (96, 90), "Autopilot plays it, a vision model scores it, the best version ships", font(56, "Semibold"),
             FG, ramp(t, 0.1))
        if sv_big:
            v = sv_big.convert("RGBA")
            v.putalpha(int(255 * ramp(t, 0.2)))
            f.alpha_composite(v, (0, 190))
            text(d, (W - 30, 190 + sv_big.height - 40), "survey cameras", font(26, "Regular"), (235, 238, 245),
                 ramp(t, 0.4), anchor="ra", stroke=1)
        y0 = 190 + (sv_big.height if sv_big else 0) + 50
        rowh = min(96, (H - y0 - 30) // max(1, len(vers)))
        for k, v in enumerate(vers):
            a = ramp(t, 0.5 + 0.25 * k, 0.4)
            y = y0 + k * rowh
            win = v.get("tag") == best
            col = ACCENT if win else (110, 122, 148)
            text(d, (96, y + rowh * 0.42), v.get("tag", "?"), font(44, "Bold"), FG, a, anchor="lm")
            wbar = 1250 * min(1.0, float(v.get("score", 0)) / 10) * a
            d.rounded_rectangle([230, y + 8, 230 + max(10, wbar), y + rowh - 14], 14, fill=rgba(col, a))
            text(d, (250 + wbar, y + rowh * 0.42), f"{float(v.get('score', 0)):.2f}", font(44, "Bold"), FG, a, anchor="lm")
            if win:
                chip(d, 420 + wbar, y + rowh * 0.42 - 28, "ships", ramp(t, 0.6 + 0.25 * len(vers), 0.4), size=30)
        return f
    segs.append(Seg("4. How it works", "playtest + judge", L_f, draw_f,
                    ["6 · PLAYTEST AND JUDGE / Autopilot plays it, a vision model scores it, the best version ships",
                     f"({g['title']}: survey sheet; scores " + ", ".join(f"{v.get('tag')} {float(v.get('score', 0)):.2f}"
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
        genre = g.get("genre", "").split(" / ")[0]
        x += chip(d, x, y0 + 14, genre if len(genre) <= 30 else genre[:29] + "…", a) + 12
        x += chip(d, x, y0 + 14, f"judge score {g['score_n']:.1f} / 10", a, fill=(30, 36, 48), fg=FG) + 12
        if g.get("composed"):
            chip(d, x0, y0 - 56, "level laid out by the model (Level.compose)", ramp(gt, 0.6), fill=(255, 120, 90), fg=(20, 10, 8))
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
        text(d, (W // 2, H - 64), NOTE, font(32, "Regular"), (170, 178, 194), ramp(t, 2.4), anchor="ms")
        return f
    return Seg("7. Close", "close card", dur, draw, [
        f"Blocksfield / {TITLE}", "Every model open-weight · One RTX 5090 · $0 per generation", pv.HASHTAG,
        pv.REPO_URL, PAGES_URL, f"Small print: {NOTE}"], fade_in=0.3, fade_out=1.0)


# ---------------------------------------------------------------- assembly

def build(gs: list[dict]) -> list[Seg]:
    head = cold_open(gs, SECTIONS["open"]) + paid(SECTIONS["paid"]) + studio(gs, SECTIONS["studio"]) + how(gs, SECTIONS["how"])
    mg = next((g for g in gs if g.get("mechanics")), None)
    beat = [mechanics_beat(mg, shot_len("mechanics", "mechanics beat", 5.0))] if mg else []
    cg = cutscene_game(gs)
    if cg:
        beat = [ltx_beat(cg, shot_len("ltx", "ltx beat", 5.0))] + beat
    tail = beat + roblox(SECTIONS["roblox"] - (beat[0].dur - 2.0 if beat else 0)) + [close(SECTIONS["close"])]
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


def cutscene_game(gs: list[dict]) -> dict | None:
    """The best shown (else any shipped) game with LTX-2.5 intro + win cutscenes."""
    for g in gs + [x for x in games(only=None, skip=set()) if x not in gs]:
        a = g["dir"] / "assets"
        if (a / "cutscene_intro.mp4").exists() and (a / "cutscene_win.mp4").exists():
            return g
    return None


def ltx_beat(g: dict, dur: float) -> Seg:
    """The game's generated intro and win cutscenes side by side, labelled LTX-2.5."""
    a = g["dir"] / "assets"
    st: dict = {}
    pw, ph = 900, 506

    def draw(t, i):
        f = canvas((10, 11, 16))
        for k, key in enumerate(("intro", "win")):
            v = st[key].frame(i)
            v = v.resize((pw, ph))
            x = 40 + k * (pw + 40)
            f.alpha_composite(v, (x, 300))
            d = ImageDraw.Draw(f, "RGBA")
            chip(d, x, 300 + ph + 18, f"{key} cutscene", ramp(t, 0.3 + 0.2 * k), fill=(30, 36, 48), fg=FG, size=26)
        d = ImageDraw.Draw(f, "RGBA")
        kicker(d, (80, 110), f"Cutscenes  ·  {g['title']}", ramp(t, 0.0), size=30)
        text(d, (80, 150), "Intro and victory cutscenes, generated with LTX-2.5", font(60, "Semibold"), FG, ramp(t, 0.1))
        text(d, (80, H - 70), "image-to-video from the game's own concept art, with generated sound  ·  a uniform post-build stage",
             font(28, "Regular"), MUTED, ramp(t, 0.5))
        return f

    def setup():
        st["intro"] = VideoReader(a / "cutscene_intro.mp4", 0.2, dur)
        st["win"] = VideoReader(a / "cutscene_win.mp4", 0.2, dur)

    def teardown():
        for r in st.values():
            r.close()
    return Seg("5c. LTX", "ltx beat", dur, draw,
               [f"CUTSCENES · {g['title']} / Intro and victory cutscenes, generated with LTX-2.5",
                "image-to-video from the game's own concept art, with generated sound · a uniform post-build stage"],
               audio=[(a / "cutscene_win.mp4", 0.2, 0.2 + dur, 0.0, -24.0 - lufs(a / "cutscene_win.mp4") + 0)] if probe(a / "cutscene_win.mp4")["audio"] else [],
               setup=setup, teardown=teardown, fade_in=0.15, fade_out=0.15)


def mechanics_beat(g: dict, dur: float) -> Seg:
    """A real game's Mechanics call (from its game.js) beside that game's own gameplay."""
    fm = mono(28)
    lines = []
    for ln in g["mechanics"]:                       # wrap long code lines (continuation indented)
        ind = len(ln) - len(ln.lstrip())
        while len(ln) > 52:
            cut = max(ln.rfind(" ", 0, 52), ind + 20)
            com = ln.lstrip().startswith("//")
            lines.append(ln[:cut]); ln = " " * ind + ("// " if com else "    ") + ln[cut:].lstrip()
        lines.append(ln)
    st: dict = {}

    def draw(t, i):
        f = canvas((14, 16, 22))
        v = st["r"].frame(i)
        v = v.resize((900, int(900 * H / W)))
        f.alpha_composite(v, (W - v.width, (H - v.height) // 2))
        f.alpha_composite(shade(240, 0.9, bottom=False))
        d = ImageDraw.Draw(f, "RGBA")
        d.rectangle([0, 0, W - v.width + 6, H], fill=(14, 16, 22, 235))
        kicker(d, (80, 60), f"New mechanic  ·  {g['title']}", ramp(t, 0.0), size=30)
        text(d, (80, 100), "The model can add its own mechanics", font(56, "Semibold"), FG, ramp(t, 0.1))
        shown = int(sum(len(x) for x in lines) * min(1.0, max(0.0, (t - 0.4) / 2.0)))
        y = 260
        for ln in lines:
            col = (125, 135, 156) if ln.strip().startswith("//") else (255, 210, 130) if "Mechanics." in ln else (214, 220, 232)
            text(d, (80, y), ln[:max(0, shown)], fm, col)
            shown -= len(ln)
            y += 40
        text(d, (80, H - 70), f"web/games/{g['id']}/game.js", font(26, "Regular"), MUTED, ramp(t, 0.5))
        return f
    return Seg("5b. Mechanics", "mechanics beat", dur, draw,
               [f"NEW MECHANIC · {g['title']} / The model can add its own mechanics", "(code, real): " + " ".join(x.strip() for x in lines)],
               setup=lambda: st.__setitem__("r", VideoReader(g["play"], 2.5, dur)), teardown=lambda: st["r"].close(),
               fade_in=0.15, fade_out=0.15)


def section_spans(segs: list[Seg]) -> dict:
    spans, clock = {}, 0.0
    for s in segs:
        key = s.section.split(". ", 1)[1] if ". " in s.section else s.section
        spans.setdefault(key, [clock, clock])
        spans[key][1] = clock + s.dur
        clock += s.dur
    return spans


SEC_KEY = {"ltx": "LTX", "mechanics": "Mechanics", "open": "Cold open", "paid": "Paid workflow", "studio": "Studio", "how": "How it works", "games": "The games",
           "roblox": "Roblox", "close": "Close"}


def vo_placements(segs: list[Seg]) -> list[tuple[float, float, str]]:
    spans = section_spans(segs)
    shots: dict = {}
    clock = 0.0
    for s in segs:
        key = s.section.split(". ", 1)[1] if ". " in s.section else s.section
        shots.setdefault(key, {}).setdefault(s.label, clock)
        clock += s.dur
    out = []
    for sec, off, line in VO:
        a, b = spans.get(SEC_KEY[sec], (None, None))
        if a is None:
            continue
        if isinstance(off, str):
            at = shots.get(SEC_KEY[sec], {}).get(off.split(":", 1)[1])
            if at is None:
                continue
            start = at + 0.3
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
    ap.add_argument("--skip", default="", help="comma-separated game ids to leave out")
    ap.add_argument("--preview", action="store_true", help="one still per shot to video/v3/preview_*.jpg")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    V3.mkdir(parents=True, exist_ok=True)
    global USE_VO
    USE_VO = not a.no_vo and not a.preview
    gs = games([x for x in a.games.split(",") if x] or None, {x for x in a.skip.split(",") if x})
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
