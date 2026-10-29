"""Roblox Open Cloud asset uploads: generated PNGs become Decals, generated GLBs become Models.

Credentials come from the environment only: ROBLOX_API_KEY (Assets read+write) and ROBLOX_CREATOR_ID (a user id;
set ROBLOX_CREATOR_GROUP=1 if it is a group). Uploading a Decal returns the decal's id; an ImageLabel needs the
id of the image inside it, which resolve_decals() asks Studio for (InsertService:LoadAsset on the creator's own
decal, read Decal.Texture).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

import httpx

API = "https://apis.roblox.com/assets/v1"
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".fbx": "model/fbx",
        ".obj": "model/obj", ".mp3": "audio/mpeg", ".ogg": "audio/ogg"}
TYPE = {".png": "Decal", ".jpg": "Decal", ".glb": "Model", ".fbx": "Model", ".obj": "Model",
        ".mp3": "Audio", ".ogg": "Audio"}


class OpenCloudError(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.environ.get("ROBLOX_API_KEY") and os.environ.get("ROBLOX_CREATOR_ID"))


def _creator() -> dict:
    cid = os.environ["ROBLOX_CREATOR_ID"]
    return {"groupId": cid} if os.environ.get("ROBLOX_CREATOR_GROUP") else {"userId": cid}


async def upload(path: str | Path, name: str, description: str = "Made with Blocksfield",
                 timeout: float = 180) -> str:
    """Upload one file; -> the asset id (a decal id for images). Raises OpenCloudError."""
    path = Path(path)
    ext = path.suffix.lower()
    if ext not in TYPE:
        raise OpenCloudError(f"cannot upload {ext} files")
    display = re.sub(r"[^A-Za-z0-9 _-]+", " ", name)[:50].strip() or "Blocksfield asset"
    req = {"assetType": TYPE[ext], "displayName": display, "description": description[:1000],
           "creationContext": {"creator": _creator()}}
    headers = {"x-api-key": os.environ["ROBLOX_API_KEY"]}
    async with httpx.AsyncClient(timeout=120) as http:
        files = {"request": (None, json.dumps(req), "application/json"),
                 "fileContent": (path.name, path.read_bytes(), MIME[ext])}
        for attempt in range(4):
            r = await http.post(f"{API}/assets", headers=headers, files=files)
            if r.status_code == 429 or r.status_code >= 500:
                await asyncio.sleep(2 + 3 * attempt)
                continue
            break
        if r.status_code >= 400:
            raise OpenCloudError(f"upload {path.name}: {r.status_code} {r.text[:400]}")
        op = r.json()
        op_path = op.get("path") or f"operations/{op.get('operationId')}"
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        while not op.get("done"):
            if loop.time() - t0 > timeout:
                raise OpenCloudError(f"upload {path.name}: still processing after {timeout:.0f}s")
            await asyncio.sleep(1.5)
            r = await http.get(f"{API}/{op_path}", headers=headers)
            if r.status_code >= 400:
                raise OpenCloudError(f"poll {path.name}: {r.status_code} {r.text[:300]}")
            op = r.json()
        if "error" in op:
            raise OpenCloudError(f"upload {path.name}: {op['error']}")
        asset_id = (op.get("response") or {}).get("assetId")
        if not asset_id:
            raise OpenCloudError(f"upload {path.name}: no asset id in {str(op)[:300]}")
        return str(asset_id)


RESOLVE_LUAU = r"""
local InsertService = game:GetService("InsertService")
local ids = %s
local out = {}
for _, id in ipairs(ids) do
	local ok, model = pcall(function() return InsertService:LoadAsset(id) end)
	if ok and model then
		local decal = model:FindFirstChildWhichIsA("Decal", true)
		if decal then out[tostring(id)] = decal.Texture end
		model:Destroy()
	end
end
return game:GetService("HttpService"):JSONEncode(out)
"""


def resolve_luau(decal_ids: list[str]) -> str:
    """Luau that maps decal ids to their image ids (run it in Studio through the bridge)."""
    return RESOLVE_LUAU % ("{" + ", ".join(str(int(i)) for i in decal_ids) + "}")


def parse_texture(texture: str) -> str | None:
    m = re.search(r"(\d{6,})", texture or "")
    return m.group(1) if m else None
