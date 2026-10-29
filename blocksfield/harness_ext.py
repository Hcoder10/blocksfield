"""Blocksfield's extra builder tools for the cybus harness (HARNESS_EXTRA_TOOLS=blocksfield.harness_ext:tools).

generate_model: prompt -> prop image (Qwen-Image) -> textured mesh (TRELLIS.2, decimated under Roblox's 20k-triangle
limit) -> uploaded as a Roblox Model (Open Cloud) -> loaded into ServerStorage.BlocksfieldAssets.<name> in the
run's Studio, scaled so its longest side is `size` studs. Game scripts clone it from there.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path

import httpx

from blocksfield import opencloud, recipe

log = logging.getLogger("blocksfield.ext")
ARBITER = os.environ.get("HARNESS_IMAGEGEN_URL", "http://127.0.0.1:8100")

LOAD_LUAU = r"""
local InsertService = game:GetService("InsertService")
local ServerStorage = game:GetService("ServerStorage")
local folder = ServerStorage:FindFirstChild("BlocksfieldAssets")
if not folder then
	folder = Instance.new("Folder")
	folder.Name = "BlocksfieldAssets"
	folder.Parent = ServerStorage
end
local old = folder:FindFirstChild("%(name)s")
if old then old:Destroy() end
local container = InsertService:LoadAsset(%(id)s)
local m = Instance.new("Model")
m.Name = "%(name)s"
for _, c in ipairs(container:GetChildren()) do
	if c:IsA("Model") then
		for _, cc in ipairs(c:GetChildren()) do cc.Parent = m end
	else
		c.Parent = m
	end
end
container:Destroy()
local parts = 0
for _, d in ipairs(m:GetDescendants()) do
	if d:IsA("BasePart") then
		d.Anchored = true
		parts += 1
		if not m.PrimaryPart then m.PrimaryPart = d end
	end
end
m.Parent = folder
local _, size = m:GetBoundingBox()
local longest = math.max(size.X, size.Y, size.Z)
if longest > 0 then m:ScaleTo(m:GetScale() * %(target)s / longest) end
m:PivotTo(CFrame.new())
local _, s2 = m:GetBoundingBox()
return string.format("%%d parts, %%.1f x %%.1f x %%.1f studs", parts, s2.X, s2.Y, s2.Z)
"""


def tools(build, stage, run_dir):
    from harness.tools.base import Tool, ToolResult
    if stage is None or not opencloud.configured():
        log.warning("generate_model disabled (%s)", "no Studio" if stage is None else "no ROBLOX_API_KEY/CREATOR_ID")
        return []
    out_dir = Path(run_dir) / "art" / "models"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "models.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}

    async def generate_model(name: str, prompt: str, size: float = 8.0) -> ToolResult:
        name = re.sub(r"[^A-Za-z0-9_]+", "_", name).strip("_")[:40] or "prop"
        style = (getattr(build, "style", None) or {}).get("direction", "")
        p = recipe.plan(f"{prompt}. {style}" if style else prompt, "prop")
        try:
            async with httpx.AsyncClient(timeout=1800) as http:
                r = await http.post(f"{ARBITER}/job", json={"workflow": "prop3d", "params": {
                    "prompt": p["prompt"], "seed": -1}})
                if r.status_code >= 400:
                    return ToolResult(text=f"ERROR: 3D generation failed: {r.text[:400]}")
                files = r.json()["files"]
            glb = next((f for f in files if f["filename"].lower().endswith(".glb")), None)
            img = next((f for f in files if f["filename"].lower().endswith(".png")), None)
            if glb is None:
                return ToolResult(text="ERROR: 3D generation produced no mesh; try a simpler, more solid object")
            path = out_dir / f"{name}.glb"
            path.write_bytes(base64.b64decode(glb["b64"]))
            preview = base64.b64decode(img["b64"]) if img else None
            if preview:
                (out_dir / f"{name}.png").write_bytes(preview)
            asset_id = await opencloud.upload(path, name, f"Blocksfield prop: {prompt[:200]}")
            res = await stage.edit(LOAD_LUAU % {"name": name, "id": int(asset_id), "target": float(size)},
                                   timeout_ms=90000)
        except Exception as e:  # noqa: BLE001
            return ToolResult(text=f"ERROR: could not make model '{name}': {e}")
        info = str(res.get("result", res))[:200] if isinstance(res, dict) else str(res)[:200]
        index[name] = {"asset_id": asset_id, "prompt": prompt, "size": size, "loaded": info}
        index_path.write_text(json.dumps(index, indent=1), encoding="utf-8")
        text = (f"3D model '{name}' is ready at ServerStorage.BlocksfieldAssets.{name} ({info}; Roblox asset "
                f"{asset_id}). Use it from a server script: "
                f"`local m = game:GetService(\"ServerStorage\").BlocksfieldAssets:WaitForChild(\"{name}\"):Clone(); "
                f"m:PivotTo(cf); m.Parent = workspace` (ScaleTo to resize; parts are anchored). The image shows "
                f"what it looks like.")
        return ToolResult(text=text, images=[preview] if preview else [])

    return [Tool("generate_model",
                 "Make a real textured 3D model (a prop, building piece, vehicle, creature, tree...) in the game's "
                 "art style, for things that would look crude built from parts. It takes ~1 minute. The model is "
                 "placed in ServerStorage.BlocksfieldAssets.<name> for your scripts to clone.",
                 {"type": "object", "required": ["name", "prompt"], "properties": {
                     "name": {"type": "string", "description": "PascalCase model name"},
                     "prompt": {"type": "string", "description": "the single object to make: shape, materials, "
                                                                 "colours"},
                     "size": {"type": "number", "description": "longest side in studs (a player is ~5)"}}},
                 generate_model, mutating=True)]
