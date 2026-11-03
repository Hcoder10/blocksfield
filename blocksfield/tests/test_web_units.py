"""Fast tests of the web pipeline pieces (no Chrome, no GPU):

    PYTHONPATH=C:/Users/sarta/cybus-harness;C:/Users/sarta/blocksfield python -m pytest blocksfield/tests -q
"""
from __future__ import annotations

import asyncio
import json
import shutil

import jsonschema
import pytest
from PIL import Image

from blocksfield import web_assets, web_build, web_fake, web_plan

CATALOG = {"modules": {
    "Look": {"functions": ["apply(game, name = 'toon_bright', overrides = {})"], "arrays": {"looks": ["toon_bright",
                                                                                                       "candy"]}},
    "Level": {"functions": ["build(game, kind, opts = {})"], "arrays": {"KINDS": ["sky_islands", "arena"]}},
    "Player": {"functions": ["create(game, opts = {})"], "arrays": {"TYPES": ["platformer", "kart"]}},
    "Camera": {"functions": ["follow(game, player, opts = {})", "chase(game, player, opts = {})"]},
    "Gameplay": {"functions": ["rules(game, opts = {})"]},
    "UI": {"functions": ["hud(game, opts = {})", "titleScreen(game, opts = {})"]},
    "FX": {"functions": ["auto(game, opts = {})"]}, "Audio": {"functions": ["auto(game, opts = {})"]},
    "Assets": {"functions": ["sky(game, name)", "prop(game, name, opts = {})"]},
    "Debug": {"functions": ["install(game, opts = {})"]}}}


def test_enums_come_from_the_kits():
    en = web_plan.enums(CATALOG)
    assert en["look"] == ["toon_bright", "candy"]
    assert en["level_kind"] == ["sky_islands", "arena"]
    assert en["player_type"] == ["platformer", "kart"]
    assert en["camera"] == ["follow", "chase"]
    assert web_plan.enums(None)["look"] == web_plan.DEFAULT_ENUMS["look"]


def test_fake_plan_matches_schema_and_normalizes():
    en = web_plan.enums(CATALOG)
    schema = web_plan.plan_schema(en)
    plan = web_fake.plan_for(schema)
    jsonschema.validate(plan, schema)
    bad = {**plan, "collectible": {**plan["collectible"], "target": 99}, "player_type": "kart", "camera": "follow"}
    fixed, notes = web_plan.normalize_plan(bad, en)
    assert fixed["collectible"]["target"] <= fixed["collectible"]["count"]
    assert fixed["camera"] == "chase" and len(notes) == 2


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_scaffold_is_valid_js_using_only_real_apis():
    assets = {"sky": {"kind": "sky", "file": "sky.jpg"}, "icon_bloom": {"kind": "icon", "file": "i.png", "for": "coin"},
              "prop_mushroom": {"kind": "prop", "file": "p.json"}}
    src = web_plan.scaffold_js(web_fake.FAKE_PLAN, CATALOG, assets)
    assert web_plan.check_js(src, CATALOG) == []
    assert "K.Assets.sky(game, 'sky')" in src and '"icon": "bloom"' in src


def test_check_js_catches_invented_apis_syntax_and_forbidden_code():
    src = ("import * as K from 'kit';\nimport x from 'lodash';\nconst game = await K.createGame({});\n"
           "K.Level.create(game, 'x');\nconst m = new K.THREE.ShaderMaterial({});\n")
    probs = "\n".join(web_plan.check_js(src, CATALOG))
    assert "K.Level.create does not exist" in probs and "build(game, kind" in probs
    assert "lodash" in probs and "shaders" in probs and "Debug.install" in probs and "game.start()" in probs
    if shutil.which("node"):
        assert "SYNTAX ERROR" in "\n".join(web_plan.check_js("const a = ;\nK.Debug.install(); game.start();",
                                                            CATALOG))


def test_doc_section_and_error_reference():
    text = "# Level\nintro\n## build(game, kind, opts)\nbuilds a level\nkinds: a, b\n## other\nzzz\n"
    sec = web_plan.doc_section(text, "build(")
    assert sec.startswith("## build(") and "kinds: a, b" in sec and "zzz" not in sec
    ref = web_plan.docs_for_error("TypeError: K.Level.create is not a function", CATALOG)
    assert "K.Level.create does not exist" in ref


def test_equirect_wraps_and_has_mid_horizon():
    pano = web_fake.fake_image(1376, 768)
    eq = web_assets.equirect(pano)
    assert eq.size == (web_assets.EQ_W, web_assets.EQ_H)
    assert web_assets.wrap_report(eq) < 2.0
    top = Image.Image.getpixel(eq, (100, 2))
    assert top == Image.Image.getpixel(eq, (1500, 2))            # the zenith row is one colour


def test_assets_stage_with_fake_art(tmp_path):
    web_fake.install_fake_art()
    game, run = tmp_path / "game", tmp_path / "run"
    a = web_assets.Assets(game, run, log_fn=lambda m: None)
    res = asyncio.run(a.run_all(web_fake.FAKE_PLAN, "pastel"))
    m = res["manifest"]
    assert {"sky", "icon_bloom", "music_main", "sfx_collect", "sfx_jump", "prop_mushroom"} <= set(m)
    assert m["sfx_collect"]["event"] == "collect" and m["sky"]["projection"] == "equirect"
    prop = json.loads((game / "assets" / m["prop_mushroom"]["file"]).read_text())
    assert prop["parts"] and prop["palette"][0].startswith("#") and max(prop["size"]) == pytest.approx(1, abs=0.15)
    assert all(0 <= p["c"] < len(prop["palette"]) for p in prop["parts"])
    on_disk = json.loads((game / "assets" / "assets.json").read_text())
    assert on_disk == m
    # resume: nothing is regenerated when the files are there
    a2 = web_assets.Assets(game, run, log_fn=lambda m: None)
    asyncio.run(a2.run_all(web_fake.FAKE_PLAN, "pastel"))
    assert all(r["seconds"] < 0.5 for r in a2.report.values())


def test_game_tools_write_rules(tmp_path):
    gt = web_build.GameTools(tmp_path, CATALOG, tmp_path / "plays", "games/x/index.html")
    run = asyncio.run
    assert run(gt.write_file("index.html", "x")).startswith("ERROR")
    assert run(gt.write_file("assets/assets.json", "{}")).startswith("ERROR")
    assert "without its content" in run(gt.write_file("game.js"))
    out = run(gt.write_file("game.js", "import * as K from 'kit';\nK.Level.make(1);\n"))
    assert "K.Level.make does not exist" in out
    run(gt.append_file("game.js", "K.Debug.install(game, {});\ngame.start();"))
    assert run(gt.edit_file("game.js", "K.Level.make(1);", "K.Level.build(game, 'arena');")).startswith("edited")
    assert "appears 0 times" in run(gt.edit_file("game.js", "nope", "x"))
    assert "game.js" in run(gt.read_file("games/x/game.js"))
    assert run(gt.read_file("../../secret.txt")).startswith("ERROR")


def test_play_score_rewards_movement_and_collection():
    base = {"ready": True, "errors": [], "autopilot": {"available": True, "moved": 30, "collected_start": 0,
                                                         "collected_end": 10, "target": 10, "won": True}}
    assert web_play_score(base) == 10
    assert web_play_score({**base, "ready": False}) <= 1
    stuck = {**base, "autopilot": {"available": True, "moved": 0, "collected_start": 0, "collected_end": 0,
                                   "target": 10}}
    assert web_play_score(stuck) == 4
    assert web_build.combined(2.0, 9.0) == 2.0               # broken games never win on looks


def web_play_score(rep):
    from blocksfield.web_play import play_score
    return play_score(rep)[0]
