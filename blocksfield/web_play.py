"""Play a generated web game in real Chrome (GPU WebGL) and report what a player would get: did it load, what broke,
what the level looks like from the survey cameras and the player's view, and how far the autopilot got.

Drives the game only through window.__kit (web/kit/CONTRACT.md, debug.js). Reuses web/tools/shot.py's http server and
Chrome flags. Synchronous (playwright sync API): call it from asyncio with asyncio.to_thread.
"""
from __future__ import annotations

import importlib.util
import json
import math
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def _shot_module():
    spec = importlib.util.spec_from_file_location("blocksfield_web_shot", WEB / "tools" / "shot.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_SHOT = _shot_module()
NOISE = ("GPU stall due to ReadPixels", "WebGL: INVALID_OPERATION", "[.WebGL-", "Automatic fallback to software",
         "AudioContext was not allowed to start", "The AudioContext was not allowed")


def _noise(msg: str) -> bool:
    return any(n in msg for n in NOISE)


def _flaky(err: str) -> bool:
    return any(k in err for k in ("ERR_NO_BUFFER_SPACE", "ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED",
                                  "ERR_EMPTY_RESPONSE", "ERR_CONNECTION_ABORTED"))


def _wait_ready(page, errors: list, wait: float) -> bool:
    t0 = time.time()
    while time.time() - t0 < wait:
        try:
            if page.evaluate("!!(window.__kit && window.__kit.ready)"):
                return True
        except Exception:  # noqa: BLE001  -- page still navigating
            pass
        if errors and time.time() - t0 > 3:
            return False
        time.sleep(0.25)
    return False


def contact_sheet(paths: list[Path], out: Path, cols: int = 2, cell=(640, 360), labels: list[str] | None = None) -> Path:
    from PIL import ImageDraw
    rows = max(1, math.ceil(len(paths) / cols))
    sheet = Image.new("RGB", (cell[0] * cols, cell[1] * rows), (16, 16, 20))
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        with Image.open(p) as im:
            im = im.convert("RGB").resize(cell, Image.LANCZOS)
        x, y = (i % cols) * cell[0], (i // cols) * cell[1]
        sheet.paste(im, (x, y))
        if labels:
            d.rectangle([x, y, x + 9 * len(labels[i]) + 10, y + 20], fill=(0, 0, 0))
            d.text((x + 5, y + 4), labels[i], fill=(255, 255, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return out


def play(page_rel: str, out_dir: Path, *, wait: float = 15.0, survey: bool = True, keys: str = "",
         autopilot: float = 0.0, frames: int = 3, video: Path | None = None, size=(1280, 720),
         evals: list[str] | None = None, root: Path = WEB) -> dict:
    """-> {ready, load_s, errors, warnings, state, shots: {name: path}, sheet, autopilot: {...}, eval: [...]}"""
    from playwright.sync_api import sync_playwright
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    srv, port = _SHOT.serve(root)
    errors: list[str] = []
    warnings: list[str] = []
    rep: dict = {"ready": False, "load_s": None, "errors": errors, "warnings": warnings, "state": None, "shots": {},
                 "sheet": None, "autopilot": None, "eval": []}

    def on_console(m) -> None:
        if m.type == "error" and not _noise(m.text):
            errors.append(f"console.error: {m.text[:1500]}")
        elif m.type == "warning" and not _noise(m.text):
            warnings.append(m.text[:400])

    def ev(page, js: str, default=None):
        try:
            return page.evaluate(js)
        except Exception as e:  # noqa: BLE001
            errors.append(f"harness eval failed ({js[:60]}): {str(e)[:300]}")
            return default

    def snap(page, name: str) -> Path:
        p = out_dir / f"{name}.png"
        page.screenshot(path=str(p))
        rep["shots"][name] = str(p)
        return p

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=_SHOT.GPU_ARGS, channel="chrome")
            kw = {"viewport": {"width": size[0], "height": size[1]}, "device_scale_factor": 1}
            if video:
                kw["record_video_dir"] = str(Path(video).parent / "_rec")
                kw["record_video_size"] = {"width": size[0], "height": size[1]}
            ctx = browser.new_context(**kw)
            page = ctx.new_page()
            page.on("console", on_console)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e} | {(e.stack or '')[:900]}"))
            page.on("response", lambda r: errors.append(f"http {r.status}: {r.url}") if r.status >= 400 else None)
            t0 = time.time()
            page.goto(f"http://127.0.0.1:{port}/{page_rel.lstrip('/')}")
            if not _wait_ready(page, errors, wait) and errors and all(_flaky(e) for e in errors):
                errors.clear()                             # a socket hiccup of the local server, not the game
                t0 = time.time()
                page.reload()
            while time.time() - t0 < wait:
                try:
                    if page.evaluate("!!(window.__kit && window.__kit.ready)"):
                        rep["ready"] = True
                        break
                except Exception:  # noqa: BLE001  -- page still navigating
                    pass
                if any(e.startswith("pageerror") for e in errors) and time.time() - t0 > 3:
                    break                                  # the module threw: it will never be ready
                time.sleep(0.25)
            rep["load_s"] = round(time.time() - t0, 2)
            page.wait_for_timeout(1500 if rep["ready"] else 300)
            for js in evals or []:
                rep["eval"].append(ev(page, js))
            if not rep["ready"]:
                snap(page, "player")
            else:
                snap(page, "title")                        # the first screen a player sees (title card, if any)
                ev(page, "window.__kit.start ? window.__kit.start() : true")     # dismiss the title, start play
                page.wait_for_timeout(900)
                if survey:
                    ev(page, "window.__kit.ui && window.__kit.ui(false)")       # clean world shots
                    cams = ev(page, "JSON.parse(JSON.stringify(window.__kit.survey ? window.__kit.survey() : []))", [])
                    paths, labels = [], []
                    for c in (cams or [])[:5]:
                        name = str(c.get("name", f"view{len(paths)}"))
                        if name == "player":
                            continue
                        ev(page, f"window.__kit.camera({json.dumps(c.get('position'))}, {json.dumps(c.get('target'))})")
                        page.wait_for_timeout(450)
                        paths.append(snap(page, f"survey_{name}"))
                        labels.append(name)
                    ev(page, "window.__kit.release && window.__kit.release()")
                    ev(page, "window.__kit.ui && window.__kit.ui(true)")
                    page.wait_for_timeout(400)
                    if paths:
                        rep["sheet"] = str(contact_sheet(paths[:4], out_dir / "survey_sheet.png", labels=labels[:4],
                                                         cols=2 if len(paths) == 4 else min(3, len(paths))))
                snap(page, "player")
                for chunk in [k for k in keys.split(",") if k.strip()]:
                    key, _, ms = chunk.partition(":")
                    held = [k for k in key.strip().split("+") if k]
                    for k in held:
                        page.keyboard.down(k)
                    page.wait_for_timeout(int(ms or 150))
                    for k in reversed(held):
                        page.keyboard.up(k)
                if keys.strip():
                    page.wait_for_timeout(300)
                    snap(page, "after_keys")
                if autopilot > 0:
                    rep["autopilot"] = _autopilot(page, ev, snap, autopilot, frames)
            rep["state"] = ev(page, "window.__kit && window.__kit.state ? "
                                    "JSON.parse(JSON.stringify(window.__kit.state())) : null")
            kit_errs = ev(page, "(window.__kit && window.__kit.errors) || window.__kitErrors || []", []) or []
            for e in kit_errs:
                line = f"kit error: {str(e)[:1500]}"
                if not any(str(e)[:120] in x for x in errors):
                    errors.append(line)
            ctx.close()
            if video and page.video:
                Path(video).parent.mkdir(parents=True, exist_ok=True)
                Path(page.video.path()).replace(video)
                rep["video"] = str(video)
            browser.close()
    finally:
        srv.shutdown()
    rep["errors"] = errors[:40]
    rep["warnings"] = sorted(set(warnings))[:15]
    return rep


def _num(d: dict | None, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and isinstance(d.get(k), (int, float)) and not isinstance(d.get(k), bool):
            return d[k]
    return default


def _pos(state: dict | None):
    p = ((state or {}).get("player") or {}).get("position")
    if isinstance(p, dict):
        p = [p.get("x"), p.get("y"), p.get("z")]
    if isinstance(p, (list, tuple)) and len(p) >= 3 and all(isinstance(v, (int, float)) for v in p[:3]):
        return [float(v) for v in p[:3]]
    return None


def _autopilot(page, ev, snap, seconds: float, frames: int) -> dict:
    get = "JSON.parse(JSON.stringify(window.__kit.state()))"
    start = ev(page, get, {}) or {}
    ok = ev(page, "window.__kit.autopilot ? (window.__kit.autopilot(true), true) : false", False)
    samples, path = [], []
    shots_at = {round(seconds * (i + 1) / (frames + 1)) for i in range(max(0, frames))}
    t0 = time.time()
    k = 0
    while time.time() - t0 < seconds:
        page.wait_for_timeout(1000)
        k += 1
        st = ev(page, get, {}) or {}
        samples.append(st)
        if (p := _pos(st)) is not None:
            path.append(p)
        if k in shots_at:
            snap(page, f"autopilot_{k:02d}")
        if st.get("won") or st.get("lost") or st.get("autopilotDone"):
            break
    ev(page, "window.__kit.autopilot && window.__kit.autopilot(false)")
    end = samples[-1] if samples else start
    dist = sum(math.dist(a, b) for a, b in zip(path, path[1:])) if len(path) > 1 else 0.0
    alive = [((s.get("player") or {}).get("alive")) for s in samples]
    deaths = sum(1 for a, b in zip(alive, alive[1:]) if a and b is False)
    return {"available": bool(ok), "seconds": round(time.time() - t0, 1), "moved": round(dist, 1),
            "collected_start": _num(start, "collected", "score", "coins"),
            "collected_end": _num(end, "collected", "score", "coins"),
            "target": _num(end, "target", "collectTarget"),
            "won": bool(end.get("won")), "lost": bool(end.get("lost")), "deaths": deaths,
            "done": bool(end.get("autopilotDone")),
            "end_state": {k: v for k, v in end.items() if k not in ("level",)}}


def play_score(rep: dict) -> tuple[float, list[str]]:
    """0-10 for 'it runs and plays', with the reasons (fed to the repair agent)."""
    notes: list[str] = []
    errs = [e for e in rep.get("errors", []) if not e.startswith("http 404: ") or "favicon" not in e]
    if not rep.get("ready"):
        notes.append("the game never became ready (window.__kit.ready stayed false): it crashed during setup or "
                     "never called K.Debug.install / game.start()")
        return (0.5 if errs else 1.0), notes
    score = 4.0
    if errs:
        notes.append(f"{len(errs)} console/page error(s) while playing")
        score -= min(3.0, 1.0 * len(errs))
    ap = rep.get("autopilot")
    if ap:
        if not ap.get("available"):
            notes.append("__kit.autopilot is missing: the autopilot playtest could not run")
        else:
            if ap.get("moved", 0) >= 6:
                score += 2
            else:
                notes.append(f"the autopilot barely moved ({ap.get('moved')} units in {ap.get('seconds')} s): the "
                             "player is stuck, frozen, or the controls never start")
            c0, c1, tgt = ap.get("collected_start"), ap.get("collected_end"), ap.get("target")
            if isinstance(c1, (int, float)):
                got = c1 - (c0 or 0)
                if got > 0:
                    score += 2 * min(1.0, got / max(1.0, float(tgt or 5)))
                else:
                    notes.append("the autopilot collected nothing along the route: collectibles are off the route, "
                                 "unreachable, or collecting is not wired to the counter")
            if ap.get("won") or ap.get("done"):
                score += 2
            elif ap.get("lost"):
                notes.append("the autopilot LOST the game during the playtest (too hard, or a hazard on the route)")
            if ap.get("deaths", 0) >= 2:
                notes.append(f"the player died {ap['deaths']} times along the intended route")
                score -= 1
    else:
        score += 2
    return round(max(0.0, min(10.0, score)), 2), notes
