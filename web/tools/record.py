"""Record a web game as a smooth, full-quality 1080p30 clip by stepping its clock frame by frame (no dropped frames,
no screen-recorder blur): requestAnimationFrame and performance.now are virtualised, each frame is screenshotted and
piped to ffmpeg.

    python web/tools/record.py games/cloudhop/index.html --out clip.mp4 --seconds 8
        [--eval "__kit.start()" --eval "__kit.autopilot(true)"] [--warmup 2.0] [--size 1920x1080] [--fps 30]
        [--orbit 6]            # instead of gameplay: a cinematic orbit around the level (from __kit.survey())

Prints a JSON line with the clip path, frames and __kit.state() at the end.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot import GPU_ARGS, WEB, serve  # noqa: E402

# virtual time: the page only advances when we call __step(dt)
INIT = """
(() => {
  const realNow = performance.now.bind(performance);
  let vt = realNow();
  const q = [];
  window.__vt = () => vt;
  performance.now = () => vt;
  const realDateNow = Date.now; const d0 = realDateNow(); const v0 = vt;
  Date.now = () => d0 + (vt - v0);
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (dtMs) => {
    vt += dtMs;
    const list = q.splice(0, q.length);
    for (const cb of list) { try { cb(vt); } catch (e) { console.error(e); } }
    return list.length;
  };
})();
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--size", default="1920x1080")
    ap.add_argument("--eval", action="append", default=[])
    ap.add_argument("--warmup", type=float, default=1.5, help="seconds of game time to run (unrecorded) after --eval")
    ap.add_argument("--orbit", type=float, default=0.0, help="record an orbit of this many seconds instead of play")
    ap.add_argument("--quality", type=int, default=92)
    a = ap.parse_args()
    w, h = (int(v) for v in a.size.lower().split("x"))
    from playwright.sync_api import sync_playwright
    srv, port = serve(WEB)
    out = Path(a.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    dt = 1000.0 / a.fps
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=GPU_ARGS, channel="chrome")
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            ctx.add_init_script(INIT)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text[:300]) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)[:300]))
            page.goto(f"http://127.0.0.1:{port}/{a.page.lstrip('/')}")
            # step until the kit says it is ready (asset loads still happen in real time between steps)
            t0 = time.time()
            while time.time() - t0 < 60:
                page.evaluate(f"window.__step && window.__step({dt})")
                if page.evaluate("!!(window.__kit && window.__kit.ready)"):
                    break
                time.sleep(0.02)
            for _ in range(int(1.0 * a.fps)):             # let async assets (sky, splats) settle
                page.evaluate(f"window.__step({dt})")
                time.sleep(0.01)
            for e in a.eval:
                page.evaluate(e)
            for _ in range(int(a.warmup * a.fps)):
                page.evaluate(f"window.__step({dt})")
            orbit = None
            if a.orbit > 0:
                sv = page.evaluate("window.__kit && window.__kit.survey ? window.__kit.survey() : null") or []
                ov = next((s for s in sv if s.get("name") == "overview"), sv[0] if sv else None)
                if ov:
                    pos = [float(x) for x in (ov["position"] if isinstance(ov["position"], list) else
                                              [ov["position"]["x"], ov["position"]["y"], ov["position"]["z"]])]
                    tgt = [float(x) for x in (ov["target"] if isinstance(ov["target"], list) else
                                              [ov["target"]["x"], ov["target"]["y"], ov["target"]["z"]])]
                    orbit = (pos, tgt)
            seconds = a.orbit if orbit else a.seconds
            n = int(round(seconds * a.fps))
            enc = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(a.fps),
                                    "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
                                    str(out)], stdin=subprocess.PIPE)
            for i in range(n):
                if orbit:
                    (px, py, pz), (tx, ty, tz) = orbit
                    r = math.hypot(px - tx, pz - tz) * 0.85
                    ang = math.atan2(pz - tz, px - tx) + (i / n) * 0.9          # a slow 50-degree arc
                    hgt = ty + (py - ty) * (0.75 - 0.2 * i / n)
                    page.evaluate(f"window.__kit.camera([{tx + math.cos(ang) * r}, {hgt}, {tz + math.sin(ang) * r}],"
                                  f" [{tx}, {ty}, {tz}])")
                page.evaluate(f"window.__step({dt})")
                enc.stdin.write(page.screenshot(type="jpeg", quality=a.quality))
            enc.stdin.close()
            enc.wait()
            try:
                state = page.evaluate("window.__kit && window.__kit.state ? window.__kit.state() : null")
            except Exception:
                state = None
            b.close()
    finally:
        srv.shutdown()
    print(json.dumps({"clip": str(out), "frames": n, "errors": errors[:10], "state": state}, default=str)[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
