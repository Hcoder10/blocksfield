"""Screenshot / play a web game page headlessly (real GPU WebGL through ANGLE), for kit development and the web harness.

    python web/tools/shot.py games/_kitdemo/index.html --out shot.png [--wait 4] [--size 1280x720]
        [--eval "window.__kit.camera([0,40,80],[0,0,0])"] [--keys "KeyW:2000,Space:200"] [--frames 4 --every 1.0]

Serves blocksfield/web over http on a free port (ES modules need http), opens the page, waits for
window.__kit.ready (or --wait seconds), runs --eval, plays --keys (key:ms, held in order), and saves screenshots.
Prints a JSON line: {"shots": [...], "errors": [...console errors / page errors...], "state": window.__kit.state()}.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]

GPU_ARGS = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader",
            "--autoplay-policy=no-user-gesture-required"]


class _Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript",
                      ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json"}

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(root: Path = WEB) -> tuple[socketserver.TCPServer, int]:
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def run(page_rel: str, out: Path, wait: float = 4.0, size=(1280, 720), evals: list[str] | None = None,
        keys: str = "", frames: int = 1, every: float = 1.0, headed: bool = False, video: Path | None = None,
        root: Path = WEB) -> dict:
    from playwright.sync_api import sync_playwright
    srv, port = serve(root)
    errors: list[str] = []
    shots: list[str] = []
    state = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not headed, args=GPU_ARGS, channel="chrome")
            ctx_kw = {"viewport": {"width": size[0], "height": size[1]}, "device_scale_factor": 1}
            if video:
                ctx_kw["record_video_dir"] = str(video.parent)
                ctx_kw["record_video_size"] = {"width": size[0], "height": size[1]}
            ctx = browser.new_context(**ctx_kw)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e} | {(e.stack or '')[:600]}"))
            page.on("response", lambda r: errors.append(f"http {r.status}: {r.url}") if r.status >= 400 else None)
            page.goto(f"http://127.0.0.1:{port}/{page_rel.lstrip('/')}")
            t0 = time.time()
            while time.time() - t0 < max(wait, 0.5):
                try:
                    if page.evaluate("!!(window.__kit && window.__kit.ready)"):
                        break
                except Exception:
                    pass
                time.sleep(0.25)
            page.wait_for_timeout(int(max(0.0, wait - (time.time() - t0)) * 1000) if wait > 0 else 0)
            for e in evals or []:
                try:
                    r = page.evaluate(e)
                    if r is not None:
                        print("eval:", json.dumps(r, default=str)[:2000])
                except Exception as ex:
                    errors.append(f"eval error: {ex}")
            page.wait_for_timeout(300)
            for chunk in [k for k in keys.split(",") if k.strip()]:
                key, _, ms = chunk.partition(":")
                keys_down = key.split("+")
                for k in keys_down:
                    page.keyboard.down(k)
                page.wait_for_timeout(int(ms or 150))
                for k in reversed(keys_down):
                    page.keyboard.up(k)
            out.parent.mkdir(parents=True, exist_ok=True)
            for i in range(frames):
                path = out if frames == 1 else out.with_name(f"{out.stem}_{i:02d}{out.suffix}")
                page.screenshot(path=str(path))
                shots.append(str(path))
                if i < frames - 1:
                    page.wait_for_timeout(int(every * 1000))
            try:
                state = page.evaluate("window.__kit && window.__kit.state ? window.__kit.state() : null")
            except Exception as ex:
                errors.append(f"state error: {ex}")
            ctx.close()
            if video and page.video:
                Path(page.video.path()).replace(video)
            browser.close()
    finally:
        srv.shutdown()
    return {"shots": shots, "errors": errors[:60], "state": state}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("page", help="path under blocksfield/web, e.g. games/_kitdemo/index.html")
    ap.add_argument("--out", default="shot.png")
    ap.add_argument("--wait", type=float, default=4.0)
    ap.add_argument("--size", default="1280x720")
    ap.add_argument("--eval", action="append", default=[])
    ap.add_argument("--keys", default="")
    ap.add_argument("--frames", type=int, default=1)
    ap.add_argument("--every", type=float, default=1.0)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--video", help="also record a .webm of the session to this path")
    a = ap.parse_args()
    w, h = (int(v) for v in a.size.lower().split("x"))
    r = run(a.page, Path(a.out).resolve(), a.wait, (w, h), a.eval, a.keys, a.frames, a.every, a.headed,
            Path(a.video).resolve() if a.video else None)
    print(json.dumps(r, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
