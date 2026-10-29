"""ComfyUI as a job runner: parameterised API-format workflows in, output files out.

A workflow lives in workflows/api/<name>.json (ComfyUI "Export (API)" format). Any string value written as
"{{param}}" is replaced by that parameter, keeping the parameter's own type when the whole value is the
placeholder (so "{{seed}}" becomes an int). Defaults live next to it in <name>.meta.json:

    {"params": {"prompt": "", "seed": 0, "width": 1024}, "outputs": ["9"], "description": "..."}

CLI, for testing a workflow on the box:
    python -m blocksfield.comfy run image prompt="a red cube" seed=3 --out /root/blocksfield/out/test
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
import random
import re
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

WORKFLOWS = Path(__file__).resolve().parent.parent / "workflows" / "api"
COMFY_URL = os.environ.get("BLOCKSFIELD_COMFY_URL", "http://127.0.0.1:8189")
PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


class ComfyError(RuntimeError):
    pass


def load(name: str) -> tuple[dict, dict]:
    graph = json.loads((WORKFLOWS / f"{name}.json").read_text(encoding="utf-8"))
    meta_path = WORKFLOWS / f"{name}.meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    return graph, meta


def fill(graph: dict, params: dict) -> dict:
    def sub(v: Any) -> Any:
        if isinstance(v, str):
            m = PLACEHOLDER.fullmatch(v)
            if m:
                if m.group(1) not in params:
                    raise ComfyError(f"workflow needs parameter '{m.group(1)}'")
                return params[m.group(1)]
            return PLACEHOLDER.sub(lambda mm: str(params[mm.group(1)]), v)
        if isinstance(v, list):
            return [sub(x) for x in v]
        if isinstance(v, dict):
            return {k: sub(x) for k, x in v.items()}
        return v
    return sub(copy.deepcopy(graph))


class Comfy:
    def __init__(self, url: str = COMFY_URL, timeout: float = 1800) -> None:
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.client_id = uuid.uuid4().hex

    async def run(self, name: str, **params: Any) -> list[dict]:
        """Run workflow `name`; -> [{"node", "filename", "kind", "data": bytes}] for every output file."""
        graph, meta = load(name)
        p = {**meta.get("params", {}), **params}
        if p.get("seed") in (None, -1, "random"):
            p["seed"] = random.randint(0, 2**31 - 1)
        return await self.run_graph(fill(graph, p), meta.get("outputs"))

    async def run_graph(self, graph: dict, outputs: list[str] | None = None) -> list[dict]:
        async with httpx.AsyncClient(timeout=60) as http:
            r = await http.post(f"{self.url}/prompt", json={"prompt": graph, "client_id": self.client_id})
            if r.status_code >= 400:
                raise ComfyError(f"ComfyUI rejected the workflow ({r.status_code}): {r.text[:1500]}")
            pid = r.json()["prompt_id"]
            t0 = time.time()
            while True:
                await asyncio.sleep(0.5)
                h = (await http.get(f"{self.url}/history/{pid}")).json()
                if pid in h:
                    entry = h[pid]
                    status = entry.get("status", {})
                    if status.get("status_str") == "error":
                        msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                        detail = msgs[-1][1] if msgs else status
                        raise ComfyError(f"workflow failed: {json.dumps(detail)[:1500]}")
                    if status.get("completed", True):
                        break
                if time.time() - t0 > self.timeout:
                    raise ComfyError(f"workflow timed out after {self.timeout:.0f}s")
            files = []
            for node, out in entry.get("outputs", {}).items():
                if outputs and node not in outputs:
                    continue
                for kind, items in out.items():
                    if not isinstance(items, list):
                        continue
                    for it in items:
                        if not isinstance(it, dict) or "filename" not in it:
                            continue
                        q = {"filename": it["filename"], "subfolder": it.get("subfolder", ""),
                             "type": it.get("type", "output")}
                        data = (await http.get(f"{self.url}/view", params=q)).content
                        files.append({"node": node, "filename": it["filename"], "kind": kind, "data": data})
            return files

    async def free(self) -> None:
        """Unload every model and empty the CUDA cache, so the next tenant gets the card."""
        async with httpx.AsyncClient(timeout=120) as http:
            await http.post(f"{self.url}/free", json={"unload_models": True, "free_memory": True})
            # /free is queued behind running work and applied lazily; an empty prompt-less wait is enough here,
            # but poll the queue so the caller only returns once nothing is executing.
            for _ in range(240):
                q = (await http.get(f"{self.url}/queue")).json()
                if not q.get("queue_running") and not q.get("queue_pending"):
                    break
                await asyncio.sleep(0.5)


def _parse_kv(items: list[str]) -> dict:
    out: dict[str, Any] = {}
    for it in items:
        k, _, v = it.partition("=")
        try:
            out[k] = json.loads(v)
        except ValueError:
            out[k] = v
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("name")
    r.add_argument("params", nargs="*", help="key=value (JSON values allowed)")
    r.add_argument("--out", default="/root/blocksfield/out/test")
    sub.add_parser("free")
    a = ap.parse_args()
    c = Comfy()
    if a.cmd == "free":
        asyncio.run(c.free())
        return 0
    t0 = time.time()
    files = asyncio.run(c.run(a.name, **_parse_kv(a.params)))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for f in files:
        (out / f["filename"]).write_bytes(f["data"])
        print(f"{f['node']} {f['kind']} {out / f['filename']} {len(f['data'])} bytes")
    print(f"{a.name}: {len(files)} file(s) in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
