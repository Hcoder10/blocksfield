"""Gallery index for the website: scans web/games/*/about.json and writes web/games/index.json.

    python web/tools/build_index.py                # published games only (what ships)
    python web/tools/build_index.py --dev          # also dry-run games and kit demos, marked "dev": true
    python web/tools/build_index.py --games <dir> --out <file>

A game ships when its dir does not start with "_", it has an about.json, and about.json is not a dry run. The dev
cards exist only to test the gallery layout; deploy/publish_pages.py always rebuilds the index without --dev.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]

CARD_KEYS = ("title", "tagline", "pitch", "genre", "controls", "created", "thumbnail", "video", "play")


def game_entry(d: Path) -> dict | None:
    try:
        about = json.loads((d / "about.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    e = {"id": d.name, **{k: about.get(k) for k in CARD_KEYS}}
    e["play"] = e["play"] or "index.html"
    for k in ("thumbnail", "video"):
        if e[k] and not (d / e[k]).exists():
            e[k] = None
    if not e["thumbnail"] and about.get("concepts"):
        e["thumbnail"] = about["concepts"][0]
    sc = about.get("score") or {}
    e["score"] = sc.get("score")
    e["repairs"] = sum(1 for k in (about.get("timings_s") or {}) if k.startswith("repair_"))
    e["model_calls"] = sum(int(v.get("calls", 0)) for v in (about.get("model_calls") or {}).values())
    e["minutes"] = round(sum((about.get("timings_s") or {}).values()) / 60, 1)
    e["dry_run"] = bool(about.get("dry_run"))
    plan = about.get("plan") or {}
    for k in ("look", "level_kind", "player_type", "camera", "ui_style"):
        e[k] = plan.get(k)
    return e


def demo_entries(d: Path, limit: int = 5) -> list[dict]:
    """Placeholder cards from a kit demo's screenshots (one per level kind), for testing the gallery layout."""
    shots = sorted((d / "shots").glob("*__hero.png")) if (d / "shots").is_dir() else []
    seen, out = set(), []
    for s in shots:
        level, look = s.stem.split("__")[:2]
        if level in seen:
            continue
        seen.add(level)
        out.append({"id": d.name, "title": f"{level.replace('_', ' ').title()} ({look.replace('_', ' ')})",
                    "tagline": "ThreeKit demo scene", "genre": f"kit demo: {level.replace('_', ' ')}",
                    "pitch": "A kit demo scene standing in for a generated game, to test the gallery layout. "
                             "Never published.",
                    "thumbnail": s.relative_to(d).as_posix(), "video": None, "play": "index.html", "score": None,
                    "repairs": 0, "model_calls": 0, "minutes": None, "dry_run": True})
    return out[:limit]


def design_space() -> dict:
    """The option lists the planner chooses from: the kit catalog of the newest web run (runs/web_*/catalog.json, read
    the same way blocksfield.web_plan does), else web_plan's defaults. The landing page prints these counts."""
    import sys
    root = WEB.parent
    sys.path.insert(0, str(root))
    try:
        from blocksfield import web_plan
    except Exception:  # noqa: BLE001  -- the site still builds without the pipeline importable
        return {}
    cats = sorted(root.glob("runs/web_*/catalog.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    cat = None
    for c in cats:
        try:
            cat = json.loads(c.read_text(encoding="utf-8"))
            break
        except (OSError, ValueError):
            continue
    en = web_plan.enums(cat)
    return {k: list(en[k]) for k in ("level_kind", "look", "player_type") if k in en}


def build(games: Path, dev: bool = False) -> dict:
    out = []
    for d in sorted(p for p in games.iterdir() if p.is_dir()):
        if d.name.startswith("_"):
            if dev and d.name.startswith("_fixture") and (d / "about.json").exists():
                e = game_entry(d)
                if e:
                    out.append({**e, "dev": True})
            elif dev and (d / "index.html").exists():
                out.extend({**e, "dev": True} for e in demo_entries(d))
            continue
        e = game_entry(d)
        if e is None or not (d / e["play"]).exists():
            continue
        if e["dry_run"]:
            if dev:
                out.append({**e, "dev": True})
            continue
        out.append(e)
    # Real games first, best judge score first (the hero reel takes the top of this list), then newest; dev last.
    def created(e):
        return time.mktime(time.strptime(e["created"][:19], "%Y-%m-%dT%H:%M:%S")) if e.get("created") else 0
    out.sort(key=lambda e: (bool(e.get("dev")), -(e.get("score") or 0), -created(e)))
    return {"generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "dev": dev, "space": design_space(), "games": out}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev", action="store_true", help="include dry-run games and kit demos (never published)")
    ap.add_argument("--games", default=str(WEB / "games"))
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    games = Path(a.games)
    idx = build(games, a.dev)
    out = Path(a.out) if a.out else games / "index.json"
    out.write_text(json.dumps(idx, indent=1), encoding="utf-8")
    print(f"{out}: {len(idx['games'])} games ({sum(1 for g in idx['games'] if g.get('dev'))} dev)")


if __name__ == "__main__":
    main()
