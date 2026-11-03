"""Generated assets for a web game: ComfyUI jobs through the arbiter (blocksfield.asset_tools), written as files plus
the assets/assets.json manifest ThreeKit's assets.js reads (web/kit/CONTRACT.md "Generated assets").

    sky     Qwen-Image panorama -> 2048x1024 equirect (horizon at mid-height, wrapped left-right, poles faded)
    icon    Qwen-Image + BiRefNet RGBA cut-out, trimmed (asset_tools.make_ui)
    music   ACE-Step loop (asset_tools.make_music)
    sfx     Stable Audio clip per gameplay event (asset_tools.make_sfx)
    prop    Idol splat (TRELLIS.2 fallback) -> voxel boxes (blocksfield.splat_to_parts) -> JSON
    concept Qwen-Image concept frames: the judge's visual target, never shipped as game art

Every asset is optional: one that fails is logged and left out of the manifest, and the kits fall back to their
procedural defaults. A file already on disk is kept (a resumed run does not pay for it twice).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path

import numpy as np
from PIL import Image

from blocksfield import asset_tools

log = logging.getLogger("blocksfield.web_assets")

EQ_W, EQ_H = 2048, 1024
JOB_TIMEOUT = 1500            # one art job, queue wait included (an art turn can sit behind a long LLM turn)
SFX_EVENTS = ("collect", "jump", "land", "damage", "death", "checkpoint", "win", "lose", "boost", "respawn")
# Audio.auto plays these names for the CONTRACT events and resolves name -> asset 'sfx_<name>' (audio.js)
SFX_NAME = {"damage": "hit"}

CONCEPT = ("An in-game screenshot of a polished stylised 3D browser game, third-person gameplay camera behind and "
           "above the player character, the whole play space readable: {scene}. Art direction: {style}. Soft "
           "shadows, rich painted sky, rim light, bloom on pickups, lush detail, cohesive palette, a clean HUD in "
           "the corners, like a shipped Nintendo-quality indie game, not photoreal, no text other than the HUD")
SKY = ("A wide 360-degree sky panorama for a game skybox, seen from high up: only sky and clouds. The horizon is a "
       "straight level line across the lower third of the image, below it only soft hazy distant cloud sea and "
       "atmosphere glow, no land, no ground, no mountains, no buildings, no trees, no people, no text. Clouds spread "
       "evenly across the whole width, no single focal object, painterly stylised game sky")


def safe(name: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", str(name).lower()).strip("_")[:40] or "asset"


# --------------------------------------------------------------------------------------------- image maths
def equirect(pano: Image.Image, width: int = EQ_W, height: int = EQ_H, horizon: float | None = None) -> Image.Image:
    """A wide sky picture (horizon somewhere in its lower half) -> an equirect panorama for a sphere background.

    The picture's sky (top .. horizon) fills elevation ~75..0 degrees, its haze (horizon .. bottom) the first ~20
    degrees below the horizon; above and below that the rows fade to the median zenith / nadir colour (an equirect's
    poles squeeze a whole row into one point, so any detail there pinches). The result wraps left-right."""
    a = np.asarray(pano.convert("RGB"), dtype=np.float64)
    h, w, _ = a.shape
    cy = int(round(h * (asset_tools.find_horizon(pano) if horizon is None else horizon)))
    cy = min(max(cy, 8), h - 8)
    half = height // 2
    top_px, low_px = int(half * 0.84), int(half * 0.24)

    def rows(src: np.ndarray, n: int) -> np.ndarray:
        img = Image.fromarray(np.clip(src, 0, 255).astype(np.uint8)).resize((width, max(1, n)), Image.LANCZOS)
        return np.asarray(img, dtype=np.float64)
    sky = rows(a[:cy], top_px)
    haze = rows(a[cy:], low_px)
    c_top = np.median(sky[: max(2, top_px // 10)].reshape(-1, 3), axis=0)
    c_dn = np.median(haze[-max(2, low_px // 4):].reshape(-1, 3), axis=0)
    out = np.empty((height, width, 3))
    out[: half - top_px] = c_top
    out[half - top_px: half] = sky
    out[half: half + low_px] = haze
    out[half + low_px:] = c_dn
    y = (np.arange(height) + 0.5) / height                  # 0 zenith .. 1 nadir
    up_w = asset_tools._smooth((y - 0.03) / 0.16)[:, None, None]          # fade the top 19% to the zenith colour
    dn_w = asset_tools._smooth((0.5 + low_px / height - y) / 0.08)[:, None, None]
    out = up_w * out + (1 - up_w) * c_top
    out = np.where(y[:, None, None] > 0.5, dn_w * out + (1 - dn_w) * c_dn, out)
    out = asset_tools.wrap_horizontal(out, 0.2)
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8))


def wrap_report(img: Image.Image) -> float:
    """How visible the left/right wrap seam is: mean |delta| across it / mean |delta| between neighbours."""
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    col = np.abs(np.diff(a, axis=1)).mean()
    return round(float(np.abs(a[:, 0] - a[:, -1]).mean() / max(col, 1e-6)), 2)


def prop_json(name: str, res: dict) -> dict:
    """splat_to_parts.convert result -> the prop JSON assets.js builds (Y up, longest side 1, origin bottom centre,
    front -Z; three.js and Roblox share those axes)."""
    def hexc(c) -> str:
        r, g, b = (int(round(255 * float(v))) for v in np.clip(c, 0, 1))
        return f"#{r:02x}{g:02x}{b:02x}"

    def r3(v) -> list:
        return [round(float(x), 4) for x in v]
    return {"name": name, "style": "voxel", "size": r3(res["size"]), "palette": [hexc(c) for c in res["palette"]],
            "parts": [{"p": r3(p["p"]), "s": r3(p["s"]), "c": int(p["c"])} for p in res["parts"]],
            "stats": {k: v for k, v in res.get("stats", {}).items() if isinstance(v, (int, float))}}


# --------------------------------------------------------------------------------------------- the stage
class Assets:
    """The game's assets/ folder and its manifest."""

    def __init__(self, game_dir: Path, run_dir: Path, log_fn=None) -> None:
        self.dir = Path(game_dir) / "assets"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.work = Path(run_dir) / "assets"
        self.work.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / "assets.json"
        self.log = log_fn or log.info
        try:
            self.manifest: dict = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.manifest = {}
        self.report: dict[str, dict] = {}

    def save(self) -> None:
        self.path.write_text(json.dumps(self.manifest, indent=1), encoding="utf-8")

    def have(self, name: str) -> bool:
        e = self.manifest.get(name)
        return bool(e) and (self.dir / e["file"]).exists()

    def add(self, name: str, file: str, data: bytes, **meta) -> None:
        (self.dir / file).write_bytes(data)
        self.manifest[name] = {"file": file, **meta}
        self.save()

    async def _guard(self, name: str, coro) -> None:
        import time
        t = time.time()
        try:
            await asyncio.wait_for(coro, JOB_TIMEOUT)
            self.report[name] = {"ok": True, "seconds": round(time.time() - t, 1)}
            self.log(f"asset {name}: ok ({time.time() - t:.0f}s)")
        except Exception as e:  # noqa: BLE001  -- every asset is optional
            self.report[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300],
                                 "seconds": round(time.time() - t, 1)}
            self.log(f"asset {name}: FAILED ({type(e).__name__}: {str(e)[:160]})")

    # -- one asset each ---------------------------------------------------------------------------
    async def sky(self, prompt: str, style: str) -> None:
        if self.have("sky"):
            return
        full = f"{prompt.strip().rstrip('.')}. Colour mood: {style[:240]}. {SKY}"
        pano = await asset_tools.raw_image(full, asset_tools.PANO_W, asset_tools.PANO_H)
        pano.convert("RGB").save(self.work / "sky_source.png")
        eq = equirect(pano)
        self.add("sky", "sky.jpg", _jpeg(eq, 90), kind="sky", projection="equirect", prompt=prompt[:300],
                 wrap_seam=wrap_report(eq))

    async def icon(self, name: str, prompt: str, style: str, for_: str = "") -> None:
        name = f"icon_{safe(name).removeprefix('icon_')}"
        if self.have(name):
            return
        img = await asset_tools.make_ui(prompt, "icon", style)
        self.add(name, f"{name}.png", asset_tools.png_bytes(img, 256), kind="icon", prompt=prompt[:300],
                 **({"for": for_} if for_ else {}))

    async def music(self, tags: str, seconds: float = 60) -> None:
        if self.have("music_main"):
            return
        data = await asset_tools.make_music(tags, seconds)
        self.add("music_main", "music_main" + _audio_ext(data), data, kind="music", loop=True, prompt=tags[:300])

    async def sfx(self, event: str, prompt: str, seconds: float = 1.5) -> None:
        event = event if event in SFX_EVENTS else safe(event)
        name = f"sfx_{SFX_NAME.get(event, event)}"
        if self.have(name):
            return
        clip = (await asset_tools.make_sfx(prompt, min(max(float(seconds), 0.5), 6.0), 1))[0]
        self.add(name, name + _audio_ext(clip), clip, kind="sfx", event=event, prompt=prompt[:300])

    async def prop(self, name: str, prompt: str, style: str, detail: int = 22) -> None:
        from blocksfield import recipe, splat_to_parts
        name = f"prop_{safe(name).removeprefix('prop_')}"
        if self.have(name):
            return
        full = f"{prompt.strip().rstrip('.')}. Art direction: {style[:200]}" if style else prompt
        got = await asset_tools.make_prop(recipe.plan(full, "prop")["prompt"], self.work / "props", name)
        res = await asyncio.to_thread(splat_to_parts.convert, got["src"], name, "voxel", int(detail),
                                      camera=got["camera"])
        try:
            splat_to_parts.preview(res, got["ref"]).save(self.work / "props" / f"{name}_preview.png")
        except Exception as e:  # noqa: BLE001  -- the preview is for people, the prop still ships
            log.warning("prop preview failed: %s", e)
        data = json.dumps(prop_json(name, res), separators=(",", ":")).encode()
        self.add(name, f"{name}.json", data, kind="prop", prompt=prompt[:300], via=got["via"],
                 parts=len(res["parts"]))

    # -- all of them -------------------------------------------------------------------------------
    def jobs(self, plan: dict, style: str) -> list:
        """The coroutines for every asset the plan asks for (submitted together, so they share one GPU swap)."""
        a = plan.get("assets") or {}
        out = []
        if a.get("sky"):
            out.append(("sky", self.sky(a["sky"], style)))
        for ic in (a.get("icons") or [])[:4]:
            out.append((f"icon_{safe(ic.get('name', 'icon'))}",
                        self.icon(ic.get("name", "icon"), ic.get("prompt", ic.get("name", "")), style,
                                  ic.get("for", ""))))
        if a.get("music"):
            out.append(("music_main", self.music(a["music"], float(a.get("music_seconds", 60)))))
        for s in (a.get("sfx") or [])[:6]:
            out.append((f"sfx_{SFX_NAME.get(s.get('event'), s.get('event', 'sfx'))}",
                        self.sfx(s.get("event", "sfx"), s.get("prompt", ""), s.get("seconds", 1.5))))
        for p in (a.get("props") or [])[:2]:
            out.append((f"prop_{safe(p.get('name', 'prop'))}", self.prop(p.get("name", "prop"), p.get("prompt", ""),
                                                                          style)))
        return out

    async def run_all(self, plan: dict, style: str) -> dict:
        jobs = self.jobs(plan, style)
        await asyncio.gather(*(self._guard(n, c) for n, c in jobs))
        self.save()
        return {"manifest": self.manifest, "report": self.report}


async def concept_board(plan: dict, out_dir: Path, n: int = 3, log_fn=None) -> list[Path]:
    """2-3 concept frames of the game (kept if already on disk): the judge's target."""
    out_dir.mkdir(parents=True, exist_ok=True)
    have = sorted(out_dir.glob("concept_*.png"))
    if have:
        return have
    shots = [s for s in (plan.get("concept_shots") or []) if isinstance(s, str) and s.strip()][:n]
    if not shots:
        shots = [plan.get("pitch", plan.get("title", "a game"))]
    style = plan.get("art_direction", "")

    async def one(i: int, scene: str) -> Path | None:
        try:
            img = await asyncio.wait_for(asset_tools.raw_image(CONCEPT.format(scene=scene.strip().rstrip("."),
                                                                              style=style[:300]),
                                                               asset_tools.PANO_W, asset_tools.PANO_H), JOB_TIMEOUT)
        except Exception as e:  # noqa: BLE001
            (log_fn or log.warning)(f"concept {i} failed: {type(e).__name__}: {str(e)[:160]}")
            return None
        img = img.convert("RGB")
        img.thumbnail((1376, 768), Image.LANCZOS)
        p = out_dir / f"concept_{i}.png"
        img.save(p)
        return p
    got = await asyncio.gather(*(one(i, s) for i, s in enumerate(shots)))
    return [p for p in got if p]


def _jpeg(img: Image.Image, q: int) -> bytes:
    import io
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=q, optimize=True)
    return buf.getvalue()


def _audio_ext(data: bytes) -> str:
    if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return ".mp3"
    if data[:4] == b"OggS":
        return ".ogg"
    if data[:4] == b"RIFF":
        return ".wav"
    if data[:4] == b"fLaC":
        return ".flac"
    return ".mp3"
