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
from pathlib import Path

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
HOLD = Path(os.environ.get("BLOCKSFIELD_HOLD", "/root/setup_logs/vllm.hold"))


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
        self.events: list[dict] = []
        self.current: str | None = None
        self.thumb_store: dict[int, bytes] = {}
        self.thumb_seq = 0
        self.llm_open: dict[int, float] = {}      # LLM calls in flight: id -> start time

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

    async def _asleep(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                return bool((await http.get(f"{VLLM_URL}/is_sleeping")).json().get("is_sleeping"))
        except (httpx.HTTPError, ValueError):
            return False

    async def _wake(self) -> None:
        """Wake vLLM and make sure it is awake. Live: a newer ComfyUI kept ~12 GB on the card after /free (a failed
        custom node left weights behind), wake_up hit CUDA OOM, and vLLM stayed asleep while LLM calls queued
        forever. If the wake does not take, restart ComfyUI (a fresh process holds no VRAM) and try again."""
        for attempt in range(3):
            await self._vllm("/wake_up")
            if not await self._asleep():
                return
            log.warning("vLLM still asleep after wake_up (attempt %d): restarting ComfyUI to free the card", attempt + 1)
            self.stats["last_error"] = f"wake_up failed (attempt {attempt + 1}); restarting ComfyUI"
            await self._restart_comfy()
        log.error("vLLM would not wake after 3 attempts")

    async def _restart_comfy(self) -> None:
        script = Path(__file__).resolve().parents[1] / "deploy" / "start_servers.sh"
        proc = await asyncio.create_subprocess_shell(f"tmux kill-session -t comfy; sleep 2; bash {script} comfy",
                                                     stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await proc.wait()
        for _ in range(120):                     # wait until ComfyUI answers again
            try:
                async with httpx.AsyncClient(timeout=5) as http:
                    if (await http.get(f"{self.comfy.url}/queue")).status_code == 200:
                        return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(1)

    def event(self, kind: str, name: str, t0: float, **extra) -> None:
        self.events.append({"kind": kind, "name": name, "start": round(t0, 2), "end": round(time.time(), 2),
                            **extra})
        del self.events[:-400]

    async def vllm_state(self) -> str:
        """'up' (answering), 'starting' (process alive, API not answering: it is allocating VRAM) or 'down'."""
        try:
            async with httpx.AsyncClient(timeout=5) as http:
                if (await http.get(f"{VLLM_URL}/health")).status_code == 200:
                    return "up"
        except httpx.HTTPError:
            pass
        proc = await asyncio.create_subprocess_exec("pgrep", "-f", "vllm serve", stdout=asyncio.subprocess.DEVNULL)
        return "starting" if await proc.wait() == 0 else "down"

    async def worker(self) -> None:
        while True:
            first = await self.queue.get()
            try:
                await self.art_turn(first)
            except Exception as e:  # noqa: BLE001  -- never leave the LLM locked out
                log.exception("art turn failed")
                self.stats["last_error"] = f"art turn: {e}"[:500]
                async with self.cond:
                    self.mode, self.art_waiting = "llm", False
                    self.cond.notify_all()

    async def art_turn(self, first: ArtJob) -> None:
        await asyncio.sleep(GATHER)              # let a burst of requests share one swap
        # vLLM grabbing VRAM (starting, or about to: the launcher drops a hold file first) means an art job now
        # would OOM both. The hold clears itself once vLLM answers.
        while (state := await self.vllm_state()) == "starting" or (HOLD.exists() and state != "up"):
            await asyncio.sleep(5)
        HOLD.unlink(missing_ok=True)
        async with self.cond:
            self.art_waiting = True
            await self.cond.wait_for(lambda: self.inflight == 0)
            self.mode = "art"
        t = time.time()
        if state == "up":
            await self._vllm("/sleep?level=1")
            self.event("sleep", "LLM -> host RAM", t)
        self.llm_loaded = False
        self.stats["sleep_s"] = round(time.time() - t, 1)
        self.stats["swaps"] += 1
        t_turn = time.time()
        job: ArtJob | None = first
        try:
            while job is not None:
                t = time.time()
                self.current = job.workflow
                try:
                    files = await self.comfy.run(job.workflow, **job.params)
                    job.fut.set_result(files)
                    self.event("art", job.workflow, t, thumbs=self.thumbs(files),
                               prompt=str(job.params.get("prompt", ""))[:160])
                except Exception as e:  # noqa: BLE001
                    self.stats["last_error"] = f"{job.workflow}: {e}"[:500]
                    job.fut.set_exception(e)
                    self.event("error", job.workflow, t, error=str(e)[:200])
                self.stats["art_jobs"] += 1
                self.stats["art_s"] = round(time.time() - t, 1)
                job = None
                if time.time() - t_turn < MAX_ART_TURN and not self.queue.empty():
                    job = self.queue.get_nowait()
        finally:
            self.current = None
            t = time.time()
            await self.comfy.free()
            if state == "up":
                await self._wake()
                self.event("wake", "LLM -> GPU", t)
            self.llm_loaded = state == "up"
            self.stats["wake_s"] = round(time.time() - t, 1)
            async with self.cond:
                self.mode = "llm"
                self.art_waiting = False
                self.cond.notify_all()

    def thumbs(self, files: list[dict]) -> list[int]:
        ids = []
        for f in files:
            if not f["filename"].lower().endswith((".png", ".jpg", ".webp")):
                continue
            try:
                with Image.open(io.BytesIO(f["data"])) as im:
                    im = im.convert("RGBA")
                    im.thumbnail((320, 320))
                    buf = io.BytesIO()
                    im.save(buf, "PNG")
            except Exception:  # noqa: BLE001
                continue
            self.thumb_seq += 1
            self.thumb_store[self.thumb_seq] = buf.getvalue()
            ids.append(self.thumb_seq)
        for k in [k for k in self.thumb_store if k <= self.thumb_seq - 200]:
            del self.thumb_store[k]
        return ids


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
        # A restart can land mid art turn, with vLLM asleep: hand the card back to the LLM before serving.
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                asleep = (await http.get(f"{VLLM_URL}/is_sleeping")).json().get("is_sleeping")
        except Exception:  # noqa: BLE001
            asleep = False
        if asleep:
            await turns.comfy.free()
            await turns._wake()
            log.warning("vLLM was asleep at startup: woke it")
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
        t0 = time.time()
        await turns.llm_enter()
        t1 = time.time()
        try:
            r = await proxy.post(f"/v1/{path}", content=body, headers=headers)
        finally:
            await turns.llm_exit()
        tokens = 0
        try:
            tokens = int(r.json().get("usage", {}).get("completion_tokens", 0))
        except Exception:  # noqa: BLE001
            pass
        turns.event("llm", path, t1, tokens=tokens, waited=round(t1 - t0, 1), status=r.status_code)
        return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))

    @app.post("/upload")
    async def upload(req: Request) -> JSONResponse:
        """{filename, b64} -> put an image into ComfyUI's input folder (for edit / image-to-video jobs)."""
        b = await req.json()
        async with httpx.AsyncClient(timeout=120) as http:
            r = await http.post(f"{turns.comfy.url}/upload/image", data={"overwrite": "true"},
                                files={"image": (b["filename"], base64.b64decode(b["b64"]), "image/png")})
        return JSONResponse(r.json() if r.status_code < 400 else {"error": r.text[:300]}, status_code=r.status_code)

    @app.get("/events")
    async def events(since: float = 0) -> dict:
        return {"now": time.time(), "mode": turns.mode, "current": turns.current, "inflight_llm": turns.inflight,
                "art_queue": turns.queue.qsize(), "events": [e for e in turns.events if e["end"] > since],
                **turns.stats}

    @app.get("/thumb/{tid}")
    async def thumb(tid: int) -> Response:
        data = turns.thumb_store.get(tid)
        return Response(data or b"", 200 if data else 404, media_type="image/png")

    @app.get("/")
    async def dashboard() -> Response:
        return Response((Path(__file__).parent / "dashboard.html").read_bytes(), media_type="text/html")

    return app


app = create_app()
