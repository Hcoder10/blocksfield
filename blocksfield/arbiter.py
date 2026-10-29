"""One RTX 5090, many models: the GPU turn-taking server.

The LLM (Qwen3.8-27B NVFP4 on vLLM, ~25 GB) and the art models (Qwen-Image, TRELLIS.2, LTX-2.5, ACE-Step on
ComfyUI, 10-30 GB each) cannot share a 32 GB card. Every client talks to this server instead:

  /v1/*        proxied to vLLM. Any number of LLM calls share an "LLM turn".
  /generate    the harness's image contract: {prompt, kind, transparent, out_size} -> {png_b64, width, height}
  /job         any ComfyUI workflow: {workflow, params} -> {files: [{filename, kind, b64}]}
  /status      turn, queue, swap count and timings (the app shows it live)

Switching to an "art turn": stop admitting LLM calls, let the in-flight ones finish, put vLLM to sleep (level 1
moves its weights to host RAM, discards the KV cache), run every queued art job back to back, free ComfyUI's
models, wake vLLM. Art jobs that arrive within GATHER seconds of each other share one swap, and LLM calls
waiting behind an art turn are never starved: an art turn ends when its queue is empty or after MAX_ART_TURN.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import time
from dataclasses import dataclass, field

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from PIL import Image

from blocksfield import recipe
from blocksfield.comfy import Comfy, ComfyError

log = logging.getLogger("blocksfield.arbiter")
VLLM_URL = os.environ.get("BLOCKSFIELD_VLLM_URL", "http://127.0.0.1:8000")
GATHER = float(os.environ.get("BLOCKSFIELD_ART_GATHER", "4"))
MAX_ART_TURN = float(os.environ.get("BLOCKSFIELD_MAX_ART_TURN", "240"))


@dataclass
class ArtJob:
    workflow: str
    params: dict
    fut: asyncio.Future
    t_submit: float = field(default_factory=time.time)


class Turns:
    def __init__(self, comfy: Comfy) -> None:
        self.comfy = comfy
        self.mode = "llm"
        self.inflight = 0
        self.art_waiting = False
        self.cond = asyncio.Condition()
        self.queue: asyncio.Queue[ArtJob] = asyncio.Queue()
        self.stats = {"swaps": 0, "art_jobs": 0, "llm_calls": 0, "sleep_s": 0.0, "wake_s": 0.0,
                      "art_s": 0.0, "last_error": None}
        self.llm_loaded = True

    # ---------------------------------------------------------------- LLM side
    async def llm_enter(self) -> None:
        async with self.cond:
            await self.cond.wait_for(lambda: self.mode == "llm" and not self.art_waiting)
            self.inflight += 1
            self.stats["llm_calls"] += 1

    async def llm_exit(self) -> None:
        async with self.cond:
            self.inflight -= 1
            self.cond.notify_all()

    # ---------------------------------------------------------------- art side
    async def submit(self, workflow: str, params: dict) -> list[dict]:
        job = ArtJob(workflow, params, asyncio.get_running_loop().create_future())
        await self.queue.put(job)
        return await job.fut

    async def _vllm(self, path: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=300) as http:
                r = await http.post(f"{VLLM_URL}{path}")
                return r.status_code < 400
        except httpx.HTTPError:
            return False

    async def worker(self) -> None:
        while True:
            first = await self.queue.get()
            await asyncio.sleep(GATHER)          # let a burst of requests share one swap
            async with self.cond:
                self.art_waiting = True
                await self.cond.wait_for(lambda: self.inflight == 0)
                self.mode = "art"
            t = time.time()
            self.llm_loaded = not await self._vllm("/sleep?level=1")
            self.stats["sleep_s"] = round(time.time() - t, 1)
            self.stats["swaps"] += 1
            t_turn = time.time()
            job: ArtJob | None = first
            while job is not None:
                t = time.time()
                try:
                    job.fut.set_result(await self.comfy.run(job.workflow, **job.params))
                except Exception as e:  # noqa: BLE001
                    self.stats["last_error"] = f"{job.workflow}: {e}"[:500]
                    job.fut.set_exception(e)
                self.stats["art_jobs"] += 1
                self.stats["art_s"] = round(time.time() - t, 1)
                job = None
                if time.time() - t_turn < MAX_ART_TURN and not self.queue.empty():
                    job = self.queue.get_nowait()
            await self.comfy.free()
            t = time.time()
            await self._vllm("/wake_up")
            self.llm_loaded = True
            self.stats["wake_s"] = round(time.time() - t, 1)
            async with self.cond:
                self.mode = "llm"
                self.art_waiting = False
                self.cond.notify_all()


def image_params(prompt: str, kind: str, transparent: bool | None) -> tuple[str, dict, bool]:
    p = recipe.plan(prompt, kind, transparent)
    wf = "image_rgba" if p["transparent"] else "image"
    return wf, {"prompt": p["prompt"], "width": p["width"], "height": p["height"], "seed": -1}, p["transparent"]


def to_png(data: bytes, transparent: bool, out_size: int) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert("RGBA" if transparent else "RGB")
        scale = out_size / max(im.size)
        if scale < 1:
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        return buf.getvalue(), im.width, im.height


def create_app() -> FastAPI:
    app = FastAPI(title="blocksfield arbiter")
    turns = Turns(Comfy())
    proxy = httpx.AsyncClient(base_url=VLLM_URL, timeout=httpx.Timeout(3600, connect=30))

    @app.on_event("startup")
    async def _start() -> None:
        asyncio.create_task(turns.worker())

    @app.get("/status")
    async def status() -> dict:
        return {"mode": turns.mode, "inflight_llm": turns.inflight, "art_queue": turns.queue.qsize(),
                "llm_loaded": turns.llm_loaded, **turns.stats}

    @app.post("/generate")
    async def generate(req: Request) -> JSONResponse:
        b = await req.json()
        wf, params, transparent = image_params(b["prompt"], b.get("kind", "icon"), b.get("transparent"))
        try:
            files = await turns.submit(wf, params)
        except ComfyError as e:
            return JSONResponse({"error": str(e)}, status_code=502)
        img = next((f for f in files if f["filename"].lower().endswith((".png", ".webp", ".jpg"))), None)
        if img is None:
            return JSONResponse({"error": f"{wf} produced no image"}, status_code=502)
        png, w, h = to_png(img["data"], transparent, int(b.get("out_size", 1024)))
        return JSONResponse({"png_b64": base64.b64encode(png).decode(), "width": w, "height": h,
                             "slice_center": None})

    @app.post("/job")
    async def job(req: Request) -> JSONResponse:
        b = await req.json()
        try:
            files = await turns.submit(b["workflow"], b.get("params", {}))
        except ComfyError as e:
            return JSONResponse({"error": str(e)}, status_code=502)
        return JSONResponse({"files": [{"filename": f["filename"], "kind": f["kind"], "node": f["node"],
                                        "b64": base64.b64encode(f["data"]).decode()} for f in files]})

    @app.api_route("/v1/{path:path}", methods=["GET", "POST"])
    async def llm(path: str, req: Request) -> Response:
        body = await req.body()
        headers = {k: v for k, v in req.headers.items() if k.lower() in ("authorization", "content-type")}
        if req.method == "GET":                 # /v1/models etc. never need the GPU
            r = await proxy.get(f"/v1/{path}", headers=headers)
            return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))
        await turns.llm_enter()
        try:
            r = await proxy.post(f"/v1/{path}", content=body, headers=headers)
        finally:
            await turns.llm_exit()
        return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))

    return app


app = create_app()
