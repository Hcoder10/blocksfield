"""Timelapse of the GPU dashboard for the demo video: one headless-Chrome screenshot every N seconds.

    python -m blocksfield.record_dashboard runs/<game>/dashboard --every 30
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
import time
from pathlib import Path

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--every", type=float, default=30)
    ap.add_argument("--url", default="http://127.0.0.1:8100/")
    a = ap.parse_args()
    out = Path(a.out).resolve()          # Chrome resolves a relative --screenshot path against its own folder
    out.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.gettempdir()) / "bf-dash-chrome"
    n = len(list(out.glob("dash_*.png")))
    while True:
        t0 = time.time()
        shot = out / f"dash_{n:05d}.png"
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--user-data-dir={profile}", "--virtual-time-budget=5000", "--window-size=1920,1080",
                        f"--screenshot={shot}", a.url], capture_output=True, timeout=60)
        if shot.exists():
            n += 1
        time.sleep(max(1.0, a.every - (time.time() - t0)))


if __name__ == "__main__":
    raise SystemExit(main())
