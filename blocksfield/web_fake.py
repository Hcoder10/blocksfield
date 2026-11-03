"""Stand-ins for the GPU box, for `web_run --dry-run` and the tests: a scripted LLM (plan, builder, repair, judge) and
fake ComfyUI jobs (procedural images, sine-wave audio, a synthetic splat). Everything else -- the stages, the file
tools, Chrome playtests, the manifest -- is the real pipeline.
"""
from __future__ import annotations

import io
import json
import math
import struct
import wave

import numpy as np
from PIL import Image, ImageDraw

from harness.llm import LLMResponse, Message, ToolCall

FAKE_PLAN = {
    "title": "Starbloom Peaks", "tagline": "Hop the floating isles, gather the star blooms",
    "genre": "3D collect-a-thon platformer",
    "core_loop": "Run and jump across floating islands collecting star blooms, then reach the beacon.",
    "controls": ["WASD / arrows: move", "Space: jump"], "win_condition": "Collect 20 blooms and reach the beacon",
    "lose_condition": "Fall too many times", "look": "toon_bright", "ui_style": "arcade", "level_kind": "sky_islands",
    "level_size": "medium", "player_type": "platformer", "camera": "follow",
    "player_colors": {"body": "#ff7a59", "accent": "#ffd166"},
    "collectible": {"tag": "coin", "label": "Blooms", "count": 30, "target": 20},
    "goal": True, "timer_seconds": 0, "lives": 3, "enemies": 2, "race": {"laps": 0, "opponents": 0},
    "art_direction": "Saturated candy pastels, chunky rounded islands, soft cel shading, warm late-afternoon light.",
    "concept_shots": ["the hero leaping between two grassy floating islands with glowing star pickups",
                      "a wide view of the island chain with the beacon at the far end"],
    "assets": {"sky": "warm late-afternoon sky with puffy pink clouds",
               "icons": [{"name": "bloom", "prompt": "a glowing five-petal star flower", "for": "coin"}],
               "music": "upbeat whimsical orchestral pop, marimba, pizzicato, 120 bpm",
               "sfx": [{"event": "collect", "prompt": "bright magical chime pickup", "seconds": 1},
                       {"event": "jump", "prompt": "soft cartoon boing jump", "seconds": 1}],
               "props": [{"name": "mushroom", "prompt": "a red spotted toadstool mushroom", "count": 8}]},
    "features": ["confetti burst on win"],
}


def _pick_enum(schema: dict, value):
    en = schema.get("enum")
    return value if not en or value in en else en[0]


def plan_for(params: dict) -> dict:
    p = json.loads(json.dumps(FAKE_PLAN))
    props = params.get("properties", {})
    for k in ("look", "ui_style", "level_kind", "player_type", "camera", "level_size"):
        if k in props:
            p[k] = _pick_enum(props[k], p[k])
    return p


VERDICT = {"score": 6, "issues": [{"severity": "major", "where": "overview", "problem": "the level reads a bit empty",
                                   "fix": "raise collectibles and add props near the route"}],
           "strengths": ["clear route", "bright palette"]}


class FakeLLM:
    """Scripted replies keyed on what the agent was given: a plan for the lead, a short read/edit/play/submit
    session for builders, a JSON verdict for the judge."""

    max_tokens = 16384

    def __init__(self, role: str = "fake") -> None:
        self.role = role
        self.calls = 0

    def __repr__(self) -> str:
        return f"FakeLLM({self.role})"

    async def chat(self, messages: list[Message], tools: list[dict] | None = None) -> LLMResponse:
        self.calls += 1
        names = {t["function"]["name"]: t["function"] for t in tools or []}
        step = sum(1 for m in messages if m.role == "assistant")

        def call(tool: str, args: dict) -> LLMResponse:
            return LLMResponse(Message("assistant", "", tool_calls=[ToolCall(f"c{self.calls}", tool, args)]),
                               {"prompt_tokens": 100, "completion_tokens": 50}, "tool_calls", {})
        if "write_file" in names:
            repair = "REPAIR ROUND" in str(messages[1].content)
            script = [("read_doc", {"name": "Level"}),
                      ("edit_file", {"path": "game.js", "old_text": "game.start();",
                                     "new_text": f"game.state.flavor = {json.dumps('repair' if repair else 'built')};"
                                                 f"\ngame.start();"}),
                      ("play_game", {"autopilot_seconds": 3}),
                      ("submit", {"summary": "dry-run edit", "changes": ["state flavor"], "known_issues": []})]
            if repair:
                script = script[1:]
            name, args = script[min(step, len(script) - 1)]
            return call(name, args)
        if "submit" in names:
            return call("submit", plan_for(names["submit"]["parameters"]))
        return LLMResponse(Message("assistant", json.dumps(VERDICT)), {"prompt_tokens": 100, "completion_tokens": 50},
                           "stop", {})


# --------------------------------------------------------------------------------------------- fake ComfyUI
def fake_image(w: int, h: int, seed: int = 0) -> Image.Image:
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    r = 120 + 100 * (1 - y) + 20 * np.sin(6.28 * x + seed)
    g = 160 + 70 * (1 - y) + 0 * x
    b = 210 + 40 * (1 - y) + 0 * x
    a = np.stack(np.broadcast_arrays(r, g, b), -1)
    a[int(h * 0.66):] *= 0.85
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def fake_icon(size: int = 512) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([size * 0.15, size * 0.15, size * 0.85, size * 0.85], fill=(255, 200, 60, 255), outline=(60, 30, 0, 255),
              width=size // 24)
    return im


def wav_bytes(seconds: float, freq: float = 660.0, rate: int = 22050) -> bytes:
    n = int(seconds * rate)
    t = np.arange(n) / rate
    s = (0.3 * np.sin(2 * math.pi * freq * t) * np.exp(-3 * t / max(seconds, 0.1)) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(s.tobytes())
    return buf.getvalue()


def fake_ply(n: int = 6000, seed: int = 0) -> bytes:
    """A toadstool as coloured points in Idol's file axes (up = -Y)."""
    rng = np.random.default_rng(seed)
    k = n // 2
    th, ph = rng.uniform(0, 2 * math.pi, k), rng.uniform(0, math.pi / 2, k)
    cap = np.stack([0.5 * np.sin(ph) * np.cos(th), 0.55 + 0.35 * np.cos(ph), 0.5 * np.sin(ph) * np.sin(th)], 1)
    cap_c = np.where(rng.random((k, 1)) < 0.15, [250, 250, 245], [220, 40, 40])
    th2, hh = rng.uniform(0, 2 * math.pi, n - k), rng.uniform(0, 0.6, n - k)
    stem = np.stack([0.15 * np.cos(th2), hh, 0.15 * np.sin(th2)], 1)
    stem_c = np.tile([240, 230, 210], (n - k, 1))
    xyz = np.concatenate([cap, stem]).astype("<f4")
    xyz[:, 1] *= -1
    rgb = np.concatenate([cap_c, stem_c]).astype("u1")
    head = (f"ply\nformat binary_little_endian 1.0\nelement vertex {n}\nproperty float x\nproperty float y\n"
            f"property float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n").encode()
    rows = b"".join(struct.pack("<fffBBB", *map(float, p), *map(int, c)) for p, c in zip(xyz, rgb))
    return head + rows


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def install_fake_art() -> None:
    """Point blocksfield.asset_tools at the fakes (module globals, so make_* pick them up)."""
    from blocksfield import asset_tools

    async def raw_image(prompt: str, width: int, height: int) -> Image.Image:
        return fake_image(width // 2, height // 2, hash(prompt) % 7)

    async def gen_image(prompt: str, kind: str, transparent: bool, out_size: int = 1024) -> Image.Image:
        return fake_icon(512) if transparent else fake_image(512, 512)

    async def run_job(workflow: str, params: dict, timeout: float = 1800) -> list[dict]:
        if workflow == "music":
            return [{"filename": "music.wav", "kind": "audio", "data": wav_bytes(4.0, 330)}]
        if workflow == "sfx":
            return [{"filename": "sfx.wav", "kind": "audio", "data": wav_bytes(min(2.0, params.get("seconds", 1)))}]
        if workflow == "prop_splat":
            return [{"filename": "prop.ply", "kind": "3d", "data": fake_ply()},
                    {"filename": "prop.png", "kind": "image", "data": _png(fake_icon(256))}]
        if workflow == "image":
            return [{"filename": "img.png", "kind": "image",
                     "data": _png(fake_image(params["width"] // 2, params["height"] // 2))}]
        raise RuntimeError(f"fake arbiter has no workflow {workflow!r}")

    asset_tools.raw_image, asset_tools.gen_image, asset_tools.run_job = raw_image, gen_image, run_job
