"""The builder and repair agents of a web game: file tools restricted to the game's folder, the kit docs, and a
play_game tool that loads the page in real Chrome; plus the vision judge and the score a version is kept by.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
from pathlib import Path

from blocksfield import web_plan, web_play

WRITABLE = re.compile(r"^(?:js/)?[A-Za-z0-9_\-]+\.js$")
IN_PARTS = ("Write big files in parts of at most ~200 lines: write_file with the first part, then append_file with "
            "each next part in order (check_game once the last part is in).")

BUILDER_SYSTEM = """You are a senior gameplay programmer at a studio that ships polished stylised 3D browser games
made with ThreeKit, a library of tested three.js kits. A game is ONE file, game.js, that composes kit calls
(`import * as K from 'kit'`). The kits already do rendering, lighting, shadows, post FX, physics, controllers,
cameras, UI, particles and sound beautifully; your craft is choosing and configuring them.

Hard rules:
- Only call kit APIs that exist: the catalog and the docs (read_doc) are the truth. Never guess a function or an
  option; when unsure, read the doc section. A thrown kit error lists the valid choices: use one of them.
- Never write shaders, physics bodies, CSS/DOM UI, a renderer or your own animation loop. Customise through kit
  options, colours, placements and game.on(...) event handlers; per-frame logic goes in game.update(fn).
- game.js must keep calling K.Debug.install(game, { level, player }) and end with game.start().
- Keep the game working at every step: after each change run play_game, read its errors and fix them before
  doing anything else. A game with errors is worth nothing, however pretty.
- Big files go in parts (write_file then append_file); small changes with edit_file.
Finish by calling `submit`."""

BUILD_SUBMIT = {"type": "object", "required": ["summary"], "properties": {
    "summary": {"type": "string"}, "changes": {"type": "array", "items": {"type": "string"}},
    "known_issues": {"type": "array", "items": {"type": "string"}}}}

WEB_JUDGE_SYSTEM = """You are the principal art director and game-feel lead of a studio that ships stylised 3D
browser games (think a Nintendo-style toon platformer, a cel-shaded arcade racer, a cozy diorama). You review
captures of a game in development and judge only what a player would see. You are exacting and concrete: every
problem you name comes with a fix a developer can apply through the game's kit options (look preset, level kind and
size, colours, placements, HUD, FX, camera). Score 1-10: 1 broken/blank, 3 grey boxes/placeholder, 5 a decent game
jam entry, 7 a strong indie demo, 9 the bar: cohesive, juicy, shipped quality. Most work in progress is 3-6."""


# --------------------------------------------------------------------------------------------- tools
class GameTools:
    """The agent's view of one game: web/games/<id>/ (write: *.js; read: the game and the kit sources)."""

    def __init__(self, game_dir: Path, catalog: dict | None, plays_dir: Path, page_rel: str, log=print,
                 autopilot: float = 8.0) -> None:
        self.dir = Path(game_dir)
        self.catalog = catalog
        self.plays_dir = Path(plays_dir)
        self.page_rel = page_rel
        self.log = log
        self.autopilot = autopilot
        self.plays = 0
        self.last_play: dict | None = None
        self.reads_since_write = 0

    def _mine(self, path: str) -> Path:
        rel = str(path or "").replace("\\", "/").lstrip("./")
        rel = re.sub(r"^(?:web/)?games/[^/]+/", "", rel)
        if not WRITABLE.match(rel):
            raise ValueError(f"you can only write game.js or other .js files of this game (e.g. game.js, js/enemies.js),"
                             f" not {path!r}; index.html and assets/ are made by the pipeline")
        return self.dir / rel

    def _problems(self, p: Path, src: str) -> list[str]:
        return web_plan.check_js(src, self.catalog, main=p.name == "game.js" and p.parent == self.dir)

    def _report(self, what: str, p: Path, src: str) -> str:
        probs = self._problems(p, src)
        return (f"{what} {p.relative_to(self.dir).as_posix()} ({src.count(chr(10)) + 1} lines)"
                + ("\nPROBLEMS:\n- " + "\n- ".join(probs[:12]) if probs else "\nno static problems; run play_game"))

    async def write_file(self, path: str, content: str | None = None, **extra) -> str:
        if content is None:
            content = next((v for k, v in extra.items() if k in ("contents", "code", "source", "text")
                            and isinstance(v, str)), None)
        if content is None:
            return f"ERROR: write_file arrived without its content, so nothing was written (a reply that long is cut " \
                   f"off). {IN_PARTS}"
        try:
            p = self._mine(path)
        except ValueError as e:
            return f"ERROR: {e}"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8", newline="\n")
        self.reads_since_write = 0
        return self._report("wrote", p, content)

    async def append_file(self, path: str, content: str | None = None) -> str:
        if content is None:
            return f"ERROR: append_file arrived without its content. {IN_PARTS}"
        try:
            p = self._mine(path)
        except ValueError as e:
            return f"ERROR: {e}"
        src = p.read_text(encoding="utf-8") if p.exists() else ""
        src = src + ("\n" if src and not src.endswith("\n") else "") + content
        p.write_text(src, encoding="utf-8", newline="\n")
        self.reads_since_write = 0
        return self._report("appended to", p, src) + " (syntax problems are expected until the last part is in)"

    async def edit_file(self, path: str, old_text: str, new_text: str) -> str:
        try:
            p = self._mine(path)
        except ValueError as e:
            return f"ERROR: {e}"
        if not p.exists():
            return f"ERROR: {path} does not exist yet; use write_file"
        src = p.read_text(encoding="utf-8")
        n = src.count(old_text)
        if n != 1:
            hint = ""
            if n == 0:
                first = old_text.strip().splitlines()[0][:60] if old_text.strip() else ""
                near = [i + 1 for i, l in enumerate(src.splitlines()) if first and first.strip() in l]
                hint = f" (its first line appears at line(s) {near[:5]}; read_file and copy the text exactly)" if near \
                    else " (read_file to see the current text and copy it exactly)"
            return f"ERROR: old_text appears {n} times in {path}; it must appear exactly once.{hint}"
        src = src.replace(old_text, new_text, 1)
        p.write_text(src, encoding="utf-8", newline="\n")
        self.reads_since_write = 0
        return self._report("edited", p, src)

    async def read_file(self, path: str, start_line: int = 1, max_lines: int = 300) -> str:
        rel = str(path or "").replace("\\", "/").lstrip("./")
        rel = re.sub(r"^(?:web/)?games/[^/]+/", "", rel)
        if rel.startswith("kit/") or rel.startswith("web/kit/"):
            p = web_plan.KIT / rel.split("kit/", 1)[1]
        else:
            p = self.dir / rel
        try:
            p.resolve().relative_to(web_plan.WEB.resolve())
        except ValueError:
            return f"ERROR: {path} is outside the game and the kit"
        if not p.is_file():
            return f"ERROR: {path} does not exist. Game files: " + ", ".join(
                x.relative_to(self.dir).as_posix() for x in self.dir.rglob("*.js"))
        self.reads_since_write += 1
        lines = p.read_text(encoding="utf-8").splitlines()
        a = max(1, int(start_line))
        chunk = lines[a - 1:a - 1 + int(max_lines)]
        more = len(lines) - (a - 1 + len(chunk))
        nudge = ("\nNOTE: you have read a lot without writing: your brief and the docs have what you need; edit game.js "
                 "now." if self.reads_since_write >= 8 else "")
        return (f"{rel} ({len(lines)} lines)\n" + "\n".join(f"{a + i:4d}| {l}" for i, l in enumerate(chunk))
                + (f"\n... ({more} more lines)" if more > 0 else "") + nudge)

    async def read_doc(self, name: str, section: str = "") -> str:
        self.reads_since_write += 1
        return web_plan.read_doc(name, section)

    async def check_game(self) -> str:
        out = []
        for p in sorted(self.dir.rglob("*.js")):
            if "assets" in p.relative_to(self.dir).parts:
                continue
            probs = self._problems(p, p.read_text(encoding="utf-8"))
            if probs:
                out.append(f"{p.relative_to(self.dir).as_posix()}:\n- " + "\n- ".join(probs[:12]))
        return "\n".join(out) or "no static problems; run play_game to see it running"

    async def play_game(self, keys: str = "", autopilot_seconds: float | None = None, survey: bool = True):
        from harness.tools.base import ToolResult
        self.plays += 1
        n = self.plays
        out = self.plays_dir / f"play_{n:02d}"
        secs = self.autopilot if autopilot_seconds is None else min(max(float(autopilot_seconds), 0), 25)
        rep = await asyncio.to_thread(web_play.play, self.page_rel, out, survey=bool(survey), keys=str(keys or ""),
                                      autopilot=secs, frames=1)
        self.last_play = rep
        (out / "report.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
        score, notes = web_play.play_score(rep)
        self.log(f"play_game #{n}: ready={rep['ready']} errors={len(rep['errors'])} play_score={score}")
        text = play_text(rep, score, notes, self.catalog)
        imgs = []
        for key in ("sheet",):
            if rep.get(key):
                imgs.append(Path(rep[key]).read_bytes())
        for name in ("player", *sorted(k for k in rep["shots"] if k.startswith("autopilot_"))[-1:]):
            if name in rep["shots"]:
                imgs.append(Path(rep["shots"][name]).read_bytes())
        return ToolResult(text=text, images=imgs[:3])

    def tools(self) -> list:
        from harness.tools.base import Tool
        s = {"type": "object", "additionalProperties": False}
        return [
            Tool("write_file", "Create or overwrite a .js file of this game (game.js, or js/<name>.js modules you "
                               "import from game.js with './js/<name>.js'). Over ~200 lines: write the first part "
                               "here, then the rest with append_file. Reports static problems.",
                 {**s, "required": ["path", "content"], "properties": {
                     "path": {"type": "string"}, "content": {"type": "string", "description": "the whole file"}}},
                 self.write_file, mutating=True),
            Tool("append_file", "Add the next part of a long file to its end (after write_file wrote the first part).",
                 {**s, "required": ["path", "content"], "properties": {
                     "path": {"type": "string"}, "content": {"type": "string"}}}, self.append_file, mutating=True),
            Tool("edit_file", "Replace one exact snippet (old_text must occur exactly once) in a game file.",
                 {**s, "required": ["path", "old_text", "new_text"], "properties": {
                     "path": {"type": "string"}, "old_text": {"type": "string"}, "new_text": {"type": "string"}}},
                 self.edit_file, mutating=True),
            Tool("read_file", "Read a game file (game.js) or a kit source file (kit/<module>.js), with line numbers.",
                 {**s, "required": ["path"], "properties": {"path": {"type": "string"},
                                                            "start_line": {"type": "integer"},
                                                            "max_lines": {"type": "integer"}}}, self.read_file),
            Tool("read_doc", "Read a kit's doc: " + ", ".join(web_plan.doc_names() or list(web_plan.MODULES))
                 + ", or CONTRACT. Give `section` (e.g. 'build(' or 'options') to get just that part.",
                 {**s, "required": ["name"], "properties": {"name": {"type": "string"},
                                                            "section": {"type": "string"}}}, self.read_doc),
            Tool("check_game", "Static check of the game files: syntax errors, kit functions that do not exist, "
                               "forbidden code.", {**s, "properties": {}}, self.check_game),
            Tool("play_game", "Load the game in real Chrome: returns console errors, __kit.state(), a survey "
                              "contact sheet (overview/side/top), the player's view, and an autopilot run along the "
                              "level route (did it move, collect, win?). Optional `keys` to press first, e.g. "
                              "'KeyW:1500,Space:200,KeyD+KeyW:800'. Takes ~30 s.",
                 {**s, "properties": {"keys": {"type": "string"},
                                      "autopilot_seconds": {"type": "number", "description": "0-25, default 8"},
                                      "survey": {"type": "boolean"}}}, self.play_game, mutating=True),
        ]


def play_text(rep: dict, score: float, notes: list[str], catalog: dict | None) -> str:
    lines = [f"ready: {rep['ready']} (after {rep.get('load_s')} s); play score {score}/10"]
    if rep["errors"]:
        lines.append(f"ERRORS ({len(rep['errors'])}): fix these first")
        lines += [f"- {e[:900]}" for e in rep["errors"][:10]]
        ref = web_plan.docs_for_error("\n".join(rep["errors"][:10]), catalog)
        if ref:
            lines.append("REFERENCE for the APIs in those errors:\n" + ref[:5000])
    else:
        lines.append("no console errors")
    lines += [f"NOTE: {n}" for n in notes]
    ap = rep.get("autopilot")
    if ap:
        lines.append("autopilot: " + json.dumps({k: v for k, v in ap.items() if k != "end_state"}))
    st = rep.get("state")
    if st:
        lines.append("state: " + json.dumps(st, default=str)[:1500])
    if rep.get("warnings"):
        lines.append("warnings: " + " | ".join(rep["warnings"][:5])[:800])
    lines.append("Images: survey sheet (overview/side/top), player view, autopilot frame.")
    return "\n".join(lines)


# --------------------------------------------------------------------------------------------- briefs
def build_brief(plan: dict, catalog_txt: str, assets: dict, scaffold: str) -> str:
    man = "\n".join(f"- {n}: {e.get('kind')} ({e.get('file')})" + (f" for {e['for']}" if e.get("for") else "")
                    + (f" event {e['event']}" if e.get("event") else "") for n, e in assets.items()) or "(none)"
    return (f"THE GAME PLAN:\n{json.dumps(plan, indent=1)}\n\n"
            f"THE KIT CATALOG (every function and option list that exists):\n{catalog_txt}\n\n"
            f"GENERATED ASSETS in assets/assets.json (use them by name: game.asset(name), K.Assets.*):\n{man}\n\n"
            + (f"THE KIT DOCS (read_doc(name, section) for details):\n{web_plan.docs_digest()}\n\n"
               if web_plan.doc_names() else "")
            + "game.js ALREADY EXISTS and runs: the pipeline wrote this scaffold from the plan:\n"
            f"```js\n{scaffold}\n```\n\n"
            "YOUR JOB: turn it into the game in the plan.\n"
            "1. read_doc the modules you will customise (at least Level, Gameplay and UI; Player, FX, World as "
            "needed). Use only options they document.\n"
            "2. Make it THIS game, not the default: tune the level options, colours and HUD to the plan; add the "
            "plan's features (hazards, movers, enemies, extra placements, FX moments on events, win/lose screens) "
            "with kit calls; make the title screen sell the fantasy.\n"
            "3. run play_game after each meaningful change; fix every error it reports before continuing. Check the "
            "autopilot result: the player must move along the route and collect.\n"
            "4. Stop when it plays with zero errors and looks like the plan; call `submit` with a summary, your "
            "changes and known issues.")


def repair_brief(plan: dict, catalog_txt: str, findings: str, rnd: int) -> str:
    return (f"REPAIR ROUND {rnd}. The game in this folder was playtested and reviewed. Fix the findings below, most "
            "severe first, without breaking what works (the strengths). Errors come first: a game with errors is "
            "worth nothing.\n\n"
            f"FINDINGS:\n{findings}\n\n"
            f"THE GAME PLAN (for intent):\n{json.dumps(plan, indent=1)[:4000]}\n\n"
            f"THE KIT CATALOG:\n{catalog_txt}\n\n"
            "Read game.js first (read_file), make the fixes with edit_file, run play_game to confirm, then `submit`.")


# --------------------------------------------------------------------------------------------- judging
async def judge(llm, images: list[bytes], plan: dict, target: list[bytes]):
    """Vision verdict (harness.judge.Verdict) on the captures vs the concept board."""
    from harness.judge import _parse_json, _verdict
    from harness.llm import Message, image_part, text_part
    parts = [text_part(
        f"THE GAME: {plan.get('title')} - {plan.get('tagline')}\nGENRE / LOOP: {plan.get('genre')}; "
        f"{plan.get('core_loop')}\nART DIRECTION: {plan.get('art_direction')}\n\n"
        "CAPTURES: a survey contact sheet (overview / side / top cameras over the whole level, HUD hidden), the "
        "player's gameplay view, a frame from an autopilot playthrough (a bot is playing), and the title screen.")]
    for k, im in enumerate(images):
        parts += [text_part(f"Capture {k + 1}:"), image_part(im)]
    if target:
        parts.append(text_part("VISUAL TARGET (concept art the game should reach; judge how close the build gets in "
                               "composition, palette, mood and richness, not pixel identity):"))
        for k, im in enumerate(target):
            parts += [text_part(f"Target {k + 1}:"), image_part(im)]
    parts.append(text_part(
        "Reply with ONLY a JSON object: {\"score\": number 1-10, \"issues\": [{\"severity\": "
        "\"blocker|major|minor|nit\", \"where\": \"which element/moment\", \"problem\": \"what is wrong, concretely\", "
        "\"fix\": \"the concrete change, in terms of kit options/colours/placements\"}], \"strengths\": [\"what "
        "works and must be kept\"]}. List every issue that keeps this below 9, most severe first. A blocker is "
        "anything broken, blank, unreadable, off-screen or placeholder-looking."))
    msgs = [Message("system", WEB_JUDGE_SYSTEM), Message("user", parts)]
    obj, last = None, ""
    for _ in range(3):
        r = await llm.chat(msgs)
        last = r.message.content if isinstance(r.message.content, str) else json.dumps(r.message.content)
        obj = _parse_json(last)
        if obj is not None:
            break
        msgs = msgs + [r.message, Message("user", "Answer again with ONLY the JSON object described, nothing else.")]
    if obj is None:
        obj = {"score": 0, "issues": [], "strengths": [], "_raw": last[:1500], "_failed": True}
    return _verdict("web", obj, 7.0)


def capture_images(rep: dict) -> list[bytes]:
    out = []
    if rep.get("sheet"):
        out.append(Path(rep["sheet"]).read_bytes())
    for name in ["player"] + sorted(k for k in rep.get("shots", {}) if k.startswith("autopilot_"))[:1] + ["title"]:
        if name in rep.get("shots", {}):
            out.append(Path(rep["shots"][name]).read_bytes())
    return out[:4]


def findings_text(rep: dict, play_notes: list[str], verdict, catalog: dict | None) -> str:
    lines = []
    if rep["errors"]:
        lines.append("ERRORS while loading/playing (blockers):")
        lines += [f"- {e[:900]}" for e in rep["errors"][:10]]
        ref = web_plan.docs_for_error("\n".join(rep["errors"][:10]), catalog)
        if ref:
            lines.append("REFERENCE for the APIs in those errors:\n" + ref[:5000])
    if play_notes:
        lines.append("PLAYTEST:")
        lines += [f"- {n}" for n in play_notes]
    ap = rep.get("autopilot")
    if ap:
        lines.append("autopilot result: " + json.dumps({k: v for k, v in ap.items() if k != "end_state"}))
    if verdict is not None and verdict.issues:
        lines.append(f"VISUAL REVIEW (score {verdict.score}/10):\n{verdict.fix_list(10)}")
    if verdict is not None and verdict.strengths:
        lines.append("STRENGTHS (keep): " + "; ".join(verdict.strengths[:5]))
    return "\n".join(lines) or "no findings: polish what you think is weakest"


def combined(play: float, vision: float | None) -> float:
    if vision is None:
        return round(play, 2)
    if play < 3:                              # broken games never win on looks
        return round(play, 2)
    return round(0.5 * play + 0.5 * vision, 2)


# --------------------------------------------------------------------------------------------- versions
def snapshot(game_dir: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for p in game_dir.rglob("*.js"):
        rel = p.relative_to(game_dir)
        if rel.parts[0] == "assets":
            continue
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest / rel)


def restore(src: Path, game_dir: Path) -> None:
    for p in list(game_dir.rglob("*.js")):
        if p.relative_to(game_dir).parts[0] != "assets":
            p.unlink()
    for p in src.rglob("*.js"):
        rel = p.relative_to(src)
        (game_dir / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, game_dir / rel)
