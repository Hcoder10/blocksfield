"""See a kit with your own eyes: build a fresh place holding every kit module plus one demo, open it in Studio, play
it, and screenshot it over time. Used to judge kits against the quality bar before any game is built on them.

    python -m blocksfield.kit_demo UIKit --seconds 60 --every 6
    python -m blocksfield.kit_demo LookKit WorldKit2 --seconds 90

Needs: no other Studio window open, the Studio bridge server on :3000, rojo. Screenshots land in runs/_kitdemo/<names>/.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path.home() / "cybus-harness"
sys.path.insert(0, str(HARNESS))

from harness.stage import maximize_studio, studio_exe  # noqa: E402
from harness.tools.studio import StudioBridge, count_studio_processes  # noqa: E402

KIT = HARNESS / "harness" / "kit"


def find_tokens() -> Path | None:
    for run in sorted((ROOT / "runs").glob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
        t = run / "workspace" / "src" / "ReplicatedStorage" / "Shared" / "Tokens.luau"
        if t.exists():
            return t
    return None


def build_place(names: list[str], out: Path, cam: str | None = None) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="kitdemo_"))
    kit_dir = tmp / "Kit"
    kit_dir.mkdir()
    for f in KIT.glob("*.luau"):
        shutil.copy(f, kit_dir / f.name)
    shared = tmp / "Shared"
    shared.mkdir()
    tok = find_tokens()
    if tok:
        shutil.copy(tok, shared / "Tokens.luau")
    sss, sps = tmp / "SSS", tmp / "SPS"
    sss.mkdir()
    sps.mkdir()
    shutil.copy(KIT / "demos" / "DemoCam.client.luau", sps / "DemoCam.client.luau")
    for n in names:
        for d in (KIT / "demos").glob(f"{n}_demo.*.luau"):
            target = sss if ".server." in d.name else sps
            shutil.copy(d, target / d.name)
    project = {"name": "kitdemo", "tree": {
        "$className": "DataModel",
        "HttpService": {"$className": "HttpService", "$properties": {"HttpEnabled": True}},
        "ReplicatedStorage": {"$className": "ReplicatedStorage", "Kit": {"$path": "Kit"}, "Shared": {"$path": "Shared"}},
        "ServerScriptService": {"$className": "ServerScriptService", "Demos": {"$path": "SSS"}},
        "StarterPlayer": {"$className": "StarterPlayer",
                          "StarterPlayerScripts": {"$className": "StarterPlayerScripts", "Demos": {"$path": "SPS"}}},
        "Workspace": {"$className": "Workspace", **({"$attributes": {"DemoCam": cam}} if cam else {}),
                      "SpawnLocation": {"$className": "SpawnLocation",
                                        "$properties": {"Anchored": True, "Size": [12, 1, 12], "Position": [0, 0.5, 0]}}},
    }}
    (tmp / "default.project.json").write_text(json.dumps(project), encoding="utf-8")
    rojo = shutil.which("rojo") or str(Path.home() / "bin" / "rojo.exe")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([rojo, "build", "-o", str(out)], cwd=tmp, check=True, capture_output=True, timeout=120)
    return out


async def run(names: list[str], seconds: float, every: float, cam: str | None = None) -> Path:
    if count_studio_processes():
        raise SystemExit("close every Studio window first (the bridge token is shared)")
    tag = "_".join(names)
    out_dir = ROOT / "runs" / "_kitdemo" / tag
    out_dir.mkdir(parents=True, exist_ok=True)
    place = build_place(names, out_dir / f"{tag}.rbxlx", cam)
    for stale in out_dir.glob("*.lock"):
        stale.unlink(missing_ok=True)
    proc = subprocess.Popen([str(studio_exe()), str(place)])
    b = StudioBridge(allow_place_ids={"0"})
    await b.connect()
    t0 = time.time()
    while time.time() - t0 < 180:
        h = await b.health()
        if (h.get("session_list") or []) and (h.get("sessions") or 0) >= 1:
            break
        await asyncio.sleep(3)
    await asyncio.sleep(8)
    maximize_studio()
    for attempt in range(20):                  # the session registers as "unknown" for a few seconds after launch
        try:
            await b.call("execution_run_luau", {"code": 'task.spawn(function() game:GetService("StudioTestService")'
                                                         ':ExecutePlayModeAsync({}) end) return "play"'})
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 19:
                raise
            await asyncio.sleep(3)
    await asyncio.sleep(10)
    shots = []
    t1 = time.time()
    while time.time() - t1 < seconds:
        maximize_studio()
        try:
            r = await b.call("screenshot_take", {"format": "png"})
            img = (r.get("images") or [None])[0]
            if img:
                p = out_dir / f"shot_{len(shots):03d}.png"
                p.write_bytes(img)
                shots.append(p)
        except Exception as e:  # noqa: BLE001
            print("screenshot failed:", e)
        await asyncio.sleep(every)
    try:
        out = await b.call("playtest_get_output_log", {})
        (out_dir / "output.json").write_text(json.dumps(out)[:200000], encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    await b.close()
    proc.terminate()
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
    print(f"{len(shots)} shots in {out_dir}")
    return out_dir


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="+")
    ap.add_argument("--seconds", type=float, default=60)
    ap.add_argument("--every", type=float, default=6)
    ap.add_argument("--cam", help='fixed camera "x,y,z,tx,ty,tz"')
    a = ap.parse_args()
    asyncio.run(run(a.names, a.seconds, a.every, a.cam))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
