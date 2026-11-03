"""Dev-only fixture game for the website: web/games/_fixture/ in the exact layout blocksfield/web_run.py writes
(about.json, assets/assets.json, about/, thumb.jpg, gameplay.mp4), built from kit demo screenshots and synthetic
audio. It lets the gallery and the making-of page be tested before real games exist. Dirs starting with "_" never ship.

    python web/tools/make_site_fixture.py && python web/tools/build_index.py --dev
"""
from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / "games" / "_fixture"
SHOTS = WEB / "games" / "_demo_look" / "shots"


def tone(path: Path, notes: list[float], seconds: float, rate: int = 22050) -> None:
    n = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            t = i / rate
            f = notes[int(t / seconds * len(notes)) % len(notes)]
            env = math.exp(-((t * len(notes) / seconds) % 1) * 4)
            frames += struct.pack("<h", int(9000 * env * math.sin(2 * math.pi * f * t)))
        w.writeframes(bytes(frames))


def main() -> None:
    from PIL import Image, ImageDraw
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    (OUT / "about").mkdir()
    (OUT / "index.html").write_text('<!doctype html><meta http-equiv="refresh" content="0;url=../_demo_look/index.html">',
                                    encoding="utf-8")

    pool = sorted(SHOTS.glob("*.png"))  # whatever the kit demo currently has; names change as kits evolve
    if not pool:
        raise SystemExit(f"no kit demo screenshots in {SHOTS}")
    pick = {}

    def shot(name: str) -> Path:
        return SHOTS / name if (SHOTS / name).exists() else pick.setdefault(name, pool[len(pick) % len(pool)])

    def jpg(src: str, dst: Path, size=(1280, 720)) -> None:
        with Image.open(shot(src)) as im:
            im = im.convert("RGB")
            im.thumbnail(size)
            im.save(dst, "JPEG", quality=85)

    jpg("sky_islands__toon_bright__hero.png", OUT / "thumb.jpg")
    jpg("sky_islands__candy__hero.png", OUT / "about" / "concept_0.jpg")
    jpg("sky_islands__sunset__hero.png", OUT / "about" / "concept_1.jpg")
    jpg("sky_islands__toon_bright__overview.png", OUT / "about" / "survey.jpg")
    jpg("sky_islands__sunset__hero.png", OUT / "assets" / "sky.jpg", (2048, 1024))
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(icon)
    pts = [(128 + 110 * math.cos(math.pi / 2 + k * math.pi / 5) * (1 if k % 2 == 0 else 0.45),
            128 - 110 * math.sin(math.pi / 2 + k * math.pi / 5) * (1 if k % 2 == 0 else 0.45)) for k in range(10)]
    d.polygon(pts, fill=(255, 205, 60, 255), outline=(120, 60, 20, 255), width=8)
    icon.save(OUT / "assets" / "icon_bloom.png")
    prop = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(prop)
    d.rectangle((108, 130, 148, 220), fill=(245, 235, 215, 255))
    d.pieslice((40, 40, 216, 200), 180, 360, fill=(220, 50, 50, 255))
    prop.save(OUT / "about" / "prop_mushroom_preview.png")
    tone(OUT / "assets" / "music_main.wav", [523.3, 659.3, 784.0, 659.3, 587.3, 698.5, 880.0, 698.5], 4.0)
    tone(OUT / "assets" / "sfx_collect.wav", [1046.5, 1568.0], 0.5)
    tone(OUT / "assets" / "sfx_jump.wav", [330.0, 440.0], 0.4)
    with tempfile.TemporaryDirectory() as td:
        for i, s in enumerate(["sky_islands__toon_bright__hero.png", "sky_islands__candy__hero.png",
                               "sky_islands__sunset__hero.png", "sky_islands__toon_bright__overview.png"]):
            shutil.copyfile(shot(s), Path(td) / f"f{i}.png")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "0.75", "-i", str(Path(td) / "f%d.png"),
                        "-vf", "scale=1280:-2,fps=30", "-c:v", "libx264", "-crf", "30", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", str(OUT / "gameplay.mp4")], check=True)
    assets = {
        "sky": {"file": "sky.jpg", "kind": "sky", "projection": "equirect",
                "prompt": "warm late-afternoon sky with puffy pink clouds"},
        "icon_bloom": {"file": "icon_bloom.png", "kind": "icon", "prompt": "a glowing five-petal star flower",
                       "for": "coin"},
        "music_main": {"file": "music_main.wav", "kind": "music", "loop": True,
                       "prompt": "upbeat whimsical orchestral pop, marimba, pizzicato, 120 bpm"},
        "sfx_collect": {"file": "sfx_collect.wav", "kind": "sfx", "event": "collect",
                        "prompt": "bright magical chime pickup"},
        "sfx_jump": {"file": "sfx_jump.wav", "kind": "sfx", "event": "jump", "prompt": "soft cartoon boing jump"},
        "prop_mushroom": {"file": "prop_mushroom.json", "kind": "prop", "prompt": "a red spotted toadstool mushroom",
                          "via": "idol", "parts": 257},
    }
    for when in ("intro", "win"):
        shutil.copyfile(OUT / "gameplay.mp4", OUT / "assets" / f"cutscene_{when}.mp4")
        shutil.copyfile(OUT / "thumb.jpg", OUT / "assets" / f"cutscene_{when}_source.jpg")
        assets[f"cutscene_{when}"] = {"file": f"cutscene_{when}.mp4", "kind": "cutscene", "when": when, "model": "LTX-2.5",
                                      "source": f"cutscene_{when}_source.jpg",
                                      "prompt": f"fixture {when} cutscene: the fox looks up at the beacon"}
    (OUT / "game.js").write_text("// fixture game.js (dev only)\nimport * as K from 'kit';\n"
                                 "const game = await K.createGame();\nK.Look.apply(game, 'toon_bright');\n\n"
                                 "// mechanic: bloom chain\nlet chain = 0, chainT = 0;\n"
                                 "game.on('collect', () => { chain = chainT > 0 ? chain + 1 : 1; chainT = 4;\n"
                                 "  if (chain >= 3) { player.boost({ jump: 1.4, seconds: 3 }); chain = 0; } });\n"
                                 "game.update((dt) => { chainT = Math.max(0, chainT - dt); });\n", encoding="utf-8")
    (OUT / "assets" / "assets.json").write_text(json.dumps(assets, indent=1), encoding="utf-8")
    plan = {
        "title": "Fixture Peaks", "tagline": "Hop the floating isles, gather the star blooms",
        "genre": "3D collect-a-thon platformer",
        "core_loop": "Run and jump across floating islands collecting star blooms, then reach the beacon.",
        "controls": ["WASD / arrows: move", "Space: jump"], "win_condition": "Collect 20 blooms and reach the beacon",
        "lose_condition": "Fall too many times", "look": "toon_bright", "level_kind": "sky_islands",
        "level_size": "medium", "player_type": "platformer", "camera": "follow",
        "player_colors": {"body": "#ff7a59", "accent": "#ffd166"},
        "collectible": {"tag": "coin", "label": "Blooms", "count": 30, "target": 20}, "goal": True,
        "timer_seconds": 0, "lives": 3, "enemies": 2, "race": {"laps": 0, "opponents": 0},
        "art_direction": "Saturated candy pastels, chunky rounded islands, soft cel shading, warm late-afternoon light.",
        "concept_shots": ["the hero leaping between two grassy floating islands with glowing star pickups",
                          "a wide view of the island chain with the beacon at the far end"],
        "assets": {"sky": assets["sky"]["prompt"],
                   "icons": [{"name": "bloom", "prompt": "a glowing five-petal star flower", "for": "coin"}],
                   "music": assets["music_main"]["prompt"],
                   "sfx": [{"event": "collect", "prompt": "bright magical chime pickup", "seconds": 1},
                           {"event": "jump", "prompt": "soft cartoon boing jump", "seconds": 1}],
                   "props": [{"name": "mushroom", "prompt": "a red spotted toadstool mushroom", "count": 8}]},
        "features": ["confetti burst on win"],
    }
    vers = [("s0", 5.1, 6.0, 4.5), ("v0", 6.2, 7.0, 5.6), ("v1", 7.4, 8.0, 7.0), ("v2", 7.1, 7.5, 6.8)]
    about = {
        "id": "_fixture", "title": plan["title"], "tagline": plan["tagline"],
        "pitch": "DEV FIXTURE. A fox collects star blooms on floating isles in warm candy-pastel light, dodging "
                 "rolling hazards, then lights the beacon at the far end of the island chain.",
        "genre": plan["genre"], "controls": plan["controls"], "created": "2026-11-02T19:00:00-0800", "dry_run": True,
        "play": "index.html", "thumbnail": "thumb.jpg", "video": "gameplay.mp4",
        "concepts": ["about/concept_0.jpg", "about/concept_1.jpg"], "survey": "about/survey.jpg",
        "score": {"best": "v1", "score": 7.4, "play": 8.0, "vision": 7.0,
                  "versions": [{"tag": t, "score": s, "play_score": p, "vision_score": v} for t, s, p, v in vers]},
        "plan": plan,
        "mapping": {"pitch": "a fox collects star blooms on floating isles",
                    "notes": "Floating isles -> sky_islands; warm candy-pastel light -> toon_bright; a fox who jumps -> "
                             "platformer with a follow camera.",
                    "chosen": {"level_kind": "custom", "look": "toon_bright", "player_type": "platformer",
                               "camera": "follow", "ui_style": "toon", "collectible": "star",
                               "collectible_label": "Blooms", "character": {"species": "fox", "accessories": ["scarf"]}},
                    "layout": {"start": "spiral_climb", "pieces_start": 14, "pieces_final": 19, "pieces_changed_from_start": 5},
                    "builder_overrides": {"level_kind": "sky_islands -> custom: a spiral climb read better than the preset arc"}},
        "mechanics": [
            {"name": "bloom chain", "how": "custom", "api": "Mechanics.custom", "file": "game.js", "line_start": 6,
             "line_end": 9},
            {"name": "beacon lock", "how": "rule", "api": "Mechanics.rule", "file": "game.js", "line_start": 1,
             "line_end": 4, "snippet": "K.Mechanics.rule(game, { when: 'collected >= 20', then: 'open:beacon' })"},
            {"name": "double jump", "how": "builtin", "api": "Mechanics.builtin",
             "snippet": "K.Mechanics.builtin(game, 'double_jump')"},
        ],
        "post_stages": [{"stage": "re-recorded and re-scored after the final kit update", "kit_commit": "0000000fixture",
                         "at": "2026-11-03T05:00:00-0800"},
                        {"stage": "cutscenes", "model": "LTX-2.5", "run": "uniform pipeline stage after build",
                         "clips": ["intro", "win"], "at": "2026-11-03T05:10:00-0800"}],
        "operator_interventions": [],
        "incidents": ["fixture incident: two builder agents ran at once; the run was re-recorded after the freeze"],
        "timings_s": {"plan": 41.0, "art": 212.0, "scaffold": 3.0, "build": 640.0, "eval_s0": 70.0, "eval_v0": 66.0,
                      "repair_1": 300.0, "eval_v1": 64.0, "repair_2": 280.0, "eval_v2": 61.0},
        "model_calls": {"lead": {"calls": 2, "prompt_tokens": 9000, "completion_tokens": 2100, "seconds": 40.0},
                        "builder": {"calls": 58, "prompt_tokens": 900000, "completion_tokens": 41000, "seconds": 1100.0},
                        "judge": {"calls": 4, "prompt_tokens": 22000, "completion_tokens": 3000, "seconds": 70.0}},
        "agents": {"live": 3, "cached": 0, "failed": 0},
        "stages": {"art": {"report": {k: {"ok": True, "seconds": 20.0} for k in assets}},
                   "scaffold": {"problems": []},
                   "build": {"result": {"summary": "fixture", "changes": ["fixture"], "known_issues": []}, "plays": 4}},
        "models": {"llm": "Qwen3.8-27B (vLLM, local)", "image": "Qwen-Image-2.1 + BiRefNet", "music": "ACE-Step",
                   "sfx": "Stable Audio", "props": "Idol image->splat -> voxels"},
    }
    (OUT / "about.json").write_text(json.dumps(about, indent=1), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
