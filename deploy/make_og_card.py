"""Render the 1200x630 social card (og:image / twitter:image) from web/site/og-card.html.

    python deploy/make_og_card.py                       # -> web/site/media/og.jpg
    python deploy/make_og_card.py --root out/pages      # render inside a pages build (publish_pages.py does this)

The game frame is the best-scoring published game's thumbnail and pitch (games/index.json, same order as the
gallery), or the Roblox thumbnail when no game has shipped yet. Needs Playwright with Chrome.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "web" / "tools"))


def render(root: Path, out: Path | None = None) -> Path:
    import shot  # web/tools/shot.py: serves a dir over http, Chrome flags
    from playwright.sync_api import sync_playwright
    out = out or root / "site" / "media" / "og.jpg"
    qs = ""
    try:
        games = [g for g in json.loads((root / "games" / "index.json").read_text(encoding="utf-8"))["games"]
                 if not g.get("dev") and g.get("thumbnail")]
    except (OSError, ValueError, KeyError):
        games = []
    if games:
        g = games[0]
        img = "../" + g["card_thumb"] if g.get("card_thumb") else "../games/{}/{}".format(g["id"], g["thumbnail"])
        qs = f"?img={quote(img)}&pitch={quote(g.get('pitch') or '')}"
    srv, port = shot.serve(root)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=shot.GPU_ARGS, channel="chrome")
            pg = b.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
            pg.goto(f"http://127.0.0.1:{port}/site/og-card.html{qs}")
            pg.wait_for_function("window.__ogReady === true", timeout=15000)
            pg.wait_for_timeout(200)
            out.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(out), type="jpeg", quality=88)
            b.close()
    finally:
        srv.shutdown()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(ROOT / "web"))
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    out = render(Path(a.root), Path(a.out) if a.out else None)
    print(f"{out} ({out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
