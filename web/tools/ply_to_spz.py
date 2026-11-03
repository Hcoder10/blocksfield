"""Compress 3DGS .ply splats (Idol output) to .spz with Spark's transcoder, in headless Chrome.

    python web/tools/ply_to_spz.py in.ply [more.ply ...] [--out-dir DIR] [--opacity 0.05]

.spz is ~8-10x smaller than .ply and loads the same way (Assets.splat accepts .ply, .spz, .splat), so games ship .spz.
Axes are left as they are: Assets.splat still applies Idol's orientation (manifest "up": "idol").
"""
from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot import GPU_ARGS, serve  # noqa: E402

PAGE = """<!doctype html><html><head><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js",
"three/addons/":"/vendor/three/addons/"}}</script></head><body><script type="module">
import * as S from '/vendor/spark/spark.module.js';
window.toSpz = async (b64, opacity) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const r = await S.transcodeSpz({ inputs: [{ fileBytes: bytes, pathOrUrl: 'in.ply' }], opacityThreshold: opacity });
  const out = r.fileBytes; let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
};
window.ready = true;
</script></body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ply", nargs="+")
    ap.add_argument("--out-dir")
    ap.add_argument("--opacity", type=float, default=0.05)
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    web = Path(__file__).resolve().parents[1]
    tmp = web / "vendor" / "spark" / "_transcode.html"
    tmp.write_text(PAGE, encoding="utf-8")
    srv, port = serve(web)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=GPU_ARGS, channel="chrome")
            page = b.new_page()
            page.goto(f"http://127.0.0.1:{port}/vendor/spark/_transcode.html")
            page.wait_for_function("window.ready === true", timeout=30000)
            for f in a.ply:
                src = Path(f)
                out = (Path(a.out_dir) if a.out_dir else src.parent) / (src.stem + ".spz")
                out.parent.mkdir(parents=True, exist_ok=True)
                b64 = page.evaluate("([d, o]) => window.toSpz(d, o)", [base64.b64encode(src.read_bytes()).decode(), a.opacity])
                out.write_bytes(base64.b64decode(b64))
                print(f"{src.name}: {src.stat().st_size // 1024} KB -> {out.name}: {out.stat().st_size // 1024} KB")
            b.close()
    finally:
        srv.shutdown()
        tmp.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
