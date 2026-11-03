"""Render the landing page's cast strip: every ThreeKit Player.SPECIES in one row, drawn by the kit in Chrome.

    python deploy/make_cast.py        # -> web/site/media/cast.jpg

These are procedural kit models (no generated art). Re-run when the kit's species list changes; it prints the list
so the caption on the landing page can be checked against it.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "web" / "tools"))


def main() -> None:
    import shot
    from PIL import Image
    raw = ROOT / "out" / "cast_raw.png"
    rep = shot.run("site/cast-card.html", raw, wait=4.0, size=(2400, 620),
                   evals=["window.__kit && window.__kit.species"])
    if rep["errors"]:
        sys.exit(f"render errors: {rep['errors']}")
    out = ROOT / "web" / "site" / "media" / "cast.jpg"
    with Image.open(raw) as im:
        im = im.convert("RGB").crop((0, 70, 2400, 570))  # sky band to the feet' shadows
        im = im.resize((1920, 400), Image.LANCZOS)
        im.save(out, "JPEG", quality=86, optimize=True, progressive=True)
    print(f"{out} ({out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
