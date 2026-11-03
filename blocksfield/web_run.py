"""Build a web game from a pitch: a static three.js game (ThreeKit) that plays from a link.

    python -m blocksfield.web_run "A neon skateboard park on floating islands ..." --id neon_skate
    python -m blocksfield.web_run --check            # tunnel + arbiter + LLM + Chrome + kit catalog
    python -m blocksfield.web_run "..." --id demo --dry-run     # fake LLM and fake ComfyUI, real Chrome

Stages (each one's result is kept in runs/web_<id>/stages/; relaunching the same command resumes after the last
finished stage; --redo <stage> runs that stage and everything after it again):
    plan      the lead designs the game as schema-checked JSON whose enums are the kits' own option lists
    art       concept board (the judge's target) + sky, icons, music, sfx, props through the arbiter, in one burst
    scaffold  index.html + a working game.js generated from the plan
    build     a builder agent customises game.js (file tools, kit docs, play_game in real Chrome)
    eval_N    autopilot playtest + vision judge vs the concept board -> a score
    repair_N  a repair agent fixes the findings; the best-scoring version is kept (never ships a regression)
    finalize  best version restored, thumbnail, autopilot gameplay video, about.json for the gallery

Output: web/games/<id>/ (index.html, game.js, assets/, about.json, thumb.jpg, gameplay.mp4, about/).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAMES = ROOT / "web" / "games"
STAGE_ORDER = ["plan", "art", "scaffold", "build"]
LLM_WAIT = int(os.environ.get("BLOCKSFIELD_LLM_WAIT", "1800"))


class CountingLLM:
    """Counts model calls and tokens per role (for about.json) around any LLM."""

    def __init__(self, llm, role: str, counts: dict) -> None:
        self.llm, self.role, self.counts = llm, role, counts
        self.max_tokens = getattr(llm, "max_tokens", None)

    async def chat(self, messages, tools=None):
        t = time.time()
        r = await self.llm.chat(messages, tools)
        c = self.counts.setdefault(self.role, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "seconds": 0.0})
        c["calls"] += 1
        c["seconds"] = round(c["seconds"] + time.time() - t, 1)
        for k in ("prompt_tokens", "completion_tokens"):
            c[k] += int((r.usage or {}).get(k, 0) or 0)
        return r


class Stages:
    def __init__(self, run_dir: Path) -> None:
        self.dir = run_dir / "stages"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.timings: dict[str, float] = {}

    def get(self, name: str):
        p = self.dir / f"{name}.json"
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def put(self, name: str, value, seconds: float | None = None) -> None:
        if seconds is not None:
            self.timings[name] = round(seconds, 1)
            value = {**value, "_seconds": round(seconds, 1)} if isinstance(value, dict) else value
        (self.dir / f"{name}.json").write_text(json.dumps(value, indent=1, default=str), encoding="utf-8")

    def drop_from(self, name: str) -> None:
        """Forget `name` and every stage after it."""
        def key(s: str) -> tuple:
            n = int(re.sub(r"\D", "", s) or 0)
            return (s == "finalize", n, 0 if s.startswith("repair") else 2 if "s0" in s or s.startswith("pair") else 1)
        later = {p.stem for p in self.dir.glob("*.json")} - set(STAGE_ORDER)
        order = STAGE_ORDER + sorted(later | {"eval_v0", "finalize"}, key=lambda s: (key(s), s))
        if name not in order:
            raise SystemExit(f"--redo: unknown stage {name!r}; stages: {', '.join(order)}")
        for s in order[order.index(name):]:
            (self.dir / f"{s}.json").unlink(missing_ok=True)

    def all_timings(self) -> dict:
        out = {}
        for p in sorted(self.dir.glob("*.json")):
            v = self.get(p.stem)
            if isinstance(v, dict) and "_seconds" in v:
                out[p.stem] = v["_seconds"]
        return out


# --------------------------------------------------------------------------------------------- the pipeline
class WebBuild:
    def __init__(self, a, wf, roles: dict, counts: dict) -> None:
        from blocksfield import web_plan
        self.a, self.wf, self.roles, self.counts = a, wf, roles, counts
        self.id = a.id
        self.game_dir = GAMES / a.id
        self.run_dir = Path(wf.run_dir)
        self.page_rel = f"games/{a.id}/index.html"
        self.stages = Stages(self.run_dir)
        self.game_dir.mkdir(parents=True, exist_ok=True)
        self.catalog: dict = {}
        self.plan: dict = {}
        self.wp = web_plan

    def log(self, msg: str) -> None:
        self.wf.log(msg)

    async def llm_up(self, why: str) -> None:
        """Wait for the box's LLM before a model call (re-opening the ssh tunnel if it dropped). Live: the tunnel went
        away for ~10 min and two builds ran their judges and repairs into ConnectErrors, shipping unjudged versions.
        After LLM_WAIT seconds the run stops instead; relaunching it (or the queue) resumes here."""
        if self.a.dry_run:
            return
        import httpx
        from blocksfield import run
        t0, warned = time.time(), False
        while True:
            try:
                await asyncio.to_thread(run.ensure_tunnel)
                async with httpx.AsyncClient(timeout=10) as http:
                    r = await http.get(f"http://127.0.0.1:{run.PORT}/v1/models")
                if r.status_code == 200:
                    if warned:
                        self.log(f"LLM back after {time.time() - t0:.0f}s ({why})")
                    return
            except (Exception, SystemExit) as e:  # noqa: BLE001  -- SystemExit: the tunnel did not open
                err = f"{type(e).__name__}: {str(e)[:120]}"
            else:
                err = f"http {r.status_code}"
            if not warned:
                self.log(f"LLM unreachable before {why} ({err}); waiting up to {LLM_WAIT // 60} min")
                warned = True
            if time.time() - t0 > LLM_WAIT:
                raise SystemExit(f"LLM unreachable for {LLM_WAIT // 60} min before {why}: stopping (relaunch to resume)")
            await asyncio.sleep(20)

    async def run(self) -> dict:
        from blocksfield import web_plan
        t = time.time()
        self.catalog = await asyncio.to_thread(web_plan.read_catalog, self.game_dir)
        (self.run_dir / "catalog.json").write_text(json.dumps(self.catalog, indent=1), encoding="utf-8")
        mods = sorted(m for m, e in self.catalog.get("modules", {}).items() if e.get("functions"))
        self.log(f"kit catalog: {len(mods)} modules with functions ({', '.join(mods)}) in {time.time() - t:.1f}s"
                 + (f"; KIT ERRORS: {self.catalog['errors'][:2]}" if self.catalog.get("errors") else ""))
        await self.stage("plan", self.plan_stage)
        if self.a.backfill_assets:
            from blocksfield import web_assets
            res = await web_assets.Assets(self.game_dir, self.run_dir, self.log).run_all(
                self.plan, self.plan.get("art_direction", ""))
            art = self.stages.get("art") or {"report": {}}
            art.setdefault("report", {}).update({k: v for k, v in res["report"].items() if v.get("seconds", 0) > 0.5})
            art["assets"] = res["manifest"]
            self.stages.put("art", art)                     # the making-of page reads what was (not) made from here
            about = self.game_dir / "about.json"
            if about.exists():
                d = json.loads(about.read_text(encoding="utf-8"))
                d.setdefault("stages", {}).setdefault("art", {})["report"] = art["report"]
                about.write_text(json.dumps(d, indent=1, default=str), encoding="utf-8")
            return {k: v for k, v in res["report"].items() if v.get("seconds", 0) > 0.5}
        await self.stage("art", self.art_stage)
        await self.stage("scaffold", self.scaffold_stage)
        await self.stage("build", self.build_stage)
        best = await self.judge_and_repair()
        return await self.stage("finalize", lambda: self.finalize(best), force=True)

    async def stage(self, name: str, fn, force: bool = False):
        got = self.stages.get(name)
        if got is not None and not force:
            self.log(f"stage {name}: done earlier (kept)")
            if name == "plan":
                self.plan = got["plan"]
            return got
        self.wf.phase(name)
        t = time.time()
        out = await fn()
        self.stages.put(name, out, time.time() - t)
        self.log(f"stage {name}: finished in {time.time() - t:.0f}s")
        return out

    # -- 1. plan ----------------------------------------------------------------------------------
    async def plan_stage(self) -> dict:
        wp = self.wp
        en = wp.enums(self.catalog)
        schema = wp.plan_schema(en)
        brief = wp.plan_brief(self.a.pitch, self.a.title, en, wp.catalog_text(self.catalog), wp.doc_names())
        plan = None
        for attempt in range(2):
            await self.llm_up("plan")
            plan = await self.wf.agent(brief, role="lead", system=wp.LEAD_SYSTEM, schema=schema,
                                       label=f"plan{'' if not attempt else '-retry'}", max_steps=6)
            if isinstance(plan, dict):
                break
        if not isinstance(plan, dict):
            raise RuntimeError("the lead produced no valid plan (see runs/.../agents/)")
        plan, notes = wp.normalize_plan(plan, en)
        if self.a.title:
            plan["title"] = self.a.title
        plan["pitch"] = self.a.pitch
        for n in notes:
            self.log(f"plan: {n}")
        self.plan = plan
        (self.run_dir / "plan.json").write_text(json.dumps(plan, indent=1), encoding="utf-8")
        self.log(f"plan: {plan['title']} | {plan['look']} {plan['level_kind']} {plan['player_type']} | "
                 f"{plan['collectible']['target']}/{plan['collectible']['count']} {plan['collectible']['tag']}")
        return {"plan": plan, "enums": en, "notes": notes}

    # -- 2+3. concept board and assets: one burst of art jobs (one GPU swap) --------------------------
    async def art_stage(self) -> dict:
        from blocksfield import web_assets
        if self.a.no_assets:
            return {"concepts": [], "assets": {}, "report": {"skipped": True}}
        assets = web_assets.Assets(self.game_dir, self.run_dir, self.log)
        concepts, res = await asyncio.gather(
            web_assets.concept_board(self.plan, self.run_dir / "concept", n=3, log_fn=self.log),
            assets.run_all(self.plan, self.plan.get("art_direction", "")))
        ok = [n for n, r in res["report"].items() if r.get("ok")]
        self.log(f"art: {len(concepts)} concept frame(s); assets ok: {', '.join(ok) or 'none'}")
        return {"concepts": [str(p) for p in concepts], "assets": res["manifest"], "report": res["report"]}

    def manifest(self) -> dict:
        try:
            return json.loads((self.game_dir / "assets" / "assets.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    # -- scaffold ---------------------------------------------------------------------------------
    async def scaffold_stage(self) -> dict:
        wp = self.wp
        (self.game_dir / "assets").mkdir(exist_ok=True)
        if not (self.game_dir / "assets" / "assets.json").exists():
            (self.game_dir / "assets" / "assets.json").write_text("{}", encoding="utf-8")
        (self.game_dir / "index.html").write_text(wp.index_html(self.plan.get("title", self.id)), encoding="utf-8")
        sc = wp.scenery_js(self.manifest(), self.catalog)
        (self.game_dir / "scenery.js").unlink(missing_ok=True)
        if sc:
            (self.game_dir / "scenery.js").write_text(sc, encoding="utf-8", newline="\n")
        src = wp.scaffold_js(self.plan, self.catalog, self.manifest())
        (self.game_dir / "game.js").write_text(src, encoding="utf-8", newline="\n")
        from blocksfield import web_build as wb
        shutil.rmtree(self.run_dir / "scaffold_src", ignore_errors=True)
        wb.snapshot(self.game_dir, self.run_dir / "scaffold_src")     # the baseline the builder must beat
        probs = wp.check_js(src, self.catalog)
        for p in probs:
            self.log(f"scaffold problem: {p}")
        return {"lines": src.count("\n") + 1, "problems": probs}

    # -- 4. build ---------------------------------------------------------------------------------
    def tools(self, tag: str):
        from blocksfield.web_build import GameTools
        gt = GameTools(self.game_dir, self.catalog, self.run_dir / "plays" / tag, self.page_rel, self.log,
                       autopilot=8.0)
        return gt, gt.tools()

    async def build_stage(self) -> dict:
        from blocksfield import web_build as wb
        gt, tools = self.tools("build")
        scaffold = (self.game_dir / "game.js").read_text(encoding="utf-8")
        brief = wb.build_brief(self.plan, self.wp.catalog_text(self.catalog), self.manifest(), scaffold)
        await self.llm_up("build")
        res = await self.wf.agent(brief, role="builder", system=wb.BUILDER_SYSTEM, tools=tools,
                                  schema=wb.BUILD_SUBMIT, label="build", max_steps=self.a.build_steps)
        if res is None:
            await self.llm_up("build (after a failed builder)")   # an outage stops the run here: build is redone
            self.log("build: the builder did not submit; continuing with what is on disk")
        if self.wp.reattach_scenery(self.game_dir):
            self.log("build: the builder dropped scenery(game, level): re-attached")
        return {"result": res, "plays": gt.plays}

    # -- 5. judge + repair ----------------------------------------------------------------------------
    def targets(self) -> list[bytes]:
        return [p.read_bytes() for p in sorted((self.run_dir / "concept").glob("concept_*.png"))][:3]

    async def evaluate(self, tag: str, src: Path | None = None) -> dict:
        from blocksfield import web_build as wb, web_play
        cached = self.stages.get(f"eval_{tag}")
        if cached is not None:
            self.log(f"eval {tag}: kept (score {cached['score']})")
            return cached
        t = time.time()
        vdir = self.run_dir / "versions" / tag
        if src is None and (vdir / "src").exists():          # re-evaluating a kept version: play exactly that code
            keep = self.run_dir / "versions" / f"_{tag}_src"
            shutil.rmtree(keep, ignore_errors=True)
            shutil.copytree(vdir / "src", keep)
            src = keep
        if src is not None:
            wb.restore(src, self.game_dir)
        shutil.rmtree(vdir, ignore_errors=True)            # a re-evaluation must not mix in an older run's frames
        wb.snapshot(self.game_dir, vdir / "src")
        rep = await asyncio.to_thread(web_play.play, self.page_rel, vdir / "play", survey=True,
                                      autopilot=self.a.autopilot, frames=2)
        (vdir / "play.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
        ps, notes = web_play.play_score(rep)
        verdict = None
        if rep["ready"] and "judge" in self.roles:
            await self.llm_up(f"judging {tag}")
            try:
                verdict = await wb.judge(self.roles["judge"], wb.capture_images(rep), self.plan, self.targets())
            except Exception as e:  # noqa: BLE001  -- a judge failure must not stop the build
                self.log(f"eval {tag}: judge failed: {type(e).__name__}: {e}")
        vision = verdict.score if verdict is not None and not verdict.raw.get("_failed") else None
        unused = wb.unused_assets(self.game_dir, "".join(x.read_text(encoding="utf-8")
                                                         for x in (vdir / "src").rglob("*.js")))
        score = wb.combined(ps, vision)
        rec = {"tag": tag, "score": score, "play_score": ps, "vision_score": vision, "play_notes": notes,
               "errors": rep["errors"][:10], "autopilot": rep.get("autopilot"), "ready": rep["ready"],
               "findings": wb.findings_text(rep, notes, verdict, self.catalog)
               + "".join(f"\nUNUSED ASSET: {u}" for u in unused),
               "unused_assets": len(unused),
               "verdict": verdict.raw if verdict is not None else None, "shots": rep.get("shots"),
               "sheet": rep.get("sheet")}
        self.stages.put(f"eval_{tag}", rec, time.time() - t)
        self.log(f"eval {tag}: score {score} (play {ps}, vision {vision}); {len(rep['errors'])} error(s)")
        return rec

    async def better(self, new: dict, old: dict) -> dict:
        """The version to keep. Clear gaps (errors, playtest, >= 1 point) decide by score; within the vision judge's
        noise a pairwise A/B judge decides, and a tie keeps the more-built version (`new` unless it is the scaffold)."""
        from blocksfield import web_build as wb
        if len(new["errors"]) != len(old["errors"]):
            return new if len(new["errors"]) < len(old["errors"]) else old
        # Absolute vision scores of two versions are not comparable (live: the same scaffold scored 6 and 7, the
        # builder's version 4 and 5, all judged on the same kit art), so only the playtest decides outright.
        if new.get("unused_assets", 0) != old.get("unused_assets", 0) and abs(new["play_score"] - old["play_score"]) < 1:
            return new if new.get("unused_assets", 0) < old.get("unused_assets", 0) else old   # keeps generated art
        if abs(new["play_score"] - old["play_score"]) >= 1 or "judge" not in self.roles:
            return new if new["score"] > old["score"] else old
        key = f"pair_{new['tag']}_{old['tag']}"
        got = self.stages.get(key)
        if got is None:
            await self.llm_up(f"pairwise {new['tag']} vs {old['tag']}")
            try:
                pick = await wb.pairwise(self.roles["judge"], wb.capture_images(new)[:3], wb.capture_images(old)[:3],
                                         self.plan)
            except Exception as e:  # noqa: BLE001
                self.log(f"pairwise {new['tag']} vs {old['tag']} failed: {e}")
                pick = "tie"
            got = {"prefer": pick, "why": list(getattr(wb.pairwise, "last_why", []))}
            self.stages.put(key, got)
        pick = got["prefer"]
        winner = new if pick == "A" else old if pick == "B" else (old if new["tag"] == "s0" else new)
        self.log(f"pairwise {new['tag']} ({new['score']}) vs {old['tag']} ({old['score']}): {pick} -> keep "
                 f"{winner['tag']}")
        return winner

    async def judge_and_repair(self) -> dict:
        from blocksfield import web_build as wb
        evals = [await self.evaluate("v0")]
        best = evals[0]
        if (self.run_dir / "scaffold_src").exists():         # the builder must beat the plain scaffold
            s0 = await self.evaluate("s0", self.run_dir / "scaffold_src")
            evals.append(s0)
            if await self.better(s0, best) is s0:
                self.log(f"eval: the scaffold (s0 {s0['score']}) beat the builder's version (v0 {best['score']})")
                best = s0
        for rnd in range(1, self.a.repair_rounds + 1):
            if best["score"] >= self.a.good_enough and not best["errors"]:
                self.log(f"repair: best score {best['score']} >= {self.a.good_enough}: done")
                break
            src = self.run_dir / "versions" / best["tag"] / "src"
            wb.restore(src, self.game_dir)                 # repair the best version, never a regression
            name = f"repair_{rnd}"
            if self.stages.get(name) is None:
                self.wf.phase(name)
                t = time.time()
                gt, tools = self.tools(name)
                await self.llm_up(name)
                res = await self.wf.agent(wb.repair_brief(self.plan, self.wp.catalog_text(self.catalog),
                                                          best["findings"], rnd),
                                          role="builder", system=wb.BUILDER_SYSTEM, tools=tools,
                                          schema=wb.BUILD_SUBMIT, label=name, max_steps=self.a.repair_steps)
                if self.wp.reattach_scenery(self.game_dir):
                    self.log(f"{name}: the repair dropped scenery(game, level): re-attached")
                self.stages.put(name, {"result": res, "from": best["tag"], "plays": gt.plays}, time.time() - t)
            ev = await self.evaluate(f"v{rnd}")
            evals.append(ev)
            if await self.better(ev, best) is ev:
                best = ev
            else:
                self.log(f"repair {rnd}: v{rnd} scored {ev['score']} <= best {best['tag']} {best['score']}: kept "
                         f"{best['tag']}")
        wb.restore(self.run_dir / "versions" / best["tag"] / "src", self.game_dir)
        return {"best": best, "evals": [{k: e[k] for k in ("tag", "score", "play_score", "vision_score")}
                                        for e in evals]}

    # -- 6. finalize ------------------------------------------------------------------------------
    async def finalize(self, best: dict) -> dict:
        from PIL import Image
        from blocksfield import web_play
        b = best["best"]
        about_dir = self.game_dir / "about"
        about_dir.mkdir(exist_ok=True)
        shots = b.get("shots") or {}
        thumb_src = next((shots[k] for k in sorted(shots, reverse=True) if k.startswith("autopilot_")),
                         shots.get("player"))
        if thumb_src and Path(thumb_src).exists():
            with Image.open(thumb_src) as im:
                im.convert("RGB").save(self.game_dir / "thumb.jpg", "JPEG", quality=88)
        if b.get("sheet") and Path(b["sheet"]).exists():
            with Image.open(b["sheet"]) as im:
                im.convert("RGB").save(about_dir / "survey.jpg", "JPEG", quality=85)
        concepts = []
        for i, p in enumerate(sorted((self.run_dir / "concept").glob("concept_*.png"))):
            with Image.open(p) as im:
                im.convert("RGB").save(about_dir / f"concept_{i}.jpg", "JPEG", quality=85)
            concepts.append(f"about/concept_{i}.jpg")
        for p in sorted((self.run_dir / "assets" / "props").glob("*_preview.png")):
            shutil.copyfile(p, about_dir / p.name)
        video = None
        if self.a.video_seconds > 0:
            t = time.time()
            webm = self.run_dir / "final" / "gameplay.webm"
            try:
                rep = await asyncio.to_thread(web_play.play, self.page_rel, self.run_dir / "final", survey=False,
                                              autopilot=self.a.video_seconds, frames=0, video=webm)
                if rep.get("video"):
                    video = encode_video(webm, self.game_dir / "gameplay.mp4", start=(rep.get("load_s") or 0) + 1.8)
            except Exception as e:  # noqa: BLE001  -- the game ships without a video rather than not at all
                self.log(f"finalize: video failed: {type(e).__name__}: {str(e)[:300]}")
            self.log(f"finalize: video {'ok' if video else 'FAILED'} in {time.time() - t:.0f}s")
        plan_out = {k: v for k, v in self.plan.items() if k != "pitch"}
        stage_out = {}
        for name in ("art", "scaffold", "build"):
            v = self.stages.get(name) or {}
            stage_out[name] = {k: v[k] for k in ("report", "problems", "result", "plays") if k in v}
        about = {
            "id": self.id, "title": self.plan.get("title"), "tagline": self.plan.get("tagline"),
            "pitch": self.a.pitch, "genre": self.plan.get("genre"), "controls": self.plan.get("controls"),
            "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "dry_run": bool(self.a.dry_run),
            "play": "index.html", "thumbnail": "thumb.jpg" if (self.game_dir / "thumb.jpg").exists() else None,
            "video": "gameplay.mp4" if video else None, "concepts": concepts,
            "survey": "about/survey.jpg" if (about_dir / "survey.jpg").exists() else None,
            "score": {"best": b["tag"], "score": b["score"], "play": b["play_score"], "vision": b["vision_score"],
                      "versions": best["evals"]},
            "plan": plan_out, "timings_s": {**self.stages.all_timings()},
            "operator_interventions": [x["what"] for x in json.loads((self.run_dir / "interventions.json").read_text(
                encoding="utf-8"))] if (self.run_dir / "interventions.json").exists() else [],
            "mapping": {"pitch": self.a.pitch, "notes": self.plan.get("mapping_notes"),
                        "chosen": {k: self.plan.get(k) for k in ("level_kind", "look", "player_type", "camera",
                                                                 "ui_style", "character")
                                   if self.plan.get(k) is not None}
                        | {"collectible": (self.plan.get("collectible") or {}).get("tag"),
                           "collectible_label": (self.plan.get("collectible") or {}).get("label")}},
            "model_calls": self.counts, "agents": self.wf.stats, "stages": stage_out,
            "models": {"llm": "Qwen3.8-27B (vLLM, local)", "image": "Qwen-Image-2.1 + BiRefNet",
                       "music": "ACE-Step", "sfx": "Stable Audio", "props": "Idol image->splat -> voxels"},
        }
        (self.game_dir / "about.json").write_text(json.dumps(about, indent=1, default=str), encoding="utf-8")
        self.log(f"finalize: web/games/{self.id}/ (best {b['tag']}, score {b['score']})")
        return {"game_dir": str(self.game_dir), "best": b["tag"], "score": b["score"], "video": bool(video)}


def encode_video(webm: Path, mp4: Path, start: float = 0.0) -> Path | None:
    ff = shutil.which("ffmpeg")
    if not ff:
        shutil.copyfile(webm, mp4.with_suffix(".webm"))
        return mp4.with_suffix(".webm")
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-ss", f"{max(0.0, start):.2f}", "-i", str(webm),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "veryfast",
                        "-movflags", "+faststart", "-an", str(mp4)], capture_output=True, text=True)
    return mp4 if r.returncode == 0 and mp4.exists() else None


# --------------------------------------------------------------------------------------------- env / check
def live_env() -> None:
    from blocksfield import asset_tools, run
    run.ensure_tunnel()
    os.environ.update(run.harness_env())
    asset_tools.ARBITER = f"http://127.0.0.1:{run.PORT}"
    os.environ.setdefault("HARNESS_CONTEXT_BUDGET", "48000")


def harness_path() -> None:
    from blocksfield import run
    for p in (str(run.HARNESS), str(ROOT)):
        if p not in sys.path:
            sys.path.insert(0, p)


def check() -> int:
    import httpx
    from blocksfield import run, web_plan
    ok = True

    def line(name: str, good: bool, info: str) -> None:
        nonlocal ok
        ok = ok and good
        print(f"[{'ok' if good else 'FAIL'}] {name}: {info}")
    try:
        live_env()
        st = httpx.get(f"http://127.0.0.1:{run.PORT}/status", timeout=10).json()
        line("arbiter", True, json.dumps(st)[:300])
        models = [m["id"] for m in httpx.get(f"http://127.0.0.1:{run.PORT}/v1/models", timeout=10).json()["data"]]
        line("llm models", "cybus" in models, str(models))
        r = httpx.post(f"http://127.0.0.1:{run.PORT}/v1/chat/completions", timeout=300, json={
            "model": "cybus", "max_tokens": 16, "messages": [{"role": "user", "content": "Say OK."}],
            "chat_template_kwargs": {"enable_thinking": False}}).json()
        line("llm chat", bool(r.get("choices")), str((r.get("choices") or [{}])[0].get("message", {}).get("content"))[:80])
    except BaseException as e:  # noqa: BLE001  -- SystemExit from the tunnel too
        line("box", False, f"{type(e).__name__}: {e}")
    try:
        t = time.time()
        cat = web_plan.read_catalog(GAMES / "_check")
        shutil.rmtree(GAMES / "_check", ignore_errors=True)
        mods = [m for m, e in cat.get("modules", {}).items() if e.get("functions")]
        line("chrome + kit catalog", not cat.get("errors"), f"{len(mods)} modules with functions in "
             f"{time.time() - t:.1f}s; enums {json.dumps(web_plan.enums(cat))[:300]}; errors {cat.get('errors')[:2]}")
    except Exception as e:  # noqa: BLE001
        line("chrome + kit catalog", False, f"{type(e).__name__}: {e}")
    line("node (syntax check)", bool(shutil.which("node")), shutil.which("node") or "missing: syntax errors only "
                                                                                    "show in the playtest")
    line("ffmpeg (video)", bool(shutil.which("ffmpeg")), shutil.which("ffmpeg") or "missing: video stays .webm")
    line("kit docs", bool(web_plan.doc_names()), ", ".join(web_plan.doc_names()) or "none yet")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pitch", nargs="?")
    ap.add_argument("--id", help="snake_case game id (default: from the pitch)")
    ap.add_argument("--title")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="fake LLM + fake ComfyUI (no box); Chrome is real")
    ap.add_argument("--redo", help="run this stage and everything after it again (plan, art, scaffold, build, "
                                   "eval_v0, repair_1, ...)")
    ap.add_argument("--repair-rounds", type=int, default=2)
    ap.add_argument("--build-steps", type=int, default=30)
    ap.add_argument("--repair-steps", type=int, default=20)
    ap.add_argument("--autopilot", type=float, default=12.0, help="seconds of autopilot per playtest")
    ap.add_argument("--video-seconds", type=float, default=16.0, help="0 = no gameplay video")
    ap.add_argument("--good-enough", type=float, default=8.5, help="stop repairing at this score")
    ap.add_argument("--no-assets", action="store_true", help="skip the art stage (kits' procedural fallbacks)")
    ap.add_argument("--intervention", action="append", default=[],
                    help="record a hand edit a person made to this game (about.json operator_interventions); "
                         "repeatable; on its own it only records (no build), with --redo / --backfill-assets "
                         "it records and runs")
    ap.add_argument("--backfill-assets", action="store_true",
                    help="only (re)try the plan's assets that are missing from the manifest, then stop (the game "
                         "picks them up on its next load; nothing is rebuilt)")
    a = ap.parse_args()
    harness_path()
    if a.check:
        return check()
    if not a.pitch and a.id:                                # resume / backfill / finalize by id alone
        idea_file = ROOT / "runs" / f"web_{a.id}" / "idea.json"
        if idea_file.exists():
            idea = json.loads(idea_file.read_text(encoding="utf-8"))
            a.pitch, a.title = idea["pitch"], a.title or idea.get("title")
    if not a.pitch:
        ap.error("give a pitch (or the --id of an existing run)")
    a.id = re.sub(r"[^a-z0-9_]+", "_", (a.id or "_".join(re.findall(r"[a-z0-9]+", a.pitch.lower())[:3])).lower())
    a.id = a.id.strip("_") or "game"
    run_dir = ROOT / "runs" / f"web_{a.id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "idea.json").write_text(json.dumps({"id": a.id, "title": a.title, "pitch": a.pitch}, indent=1),
                                       encoding="utf-8")
    if a.redo:
        Stages(run_dir).drop_from(a.redo)
    if a.intervention:
        f = run_dir / "interventions.json"
        log = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
        log += [{"at": time.strftime("%Y-%m-%d %H:%M"), "what": t} for t in a.intervention]
        f.write_text(json.dumps(log, indent=1), encoding="utf-8")
        about = GAMES / a.id / "about.json"
        if about.exists():                                  # keep the shipped about.json honest right away
            d = json.loads(about.read_text(encoding="utf-8"))
            d["operator_interventions"] = [x["what"] for x in log]
            about.write_text(json.dumps(d, indent=1, default=str), encoding="utf-8")
        if not (a.redo or a.backfill_assets):
            print(f"recorded {len(a.intervention)} intervention(s) for {a.id}; nothing else to do")
            return 0
    from harness.workflow import Workflow
    counts: dict = {}
    if a.dry_run:
        from blocksfield import web_fake
        web_fake.install_fake_art()
        base = {r: web_fake.FakeLLM(r) for r in ("lead", "builder", "judge")}
    else:
        live_env()
        from harness.llm import llm_from_env
        base = {r: llm_from_env(r) for r in ("lead", "builder", "judge")}
    roles = {r: CountingLLM(l, r, counts) for r, l in base.items()}
    wf = Workflow(f"web_game:{a.id}", run_dir, roles, concurrency=int(os.environ.get("HARNESS_CONCURRENCY", "3")))
    wf.log(f"web build {a.id} -> web/games/{a.id}/ ({'DRY RUN' if a.dry_run else 'live'})")
    t = time.time()
    out = asyncio.run(WebBuild(a, wf, roles, counts).run())
    wf.log(f"done in {time.time() - t:.0f}s: {json.dumps(out)}; {wf.summary()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
