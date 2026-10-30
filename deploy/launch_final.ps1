param([string]$Id = "starbloom", [string]$Run = "starbloom_final", [int]$Repair = 1, [int]$Polish = 1, [int]$Items = 3)
$ErrorActionPreference = "Stop"
$py = if ($env:BLOCKSFIELD_PYTHON) { $env:BLOCKSFIELD_PYTHON } else { "python" }
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root "runs\$Run"
New-Item -ItemType Directory -Force $dir | Out-Null
$env:HARNESS_MAX_ITEMS = "$Items"
$env:HARNESS_KIT_GATE = "1"
$pitch = "Starbloom Peaks: a bright, sunny, juicy N64-style 3D platformer in saturated toon colours (Super Mario 64 meets Wave Racer). Run, double-jump, long-jump, dive and ground-pound across floating meadow islands, wobbly mushroom platforms, spinning hazards and moving platforms to collect Star Seeds and coins. Each Star Seed makes a giant flower bloom on the hub island. Clear blue sky, crisp sunlight, cheerful animated HUD (star and coin counters, timer), checkpoints, satisfying collect effects and music."
$b = Start-Process -FilePath $py -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $dir "build.log") -RedirectStandardError (Join-Path $dir "build.err.log") `
  -ArgumentList @("-u", "-m", "blocksfield.run", "`"$pitch`"", "--id", $Id, "--run", $Run,
                  "--title", "`"Starbloom Peaks`"", "--repair-rounds", "$Repair", "--polish-rounds", "$Polish")
$d = Start-Process -FilePath $py -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -ArgumentList @("-u", "-m", "blocksfield.record_dashboard", "$dir\dashboard", "--every", "30")
"build pid $($b.Id); recorder pid $($d.Id)"
