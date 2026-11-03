"""Record a ~15 s 1920x1080 clip of Blocksfield Studio for the demo video: the Create page typing a pitch, then a
finished build replayed "live" (sped up, labelled as a replay in the UI) through plan, concept board, assets, build,
judging and the finished game.

    python -m blocksfield.studio_record --run neon_drift --out runs/studio_clip.mp4 [--seconds 15] [--headed]

Starts its own Studio (launching off) on a free port unless --url points at a running one. Needs ffmpeg for the mp4
(Playwright records webm; the webm is kept next to it).
"""
from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_studio() -> str:
    from http.server import ThreadingHTTPServer

    from blocksfield import studio
    port = free_port()
    studio.Handler.arbiter = studio.Arbiter("http://127.0.0.1:8100")
    studio.Handler.allow_launch = False
    srv = ThreadingHTTPServer(("127.0.0.1", port), studio.Handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", default="neon_drift", help="finished web run to replay")
    ap.add_argument("--out", default=str(ROOT / "video" / "studio_take.mp4"))
    ap.add_argument("--seconds", type=float, default=15.0)
    ap.add_argument("--home", type=float, default=5.0, help="seconds on the Create page")
    ap.add_argument("--url", default=None, help="a running Studio (default: start one)")
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args(argv)
    from playwright.sync_api import sync_playwright

    base = a.url or start_studio()
    idea = json.loads((ROOT / "runs" / f"web_{a.run}" / "idea.json").read_text(encoding="utf-8"))
    pitch = idea["pitch"]
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    vid_dir = out.parent / "_studio_rec"
    shutil.rmtree(vid_dir, ignore_errors=True)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=not a.headed, channel="chrome",
                              args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
                                    "--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1,
                            record_video_dir=str(vid_dir), record_video_size={"width": 1920, "height": 1080})
        pg = ctx.new_page()
        # warm the run page's images so the replay doesn't wait on the network
        pg.goto(f"{base}/run/{a.run}", wait_until="networkidle")
        pg.wait_for_timeout(1200)
        pg.goto(f"{base}/", wait_until="networkidle")
        pg.wait_for_timeout(1500)
        t0 = time.time()
        cps = max(60, int(len(pitch) / max(1.5, a.home - 1.6)))   # finish typing ~1 s before the cut
        pg.goto(f"{base}/?type={urllib.parse.quote(pitch)}&cps={cps}", wait_until="load")
        pg.wait_for_timeout(int(max(0.5, a.home - 1.0) * 1000))
        pg.hover("#make")                                         # the hand goes to the button; no build is launched
        pg.wait_for_timeout(900)
        home_end = time.time() - t0
        pg.goto(f"{base}/run/{a.run}?replay=auto&autoplay=video", wait_until="load")
        pg.wait_for_timeout(int(max(1.0, a.seconds - home_end) * 1000))
        video = pg.video
        ctx.close()
        b.close()
        webm = Path(video.path())
    keep = out.with_suffix(".webm")
    shutil.move(str(webm), keep)
    shutil.rmtree(vid_dir, ignore_errors=True)
    # cut the warm-up (everything before the Create page) and encode for the editor
    warm = probe_duration(keep) - a.seconds + 0.3      # start just after the Create page has painted
    ff = shutil.which("ffmpeg")
    if ff:
        subprocess.run([ff, "-y", "-loglevel", "error", "-ss", f"{max(0, warm):.2f}", "-i", str(keep), "-t", f"{a.seconds - 0.3:.2f}",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", str(out)], check=True)
        print(f"studio clip: {out} ({a.seconds:.1f}s, 1920x1080); raw {keep}")
    else:
        print(f"studio clip (webm, no ffmpeg found): {keep}")


def probe_duration(p: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    r = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


if __name__ == "__main__":
    main()
