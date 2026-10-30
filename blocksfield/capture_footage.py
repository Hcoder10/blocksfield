"""Record demo footage of a finished game place: four cinematic shots and one gameplay shot, as 1080p30 clips.

    python -m blocksfield.capture_footage --place runs/<game>/place/<game>.rbxlx --out video/game_footage --seconds 5

How it works. Python cannot see a play session (the bridge's play mode runs in a DataModel it cannot reach), so the
game and Python share a clock instead of talking:
  1. The place is COPIED to <out>/_work and the copy is opened in a new Studio (the original file is never opened).
  2. In edit mode a LocalScript __FootageCam goes into StarterPlayerScripts (plus StreamingEnabled=false so the
     whole level is on the client). It never reaches the original place, and is removed again after play.
  3. In play, __FootageCam waits for the character and the level's tags (KitSpawn, KitCheckpoint, KitGoal, KitCoin;
     bounds fall back to workspace.StudioWorld), shows a full-screen magenta frame, then removes it: that moment is
     T0. Python finds the viewport box from the magenta and T0 from when it disappears.
  4. From T0 the script flies a fixed timeline (the same numbers Python computed): each shot parks at its start pose
     half a gap early, moves for exactly its duration, and holds its end pose. Python records each shot with a
     margin on both sides and cuts it out by time, so a few hundred ms of clock error only trims still frames.
     Shots: 1 high orbit over the level, 2 low dolly from the hub along the course to the first goal, 3 hero orbit
     of the hub at player height, 4 gameplay (Custom camera, the character runs the course with MoveTo and jumps,
     collecting coins), 5 slow push-in on the final goal.
  5. Clips are cut from the bridge's window recordings (retimed by the real capture rate, cropped to the viewport,
     scaled to 1920x1080). If recording fails, timed screenshots are stitched instead.

Outputs in --out: clip_01_orbit.mp4 .. clip_05_goal.mp4, footage_sheet.jpg (one frame per second per clip),
footage_manifest.json (timeline, crop, per-shot method and errors). Raw recordings stay in <out>/_work.

Needs: no other Studio window open (the bridge token is shared by every window), the Studio bridge on :3000,
ffmpeg + ffprobe on PATH. Closes only the Studio process it launched (by PID).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import logging
import math
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path.home() / "cybus-harness"
sys.path.insert(0, str(HARNESS))

from harness.stage import magenta_bbox, maximize_studio, studio_exe  # noqa: E402
from harness.tools import capture  # noqa: E402
from harness.tools.studio import StudioBridge, StudioError, StudioRefused  # noqa: E402

log = logging.getLogger("blocksfield.capture_footage")

W, H, FPS = 1920, 1080, 30
LEAD = 3.0          # T0 -> start of shot 1 (camera parked at shot 1's start pose meanwhile)
PRE, POST = 1.0, 0.8  # recording margin before a shot's motion starts / after it ends
MAGENTA = 4.0       # seconds the viewport marker stays up
SCRIPT_NAME = "__FootageCam"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

SHOTS = [("orbit", "clip_01_orbit"), ("dolly", "clip_02_dolly"), ("hero", "clip_03_hero"),
         ("play", "clip_04_gameplay"), ("goal", "clip_05_goal")]


@dataclass
class Shot:
    n: int
    kind: str
    name: str
    park: float          # seconds after T0: camera jumps to this shot's start pose
    start: float         # motion starts
    dur: float           # motion lasts
    record: bool = True
    method: str = ""     # video | screenshots | failed | skipped
    rec_t: float | None = None       # recording start, seconds after T0
    wall: float | None = None        # recording wall duration reported by the bridge
    raw: str = ""
    frames: list = field(default_factory=list)   # screenshot fallback: [[t_after_T0, path], ...]
    clip: str = ""
    clip_seconds: float = 0.0
    late: float = 0.0
    errors: list = field(default_factory=list)

    @property
    def end(self) -> float:
        return self.start + self.dur


def build_schedule(seconds: float, play_seconds: float, gap: float, only: set[int] | None) -> list[Shot]:
    shots, t, prev_end = [], LEAD, None
    for i, (kind, name) in enumerate(SHOTS, 1):
        dur = play_seconds if kind == "play" else seconds
        park = 0.0 if prev_end is None else prev_end + gap / 2
        shots.append(Shot(i, kind, name, park, t, dur, record=not only or i in only))
        prev_end = t + dur
        t = prev_end + gap
    return shots


# ------------------------------------------------------------------------------------------------ the in-game script

CAM_LUAU = r'''-- __FootageCam: injected by blocksfield.capture_footage for one recording session and removed afterwards.
-- Shows a magenta frame (Python finds the viewport and T0 from it), then flies a fixed timeline of shots.
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")
local StarterGui = game:GetService("StarterGui")

local CFG = __CFG__

local player = Players.LocalPlayer
local function body()
	local ch = player.Character
	local hum = ch and ch:FindFirstChildOfClass("Humanoid")
	local root = ch and ch:FindFirstChild("HumanoidRootPart")
	return ch, hum, root
end
do
	local ch = player.Character or player.CharacterAdded:Wait()
	ch:WaitForChild("HumanoidRootPart", 30)
	ch:WaitForChild("Humanoid", 30)
end
task.wait(CFG.settle)

-- the level may be built by the game's own scripts after join: wait until the tag count stops changing
local TAGS = { "KitSpawn", "KitCheckpoint", "KitGoal", "KitCoin" }
do
	local last, stableSince, t0 = -1, os.clock(), os.clock()
	while os.clock() - t0 < CFG.layoutWait do
		local n = 0
		for _, tg in ipairs(TAGS) do
			n += #CollectionService:GetTagged(tg)
		end
		if n ~= last then
			last, stableSince = n, os.clock()
		end
		if n > 0 and os.clock() - stableSince > 1.5 then
			break
		end
		task.wait(0.25)
	end
end

local function posOf(inst)
	if inst:IsA("BasePart") then return inst.Position end
	if inst:IsA("Model") then return inst:GetPivot().Position end
	if inst:IsA("Attachment") then return inst.WorldPosition end
	return nil
end
local function tagged(name)
	local out = {}
	for _, inst in ipairs(CollectionService:GetTagged(name)) do
		if inst:IsDescendantOf(workspace) then
			local p = posOf(inst)
			if p then table.insert(out, { inst = inst, pos = p }) end
		end
	end
	return out
end
local function flat(v)
	return Vector3.new(v.X, 0, v.Z)
end

-- ---------------------------------------------------------------- layout
local _, _, root0 = body()
local here = root0 and root0.Position or Vector3.zero
local spawns, checkpoints, goals, coins = tagged("KitSpawn"), tagged("KitCheckpoint"), tagged("KitGoal"), tagged("KitCoin")
local hub
do
	local best = math.huge
	for _, s in ipairs(spawns) do
		local d = (s.pos - here).Magnitude
		if d < best then hub, best = s.pos, d end
	end
	if not hub then
		local sl = workspace:FindFirstChildWhichIsA("SpawnLocation", true)
		hub = sl and sl.Position or here
	end
end
for _, c in ipairs(checkpoints) do
	c.index = tonumber(c.inst:GetAttribute("Index")) or math.huge
	c.d = (c.pos - hub).Magnitude
end
table.sort(checkpoints, function(a, b)
	if a.index ~= b.index then return a.index < b.index end
	return a.d < b.d
end)
for _, g in ipairs(goals) do
	g.island = tonumber(g.inst:GetAttribute("Island"))
	g.final = g.inst:GetAttribute("Final") == true
	g.d = (g.pos - hub).Magnitude
end

-- the course: hub, then each checkpoint followed by its island's goal, then any goals left (nearest first)
local route, goalOrder, usedGoal = { hub }, {}, {}
local function push(p)
	if (p - route[#route]).Magnitude > 3 then table.insert(route, p) end
end
for _, c in ipairs(checkpoints) do
	push(c.pos)
	for _, g in ipairs(goals) do
		if not usedGoal[g] and g.island ~= nil and g.island == c.index then
			usedGoal[g] = true
			push(g.pos)
			table.insert(goalOrder, { g = g, at = #route })
		end
	end
end
do
	local rest = {}
	for _, g in ipairs(goals) do
		if not usedGoal[g] then table.insert(rest, g) end
	end
	table.sort(rest, function(a, b) return a.d < b.d end)
	for _, g in ipairs(rest) do
		push(g.pos)
		table.insert(goalOrder, { g = g, at = #route })
	end
end

local firstGoal, finalGoal
for _, e in ipairs(goalOrder) do
	if not firstGoal and e.g.d > 25 then firstGoal = e end
	if e.g.final then finalGoal = e end
end
finalGoal = finalGoal or goalOrder[#goalOrder]

-- the walk: the route with the coins near each leg inserted in order along it
local walk, usedCoin = { route[1] }, {}
for i = 1, #route - 1 do
	local a, b = route[i], route[i + 1]
	local ab = flat(b - a)
	local L2 = ab:Dot(ab)
	local hits = {}
	for _, c in ipairs(coins) do
		if not usedCoin[c] and L2 > 1e-3 then
			local t = flat(c.pos - a):Dot(ab) / L2
			local off = flat(c.pos - (a + (b - a) * math.clamp(t, 0, 1))).Magnitude
			if t > 0 and t < 1 and off < CFG.coinReach then
				table.insert(hits, { t = t, c = c })
			end
		end
	end
	table.sort(hits, function(x, y) return x.t < y.t end)
	for _, h in ipairs(hits) do
		usedCoin[h.c] = true
		table.insert(walk, h.c.pos)
	end
	table.insert(walk, b)
end

-- bounds: the tagged layout when there is one, else workspace.StudioWorld
local minV, maxV
local function grow(p)
	if not minV then
		minV, maxV = p, p
	else
		minV = Vector3.new(math.min(minV.X, p.X), math.min(minV.Y, p.Y), math.min(minV.Z, p.Z))
		maxV = Vector3.new(math.max(maxV.X, p.X), math.max(maxV.Y, p.Y), math.max(maxV.Z, p.Z))
	end
end
do
	local n = 0
	for _, list in ipairs({ spawns, checkpoints, goals, coins }) do
		for _, e in ipairs(list) do
			grow(e.pos)
			n += 1
		end
	end
	if n < 3 then
		local world = workspace:FindFirstChild("StudioWorld")
		if world then
			for _, d in ipairs(world:GetDescendants()) do
				if d:IsA("BasePart") and d.Size.Magnitude < 1500 then grow(d.Position) end
			end
		end
	end
	grow(hub)
end
local center = (minV + maxV) / 2
local size = maxV - minV
local span = math.max(size.X, size.Z)

-- ---------------------------------------------------------------- shots (u = 0..1 through the motion)
local function ease(u)
	u = math.clamp(u, 0, 1)
	return 0.5 - 0.5 * math.cos(math.pi * u)
end

local R = math.max(span * 0.62 + 50, 90)
local orbitH = math.max(span * 0.32 + 35, 60) + size.Y * 0.5
local orbitA = (flat(hub - center).Magnitude > 1) and math.atan2(hub.Z - center.Z, hub.X - center.X) or 0
local function orbit(u)
	local sweep = math.rad(CFG.orbitDegrees)
	local a = orbitA - sweep / 2 + sweep * ease(u)
	local pos = center + Vector3.new(math.cos(a) * R, orbitH, math.sin(a) * R)
	return CFrame.lookAt(pos, center - Vector3.new(0, size.Y * 0.15, 0))
end

local dpts = {}
for i = 1, (firstGoal and firstGoal.at or #route) do
	table.insert(dpts, route[i])
end
if #dpts < 2 and flat(center - hub).Magnitude > 10 then
	dpts = { hub, center }
end
local cum = { 0 }
for i = 2, #dpts do
	cum[i] = cum[i - 1] + (dpts[i] - dpts[i - 1]).Magnitude
end
local pathLen = cum[#cum]
local function along(s)
	s = math.clamp(s, 0, pathLen)
	for i = 2, #dpts do
		if s <= cum[i] then
			local seg = cum[i] - cum[i - 1]
			return dpts[i - 1]:Lerp(dpts[i], seg > 0 and (s - cum[i - 1]) / seg or 0)
		end
	end
	return dpts[#dpts]
end
local function smoothAlong(s, w)
	local acc = Vector3.zero
	for k = -4, 4 do
		acc += along(s + k * w / 4)
	end
	return acc / 9
end
local function dolly(u)
	if pathLen < 1 then
		return CFrame.lookAt(hub + Vector3.new(30, 18, 30), hub)   -- nothing to fly along: hold on the hub
	end
	local s = ease(u) * pathLen * CFG.dollyCoverage
	local p = smoothAlong(s, 24)
	local ahead = smoothAlong(s + 28, 24)
	local fwd = flat(ahead - p)
	fwd = fwd.Magnitude > 0.1 and fwd.Unit or Vector3.new(0, 0, -1)
	local side = fwd:Cross(Vector3.yAxis)
	local pos = p - fwd * 14 + side * 9 + Vector3.new(0, 11, 0)
	return CFrame.lookAt(pos, ahead + Vector3.new(0, 3, 0))
end

local heroA
do
	local c = flat((dpts[2] or center) - hub)
	heroA = (c.Magnitude > 1 and math.atan2(c.Z, c.X) or 0) + math.pi   -- behind the hub, looking down the course
end
local function hero(u)
	local a = heroA + math.rad(CFG.heroDegrees) * (ease(u) - 0.5)
	local pos = hub + Vector3.new(math.cos(a) * CFG.heroRadius, 6, math.sin(a) * CFG.heroRadius)
	return CFrame.lookAt(pos, hub + Vector3.new(0, 3.5, 0))
end

local function goalShot(u)
	if not finalGoal then
		return CFrame.lookAt(center + Vector3.new(R * 0.5, orbitH * 0.6, R * 0.5), center)   -- no goal: hold steady
	end
	local g = finalGoal.g.pos
	local from = route[finalGoal.at - 1] or hub
	local dir = flat(from - g)
	dir = dir.Magnitude > 1 and dir.Unit or Vector3.new(1, 0, 0)
	local far = g + dir * 70 + Vector3.new(0, 26, 0)
	local near = g + dir * 15 + Vector3.new(0, 4, 0)
	return CFrame.lookAt(far:Lerp(near, ease(u)), g + Vector3.new(0, 1, 0))
end

local chasePos
local function chaseCam(dt)
	local _, _, r = body()
	if not r then return nil end
	local v = flat(r.AssemblyLinearVelocity)
	local look = flat(r.CFrame.LookVector)
	local fwd = v.Magnitude > 2 and v.Unit or (look.Magnitude > 0.1 and look.Unit or Vector3.new(0, 0, -1))
	local want = r.Position - fwd * 16 + Vector3.new(0, 7, 0)
	chasePos = chasePos and chasePos:Lerp(want, math.clamp(dt * 3, 0, 1)) or want
	return CFrame.lookAt(chasePos, r.Position + fwd * 6 + Vector3.new(0, 2, 0))
end

local FN = { orbit = orbit, dolly = dolly, hero = hero, goal = goalShot }

-- ---------------------------------------------------------------- HUD
local hidden = {}
local function setHud(show)
	local pg = player:FindFirstChildOfClass("PlayerGui")
	if not pg then return end
	if show then
		for gui, was in pairs(hidden) do
			if gui.Parent then gui.Enabled = was end
		end
		table.clear(hidden)
	else
		for _, gui in ipairs(pg:GetChildren()) do
			if gui:IsA("ScreenGui") and gui.Name ~= "__FootageMarker" and hidden[gui] == nil then
				hidden[gui] = gui.Enabled
				gui.Enabled = false
			end
		end
	end
end
task.spawn(function()
	for _ = 1, 20 do
		local ok = pcall(function()
			StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.All, false)
			StarterGui:SetCore("TopbarEnabled", false)
		end)
		if ok then break end
		task.wait(0.5)
	end
end)
local controls
pcall(function()
	controls = require(player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule", 5)):GetControls()
end)

-- ---------------------------------------------------------------- the timeline
local shots = CFG.shots
local T0 = os.clock() + CFG.magenta
local mode
RunService:BindToRenderStep("__FootageCam", Enum.RenderPriority.Camera.Value + 1, function(dt)
	local cam = workspace.CurrentCamera
	if not cam then return end
	local t = os.clock() - T0
	local shot = shots[1]
	for _, s in ipairs(shots) do
		if t >= s.park then shot = s end
	end
	if shot.kind == "play" then
		if mode ~= "play" then
			mode = "play"
			if CFG.hideHud then setHud(true) end
			cam.FieldOfView = 70
			local _, hum, r = body()
			if r and walk[2] and flat(walk[2] - r.Position).Magnitude > 1 then
				r.CFrame = CFrame.lookAt(r.Position, Vector3.new(walk[2].X, r.Position.Y, walk[2].Z))
			end
			if not CFG.chase and hum then
				if r then
					cam.CFrame = CFrame.lookAt(r.Position - r.CFrame.LookVector * 14 + Vector3.new(0, 6, 0), r.Position)
				end
				cam.CameraSubject = hum
				cam.CameraType = Enum.CameraType.Custom
			end
		end
		if CFG.chase then
			local cf = chaseCam(dt)
			if cf then
				cam.CameraType = Enum.CameraType.Scriptable
				cam.CFrame = cf
			end
		end
		return
	end
	mode = "cine"
	if CFG.hideHud then setHud(false) end
	cam.CameraType = Enum.CameraType.Scriptable
	cam.FieldOfView = CFG.fov
	local ok, cf = pcall(FN[shot.kind], (t - shot.start) / shot.dur)
	if ok and cf then cam.CFrame = cf end
end)

-- the viewport marker; when it goes, the clock starts
local marker = Instance.new("ScreenGui")
marker.Name = "__FootageMarker"
marker.IgnoreGuiInset = true
marker.ResetOnSpawn = false
marker.DisplayOrder = 1000000
pcall(function() marker.ScreenInsets = Enum.ScreenInsets.None end)
local fill = Instance.new("Frame")
fill.Size = UDim2.fromScale(1, 1)
fill.BackgroundColor3 = Color3.fromRGB(255, 0, 255)
fill.BorderSizePixel = 0
fill.Parent = marker
marker.Parent = player:WaitForChild("PlayerGui")
task.wait(math.max(0, T0 - os.clock()))
marker:Destroy()

-- gameplay: run the walk with MoveTo, jumping at edges, up steps and when stuck
local playShot
for _, s in ipairs(shots) do
	if s.kind == "play" then playShot = s end
end
if playShot then
	task.spawn(function()
		while os.clock() < T0 + playShot.start do
			task.wait()
		end
		if controls then pcall(function() controls:Disable() end) end
		local stopAt = T0 + playShot.start + playShot.dur + CFG.runOver
		local params = RaycastParams.new()
		params.FilterType = Enum.RaycastFilterType.Exclude
		pcall(function() params.RespectCanCollide = true end)
		local i, onPoint = 2, os.clock()
		local lastChar, lastPos, lastMove
		while os.clock() < stopAt do
			local ch, hum, r = body()
			if not (hum and r) or hum.Health <= 0 then
				task.wait(0.1)
				continue
			end
			if ch ~= lastChar then
				if lastChar then   -- respawned: carry on from the nearest point of the walk
					local best, bd = i, math.huge
					for k = 2, #walk do
						local d = (walk[k] - r.Position).Magnitude
						if d < bd then best, bd = k, d end
					end
					i = best
				end
				lastChar = ch
				params.FilterDescendantsInstances = { ch }
				lastPos, lastMove, onPoint = r.Position, os.clock(), os.clock()
			end
			local target = walk[i]
			if not target then break end
			local toward = flat(target - r.Position)
			if toward.Magnitude < CFG.arrive or os.clock() - onPoint > CFG.pointTimeout then
				i += 1
				onPoint = os.clock()
				continue
			end
			hum:MoveTo(target)
			if hum.FloorMaterial ~= Enum.Material.Air then
				local ahead = r.Position + toward.Unit * 3.5
				local hit = workspace:Raycast(ahead, Vector3.new(0, -(hum.HipHeight + r.Size.Y / 2 + 6), 0), params)
				if not hit then hum.Jump = true end
				if target.Y - r.Position.Y > 4 and toward.Magnitude < 8 then hum.Jump = true end
			end
			if (r.Position - lastPos).Magnitude > 1 then
				lastPos, lastMove = r.Position, os.clock()
			elseif os.clock() - lastMove > 0.6 then
				hum.Jump = true
				lastMove = os.clock()
			end
			task.wait(0.05)
		end
		local _, hum, r = body()
		if hum and r then hum:MoveTo(r.Position) end
	end)
end
'''


def lua_literal(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(round(float(v), 4))
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{k} = {lua_literal(x)}" for k, x in v.items()) + " }"
    if isinstance(v, (list, tuple)):
        return "{ " + ", ".join(lua_literal(x) for x in v) + " }"
    raise TypeError(f"no Luau literal for {type(v).__name__}")


def long_string(text: str) -> str:
    """Luau long-bracket string holding `text` verbatim."""
    level = 0
    while f"]{'=' * level}]" in text:
        level += 1
    eq = "=" * level
    return f"[{eq}[\n{text}]{eq}]"


def cam_source(shots: list[Shot], a: argparse.Namespace) -> str:
    cfg = {
        "settle": 2.0, "layoutWait": 20.0, "magenta": MAGENTA, "fov": 55, "hideHud": not a.keep_hud,
        "chase": a.chase_cam, "orbitDegrees": 110, "heroDegrees": 100, "heroRadius": 26, "dollyCoverage": 0.9,
        "coinReach": 12, "arrive": 3.5, "pointTimeout": 4.0, "runOver": 1.0,
        "shots": [{"kind": s.kind, "park": s.park, "start": s.start, "dur": s.dur} for s in shots],
    }
    return CAM_LUAU.replace("__CFG__", lua_literal(cfg))


def inject_code(source: str, neutral_avatar: bool) -> str:
    return f'''local SP = game:GetService("StarterPlayer")
local sps = SP:FindFirstChildOfClass("StarterPlayerScripts")
if not sps then sps = Instance.new("StarterPlayerScripts") sps.Parent = SP end
local old = sps:FindFirstChild("{SCRIPT_NAME}")
if old then old:Destroy() end
local s = Instance.new("LocalScript")
s.Name = "{SCRIPT_NAME}"
s.Source = {long_string(source)}
s.Parent = sps
local streaming = workspace.StreamingEnabled
pcall(function() workspace.StreamingEnabled = false end)
local appearance = SP.LoadCharacterAppearance
if {lua_literal(neutral_avatar)} then pcall(function() SP.LoadCharacterAppearance = false end) end
return "FOOTAGE_INJECTED streaming=" .. tostring(streaming) .. " appearance=" .. tostring(appearance)'''


def remove_code(prev: dict) -> str:
    lines = [f'local sps = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")',
             f'local s = sps and sps:FindFirstChild("{SCRIPT_NAME}")',
             'if s then s:Destroy() end']
    if "streaming" in prev:
        lines.append(f'pcall(function() workspace.StreamingEnabled = {lua_literal(prev["streaming"])} end)')
    if "appearance" in prev:
        lines.append('pcall(function() game:GetService("StarterPlayer").LoadCharacterAppearance = '
                     f'{lua_literal(prev["appearance"])} end)')
    lines.append('return "FOOTAGE_REMOVED"')
    return "\n".join(lines)


# ------------------------------------------------------------------------------------------------ Studio process

def studio_pids() -> set[int]:
    """PIDs of running Roblox Studio processes (looked up by image name; never killed that way)."""
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq RobloxStudioBeta.exe", "/FO", "CSV", "/NH"],
                             capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    pids = set()
    for row in csv.reader(out.splitlines()):
        if len(row) > 1 and row[0].strip().lower() == "robloxstudiobeta.exe":
            try:
                pids.add(int(row[1]))
            except ValueError:
                pass
    return pids


def close_studio(pids: set[int]) -> None:
    """End only the given Studio PIDs (the ones this run launched), and only while they are still Studio."""
    for pid in sorted(pids & studio_pids()):
        log.info("closing Studio pid %d", pid)
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=30,
                       creationflags=NO_WINDOW)


async def launch(place: Path, timeout: float) -> tuple[subprocess.Popen, set[int]]:
    before = studio_pids()
    if before:
        raise SystemExit(f"{len(before)} Roblox Studio window(s) already open (pids {sorted(before)}). The bridge token "
                         "is shared by every window, so close them first; this script opens its own copy of the place.")
    exe = studio_exe()
    if not exe:
        raise SystemExit("Roblox Studio is not installed (no RobloxStudioBeta.exe found)")
    for stale in place.parent.glob("*.lock"):
        stale.unlink(missing_ok=True)
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    proc = subprocess.Popen([str(exe), str(place)], creationflags=flags, close_fds=True)
    log.info("launched Studio pid %d on %s", proc.pid, place)
    watcher = StudioBridge(allow_place_ids={"0"})
    deadline = time.monotonic() + timeout
    while True:
        await asyncio.sleep(3)
        try:
            sessions = (await watcher.health()).get("session_list") or []
        except Exception:  # noqa: BLE001 - bridge restarting
            sessions = []
        if any(str(s.get("place_id")) == "0" for s in sessions):
            break
        if time.monotonic() > deadline:
            raise RuntimeError(f"Studio did not connect to the bridge within {timeout:.0f}s")
    await asyncio.sleep(8)          # let the place finish loading
    maximize_studio()
    return proc, (studio_pids() - before) | {proc.pid}


async def retry(what: str, fn, attempts: int, delay: float):
    for i in range(attempts):
        try:
            return await fn()
        except (StudioError, asyncio.TimeoutError) as e:
            if i + 1 >= attempts:
                raise
            log.info("%s failed (%s); retrying", what, e)
            await asyncio.sleep(delay)


async def luau(bridge: StudioBridge, code: str, timeout_ms: int = 30000) -> str:
    res = await asyncio.wait_for(bridge.call("execution_run_luau", {"code": code, "timeout_ms": timeout_ms}),
                                 timeout_ms / 1000 + 15)
    return json.dumps(res)


async def start_play(bridge: StudioBridge) -> None:
    """playtest_start, retried while Studio is busy; StudioTestService as a last resort."""
    for i in range(20):
        try:
            await asyncio.wait_for(bridge.call("playtest_start", {"mode": "play"}), 60)
            return
        except (StudioError, asyncio.TimeoutError) as e:
            if isinstance(e, StudioRefused) and "unknown" not in str(e).lower():
                raise
            log.info("playtest_start failed (%s); retrying", e)
            await asyncio.sleep(1.5 if i < 10 else 3)
    log.warning("playtest_start kept failing; starting play through StudioTestService")
    await luau(bridge, 'task.spawn(function() game:GetService("StudioTestService"):ExecutePlayModeAsync({}) end) '
                       'return "play"')


# ------------------------------------------------------------------------------------------------ capture

async def grab(bridge: StudioBridge, fmt: str = "jpeg") -> tuple[bytes, float]:
    """One screenshot and the moment it was (about) taken."""
    a = time.monotonic()
    for attempt in range(3):
        try:
            kw = {"format": fmt, "quality": 92} if fmt == "jpeg" else {"format": fmt}
            img = await asyncio.wait_for(capture.screenshot(bridge, **kw), 20)
            return img, (a + time.monotonic()) / 2
        except (StudioError, asyncio.TimeoutError) as e:
            if attempt == 2:
                raise
            log.info("screenshot failed (%s); restoring the window", e)
            maximize_studio()
            await asyncio.sleep(0.5)
            a = time.monotonic()
    raise AssertionError("unreachable")


async def find_viewport(bridge: StudioBridge, boot_timeout: float, work: Path) -> dict:
    """Wait for the magenta marker: its box is the viewport, its disappearance is T0."""
    deadline = time.monotonic() + boot_timeout
    while True:
        img, _ = await grab(bridge)
        if magenta_bbox(img):
            break
        if time.monotonic() > deadline:
            (work / "_no_marker.jpg").write_bytes(img)
            raise RuntimeError(f"the footage marker never appeared within {boot_timeout:.0f}s (did play start, and did "
                               f"{SCRIPT_NAME} run? last screenshot: {work / '_no_marker.jpg'})")
        await asyncio.sleep(0.4)
    png, t = await grab(bridge, "png")
    box = magenta_bbox(png)
    (work / "_calibration.png").write_bytes(png)
    if not box:
        raise RuntimeError("the marker vanished before the calibration screenshot; rerun")
    with Image.open(io.BytesIO(png)) as im:
        shot_size = im.size
    last_seen, cleared = t, None
    limit = time.monotonic() + MAGENTA + 15
    while time.monotonic() < limit:
        img, t = await grab(bridge)
        if magenta_bbox(img):
            last_seen = t
        else:
            cleared = t
            break
    if cleared is None:
        raise RuntimeError("the marker never went away; the in-game timeline did not start")
    return {"box": box, "shot_size": shot_size, "t0": (last_seen + cleared) / 2, "t0_error": (cleared - last_seen) / 2}


async def sleep_until(t: float) -> None:
    delay = t - time.monotonic()
    if delay > 0:
        await asyncio.sleep(delay)


async def record_shot(bridge: StudioBridge, s: Shot, t0: float, use_video: bool, raw_dir: Path) -> bool:
    """Record one shot. Returns whether video recording still works (False switches the rest to screenshots)."""
    rec_from, rec_to = t0 + s.start - PRE, t0 + s.end + POST
    await sleep_until(rec_from)
    s.late = max(0.0, time.monotonic() - rec_from)
    if s.late > PRE:
        s.errors.append(f"recording started {s.late:.2f}s late; the shot's first {s.late - PRE:.2f}s are lost")
    if use_video:
        started = False
        try:
            a = time.monotonic()
            r = await asyncio.wait_for(bridge.call("video_record_start", {
                "max_duration_seconds": int(min(30, math.ceil(PRE + s.dur + POST + 2))), "fps": FPS,
                "quality": "high"}), 15)
            s.rec_t = (a + time.monotonic()) / 2 - t0
            rid = r.get("recording_id")
            if not rid:
                raise StudioError(f"video_record_start gave no recording_id: {r}")
            started = True
            await sleep_until(rec_to)
            stop = await asyncio.wait_for(bridge.call("video_record_stop", {"recording_id": rid}), 90)
            video = stop.get("video")
            if not video:
                raise StudioError(f"video_record_stop returned no video (keys {sorted(stop)})")
            raw = raw_dir / f"{s.name}_raw.mp4"
            raw.write_bytes(video)
            s.raw, s.wall, s.method = str(raw), float(stop.get("duration_seconds") or 0), "video"
            return True
        except Exception as e:  # noqa: BLE001 - fall back to screenshots
            s.errors.append(f"video: {type(e).__name__}: {e}")
            log.warning("shot %d video failed: %s", s.n, e)
            if started and time.monotonic() > t0 + s.start + 0.5:
                s.method = "failed"          # the shot is over; the remaining ones switch to screenshots
                return False
    s.method = "screenshots"
    while time.monotonic() < rec_to:
        try:
            img, t = await grab(bridge)
        except Exception as e:  # noqa: BLE001
            s.errors.append(f"screenshot: {e}")
            await asyncio.sleep(0.2)
            continue
        p = raw_dir / f"{s.name}_{len(s.frames):04d}.jpg"
        p.write_bytes(img)
        s.frames.append([t - t0, str(p)])
    if not s.frames:
        s.method = "failed"
    return False


# ------------------------------------------------------------------------------------------------ encoding

def run_ff(args: list[str], cwd: Path | None = None) -> None:
    r = subprocess.run(args, capture_output=True, text=True, timeout=600, cwd=cwd, creationflags=NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError(f"{Path(args[0]).name} failed: {r.stderr.strip()[-1500:]}")


def probe(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,nb_read_packets:format=duration", "-of", "json", str(path)],
                       capture_output=True, text=True, timeout=120, creationflags=NO_WINDOW)
    j = json.loads(r.stdout or "{}")
    st = (j.get("streams") or [{}])[0]
    return {"w": int(st.get("width") or 0), "h": int(st.get("height") or 0),
            "frames": int(st.get("nb_read_packets") or 0),
            "dur": float((j.get("format") or {}).get("duration") or 0)}


def crop_filter(box: tuple[int, int, int, int], shot_size: tuple[int, int], frame_size: tuple[int, int]) -> str:
    """The viewport box (screenshot pixels) mapped onto a frame of another size, then covered to W x H."""
    fx, fy = frame_size[0] / shot_size[0], frame_size[1] / shot_size[1]
    if abs(frame_size[0] - shot_size[0]) <= 2 and abs(frame_size[1] - shot_size[1]) <= 2:
        fx = fy = 1.0                      # the recorder only trims odd sizes to even
    x0, y0 = max(0, int(box[0] * fx)), max(0, int(box[1] * fy))
    x1, y1 = min(frame_size[0], int(box[2] * fx)), min(frame_size[1], int(box[3] * fy))
    cw, ch = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
    return (f"crop={cw}:{ch}:{x0}:{y0},scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={W}:{H},fps={FPS},format=yuv420p")


ENCODE = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-r", str(FPS), "-movflags", "+faststart"]


def encode_video(s: Shot, calib: dict, out: Path) -> None:
    raw = Path(s.raw)
    info = probe(raw)
    if not info["frames"]:
        raise RuntimeError(f"{raw.name} has no frames")
    # The recorder stamps frames at the requested fps even when it captures slower, so retime by the real rate.
    rate = info["frames"] / s.wall if s.wall and s.wall > 0.5 else (info["frames"] / info["dur"] if info["dur"] else FPS)
    cut = max(0.0, s.start - (s.rec_t or 0.0))
    have = info["frames"] / rate - cut
    if have < s.dur - 0.05:
        s.errors.append(f"recording covers only {max(0.0, have):.2f}s of the {s.dur:.2f}s shot")
    vf = (f"setpts=N/({rate:.5f}*TB),trim=start={cut:.3f}:duration={s.dur:.3f},setpts=PTS-STARTPTS,"
          + crop_filter(calib["box"], calib["shot_size"], (info["w"], info["h"])))
    run_ff(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-vf", vf, *ENCODE, str(out)])


def encode_frames(s: Shot, calib: dict, out: Path) -> None:
    frames = sorted((float(t), Path(p)) for t, p in s.frames)
    first = max([i for i, (t, _) in enumerate(frames) if t <= s.start] or [0])
    keep = [(t, p) for t, p in frames[first:] if t < s.end]
    if not keep:
        raise RuntimeError("no screenshots inside the shot")
    lines = []
    for i, (t, p) in enumerate(keep):
        t_next = keep[i + 1][0] if i + 1 < len(keep) else s.end
        lines += [f"file '{p.name}'", f"duration {max(1.0 / FPS, min(t_next, s.end) - max(t, s.start)):.4f}"]
    lines.append(f"file '{keep[-1][1].name}'")
    lst = keep[0][1].parent / f"{s.name}_frames.txt"
    lst.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with Image.open(keep[0][1]) as im:
        size = im.size
    s.errors.append(f"stitched from {len(keep)} screenshots ({len(keep) / s.dur:.1f} fps)")
    run_ff(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst.name,
            "-vf", crop_filter(calib["box"], calib["shot_size"], size), "-t", f"{s.dur:.3f}", *ENCODE, str(out)],
           cwd=lst.parent)


def contact_sheet(clips: list[tuple[str, Path]], out: Path, tmp: Path) -> None:
    """One row per clip, one frame per second."""
    rows = []
    for name, clip in clips:
        d = tmp / f"sheet_{name}"
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("*.jpg"):
            old.unlink()
        try:
            run_ff(["ffmpeg", "-y", "-loglevel", "error", "-i", str(clip), "-vf", "fps=1,scale=384:216",
                    str(d / "f%03d.jpg")])
        except RuntimeError as e:
            log.warning("contact sheet frames for %s failed: %s", name, e)
        rows.append((name, [Image.open(p).convert("RGB") for p in sorted(d.glob("f*.jpg"))]))
    rows = [(n, fr) for n, fr in rows if fr]
    if not rows:
        return
    label_w, cw, ch, pad = 190, 384, 216, 6
    cols = max(len(fr) for _, fr in rows)
    sheet = Image.new("RGB", (label_w + cols * (cw + pad) + pad, len(rows) * (ch + pad) + pad), (16, 17, 20))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    for r, (name, frames) in enumerate(rows):
        y = pad + r * (ch + pad)
        draw.text((12, y + ch // 2 - 12), name.replace("clip_", ""), fill=(235, 235, 235), font=font)
        for c, im in enumerate(frames):
            sheet.paste(im, (label_w + pad + c * (cw + pad), y))
            draw.text((label_w + pad + c * (cw + pad) + 6, y + 4), f"{c}s", fill=(255, 255, 255), font=font)
    sheet.save(out, quality=88)


# ------------------------------------------------------------------------------------------------ main

async def run(a: argparse.Namespace) -> int:
    src = Path(a.place).resolve()
    if not src.exists():
        raise SystemExit(f"no such place: {src}")
    out = Path(a.out).resolve()
    work = out / "_work"
    work.mkdir(parents=True, exist_ok=True)
    place = work / f"footage_place{src.suffix}"
    shutil.copy2(src, place)              # Studio only ever opens this copy
    only = {int(x) for x in a.only.split(",")} if a.only else None
    shots = build_schedule(a.seconds, a.gameplay_seconds, a.gap, only)
    source = cam_source(shots, a)
    (work / f"{SCRIPT_NAME}.client.luau").write_text(source, encoding="utf-8")
    manifest: dict = {"place": str(src), "copy": str(place), "shots": [], "errors": []}

    proc, ours = None, set()
    bridge: StudioBridge | None = None
    injected, playing, prev = False, False, {}
    calib: dict | None = None
    try:
        proc, ours = await launch(place, a.launch_timeout)
        manifest["studio_pids"] = sorted(ours)
        bridge = StudioBridge(allow_place_ids={"0"})
        await retry("bridge connect", bridge.connect, 10, 3)

        text = await retry("inject", lambda: luau(bridge, inject_code(source, not a.avatar)), 20, 3)
        if "FOOTAGE_INJECTED" not in text:
            raise RuntimeError(f"injecting {SCRIPT_NAME} failed: {text[:800]}")
        injected = True
        for key in ("streaming", "appearance"):
            if f"{key}=true" in text or f"{key}=false" in text:
                prev[key] = f"{key}=true" in text
        log.info("%s injected (previous: %s)", SCRIPT_NAME, prev)

        maximize_studio()
        playing = True                    # from here on stop must run, even if the start fails half way
        await start_play(bridge)
        calib = await find_viewport(bridge, a.boot_timeout, work)
        t0 = calib["t0"]
        log.info("viewport %s in a %s window; T0 found to +-%.2fs", calib["box"], calib["shot_size"], calib["t0_error"])
        use_video = not a.screenshots and bool(shutil.which("ffmpeg"))
        for s in shots:
            if not s.record:
                s.method = "skipped"
                continue
            log.info("shot %d %s: %.1fs", s.n, s.kind, s.dur)
            use_video = await record_shot(bridge, s, t0, use_video, work)
        await sleep_until(t0 + shots[-1].end + 1.0)
    except Exception as e:  # noqa: BLE001 - still clean up and encode whatever was captured
        log.error("capture failed: %s: %s", type(e).__name__, e)
        manifest["errors"].append(f"{type(e).__name__}: {e}")
    finally:
        if bridge is not None:
            if playing:
                try:
                    await retry("playtest_stop", lambda: asyncio.wait_for(bridge.call("playtest_stop", {}), 30), 3, 2)
                    await asyncio.sleep(3)
                except Exception as e:  # noqa: BLE001
                    manifest["errors"].append(f"playtest_stop: {e}")
            if injected:
                try:
                    text = await retry("remove", lambda: luau(bridge, remove_code(prev)), 5, 2)
                    if "FOOTAGE_REMOVED" not in text:
                        raise RuntimeError(text[:300])
                    log.info("%s removed", SCRIPT_NAME)
                except Exception as e:  # noqa: BLE001 - the copy is never saved, and Studio closes next
                    manifest["errors"].append(f"removing {SCRIPT_NAME}: {e} (only the working copy had it)")
            await bridge.close()
        if ours and not a.keep_studio:
            close_studio(ours)

    clips = []
    for s in shots:
        if s.method in ("video", "screenshots") and calib:
            dst = out / f"{s.name}.mp4"
            try:
                (encode_video if s.method == "video" else encode_frames)(s, calib, dst)
                s.clip, s.clip_seconds = str(dst), probe(dst)["dur"]
                clips.append((s.name, dst))
            except Exception as e:  # noqa: BLE001
                s.errors.append(f"encode: {e}")
                log.error("encoding %s failed: %s", s.name, e)
    if clips:
        contact_sheet(clips, out / "footage_sheet.jpg", work)
    manifest["calibration"] = {k: (list(v) if isinstance(v, tuple) else v) for k, v in (calib or {}).items()
                               if k != "t0"}
    manifest["shots"] = [{k: v for k, v in asdict(s).items() if k != "frames"} | {"screenshots": len(s.frames)}
                         for s in shots]
    (out / "footage_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for s in shots:
        print(f"{s.n} {s.kind:6s} {s.method or '-':11s} {s.clip_seconds:5.2f}s {s.clip or ''} "
              + ("; ".join(s.errors) if s.errors else ""))
    if clips:
        print(f"contact sheet: {out / 'footage_sheet.jpg'}")
    for e in manifest["errors"]:
        print("ERROR:", e)
    wanted = [s for s in shots if s.record]
    return 0 if wanted and all(s.clip for s in wanted) else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Record cinematic + gameplay clips of a finished game place in Studio.")
    ap.add_argument("--place", required=True, help="the finished .rbxlx/.rbxl (a copy is opened, never the file)")
    ap.add_argument("--out", default=str(ROOT / "video" / "game_footage"), help="output folder")
    ap.add_argument("--seconds", type=float, default=5.0, help="length of each cinematic shot")
    ap.add_argument("--gameplay-seconds", type=float, default=10.0, help="length of the gameplay shot")
    ap.add_argument("--gap", type=float, default=6.0, help="seconds between shots (recording stop/start happens here)")
    ap.add_argument("--only", help="record only these shots, e.g. 1,4 (the timeline still runs in full)")
    ap.add_argument("--screenshots", action="store_true", help="skip video recording; stitch timed screenshots")
    ap.add_argument("--chase-cam", action="store_true", help="gameplay shot: scripted chase camera, not Custom")
    ap.add_argument("--keep-hud", action="store_true", help="leave the game's HUD on during cinematic shots")
    ap.add_argument("--avatar", action="store_true", help="keep the tester's avatar (default: neutral character)")
    ap.add_argument("--keep-studio", action="store_true", help="leave the launched Studio open afterwards")
    ap.add_argument("--launch-timeout", type=float, default=240.0)
    ap.add_argument("--boot-timeout", type=float, default=180.0, help="play start -> marker on screen")
    a = ap.parse_args()
    cap = 30 - PRE - POST - 2
    for name in ("seconds", "gameplay_seconds"):
        if not 1.0 <= getattr(a, name) <= cap:
            ap.error(f"--{name.replace('_', '-')} must be between 1 and {cap:.1f} (one recording is at most 30 s)")
    if a.gap < 2 * (PRE + 1.0):
        ap.error(f"--gap must be at least {2 * (PRE + 1.0):.1f}")
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            ap.error(f"{tool} is not on PATH")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    return asyncio.run(run(a))


if __name__ == "__main__":
    raise SystemExit(main())
