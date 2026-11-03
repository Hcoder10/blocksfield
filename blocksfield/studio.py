"""Blocksfield Studio: the app face of the pipeline. A local web app to type a pitch, watch a build happen live (plan,
concept board, generated assets, builder playtests, judged versions, the finished game) and see who holds the GPU.

    python -m blocksfield.studio [--port 8420] [--allow-launch] [--arbiter http://127.0.0.1:8100]

Pages: /  (pitch box, live GPU strip, recent games)   /run/<id>  (live run view)   /runs  (every web game)
API:   /api/runs   /api/run/<id>?at=<epoch>   /api/gpu?since=<epoch>   /api/gpu/thumb/<n>   POST /api/make
`at` replays a finished run as of that moment (files by mtime, log lines by timestamp), which is how the run view
can be recorded "live" from a finished build. "Make game" only launches a build when started with --allow-launch.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
RUNS = ROOT / "runs"
GAMES = WEB / "games"
STUDIO = WEB / "studio"
STAGES = ["plan", "art", "scaffold", "build", "judge", "finalize"]
LOG_RE = re.compile(r"^\[(\d\d):(\d\d):(\d\d)\] (.*)$")
for ext, typ in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".wasm", "application/wasm"),
                 (".json", "application/json"), (".woff2", "font/woff2"), (".mp4", "video/mp4"), (".webm", "video/webm"),
                 (".mp3", "audio/mpeg"), (".wav", "audio/wav"), (".svg", "image/svg+xml")):
    mimetypes.add_type(typ, ext)


def _json(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def _rel(p: Path) -> str:
    """URL for a file under runs/ or web/."""
    p = p.resolve()
    try:
        return "/" + p.relative_to(WEB).as_posix()
    except ValueError:
        return "/runfile/" + p.relative_to(RUNS).as_posix()


# ------------------------------------------------------------------------------------------------ run snapshots
def parse_log(path: Path) -> list[dict]:
    """build.log lines -> [{t (epoch), text}]. Lines carry only HH:MM:SS: anchor on the file's mtime and walk back
    so runs that cross midnight still come out in order."""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    end = _mtime(path) or time.time()
    day = dt.datetime.fromtimestamp(end).date()
    out, prev = [], None
    stamped = []
    for ln in lines:
        m = LOG_RE.match(ln)
        if m:
            secs = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3])
            stamped.append((secs, m[4]))
    # assign dates from the end backwards
    day_off = 0
    for secs, text in reversed(stamped):
        if prev is not None and secs > prev + 3600:
            day_off += 1
        prev = secs
        base = dt.datetime.combine(day - dt.timedelta(days=day_off), dt.time()).timestamp()
        out.append({"t": base + secs, "text": text})
    out.reverse()
    return out


def _log_kind(text: str) -> str:
    t = text.lower()
    if "failed" in t or "error" in t:
        return "bad"
    if t.startswith("asset ") or t.startswith("art:"):
        return "art"
    if t.startswith("eval") or "scored" in t or t.startswith("repair"):
        return "judge"
    if t.startswith("#") or "agent" in t:
        return "agent"
    if t.startswith("==") or t.startswith("stage "):
        return "stage"
    return "info"


def _gpu_from_log(log: list[dict]) -> list[dict]:
    """Who held the GPU during this run, reconstructed from its log: ComfyUI for the art burst, the LLM while an
    agent or a vision judge was working. The arbiter only keeps recent events, so this is the run's own history."""
    segs = []
    art0 = agent0 = None
    agent_name = None
    last = None
    for e in log:
        tx, t = e["text"], e["t"]
        if tx == "== art ==":
            art0 = t
        elif tx.startswith("stage art: finished") and art0:
            segs.append({"kind": "art", "start": art0, "end": t})
            art0 = None
        elif re.match(r"#\d+ \S+ started", tx):
            agent0, agent_name = t, tx.split()[1]
        elif re.match(r"#\d+ \S+ done", tx) and agent0:
            segs.append({"kind": "llm", "start": agent0, "end": t, "name": tx.split()[1]})
            agent0 = None
        elif tx.startswith("eval ") and last is not None:
            segs.append({"kind": "judge", "start": max(last, t - 150), "end": t})
        last = t
    if agent0:
        segs.append({"kind": "llm", "start": agent0, "end": None, "name": agent_name})
    if art0:
        segs.append({"kind": "art", "start": art0, "end": None})
    return segs


def _shots(d: Path, at: float) -> dict:
    out = {}
    for p in sorted(d.glob("*.png")):
        if _mtime(p) <= at:
            out[p.stem] = _rel(p)
    return out


def run_snapshot(rid: str, at: float | None = None) -> dict:
    rd = RUNS / f"web_{rid}"
    gd = GAMES / rid
    if not rd.is_dir() and not gd.is_dir():
        raise FileNotFoundError(rid)
    now = time.time()
    live = at is None
    at = now if at is None else at
    log_all = parse_log(rd / "build.log")
    log = [e for e in log_all if e["t"] <= at]
    idea = _json(rd / "idea.json", {}) or {}
    about = _json(gd / "about.json", {}) or {}
    started = log_all[0]["t"] if log_all else _mtime(rd / "idea.json")
    st_dir = rd / "stages"
    stage_files = {p.stem: p for p in st_dir.glob("*.json")} if st_dir.is_dir() else {}
    # when each stage finished: its log line if there is one (files can be rewritten later by --redo), else mtime
    fin_t = {}
    for e in log_all:
        m = re.match(r"stage (\w+): finished", e["text"]) or re.match(r"eval (\w+): score", e["text"])
        if m:
            fin_t["eval_" + m[1] if e["text"].startswith("eval") else m[1]] = e["t"]
    made = {k: fin_t.get(k, _mtime(p)) for k, p in stage_files.items()}
    visible = {k: p for k, p in stage_files.items() if made[k] <= at}

    def stage_t(name):
        return made[name] if name in visible else None

    finished = any(e["text"].startswith("done in ") for e in log) or ("finalize" in visible)
    failed = (not finished) and any(e["text"].startswith(("FAILED", "Traceback")) or "fatal" in e["text"].lower() for e in log[-3:])
    # stage strip
    starts = {}
    for e in log:
        m = re.match(r"== (\w+) ==", e["text"])
        if m:
            starts.setdefault("judge" if m[1].startswith("repair") or m[1].startswith("eval") else m[1], e["t"])
    for e in log:                    # judging starts with the first eval after the build
        if e["text"].startswith("eval ") and "judge" not in starts:
            starts["judge"] = e["t"] - 150
    done = {"plan": "plan" in visible, "art": "art" in visible, "scaffold": "scaffold" in visible,
            "build": "build" in visible, "judge": "finalize" in starts or finished, "finalize": finished}
    ends = {"plan": stage_t("plan"), "art": stage_t("art"), "scaffold": stage_t("scaffold"), "build": stage_t("build"),
            "judge": starts.get("finalize"), "finalize": log[-1]["t"] if finished and log else None}
    if "judge" not in starts and done["build"]:
        starts["judge"] = ends["build"]
    stages, active = [], None
    for name in STAGES:
        state = "done" if done[name] else "todo"
        if state == "todo" and active is None and not finished:
            state, active = "active", name
        stages.append({"name": name, "state": state, "start": starts.get(name), "end": ends[name] if done[name] else None})
    phase = next((s["name"] for s in stages if s["state"] == "active"), "done" if finished else None)

    snap: dict = {"id": rid, "now": now, "at": at, "live": live, "started": started,
                  "ended": log[-1]["t"] if finished and log else None,
                  "status": "done" if finished else ("failed" if failed else "running"), "phase": phase,
                  "pitch": idea.get("pitch") if len(idea.get("pitch") or "") > 30 else (about.get("pitch") or idea.get("pitch")),
                  "stages": stages,
                  "replay": {"start": started, "end": log_all[-1]["t"] if log_all else now}}
    plan = None
    if "plan" in visible:
        plan = (_json(visible["plan"], {}) or {}).get("plan") or _json(rd / "plan.json", {})
    if plan:
        snap["plan"] = {k: plan.get(k) for k in ("title", "tagline", "genre", "core_loop", "controls", "win_condition",
                                                 "lose_condition", "look", "ui_style", "level_kind", "level_size",
                                                 "player_type", "camera", "player_colors", "collectible", "timer_seconds",
                                                 "lives", "enemies", "race", "art_direction", "music", "assets")}
        snap["title"], snap["tagline"] = plan.get("title"), plan.get("tagline")
    else:
        snap["title"] = about.get("title") if not live or finished else None

    # concept board + generated assets
    snap["concepts"] = [_rel(p) for p in sorted((rd / "concept").glob("concept_*.png")) if _mtime(p) <= at]
    art = _json(stage_files["art"], {}) if "art" in stage_files else None
    manifest = art.get("assets") if art else (_json(gd / "assets" / "assets.json", {}) or {})
    report = (art or {}).get("report") or {}
    assets = []
    asset_t = {}
    for e in log_all:
        m = re.match(r"asset (\S+): ok", e["text"])
        if m:
            asset_t[m[1]] = e["t"]
    for name, e in (manifest or {}).items():
        f = gd / "assets" / e.get("file", "")
        t_made = asset_t.get(name, _mtime(f))
        if not f.is_file() or t_made > at:
            continue
        rep = report.get(name) if isinstance(report, dict) else None
        assets.append({"name": name, "kind": e.get("kind"), "url": _rel(f), "prompt": e.get("prompt"),
                       "secs": (rep or {}).get("seconds"), "t": t_made})
    for p in sorted((rd / "assets" / "props").glob("*_preview.png")):
        if _mtime(p) <= at:
            assets.append({"name": p.stem.replace("_preview", ""), "kind": "prop", "url": _rel(p), "t": _mtime(p)})
    failed_assets = []
    for e in log:
        m = re.match(r"asset (\S+): FAILED", e["text"])
        if m:
            failed_assets.append(m[1])
    snap["assets"] = sorted(assets, key=lambda a: a["t"])
    snap["assets_failed"] = failed_assets

    # builder playtests (play_game calls made while the agents work)
    plays = []
    pd = rd / "plays"
    if pd.is_dir():
        for rnd in sorted(pd.iterdir(), key=lambda p: (p.name != "build", p.name)):
            for play in sorted(rnd.glob("play_*")):
                sh = _shots(play, at)
                if sh:
                    rep = _json(play / "report.json", {}) if _mtime(play / "report.json") <= at else {}
                    st = (rep or {}).get("state") or {}
                    plays.append({"round": rnd.name, "n": int(play.name.split("_")[1]), "shots": sh,
                                  "t": max(_mtime(play / f"{k}.png") for k in sh),
                                  "errors": len((rep or {}).get("errors") or []),
                                  "collected": st.get("collected"), "target": st.get("target")})
    snap["plays"] = plays

    # judged versions
    versions = []
    for k, p in visible.items():
        if not k.startswith("eval_"):
            continue
        ev = _json(p, {}) or {}
        tag = ev.get("tag") or k[5:]
        vd = rd / "versions" / tag
        ap = ev.get("autopilot") or {}
        versions.append({"tag": tag, "score": ev.get("score"), "play": ev.get("play_score"), "vision": ev.get("vision_score"),
                         "notes": (ev.get("vision_notes") or ev.get("notes") or ev.get("play_notes") or [])[:4],
                         "shots": _shots(vd / "play", max(at, made[k] + 5)), "t": made[k], "errors": len(ev.get("errors") or []),
                         "collected": ap.get("collected_end"), "target": ap.get("target"), "won": ap.get("won"),
                         "moved": ap.get("moved")})
    versions.sort(key=lambda v: v["t"])
    if versions:
        best = max(versions, key=lambda v: (v["score"] or 0, -v["t"]))
        kept = None
        for e in log:
            m = re.search(r"best (\w+), score", e["text"]) or re.search(r"kept (\w+)$", e["text"])
            if m:
                kept = m[1]
        for v in versions:
            v["kept"] = v["tag"] == (kept or best["tag"])
    snap["versions"] = versions

    # agents (their records land when each call finishes)
    agents = []
    for p in sorted((rd / "agents").glob("*.json")):
        if _mtime(p) > at:
            continue
        a = _json(p, {}) or {}
        steps = []
        for m in a.get("messages") or []:
            for tc in m.get("tool_calls") or []:
                name = tc.get("name") or (tc.get("function") or {}).get("name")
                args = tc.get("arguments") or (tc.get("function") or {}).get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {"raw": args[:80]}
                brief = args.get("name") or args.get("path") or args.get("section") or ""
                if name == "edit_file" or name == "write_file":
                    brief = args.get("path") or "game.js"
                steps.append({"tool": name, "arg": str(brief)[:40]})
        res = a.get("result") or {}
        summary = res.get("summary") if isinstance(res, dict) else str(res)
        u = a.get("usage") or {}
        agents.append({"label": a.get("label"), "role": a.get("role"), "seconds": a.get("seconds"), "steps": steps[-60:],
                       "nsteps": a.get("steps"), "tokens": u.get("total_tokens"), "prompt_tokens": u.get("prompt_tokens"),
                       "completion_tokens": u.get("completion_tokens"), "summary": (summary or "")[:600], "t": _mtime(p)})
    # an agent that is working right now (started in the log, no record yet)
    working = None
    for e in log:
        m = re.match(r"#(\d+) (\S+) started \((\w+)", e["text"])
        if m:
            working = {"label": m[2], "role": m[3], "since": e["t"]}
        elif re.match(r"#\d+ \S+ done", e["text"]):
            working = None
    snap["agents"], snap["working"] = agents, working

    snap["log"] = [{"t": e["t"], "text": e["text"][:220], "kind": _log_kind(e["text"])}
                   for e in log if not e["text"].startswith("play_game #")][-18:]
    snap["gpu"] = [{**g, "end": None if g["end"] is None or g["end"] > at else g["end"]}
                   for g in _gpu_from_log(log_all) if g["start"] <= at]
    if finished:
        snap["final"] = {"game": f"/games/{rid}/index.html" if (gd / "index.html").is_file() else None,
                         "thumb": f"/games/{rid}/thumb.jpg" if (gd / "thumb.jpg").is_file() else None,
                         "video": f"/games/{rid}/gameplay.mp4" if (gd / "gameplay.mp4").is_file() else None,
                         "score": (about.get("score") or {}).get("score") if isinstance(about.get("score"), dict) else about.get("score"),
                         "title": about.get("title")}
        snap["title"] = snap.get("title") or about.get("title")
    return snap


def _friendly(line: str) -> str:
    m = re.match(r"done in (\d+)s: (\{.*?\})", line)
    if m:
        try:
            d = json.loads(m[2])
            return f"built in {int(m[1]) // 60} min · kept {d.get('best')} · score {d.get('score')}"
        except ValueError:
            return f"built in {int(m[1]) // 60} min"
    return line


def list_runs() -> list[dict]:
    ids = {p.name[4:] for p in RUNS.glob("web_*") if p.is_dir()}
    ids |= {p.name for p in GAMES.iterdir() if p.is_dir() and not p.name.startswith("_") and (p / "about.json").is_file()}
    out = []
    for rid in ids:
        rd, gd = RUNS / f"web_{rid}", GAMES / rid
        about = _json(gd / "about.json", {}) or {}
        idea = _json(rd / "idea.json", {}) or {}
        plan = _json(rd / "plan.json", {}) or {}
        if about.get("dry_run") or idea.get("dry_run") or "dry" in rid:
            continue
        log = rd / "build.log"
        tail = ""
        if log.is_file():
            lines = [ln for ln in log.read_text(encoding="utf-8", errors="replace").splitlines() if LOG_RE.match(ln)]
            tail = LOG_RE.match(lines[-1])[4] if lines else ""
        done = (gd / "about.json").is_file() and (not log.is_file() or tail.startswith("done in") or "finalize" in tail
                                                  or _mtime(gd / "about.json") >= _mtime(log) - 5)
        upd = max(_mtime(log), _mtime(gd / "about.json"))
        out.append({"id": rid, "title": about.get("title") or plan.get("title") or rid.replace("_", " ").title(),
                    "tagline": about.get("tagline") or plan.get("tagline"), "pitch": about.get("pitch") or idea.get("pitch"),
                    "genre": about.get("genre") or plan.get("genre"),
                    "score": (about.get("score") or {}).get("score") if isinstance(about.get("score"), dict) else about.get("score"),
                    "thumb": f"/games/{rid}/thumb.jpg" if (gd / "thumb.jpg").is_file() else
                    next((_rel(p) for p in sorted((rd / "concept").glob("concept_*.png"))), None),
                    "video": f"/games/{rid}/gameplay.mp4" if (gd / "gameplay.mp4").is_file() else None,
                    "status": "done" if done else ("running" if time.time() - upd < 1800 else "stopped"),
                    "last": _friendly(tail)[:140], "updated": upd, "has_run": rd.is_dir()})
    out.sort(key=lambda r: (r["status"] != "running", -r["updated"]))
    return out


# ------------------------------------------------------------------------------------------------ GPU (arbiter)
class Arbiter:
    """Polls the arbiter's /events in the background and keeps a longer history than its 400-event ring."""

    def __init__(self, url: str) -> None:
        self.url = url.rstrip("/")
        self.events: dict[tuple, dict] = {}
        self.state: dict = {"online": False}
        self.lock = threading.Lock()
        threading.Thread(target=self.loop, daemon=True).start()

    def loop(self) -> None:
        since = 0.0
        while True:
            try:
                with urllib.request.urlopen(f"{self.url}/events?since={since}", timeout=4) as r:
                    d = json.loads(r.read())
                with self.lock:
                    for e in d.get("events", []):
                        self.events[(e.get("kind"), e.get("name"), e.get("start"))] = e
                    cutoff = d["now"] - 4 * 3600
                    for k in [k for k, e in self.events.items() if (e.get("end") or 0) < cutoff]:
                        del self.events[k]
                    self.state = {"online": True, **{k: v for k, v in d.items() if k != "events"}, "polled": time.time()}
                since = max(since, d["now"] - 120)
            except (urllib.error.URLError, OSError, ValueError, KeyError):
                with self.lock:
                    self.state = {**self.state, "online": False}
            time.sleep(1.5)

    def snapshot(self, since: float) -> dict:
        with self.lock:
            evs = sorted((e for e in self.events.values() if (e.get("end") or 0) > since), key=lambda e: e["start"])
            return {**self.state, "events": evs[-800:], "local_now": time.time()}

    def thumb(self, n: str) -> bytes | None:
        try:
            with urllib.request.urlopen(f"{self.url}/thumb/{int(n)}", timeout=4) as r:
                return r.read()
        except (urllib.error.URLError, OSError, ValueError):
            return None


# ------------------------------------------------------------------------------------------------ launching
def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    words = s.split("_")[:4]
    return "_".join(words)[:32] or f"game_{int(time.time())}"


def launch(pitch: str, rid: str, title: str = "") -> dict:
    rd = RUNS / f"web_{rid}"
    rd.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.setdefault("BLOCKSFIELD_BOX", "-p 14412 root@ssh7.vast.ai")
    harness = env.get("BLOCKSFIELD_HARNESS") or str(Path.home() / "cybus-harness")
    env["PYTHONPATH"] = os.pathsep.join([harness, str(ROOT)])
    env["PYTHONUTF8"] = "1"
    argv = [sys.executable, "-u", "-m", "blocksfield.web_run", pitch, "--id", rid, "--repair-rounds", "2"]
    if title:
        argv += ["--title", title]
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    with open(rd / "build.log", "ab") as out, open(rd / "build.err.log", "ab") as err:
        p = subprocess.Popen(argv, cwd=str(ROOT), env=env, stdout=out, stderr=err, stdin=subprocess.DEVNULL,
                             creationflags=flags, close_fds=True)
    return {"ok": True, "id": rid, "pid": p.pid}


# ------------------------------------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "BlocksfieldStudio/1"
    arbiter: Arbiter = None  # type: ignore[assignment]
    allow_launch = False

    def log_message(self, *a) -> None:  # quiet
        pass

    def send_json(self, obj, status: int = 200) -> None:
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, p: Path) -> None:
        if not p.is_file():
            return self.send_error(404)
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        size = p.stat().st_size
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else max(0, size - int(b))
            end = int(b) if a and b else size - 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(p, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 16, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return
                left -= len(chunk)

    def safe(self, base: Path, rel: str) -> Path | None:
        p = (base / urllib.parse.unquote(rel)).resolve()
        return p if p == base.resolve() or base.resolve() in p.parents else None

    def do_GET(self) -> None:  # noqa: N802
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        path = u.path
        try:
            if path in ("/", "/index.html", "/create"):
                return self.send_file(STUDIO / "index.html")
            if path in ("/runs", "/runs/"):
                return self.send_file(STUDIO / "runs.html")
            if re.fullmatch(r"/run/[\w-]+/?", path):
                return self.send_file(STUDIO / "run.html")
            if path == "/api/runs":
                return self.send_json({"runs": list_runs(), "launch": self.allow_launch})
            m = re.fullmatch(r"/api/run/([\w-]+)", path)
            if m:
                at = float(q["at"][0]) if q.get("at") else None
                try:
                    return self.send_json(run_snapshot(m[1], at))
                except FileNotFoundError:
                    return self.send_json({"error": f"no run {m[1]}"}, 404)
            if path == "/api/gpu":
                return self.send_json(self.arbiter.snapshot(float(q.get("since", ["0"])[0])))
            m = re.fullmatch(r"/api/gpu/thumb/(\d+)", path)
            if m:
                data = self.arbiter.thumb(m[1])
                if not data:
                    return self.send_error(404)
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Cache-Control", "max-age=3600")
                self.end_headers()
                return self.wfile.write(data)
            if path.startswith("/runfile/"):
                p = self.safe(RUNS, path[len("/runfile/"):])
                return self.send_file(p) if p else self.send_error(403)
            p = self.safe(WEB, path.lstrip("/"))
            if p and p.is_dir():
                p = p / "index.html"
            return self.send_file(p) if p else self.send_error(403)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/make":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self.send_json({"ok": False, "error": "bad json"}, 400)
        pitch = (body.get("pitch") or "").strip()
        if len(pitch) < 20:
            return self.send_json({"ok": False, "error": "Write a pitch of at least a sentence."}, 400)
        rid = slug(body.get("id") or body.get("title") or pitch)
        if (RUNS / f"web_{rid}").exists() or (GAMES / rid).exists():
            rid = f"{rid}_{int(time.time()) % 100000}"
        if not self.allow_launch:
            return self.send_json({"ok": False, "id": rid, "error": "Launching is off in this Studio "
                                   "(start it with --allow-launch). Opening a recent run instead."}, 403)
        return self.send_json(launch(pitch, rid, body.get("title") or ""))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8420)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--arbiter", default=os.environ.get("BLOCKSFIELD_ARBITER", "http://127.0.0.1:8100"))
    ap.add_argument("--allow-launch", action="store_true", help="let 'Make game' start real builds")
    a = ap.parse_args(argv)
    Handler.arbiter = Arbiter(a.arbiter)
    Handler.allow_launch = a.allow_launch
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    print(f"Blocksfield Studio on http://{a.host}:{a.port}/  (arbiter {a.arbiter}; launching "
          f"{'ON' if a.allow_launch else 'off'})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
