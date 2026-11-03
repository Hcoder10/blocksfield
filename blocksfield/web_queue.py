"""Keep the box busy overnight: launch queued web builds so that at most N run at once.

    python -m blocksfield.web_queue runs/web_queue.json [--max 2] [--every 60]

The queue file is a JSON list of jobs, each {"id": ..., "pitch": ..., "args": [...extra web_run args]} (pitch may be
omitted for an existing run: resume / --redo / --backfill-assets). It is re-read on every poll, so jobs can be added
or reordered while it runs; a job is launched once (its id + args are recorded in <queue>.done.json). Running builds
are counted from the process table (any `blocksfield.web_run ... --id X`, including ones started by hand), so the
queue never starts a duplicate of a game that is already building. Logs: runs/web_<id>/queue_<n>.log.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def running_ids() -> set[str]:
    """--id of every live web_run process (by command line; Windows via CIM, elsewhere via ps)."""
    if os.name == "nt":
        cmd = ["powershell", "-NoProfile", "-Command",
               "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ForEach-Object { $_.CommandLine }"]
    else:
        cmd = ["ps", "-eo", "args"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout
    return {m.group(1) for line in out.splitlines() if "blocksfield.web_run" in line
            for m in [re.search(r"--id\s+\"?([A-Za-z0-9_]+)", line)] if m}


def launch(job: dict, n: int) -> int:
    run_dir = ROOT / "runs" / f"web_{job['id']}"
    run_dir.mkdir(parents=True, exist_ok=True)
    args = [sys.executable, "-u", "-m", "blocksfield.web_run"]
    if job.get("pitch"):
        args.append(job["pitch"])
    args += ["--id", job["id"], *job.get("args", [])]
    env = {**os.environ, "PYTHONUTF8": "1"}
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    log = open(run_dir / f"queue_{n}.log", "w", encoding="utf-8")
    p = subprocess.Popen(args, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
    return p.pid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("queue")
    ap.add_argument("--max", type=int, default=2)
    ap.add_argument("--every", type=float, default=60)
    a = ap.parse_args()
    qf = Path(a.queue)
    done_f = qf.with_suffix(".done.json")
    done = json.loads(done_f.read_text(encoding="utf-8")) if done_f.exists() else []
    while True:
        try:
            jobs = json.loads(qf.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"[{time.strftime('%H:%M')}] queue unreadable: {e}", flush=True)
            time.sleep(a.every)
            continue
        keys = {json.dumps([d["id"], d.get("args", [])]) for d in done}
        todo = [j for j in jobs if json.dumps([j["id"], j.get("args", [])]) not in keys]
        live = running_ids()
        if not todo and not live:
            print(f"[{time.strftime('%H:%M')}] queue empty and nothing running: done", flush=True)
            return 0
        for j in todo:
            if len(live) >= a.max:
                break
            if j["id"] in live:                     # never two builds of one game at once
                continue
            pid = launch(j, len(done))
            done.append({**j, "pid": pid, "at": time.strftime("%Y-%m-%d %H:%M")})
            done_f.write_text(json.dumps(done, indent=1), encoding="utf-8")
            live.add(j["id"])
            print(f"[{time.strftime('%H:%M')}] launched {j['id']} {' '.join(j.get('args', []))} (pid {pid}); "
                  f"running: {', '.join(sorted(live))}", flush=True)
        time.sleep(a.every)


if __name__ == "__main__":
    raise SystemExit(main())
