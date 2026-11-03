"""End-to-end dry run of `python -m blocksfield.web_run --dry-run`: fake LLM and fake ComfyUI, real stages, real kits,
real Chrome. Slow (~2-3 min), so opt-in:

    BLOCKSFIELD_WEB_E2E=1 PYTHONPATH=C:/Users/sarta/cybus-harness;C:/Users/sarta/blocksfield python -m pytest \
        blocksfield/tests/test_web_pipeline.py -q
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import pytest

from blocksfield.web_run import GAMES, ROOT

GID = "e2e_dry"


@pytest.mark.skipif(os.environ.get("BLOCKSFIELD_WEB_E2E") != "1", reason="slow: set BLOCKSFIELD_WEB_E2E=1")
def test_dry_run_builds_a_playable_game():
    run_dir, game_dir = ROOT / "runs" / f"web_{GID}", GAMES / GID
    for d in (run_dir, game_dir):
        shutil.rmtree(d, ignore_errors=True)
    env = {**os.environ, "PYTHONUTF8": "1"}
    r = subprocess.run([sys.executable, "-m", "blocksfield.web_run", "A fox collects star blooms on floating isles",
                        "--id", GID, "--dry-run", "--autopilot", "6", "--video-seconds", "5", "--repair-rounds", "1"],
                       cwd=ROOT, env=env, capture_output=True, text=True, timeout=900)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-3000:]
    for f in ("index.html", "game.js", "assets/assets.json", "about.json", "thumb.jpg", "gameplay.mp4"):
        assert (game_dir / f).exists(), f
    about = json.loads((game_dir / "about.json").read_text(encoding="utf-8"))
    assert about["title"] and about["pitch"] and about["timings_s"] and about["model_calls"]
    stages = run_dir / "stages"
    best = json.loads((stages / f"eval_{about['score']['best']}.json").read_text(encoding="utf-8"))
    assert best["ready"] and best["errors"] == [], best["errors"]
    assert best["autopilot"]["moved"] > 5
