"""What a web game may be made of: the ThreeKit catalog (read from the kits themselves in Chrome), the plan schema whose
enums come from it (the model picks, it does not invent), the plan -> game.js scaffold, and a static check of game.js
against the catalog (invented kit APIs are caught before the page even loads).
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
KIT = WEB / "kit"
DOCS = KIT / "docs"
MODULES = ("Look", "World", "Level", "Assets", "Physics", "Player", "Camera", "Gameplay", "UI", "FX", "Audio", "Debug")

# CONTRACT.md's lists: used when a kit does not export its own yet
DEFAULT_ENUMS = {
    "look": ["toon_bright", "candy", "sunset", "neon_night", "dark_fantasy", "cozy", "desert", "snow"],
    "level_kind": ["sky_islands", "meadow_course", "arena", "town", "race_track"],
    "player_type": ["platformer", "kart", "boat", "topdown", "fps"],
    "camera": ["follow", "chase", "topdown", "orbit", "firstPerson"],
}
CAMERA_FOR = {"platformer": "follow", "kart": "chase", "boat": "chase", "topdown": "topdown", "fps": "firstPerson"}

INDEX_HTML = """<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>{title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{{margin:0;height:100%;overflow:hidden;background:#000}}</style>
<script type="importmap">{{"imports":{{"three":"../../vendor/three/three.module.js",
 "three/addons/":"../../vendor/three/addons/","kit":"../../kit/index.js"}}}}</script>
</head><body><script type="module" src="./game.js"></script></body></html>
"""

CATALOG_HTML = """<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">
<script type="importmap">{"imports":{"three":"../../vendor/three/three.module.js",
 "three/addons/":"../../vendor/three/addons/","kit":"../../kit/index.js"}}</script></head><body><script type="module">
const out = {}; const fail = [];
let K = null;
try { K = await import('kit'); } catch (e) { fail.push(String(e && e.stack || e)); }
const params = (f) => { const m = String(f).match(/^[^(]*\\(([^)]*)\\)/); return m ? m[1].replace(/\\s+/g, ' ').trim() : ''; };
for (const [mod, ns] of Object.entries(K || {})) {
  if (mod === 'THREE' || mod === 'RAPIER') continue;
  if (typeof ns === 'function') { (out._top = out._top || { functions: [], arrays: {}, objects: {} }).functions.push(`${mod}(${params(ns)})`); continue; }
  if (!ns || typeof ns !== 'object') continue;
  const e = { functions: [], arrays: {}, objects: {} };
  for (const [k, v] of Object.entries(ns)) {
    if (typeof v === 'function') e.functions.push(`${k}(${params(v)})`);
    else if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) e.arrays[k] = v.slice(0, 80);
    else if (v && typeof v === 'object' && !Array.isArray(v)) { const ks = Object.keys(v); if (ks.length && ks.length <= 80) e.objects[k] = ks; }
  }
  if (typeof ns.list === 'function' && ns.list.length === 0) { try { const r = ns.list(); if (Array.isArray(r)) e.arrays['list()'] = r.map(String); } catch (x) {} }
  out[mod] = e;
}
window.__catalog = { modules: out, fail };
</script></body></html>
"""


# --------------------------------------------------------------------------------------------- catalog
def read_catalog(game_dir: Path, timeout: float = 20) -> dict:
    """Import kit/index.js in Chrome and list every module's functions (with parameter lists), string arrays (the
    enums) and object keys. Written next to the game as _catalog.html (removed afterwards)."""
    from playwright.sync_api import sync_playwright
    from blocksfield.web_play import _SHOT
    game_dir.mkdir(parents=True, exist_ok=True)
    page_file = game_dir / "_catalog.html"
    page_file.write_text(CATALOG_HTML, encoding="utf-8")
    srv, port = _SHOT.serve(WEB)
    errors: list[str] = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True, args=_SHOT.GPU_ARGS, channel="chrome")
            page = b.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)[:500]))
            page.goto(f"http://127.0.0.1:{port}/{page_file.relative_to(WEB).as_posix()}")
            page.wait_for_function("!!window.__catalog", timeout=timeout * 1000)
            cat = page.evaluate("window.__catalog")
            b.close()
    finally:
        srv.shutdown()
        page_file.unlink(missing_ok=True)
    cat["errors"] = errors + list(cat.pop("fail", []))
    return cat


def fn_names(catalog: dict, module: str) -> set[str]:
    return {f.split("(", 1)[0] for f in (catalog.get("modules", {}).get(module) or {}).get("functions", [])}


def _pick(catalog: dict, module: str, pattern: str) -> list[str] | None:
    arrays = (catalog.get("modules", {}).get(module) or {}).get("arrays", {})
    for k, v in arrays.items():
        if re.search(pattern, k, re.I) and v:
            return list(v)
    objs = (catalog.get("modules", {}).get(module) or {}).get("objects", {})
    for k, v in objs.items():
        if re.search(pattern, k, re.I) and v:
            return list(v)
    return None


def enums(catalog: dict | None) -> dict[str, list[str]]:
    """The plan's choice lists, from the kits' own exports where they have them."""
    c = catalog or {}
    out = {k: list(v) for k, v in DEFAULT_ENUMS.items()}
    if v := _pick(c, "Look", r"^(looks|names|presets|list\(\))$"):
        out["look"] = v
    if v := _pick(c, "Level", r"kind"):
        out["level_kind"] = v
    if v := _pick(c, "Player", r"type"):
        out["player_type"] = v
    if cams := [f for f in ("follow", "chase", "topdown", "orbit", "firstPerson") if f in fn_names(c, "Camera")]:
        out["camera"] = cams
    return out


def catalog_text(catalog: dict | None, limit: int = 9000) -> str:
    """The catalog as the model reads it: one block per module."""
    lines = []
    for mod, e in sorted((catalog or {}).get("modules", {}).items(), key=lambda kv: (MODULES + (kv[0],)).index(kv[0])
                         if kv[0] in MODULES else 99):
        lines.append(f"K.{mod}: " + ", ".join(e.get("functions", [])) if mod != "_top" else
                     "K (top level): " + ", ".join(e.get("functions", [])))
        for k, v in e.get("arrays", {}).items():
            lines.append(f"    {mod}.{k} = {json.dumps(v)}")
        for k, v in e.get("objects", {}).items():
            lines.append(f"    {mod}.{k} keys: {', '.join(v[:40])}")
    text = "\n".join(lines)
    return text if len(text) <= limit else text[:limit] + "\n..."


# --------------------------------------------------------------------------------------------- docs
def doc_names() -> list[str]:
    return sorted(p.stem for p in DOCS.glob("*.md")) if DOCS.is_dir() else []


def read_doc(name: str, section: str = "", limit: int = 14000) -> str:
    """One kit doc (case-insensitive name, 'CONTRACT' for the contract); with `section`, only the part from the
    first heading or line that mentions it."""
    name = (name or "").strip().removesuffix(".md")
    if name.upper() == "CONTRACT":
        path = KIT / "CONTRACT.md"
    else:
        path = next((p for p in DOCS.glob("*.md") if p.stem.lower() == name.lower()), None) if DOCS.is_dir() else None
    if path is None or not path.exists():
        return (f"ERROR: no doc named {name!r}. Docs: {', '.join(doc_names() + ['CONTRACT']) or 'CONTRACT'}")
    text = path.read_text(encoding="utf-8")
    if section:
        text = doc_section(text, section) or f"(no section mentioning {section!r} in {path.name}; whole doc:)\n{text}"
    return text if len(text) <= limit else text[:limit] + f"\n... [{len(text) - limit} more chars: ask for a section]"


def doc_section(text: str, needle: str, max_lines: int = 60) -> str:
    lines = text.splitlines()
    low = needle.lower()
    hit = next((i for i, l in enumerate(lines) if l.startswith("#") and low in l.lower()), None)
    if hit is None:
        hit = next((i for i, l in enumerate(lines) if low in l.lower()), None)
    if hit is None:
        return ""
    start = hit
    while start > 0 and not lines[start].startswith("#") and hit - start < 6:
        start -= 1
    end = start + 1
    level = len(lines[start]) - len(lines[start].lstrip("#")) if lines[start].startswith("#") else 9
    while end < len(lines) and end - start < max_lines:
        l = lines[end]
        if l.startswith("#") and len(l) - len(l.lstrip("#")) <= level:
            break
        end += 1
    return "\n".join(lines[start:end])


def docs_for_error(error: str, catalog: dict | None) -> str:
    """The doc sections (or catalog lines) for the kit APIs an error message names: the repair agent's reference."""
    out, seen = [], set()
    for mod, fn in re.findall(r"\b(" + "|".join(MODULES) + r")\.(\w+)", error):
        if (mod, fn) in seen:
            continue
        seen.add((mod, fn))
        e = (catalog or {}).get("modules", {}).get(mod) or {}
        real = e.get("functions", [])
        if real and fn not in fn_names(catalog, mod) and fn not in e.get("arrays", {}):
            out.append(f"K.{mod}.{fn} does not exist. K.{mod} has: {', '.join(real)}")
        doc = read_doc(mod, f"{fn}(", 3000)
        if not doc.startswith("ERROR"):
            out.append(f"--- docs/{mod}.md, {fn} ---\n{doc}")
    return "\n".join(out)


# --------------------------------------------------------------------------------------------- the plan
def plan_schema(en: dict[str, list[str]]) -> dict:
    hexc = {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}
    s = {"type": "string", "minLength": 1}
    return {
        "type": "object",
        "required": ["title", "tagline", "genre", "core_loop", "controls", "win_condition", "look", "level_kind",
                     "level_size", "player_type", "camera", "player_colors", "collectible", "goal", "timer_seconds",
                     "lives", "art_direction", "concept_shots", "assets", "features"],
        "properties": {
            "title": {**s, "maxLength": 40}, "tagline": {**s, "maxLength": 90}, "genre": s,
            "core_loop": {**s, "description": "one or two sentences: what the player does again and again"},
            "controls": {"type": "array", "items": s, "minItems": 1, "maxItems": 6,
                         "description": "e.g. 'WASD / arrows: move', 'Space: jump'"},
            "win_condition": s, "lose_condition": {"type": "string"},
            "look": {"enum": en["look"]}, "level_kind": {"enum": en["level_kind"]},
            "level_size": {"enum": ["small", "medium", "large"]},
            "player_type": {"enum": en["player_type"]}, "camera": {"enum": en["camera"]},
            "player_colors": {"type": "object", "required": ["body", "accent"],
                              "properties": {"body": hexc, "accent": hexc}},
            "collectible": {"type": "object", "required": ["tag", "label", "count", "target"], "properties": {
                "tag": {"type": "string", "pattern": "^[a-z][a-z0-9_]{1,20}$",
                        "description": "one word: coin, gem, star, crystal, fish, shard..."},
                "label": {**s, "maxLength": 20}, "count": {"type": "integer", "minimum": 5, "maximum": 80},
                "target": {"type": "integer", "minimum": 1, "maximum": 80}}},
            "goal": {"type": "boolean", "description": "a goal/finish the player must reach"},
            "timer_seconds": {"type": "integer", "minimum": 0, "maximum": 600, "description": "0 = no time limit"},
            "lives": {"type": "integer", "minimum": 0, "maximum": 9, "description": "0 = unlimited"},
            "art_direction": {**s, "description": "2-3 sentences: palette, materials, mood, light, references"},
            "concept_shots": {"type": "array", "items": s, "minItems": 2, "maxItems": 3,
                              "description": "2-3 gameplay moments to paint as the visual target, each one "
                                             "sentence describing what is on screen"},
            "assets": {"type": "object", "required": ["sky", "icons", "music", "sfx", "props"], "properties": {
                "sky": {**s, "description": "the sky panorama: time of day, clouds, colours"},
                "icons": {"type": "array", "maxItems": 4, "items": {"type": "object", "required": ["name", "prompt"],
                          "properties": {"name": {"type": "string", "pattern": "^[a-z][a-z0-9_]{1,24}$"},
                                         "prompt": s, "for": {"type": "string",
                                                              "description": "HUD counter id it decorates"}}}},
                "music": {**s, "description": "music tags: genre, mood, instruments, tempo"},
                "sfx": {"type": "array", "maxItems": 6, "items": {"type": "object", "required": ["event", "prompt"],
                        "properties": {"event": {"enum": ["collect", "jump", "land", "damage", "death", "checkpoint",
                                                          "win", "lose", "boost", "respawn"]},
                                       "prompt": s, "seconds": {"type": "number", "minimum": 0.5, "maximum": 6}}}},
                "props": {"type": "array", "maxItems": 2, "items": {"type": "object", "required": ["name", "prompt"],
                          "properties": {"name": {"type": "string", "pattern": "^[a-z][a-z0-9_]{1,24}$"},
                                         "prompt": {**s, "description": "ONE solid object, its shape and colours"},
                                         "count": {"type": "integer", "minimum": 1, "maximum": 30}}}},
            }},
            "features": {"type": "array", "items": s, "maxItems": 6,
                         "description": "extra touches the builder adds with kit calls (hazards, movers, enemies, "
                                        "FX moments, HUD extras), each achievable with the catalog"},
        },
    }


LEAD_SYSTEM = """You are the lead designer of a small studio that ships polished, stylised 3D browser games built
from ThreeKit, a library of tested three.js kits (looks, levels, players, cameras, gameplay rules, UI, FX, audio).
Every game is assembled by composing kits, so you design within what the kits offer: you pick from the listed
options, never invent new systems. Your designs are tight, readable and fun in two minutes of play: one clear
core loop, an obvious goal, juicy feedback. Finish by calling `submit` with the plan."""


def plan_brief(pitch: str, title: str | None, en: dict, catalog_txt: str, docs: list[str]) -> str:
    return (f"PITCH:\n{pitch}\n\n" + (f"WORKING TITLE: {title}\n\n" if title else "")
            + "Design this as a ThreeKit browser game. Choose:\n"
            f"- look (the art preset): one of {', '.join(en['look'])}\n"
            f"- level_kind (a whole dressed level built in one call): one of {', '.join(en['level_kind'])}\n"
            f"- player_type (the controller): one of {', '.join(en['player_type'])}\n"
            f"- camera: one of {', '.join(en['camera'])} (follow for platformers, chase for karts/boats, topdown "
            "for topdown, firstPerson for fps)\n"
            "- a collectible (count placed along the level, target needed to win), goal, timer, lives\n"
            "- player colours, the art direction, 2-3 concept shots (the visual target the game is judged against)\n"
            "- generated assets: a sky panorama, 2-4 HUD icons, a music loop, 4-6 sound effects (one per gameplay "
            "event), 0-2 props (single solid objects like a mushroom, crate, lantern, statue; they become voxel "
            "models scattered in the level)\n"
            "- features: up to 6 extra touches the builder will add with kit calls from the catalog below\n\n"
            "Match the pitch's fantasy with the closest kit choices; if the pitch asks for something the kits cannot "
            "do, keep its mood and theme and pick the closest playable loop.\n\n"
            f"THE KIT CATALOG (every function and option list that exists):\n{catalog_txt}\n\n"
            + (f"Kit docs available to the builder: {', '.join(docs)}\n\n" if docs else "")
            + "Call `submit` with the plan.")


def normalize_plan(plan: dict, en: dict) -> tuple[dict, list[str]]:
    """Fix what the schema cannot express; returns the notes."""
    p = json.loads(json.dumps(plan))
    notes = []
    c = p.get("collectible") or {}
    if c.get("target", 0) > c.get("count", 0):
        c["target"] = max(1, int(c.get("count", 10) * 0.75))
        notes.append(f"collectible target lowered to {c['target']} (more than were placed)")
    want = CAMERA_FOR.get(p.get("player_type"))
    if want and want in en.get("camera", []) and p.get("camera") != want and p.get("player_type") in ("kart", "boat",
                                                                                                     "fps", "topdown"):
        notes.append(f"camera {p.get('camera')} -> {want} for a {p.get('player_type')} player")
        p["camera"] = want
    return p, notes


# --------------------------------------------------------------------------------------------- the scaffold
def scaffold_js(plan: dict, catalog: dict | None = None, assets: dict | None = None) -> str:
    """A complete, conservative game.js from the plan: the CONTRACT skeleton with the plan's choices filled in. The
    builder starts from this (a working game) and customises it, instead of writing a game from nothing."""
    c = plan.get("collectible") or {}
    tag = c.get("tag", "coin")
    target = int(c.get("target", 10))
    j = json.dumps
    has = (lambda mod, fn: fn in fn_names(catalog, mod)) if catalog else (lambda mod, fn: True)
    assets = assets or {}
    icon = next((n.removeprefix("icon_") for n, e in assets.items() if e.get("kind") == "icon"
                 and (e.get("for") in (tag, "coins", "collect") or tag in n)), tag)
    timer = int(plan.get("timer_seconds") or 0)
    controls = " · ".join(plan.get("controls") or [])[:120]
    lines = [
        "import * as K from 'kit';",
        "",
        f"// {plan.get('title', 'Game')}: {plan.get('tagline', '')}",
        f"const game = await K.createGame({{ assets: './assets/assets.json', seed: 7, title: {j(plan.get('title'))} }});",
        f"K.Look.apply(game, {j(plan.get('look', 'toon_bright'))});",
    ]
    if "sky" in assets and has("Assets", "sky"):
        lines.append("K.Assets.sky(game, 'sky');")
    lines += [
        f"const level = K.Level.build(game, {j(plan.get('level_kind'))}, {{ size: {j(plan.get('level_size', 'medium'))},"
        f" collectibles: {int(c.get('count', 30))} }});",
        f"const player = K.Player.create(game, {{ type: {j(plan.get('player_type'))}, spawn: level.spawn, "
        f"yaw: level.spawnYaw, colors: {j(plan.get('player_colors') or {})} }});",
    ]
    cam = plan.get("camera") or CAMERA_FOR.get(plan.get("player_type"), "follow")
    lines.append(f"K.Camera.{cam}(game, player);" if cam != "orbit" else "K.Camera.orbit(game, { target: player });")
    rules = {"level": None, "player": None, "collect": {"tag": tag, "target": target}, "goal": bool(plan.get("goal")),
             "timer": timer or False, "lives": int(plan.get("lives") or 0) or False}
    rules_js = j(rules).replace('"level": null', "level").replace('"player": null', "player")
    lines.append(f"const rules = K.Gameplay.rules(game, {rules_js});")
    for p in [n for n, e in assets.items() if e.get("kind") == "prop"][:2]:
        if has("Assets", "prop"):
            lines.append(f"K.Assets.scatter(game, {j(p)}, {{ level, count: 8 }});"
                         if catalog and has("Assets", "scatter") else
                         f"for (let i = 2; i < level.route.length - 1; i += Math.max(1, Math.floor(level.route.length "
                         f"/ 6))) K.Assets.prop(game, {j(p)}, {{ position: level.route[i].clone().add(new K.THREE"
                         f".Vector3(6, 0, 3)), scale: 3 }});")
    hud = {"title": plan.get("title"), "counters": [{"id": tag, "icon": icon, "label": c.get("label", "Coins")}],
           "timer": bool(timer)}
    lines.append(f"K.UI.hud(game, {j(hud)});")
    lines.append(f"K.UI.titleScreen(game, {j({'title': plan.get('title'), 'subtitle': plan.get('tagline', ''), 'controls': controls, 'start': 'Press Space'})});")
    if has("FX", "auto"):
        lines.append("K.FX.auto(game);")
    if has("Audio", "auto"):
        lines.append("K.Audio.auto(game);")
    else:
        lines.append("if (game.asset('music_main')) K.Audio.music(game, game.asset('music_main'));")
    lines += ["K.Debug.install(game, { level, player, rules });", "game.start();", ""]
    return "\n".join(lines)


def index_html(title: str) -> str:
    import html
    return INDEX_HTML.format(title=html.escape(title or "Game"))


# --------------------------------------------------------------------------------------------- static check
FORBIDDEN = [
    (r"\bShaderMaterial\b|\bRawShaderMaterial\b|onBeforeCompile|gl_FragColor|gl_Position",
     "do not write shaders: use K.Look materials / presets"),
    (r"RAPIER\.\w+Desc|world\.createRigidBody|world\.createCollider",
     "do not write physics by hand: use K.Physics helpers / Level colliders"),
    (r"createElement\(\s*['\"]style['\"]|\.style\.cssText|\.innerHTML\s*=\s*['\"`]<style",
     "do not write CSS/DOM UI: use K.UI"),
    (r"new\s+K?\.?THREE\.WebGLRenderer|new\s+WebGLRenderer|requestAnimationFrame\(",
     "do not make a renderer or your own loop: use game.update(fn) and game.start()"),
]


def node_check(src: str) -> str | None:
    """Syntax error text from `node --check` (as an ES module), or None."""
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "game.mjs"
        p.write_text(src, encoding="utf-8")
        try:
            r = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            return None                       # no node: the browser playtest still reports syntax errors
        if r.returncode == 0:
            return None
        return re.sub(r"[A-Za-z]:\\[^\s:]*game\.mjs", "game.js", (r.stderr or r.stdout).strip())[:1200]


def check_js(src: str, catalog: dict | None, main: bool = True) -> list[str]:
    """Problems in a game file before it runs: syntax, kit APIs that do not exist, imports, forbidden code."""
    probs = []
    if err := node_check(src):
        probs.append(f"SYNTAX ERROR: {err}")
    mods = (catalog or {}).get("modules", {})
    for mod, fn in sorted(set(re.findall(r"\b(" + "|".join(MODULES) + r")\.([A-Za-z_]\w*)\s*\(", src))):
        e = mods.get(mod)
        if e is None or not e.get("functions"):
            continue                         # module not landed / not introspected: the playtest will tell
        if fn not in fn_names(catalog, mod):
            probs.append(f"K.{mod}.{fn} does not exist (invented API). K.{mod} has: {', '.join(e['functions'])}")
    for m in re.findall(r"""^\s*import\s[^'"]*['"]([^'"]+)['"]""", src, re.M):
        if not (m in ("kit", "three") or m.startswith("three/addons/") or m.startswith("./")):
            probs.append(f"import from {m!r}: only 'kit', 'three', 'three/addons/...' and ./ files of this game load")
    for pat, why in FORBIDDEN:
        if re.search(pat, src):
            probs.append(f"forbidden: {why}")
    if main:
        if "Debug.install" not in src:
            probs.append("game.js must call K.Debug.install(game, { level, player }) (the harness drives the game "
                         "through it)")
        if not re.search(r"\.start\(\s*\)", src):
            probs.append("game.js must end by calling game.start()")
    return probs
