"""Build a Roblox game from a pitch: the laptop-side entry point.

Studio runs here (the harness drives it), every model runs on the GPU box behind the arbiter, reached over an SSH
tunnel. Usage:
    python -m blocksfield.run "A neon skateboard park on floating islands ..." --id neon_skate
    python -m blocksfield.run --check          # tunnel + arbiter + bridge, no build
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path(os.environ.get("BLOCKSFIELD_HARNESS", Path.home() / "cybus-harness"))
BOX = os.environ.get("BLOCKSFIELD_BOX", "-p 16278 root@ssh9.vast.ai")
PORT = 8100
NO_THINK = json.dumps({"chat_template_kwargs": {"enable_thinking": False}})


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) == 0


def ensure_tunnel() -> None:
    if port_open(PORT):
        return
    args = ["ssh", "-N", "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=30", "-o",
            "ExitOnForwardFailure=yes", "-L", f"{PORT}:127.0.0.1:{PORT}", *BOX.split()]
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    subprocess.Popen(args, creationflags=flags, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(30):
        if port_open(PORT):
            return
        time.sleep(1)
    raise SystemExit(f"tunnel to the box did not open on :{PORT} ({' '.join(args)})")


def harness_env() -> dict:
    base = f"http://127.0.0.1:{PORT}"
    env = dict(os.environ)
    env.update({
        "HARNESS_DEFAULT_BASE_URL": f"{base}/v1", "HARNESS_DEFAULT_MODEL": "cybus",
        "HARNESS_DEFAULT_API_KEY": env.get("CYBUS_API_KEY", "local"),
        "HARNESS_IMAGEGEN_PROVIDER": "http", "HARNESS_IMAGEGEN_URL": base,
        "HARNESS_IMAGEGEN_CONCURRENCY": "4",
        "HARNESS_CONCURRENCY": env.get("HARNESS_CONCURRENCY", "3"),
        "PYTHONPATH": str(HARNESS) + os.pathsep + env.get("PYTHONPATH", ""),
        "PYTHONUTF8": "1",
    })
    for role in ("BUILDER", "JUDGE", "CRITIC", "REVISER"):     # thinking stays on for lead / art / architect
        env.setdefault(f"HARNESS_{role}_EXTRA", NO_THINK)
    # 3D props need Open Cloud: the key from the environment or ~/.blocksfield/roblox_key.txt (never in the repo)
    key_file = Path.home() / ".blocksfield" / "roblox_key.txt"
    if not env.get("ROBLOX_API_KEY") and key_file.exists():
        env["ROBLOX_API_KEY"] = key_file.read_text(encoding="utf-8").strip()
    creator_file = Path.home() / ".blocksfield" / "roblox_creator_id.txt"
    if not env.get("ROBLOX_CREATOR_ID") and creator_file.exists():
        env["ROBLOX_CREATOR_ID"] = creator_file.read_text(encoding="utf-8").strip()
    if env.get("ROBLOX_API_KEY") and env.get("ROBLOX_CREATOR_ID"):
        env.setdefault("HARNESS_EXTRA_TOOLS", "blocksfield.harness_ext:tools")
        env["PYTHONPATH"] = str(ROOT) + os.pathsep + env["PYTHONPATH"]
    analyzer = shutil.which("luau-analyze") or str(Path.home() / "bin" / "luau-analyze.exe")
    if Path(analyzer).exists():
        env.setdefault("HARNESS_LUAU_ANALYZE", analyzer)
    return env


def check() -> int:
    ensure_tunnel()
    st = httpx.get(f"http://127.0.0.1:{PORT}/status", timeout=10).json()
    print("arbiter:", json.dumps(st))
    models = httpx.get(f"http://127.0.0.1:{PORT}/v1/models", timeout=10).json()
    print("llm:", [m["id"] for m in models.get("data", [])])
    r = subprocess.run([sys.executable, "-m", "harness.doctor"], cwd=HARNESS, env=harness_env())
    return r.returncode


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pitch", nargs="?")
    ap.add_argument("--id", help="snake_case game id (default: from the pitch)")
    ap.add_argument("--title")
    ap.add_argument("--run", help="run directory name under runs/ (default: the id); a seeded run keeps the id so "
                                  "its journal replays")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--repair-rounds", type=int, default=2)
    ap.add_argument("--polish-rounds", type=int, default=1)
    a = ap.parse_args()
    if a.check:
        return check()
    if not a.pitch:
        ap.error("give a pitch")
    gid = a.id or "_".join(re.findall(r"[a-z0-9]+", a.pitch.lower())[:3])
    run_dir = ROOT / "runs" / (a.run or gid)
    run_dir.mkdir(parents=True, exist_ok=True)
    idea = {"id": gid, "title": a.title or gid.replace("_", " ").title(), "pitch": a.pitch}
    (run_dir / "idea.json").write_text(json.dumps(idea, indent=1), encoding="utf-8")
    ensure_tunnel()
    cmd = [sys.executable, "-m", "harness.workflows.build_game", "--idea", str(run_dir / "idea.json"),
           "--run-dir", str(run_dir), "--repair-rounds", str(a.repair_rounds),
           "--polish-rounds", str(a.polish_rounds)]
    print("building", gid, "->", run_dir)
    return subprocess.run(cmd, cwd=HARNESS, env=harness_env()).returncode


if __name__ == "__main__":
    raise SystemExit(main())
