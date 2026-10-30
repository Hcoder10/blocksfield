"""Blocksfield's art and audio builder tools: every one is a ComfyUI workflow run through the arbiter.

    generate_texture   Qwen-Image surface -> made seamless here -> MaterialVariant colour map
    generate_skybox    Qwen-Image sky panorama + zenith -> six wrapped Sky faces
    generate_sfx       Stable Audio 3 small-sfx (workflows/api/sfx.json) -> MP3 for Kit.Sound
    generate_music     ACE-Step 1.5 (workflows/api/music.json) -> looping MP3 for Kit.Sound
    generate_icon      Qwen-Image + BiRefNet cut-out, game-UI icon recipe
    generate_ui_art    the same for panels, buttons, banners and badges, with a 9-slice centre

Delivery is the harness's AssetStore: images go in through AssetStore.add (so Kit.Assets.image(name) works),
audio is mirrored next to them (art/audio/, same Studio content folder). Everything lands in Studio's local
content folder as rbxasset://cybus/<run>/<file>, which loads in Studio play sessions with no upload.

The image maths (seamless tiling, sky slicing) is plain numpy/PIL in the functions below, testable without a GPU.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import shutil
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

log = logging.getLogger("blocksfield.assets")
ARBITER = os.environ.get("HARNESS_IMAGEGEN_URL", "http://127.0.0.1:8100").rstrip("/")

# Qwen-Image native sizes (blocksfield.recipe.NATIVE); the sky panorama is the widest one.
PANO_W, PANO_H = 2752, 1536
SKY_FACE = 512

TEXTURE = ("A seamless tileable top-down surface texture filling the entire frame edge to edge, orthographic, "
           "flat even lighting with no shadows or vignette, uniform detail density across the whole frame, no "
           "objects, no text, stylised game texture with crisp readable detail")
SKY_PANO = ("A wide 360-degree sky panorama for a game skybox, seen from high up: only sky and clouds. The horizon is "
            "a straight level line across the lower third of the image, below it only soft hazy distant cloud sea "
            "and atmosphere glow, no land, no ground, no mountains, no buildings, no trees, no people, no text. "
            "Clouds spread evenly across the whole width, no single focal object, painterly stylised game sky")
SKY_UP = ("Looking straight up into the sky at the zenith: a top-down view of open sky with soft clouds spread "
          "evenly over the whole frame, no horizon, no ground, no sun disc, no objects, no text, painterly "
          "stylised game sky")
SFX = ("Clean isolated game sound effect, close-up studio recording, punchy and clear, no music, no voice, no "
       "background noise")
MUSIC = "instrumental, loopable video game background music, clean mix"
UI = {
    "icon": ("A polished mobile game UI icon: one bold centred object, thick dark outline, glossy highlights and soft "
             "cel shading, vibrant saturated colours, slight three-quarter view, filling most of the frame, no text, "
             "no frame, no background"),
    "panel": ("An empty game UI window panel, straight front view, perfectly symmetrical, rounded corners, a thick "
              "outlined bevelled border with a glossy rim highlight, and a large plain flat-coloured empty centre "
              "for content, no text, no icons, no background"),
    "button": ("An empty glossy game UI button, a wide horizontal rounded rectangle, thick dark outline, bright bevelled "
               "top highlight and a darker bottom lip, flat front view, centred, no text, no icons, no background"),
    "banner": ("An empty game UI title ribbon banner, wide and horizontal, folded ribbon tails at both ends, thick "
               "outline, glossy highlights, a plain flat centre for a title, front view, no text, no background"),
    "badge": ("A game achievement badge emblem: a round or shield shape with a metallic rim, a glossy centred symbol, "
              "thick outline, bold colours, front view, centred, no text, no background"),
}
UI_RATIO_KIND = {"icon": "icon", "panel": "panel", "button": "button", "banner": "banner", "badge": "icon"}
SLICED = {"panel", "button", "banner"}
BASE_MATERIALS = {"cobble": "Cobblestone", "brick": "Brick", "wood": "WoodPlanks", "plank": "WoodPlanks",
                  "stone": "Slate", "rock": "Slate", "grass": "Grass", "moss": "Grass", "metal": "Metal", "steel": "Metal",
                  "rust": "CorrodedMetal", "sand": "Sand", "dirt": "Ground", "mud": "Mud", "soil": "Ground",
                  "fabric": "Fabric", "cloth": "Fabric", "carpet": "Fabric", "concrete": "Concrete",
                  "ice": "Ice", "snow": "Snow", "marble": "Marble", "granite": "Granite", "tile": "Pavement",
                  "asphalt": "Asphalt", "lava": "CrackedLava", "glass": "Glass"}


# --------------------------------------------------------------------------------------------- image maths
def _smooth(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _edge_weight(n: int, feather: float) -> np.ndarray:
    """0 at both ends of an axis of length n, rising smoothly to 1 at `feather` (fraction of n) from the ends."""
    x = np.arange(n) + 0.5
    d = np.minimum(x, n - x) / (feather * n)
    return _smooth(d)


def make_seamless(img: Image.Image, feather: float = 0.3) -> Image.Image:
    """Offset-by-half cross-fade: blend the image with its x-, y- and xy-shifted copies so each copy's seam sits
    where its weight is zero. Every copy wraps at the output's edges where it is used, so the result tiles. The blend
    is variance-preserving (sum w_i (I_i - mean) / sqrt(sum w_i^2)), so the cross-faded band keeps its contrast."""
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    h, w, _ = a.shape
    ax = _edge_weight(w, feather)[None, :, None]
    ay = _edge_weight(h, feather)[:, None, None]
    copies = [a, np.roll(a, w // 2, 1), np.roll(a, h // 2, 0), np.roll(np.roll(a, w // 2, 1), h // 2, 0)]
    weights = [ax * ay, (1 - ax) * ay, ax * (1 - ay), (1 - ax) * (1 - ay)]
    mu = a.mean(axis=(0, 1), keepdims=True)
    num = sum(wt * (c - mu) for wt, c in zip(weights, copies))
    norm = np.sqrt(sum(wt * wt for wt in weights))
    out = mu + num / norm
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8))


def seam_report(img: Image.Image) -> dict:
    """How visible the wrap seams are when tiled: mean |delta| across the seam / mean |delta| between neighbours."""
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    col = np.abs(np.diff(a, axis=1)).mean()
    row = np.abs(np.diff(a, axis=0)).mean()
    seam_x = np.abs(a[:, 0] - a[:, -1]).mean()
    seam_y = np.abs(a[0] - a[-1]).mean()
    return {"seam_x_ratio": round(float(seam_x / max(col, 1e-6)), 2),
            "seam_y_ratio": round(float(seam_y / max(row, 1e-6)), 2)}


def tile(img: Image.Image, n: int = 2) -> Image.Image:
    w, h = img.size
    out = Image.new(img.mode, (w * n, h * n))
    for i in range(n):
        for j in range(n):
            out.paste(img, (i * w, j * h))
    return out


def wrap_horizontal(a: np.ndarray, feather: float = 0.25) -> np.ndarray:
    """Make an image wrap left-to-right (the 1D form of make_seamless), keeping each row's mean (sky gradients)."""
    w = a.shape[1]
    ax = _edge_weight(w, feather)[None, :, None]
    r = np.roll(a, w // 2, 1)
    mu = a.mean(axis=1, keepdims=True)
    return mu + (ax * (a - mu) + (1 - ax) * (r - mu)) / np.sqrt(ax * ax + (1 - ax) ** 2)


def _fade_rows(face: np.ndarray, color: np.ndarray, top: bool, frac: float) -> np.ndarray:
    n = face.shape[0]
    y = np.arange(n) + 0.5
    d = (y if top else n - y) / (frac * n)
    w = _smooth(d)[:, None, None]                 # 0 at the edge -> the shared colour
    return w * face + (1 - w) * color


def find_horizon(img: Image.Image, default: float = 2 / 3) -> float:
    """Height fraction of the horizon: the steepest brightness drop (bright horizon glow -> haze below it) in the lower
    half. The model does not always put it where the prompt says (asked for 2/3, drew it at ~0.82)."""
    a = np.asarray(img.convert("L").resize((64, 256)), dtype=np.float64).mean(axis=1)
    a = np.convolve(a, np.ones(7) / 7, mode="same")
    lo, hi = int(0.5 * len(a)), int(0.94 * len(a))
    g = np.diff(a)[lo:hi]
    if len(g) == 0 or g.min() > -1.0:            # no clear edge: trust the prompt
        return default
    return float(np.clip((lo + int(g.argmin()) + 1) / len(a), 0.5, 0.88))


def sky_faces(pano: Image.Image, up: Image.Image, horizon: float | None = None, size: int = SKY_FACE) -> dict:
    """Panorama (horizon at `horizon` of its height) + zenith image -> {Lf, Ft, Rt, Bk, Up, Dn} PIL faces.

    The side faces are a 4:1 band centred on the horizon (90 degrees tall at the panorama's own angular scale), wrapped
    so the last face meets the first, cut into four squares in horizontal-cross order Lf Ft Rt Bk. The top and bottom
    rows of every side face, the Up face's rim and the whole Dn face fade to one shared zenith / nadir colour, so the
    cube's seams match whatever the orientation of Up and Dn."""
    a = np.asarray(pano.convert("RGB"), dtype=np.float64)
    h, w, _ = a.shape
    s = w // 4
    cy = int(round(h * (find_horizon(pano) if horizon is None else horizon)))
    y0 = min(max(0, cy - s // 2), max(0, h - s))
    band = a[y0:y0 + s, :4 * s]
    if band.shape[0] < s:                        # a short panorama: stretch what there is to a square band
        band = np.asarray(Image.fromarray(band.astype(np.uint8)).resize((4 * s, s), Image.LANCZOS), np.float64)
    band = wrap_horizontal(band)
    sides = [band[:, i * s:(i + 1) * s] for i in range(4)]
    # the shared colours are medians, not means: the mean of blue sky and peach clouds is grey, the median is sky
    c_top = np.median(np.concatenate([f[: max(2, s // 12)].reshape(-1, 3) for f in sides]), axis=0)
    c_dn = np.median(np.concatenate([f[-max(2, s // 12):].reshape(-1, 3) for f in sides]), axis=0)
    sides = [_fade_rows(_fade_rows(f, c_top, True, 0.12), c_dn, False, 0.18) for f in sides]
    u = np.asarray(up.convert("RGB").resize((s, s), Image.LANCZOS), dtype=np.float64)
    gy, gx = np.mgrid[0:s, 0:s]
    t = np.maximum(np.abs(gx + 0.5 - s / 2), np.abs(gy + 0.5 - s / 2)) / (s / 2)     # 0 centre, 1 rim
    wu = 1 - _smooth((t - 0.7) / 0.3)[..., None]
    # match the zenith image's overall colour to the panorama's top so the fade is short and soft
    u = u - u.mean(axis=(0, 1)) + 0.5 * (u.mean(axis=(0, 1)) + c_top)
    u = wu * u + (1 - wu) * c_top
    dn = np.ones((s, s, 3)) * c_dn

    def im(x: np.ndarray) -> Image.Image:
        return Image.fromarray(np.clip(x, 0, 255).round().astype(np.uint8)).resize((size, size), Image.LANCZOS)
    names = ["Lf", "Ft", "Rt", "Bk"]
    out = {n: im(f) for n, f in zip(names, sides)}
    out["Up"], out["Dn"] = im(u), im(dn)
    return out


def sky_cross(faces: dict) -> Image.Image:
    """Horizontal-cross preview: Up above Ft, Dn below, Lf Ft Rt Bk across."""
    s = faces["Ft"].width
    out = Image.new("RGB", (4 * s, 3 * s), (24, 24, 28))
    out.paste(faces["Up"], (s, 0))
    for i, n in enumerate(["Lf", "Ft", "Rt", "Bk"]):
        out.paste(faces[n], (i * s, s))
    out.paste(faces["Dn"], (s, 2 * s))
    return out


def crop_alpha(img: Image.Image, pad: float = 0.03) -> Image.Image:
    """Trim the transparent margin a cut-out leaves, keeping a little padding."""
    img = img.convert("RGBA")
    box = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not box:
        return img
    l, t, r, b = box
    p = int(pad * max(r - l, b - t))
    return img.crop((max(0, l - p), max(0, t - p), min(img.width, r + p), min(img.height, b + p)))


def png_bytes(img: Image.Image, max_side: int | None = None) -> bytes:
    if max_side and max(img.size) > max_side:
        img = img.copy()
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def guess_base(prompt: str) -> str:
    p = prompt.lower()
    return next((m for k, m in BASE_MATERIALS.items() if k in p), "SmoothPlastic")


# --------------------------------------------------------------------------------------------- arbiter calls
async def run_job(workflow: str, params: dict, timeout: float = 1800) -> list[dict]:
    """POST /job -> [{filename, kind, data: bytes}]; raises RuntimeError on a failed workflow."""
    async with httpx.AsyncClient(timeout=timeout) as http:
        r = await http.post(f"{ARBITER}/job", json={"workflow": workflow, "params": params})
    if r.status_code >= 400:
        raise RuntimeError(f"{workflow} failed ({r.status_code}): {r.text[:400]}")
    return [{**f, "data": base64.b64decode(f["b64"])} for f in r.json()["files"]]


async def gen_image(prompt: str, kind: str, transparent: bool, out_size: int = 1024) -> Image.Image:
    """POST /generate (the arbiter applies blocksfield.recipe for the kind's size and the RGBA template)."""
    async with httpx.AsyncClient(timeout=900) as http:
        r = await http.post(f"{ARBITER}/generate", json={"prompt": prompt, "kind": kind, "transparent": transparent,
                                                         "out_size": out_size})
    if r.status_code >= 400:
        raise RuntimeError(f"image generation failed ({r.status_code}): {r.text[:400]}")
    return Image.open(io.BytesIO(base64.b64decode(r.json()["png_b64"]))).copy()


async def raw_image(prompt: str, width: int, height: int) -> Image.Image:
    files = await run_job("image", {"prompt": prompt, "width": width, "height": height, "seed": -1})
    img = next((f for f in files if f["filename"].lower().endswith((".png", ".jpg", ".webp"))), None)
    if img is None:
        raise RuntimeError("image workflow produced no image")
    return Image.open(io.BytesIO(img["data"])).copy()


def _audio_files(files: list[dict]) -> list[dict]:
    return [f for f in files if f["filename"].lower().endswith((".mp3", ".ogg", ".flac", ".wav", ".opus"))]


async def make_texture(prompt: str, tileable: bool = True) -> tuple[Image.Image, Image.Image, dict]:
    raw = await gen_image(prompt, "texture", False, 1024)
    raw = raw.convert("RGB")
    out = make_seamless(raw) if tileable else raw
    return raw, out, {"raw": seam_report(raw), "fixed": seam_report(out)}


async def make_skybox(prompt: str) -> tuple[dict, Image.Image, Image.Image]:
    pano, up = await asyncio.gather(raw_image(f"{prompt}. {SKY_PANO}", PANO_W, PANO_H),
                                    raw_image(f"{prompt}. {SKY_UP}", 2048, 2048))   # one swap: both in one burst
    return sky_faces(pano, up), pano, up


async def make_sfx(prompt: str, seconds: float, variants: int = 1) -> list[bytes]:
    secs = max(1, int(round(seconds)))
    files = await run_job("sfx", {"prompt": f"{prompt.strip().rstrip('.')}. {SFX}. Length: {secs} seconds.",
                                  "seconds": float(seconds), "variants": int(variants), "seed": -1})
    audio = _audio_files(files)
    if not audio:
        raise RuntimeError("sfx workflow produced no audio")
    return [f["data"] for f in audio]


async def make_music(tags: str, seconds: float) -> bytes:
    files = await run_job("music", {"tags": f"{tags.strip().rstrip(',')}, {MUSIC}", "seconds": float(seconds),
                                    "lyrics": "[Instrumental]", "seed": -1})
    audio = _audio_files(files)
    if not audio:
        raise RuntimeError("music workflow produced no audio")
    return audio[0]["data"]


async def make_ui(prompt: str, kind: str, style: str = "") -> Image.Image:
    s = f" Art direction: {style.strip()[:300]}" if style.strip() else ""
    img = await gen_image(f"{prompt.strip().rstrip('.')}. {UI[kind]}.{s}", UI_RATIO_KIND[kind], True, 1024)
    return crop_alpha(img)


# --------------------------------------------------------------------------------------------- delivery
class AudioStore:
    """Audio beside the run's AssetStore images: files in art/audio/, copied into the same Studio content folder."""

    def __init__(self, assets) -> None:
        self.assets = assets
        self.dir = Path(assets.dir) / "audio"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index_file = self.dir / "audio.json"
        try:
            self.index: dict = json.loads(self.index_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.index = {}

    def add(self, filename: str, data: bytes, *, kind: str, prompt: str) -> str:
        path = self.dir / filename
        path.write_bytes(data)
        d = self.assets.content_dir()
        if d is not None:
            try:
                d.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, d / filename)
            except OSError as e:
                log.warning("could not install %s into Studio content: %s", filename, e)
        cid = f"rbxasset://cybus/{self.assets.run_id}/{filename}"
        self.index[filename] = {"id": cid, "file": str(path), "kind": kind, "prompt": prompt[:500]}
        self.index_file.write_text(json.dumps(self.index, indent=1), encoding="utf-8")
        return cid


def _luau_list(ids: list[str]) -> str:
    return "{ " + ", ".join(f'"{i}"' for i in ids) + " }"


def tools(build, stage, run_dir):
    from harness.tools.base import Tool, ToolResult
    from harness.tools.imagegen import guess_slice, safe_name
    store = getattr(build, "assets", None)
    if store is None:
        log.warning("asset tools disabled: the run has no AssetStore (HARNESS_IMAGEGEN_PROVIDER unset)")
        return []
    audio = AudioStore(store)

    def style() -> str:
        return (getattr(build, "style", None) or {}).get("direction", "")

    async def generate_texture(name: str, prompt: str, tileable: bool = True, studs_per_tile: float = 8,
                               base: str = "") -> ToolResult:
        name = safe_name(name)
        base = base or guess_base(prompt)
        try:
            _, tex, seams = await make_texture(prompt, tileable)
        except Exception as e:  # noqa: BLE001
            return ToolResult(text=f"ERROR: texture generation failed: {e}")
        cid = store.add(name, png_bytes(tex), kind="texture", prompt=prompt)
        spt = float(studs_per_tile)
        return ToolResult(
            text=f"texture '{name}' installed as {cid} (1024x1024{', seamless' if tileable else ''}). Make it a "
                 f"material once, then put it on parts or whole models:\n"
                 f"  Kit.LookKit.material(\"{name}\", {{ base = Enum.Material.{base}, colorMap = \"{cid}\", "
                 f"studsPerTile = {spt:g} }})\n"
                 f"  Kit.LookKit.useMaterial(partOrModel, \"{name}\")\n"
                 f"(useMaterial sets the MaterialVariant where one could be made and otherwise tiles a Texture on "
                 f"every face; do not set part.MaterialVariant yourself: running scripts cannot create the variant.) "
                 f"Also Assets.image(\"{name}\"). The image shows 2x2 tiles: regenerate if it does not fit the style "
                 f"guide.",
            images=[png_bytes(tile(tex), 768)])

    async def generate_skybox(name: str, prompt: str) -> ToolResult:
        name = safe_name(name)
        full = f"{prompt.strip().rstrip('.')}. Colour mood: {style()[:240]}" if style() else prompt
        try:
            faces, _, _ = await make_skybox(full)
        except Exception as e:  # noqa: BLE001
            return ToolResult(text=f"ERROR: skybox generation failed: {e}")
        ids = {n: store.add(f"{name}_{n.lower()}", png_bytes(f), kind="skybox", prompt=prompt)
               for n, f in faces.items()}
        faces_luau = ", ".join(f'{n.lower()} = "{ids[n]}"' for n in ("Bk", "Dn", "Ft", "Lf", "Rt", "Up"))
        return ToolResult(
            text=f"skybox '{name}' installed (6 faces, {SKY_FACE}px). Apply it after Kit.LookKit.apply(...), which "
                 f"removes every Sky LookKit did not make:\n  Kit.LookKit.skybox({{ {faces_luau} }})\n"
                 f"The image is the cube cross: Up / Lf Ft Rt Bk / Dn.",
            images=[png_bytes(sky_cross(faces), 1024)])

    async def generate_sfx(name: str, prompt: str, seconds: float = 2.0, variants: int = 1) -> ToolResult:
        name = safe_name(name)
        seconds = min(max(float(seconds), 0.5), 20.0)
        variants = min(max(int(variants), 1), 4)
        try:
            clips = await make_sfx(prompt, seconds, variants)
        except Exception as e:  # noqa: BLE001
            return ToolResult(text=f"ERROR: sound generation failed: {e}")
        ids = [audio.add(f"{name}{'' if i == 0 else f'_{i + 1}'}.mp3", c, kind="sfx", prompt=prompt)
               for i, c in enumerate(clips)]
        return ToolResult(
            text=f"sound '{name}' installed ({len(ids)} variant(s), {seconds:g}s). Register it where your audio is "
                 f"set up:\n  Sound.register(\"{name}\", {{ ids = {_luau_list(ids)}, group = \"SFX\", volume = 0.7, "
                 f"pitch = 0.05 }})\nthen `Sound.play(\"{name}\")` (or `Sound.play(\"{name}\", {{ parent = part }})` "
                 f"for 3D). Several ids are picked at random each play.")

    async def generate_music(name: str, tags: str, seconds: float = 60.0) -> ToolResult:
        name = safe_name(name)
        seconds = min(max(float(seconds), 10.0), 240.0)
        try:
            track = await make_music(tags, seconds)
        except Exception as e:  # noqa: BLE001
            return ToolResult(text=f"ERROR: music generation failed: {e}")
        cid = audio.add(f"{name}.mp3", track, kind="music", prompt=tags)
        return ToolResult(
            text=f"music '{name}' installed as {cid} ({seconds:g}s). Register and play it on the client:\n"
                 f"  Sound.register(\"{name}\", {{ ids = {{ \"{cid}\" }}, group = \"Music\", volume = 0.5, "
                 f"looped = true }})\n  Sound.music(\"{name}\", 1.5)")

    async def ui_art(name: str, prompt: str, kind: str) -> ToolResult:
        name = safe_name(name)
        if kind not in UI:
            return ToolResult(text=f"ERROR: kind must be one of {', '.join(sorted(UI))}")
        try:
            img = await make_ui(prompt, kind, style())
        except Exception as e:  # noqa: BLE001
            return ToolResult(text=f"ERROR: UI art generation failed: {e}")
        png = png_bytes(img, 1024 if kind != "icon" else 512)
        sl = guess_slice(png) if kind in SLICED else None
        cid = store.add(name, png, kind=kind, prompt=prompt, slice_center=sl)
        w, h = Image.open(io.BytesIO(png)).size
        use = f"imageLabel.Image = Assets.image(\"{name}\")  -- {cid}, {w}x{h}, transparent"
        if sl:
            use += (f"\nimageLabel.ScaleType = Enum.ScaleType.Slice; imageLabel.SliceCenter = "
                    f"Rect.new({', '.join(map(str, sl))})  -- or Assets.slice(\"{name}\"); stretches without "
                    f"distorting the border")
        else:
            use += "\nimageLabel.ScaleType = Enum.ScaleType.Fit; imageLabel.BackgroundTransparency = 1"
        return ToolResult(text=f"{kind} '{name}' installed.\n{use}\nLook at it: regenerate with a better prompt if it "
                               f"does not fit the style guide.", images=[png])

    async def generate_icon(name: str, prompt: str) -> ToolResult:
        return await ui_art(name, prompt, "icon")

    async def generate_ui_art(name: str, prompt: str, kind: str = "panel") -> ToolResult:
        return await ui_art(name, prompt, kind)

    s = {"type": "object", "additionalProperties": False}
    nm = {"type": "string", "description": "snake_case asset name"}
    return [
        Tool("generate_texture",
             "Generate a seamless tiling surface texture (floor, wall, ground, roof, fabric...) in the game's style and "
             "get the Luau to use it as a MaterialVariant. Better than flat colours on big surfaces.",
             {**s, "required": ["name", "prompt"], "properties": {
                 "name": nm, "prompt": {"type": "string", "description": "the surface: material, pattern, colours"},
                 "tileable": {"type": "boolean"},
                 "studs_per_tile": {"type": "number", "description": "how many studs one repeat covers (default 8)"},
                 "base": {"type": "string", "description": "Enum.Material name for physics/sound (default: "
                                                           "guessed from the prompt)"}}},
             generate_texture, mutating=True),
        Tool("generate_skybox",
             "Generate a custom painted sky (6 Sky faces) for the game's mood and get the Sky property assignments.",
             {**s, "required": ["name", "prompt"], "properties": {
                 "name": nm, "prompt": {"type": "string", "description": "the sky: time of day, clouds, colours"}}},
             generate_skybox, mutating=True),
        Tool("generate_sfx",
             "Generate a sound effect (impact, pickup, whoosh, UI click, explosion, footstep, ambience...) and get the "
             "Sound.register line for it.",
             {**s, "required": ["name", "prompt"], "properties": {
                 "name": nm, "prompt": {"type": "string", "description": "the sound: source, material, character"},
                 "seconds": {"type": "number", "description": "length; 1-3 for hits and clicks, 3-6 for actions, "
                                                              "6-15 for ambience"},
                 "variants": {"type": "integer", "description": "1-4 takes to randomise between (default 1)"}}},
             generate_sfx, mutating=True),
        Tool("generate_music",
             "Generate an instrumental looping music track and get the Sound.register / Sound.music lines.",
             {**s, "required": ["name", "tags"], "properties": {
                 "name": nm, "tags": {"type": "string", "description": "genre, mood, instruments, tempo words"},
                 "seconds": {"type": "number", "description": "length (default 60)"}}},
             generate_music, mutating=True),
        Tool("generate_icon",
             "Generate a polished transparent game UI icon (currency, item, ability, menu button glyph).",
             {**s, "required": ["name", "prompt"], "properties": {
                 "name": nm, "prompt": {"type": "string", "description": "the one object the icon shows"}}},
             generate_icon, mutating=True),
        Tool("generate_ui_art",
             "Generate polished transparent game UI art: a panel (window), button skin, title banner or badge. "
             "Panels, buttons and banners come with a 9-slice centre.",
             {**s, "required": ["name", "prompt"], "properties": {
                 "name": nm, "prompt": {"type": "string", "description": "colours, material, theme"},
                 "kind": {"type": "string", "enum": sorted(UI)}}},
             generate_ui_art, mutating=True),
    ]
