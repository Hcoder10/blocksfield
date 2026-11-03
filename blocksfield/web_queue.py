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
    """Start one build detached. On Windows through PowerShell Start-Process, exactly like deploy/launch_web.ps1: live,
    builds started with subprocess.Popen(DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB) from this runner died about a
    minute in with nothing logged, while Start-Process builds ran to the end."""
    run_dir = ROOT / "runs" / f"web_{job['id']}"
    run_dir.mkdir(parents=True, exist_ok=True)
    args = ["-u", "-m", "blocksfield.web_run"] + ([job["pitch"]] if job.get("pitch") else [])         + ["--id", job["id"], *job.get("args", [])]
    out, err = run_dir / f"queue_{n}.log", run_dir / f"queue_{n}.err.log"
    if os.name == "nt":
        def q(x: str) -> str:
            return "'" + x.replace("'", "''") + "'"
        arglist = ", ".join(q('"' + x.replace('"', '\\"') + '"' if " " in x else x) for x in args)
        ps = (f"$env:PYTHONUTF8 = '1'; $p = Start-Process -FilePath {q(sys.executable)} -WorkingDirectory {q(str(ROOT))} "
              f"-WindowStyle Hidden -PassThru -RedirectStandardOutput {q(str(out))} -RedirectStandardError {q(str(err))} "
              f"-ArgumentList @({arglist}); $p.Id")
        # no pipes: the build would inherit them and run() would wait for the whole build; the pid comes back in a file
        pid_file = run_dir / f"queue_{n}.pid"
        subprocess.run(["powershell", "-NoProfile", "-Command", f"{ps} | Out-File -Encoding ascii {q(str(pid_file))}"],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        try:
            return int(pid_file.read_text(encoding="ascii").strip() or 0)
        except (OSError, ValueError):
            return 0
    log = open(out, "w", encoding="utf-8")
    return subprocess.Popen([sys.executable, *args], cwd=ROOT, env={**os.environ, "PYTHONUTF8": "1"}, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True).pid


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
        live = running_ids()
        # a launched job that is gone without its "done in" line died (live: one vanished during its first Chrome
        # step with nothing logged): launch it again, twice at most
        for d in done:
            if d.get("finished") or d.get("gave_up") or d["id"] in live:
                continue
            log = ROOT / "runs" / f"web_{d['id']}" / "log.txt"
            text = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
            if re.search(r"\] done in \d+s|^\S+ \S+ done in \d+s", text[text.rfind("web build"):], re.M):
                d["finished"] = True
            elif d.get("attempts", 1) >= 3:
                d["gave_up"] = True
                print(f"[{time.strftime('%H:%M')}] {d['id']} died 3 times: giving up", flush=True)
            else:
                d["retry"] = True
        done_f.write_text(json.dumps(done, indent=1), encoding="utf-8")
        keys = {json.dumps([d["id"], d.get("args", [])]) for d in done if not d.get("retry")}
        todo = [j for j in jobs if json.dumps([j["id"], j.get("args", [])]) not in keys]
        if not todo and not live:
            print(f"[{time.strftime('%H:%M')}] queue empty and nothing running: done", flush=True)
            return 0
        for j in todo:
            if len(live) >= a.max:
                break
            if j["id"] in live:                     # never two builds of one game at once
                continue
            pid = launch(j, len(done))
            prev = [d for d in done if d.get("retry") and d["id"] == j["id"] and d.get("args", []) == j.get("args", [])]
            for d in prev:
                done.remove(d)
            done.append({**j, "pid": pid, "at": time.strftime("%Y-%m-%d %H:%M"),
                         "attempts": max([d.get("attempts", 1) for d in prev] or [0]) + 1})
            done_f.write_text(json.dumps(done, indent=1), encoding="utf-8")
            live.add(j["id"])
            print(f"[{time.strftime('%H:%M')}] launched {j['id']} {' '.join(j.get('args', []))} (pid {pid}); "
                  f"running: {', '.join(sorted(live))}", flush=True)
        time.sleep(a.every)


if __name__ == "__main__":
    raise SystemExit(main())
