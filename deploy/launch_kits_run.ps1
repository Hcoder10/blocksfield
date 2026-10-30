$ErrorActionPreference = "Stop"
$py = if ($env:BLOCKSFIELD_PYTHON) { $env:BLOCKSFIELD_PYTHON } else { "python" }
$root = Split-Path $PSScriptRoot -Parent
$run = Join-Path $root "runs\starbloom_kits"
$env:HARNESS_MAX_ITEMS = "3"
$env:HARNESS_KIT_GATE = "1"
$pitch = "Starbloom Peaks: a bright, juicy N64-style 3D platformer. Run, double-jump, long-jump, dive and ground-pound across floating meadow islands, wobbly mushroom platforms, spinning hazards and moving platforms to collect Star Seeds and coins. Each Star Seed makes a giant flower bloom on the hub island. Cute toon look, cheerful animated HUD (star and coin counters, timer), checkpoints, satisfying collect effects and music."
$b = Start-Process -FilePath $py -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $run "build.log") -RedirectStandardError (Join-Path $run "build.err.log") `
  -ArgumentList @("-u", "-m", "blocksfield.run", "`"$pitch`"", "--id", "starbloom", "--run", "starbloom_kits",
                  "--title", "`"Starbloom Peaks`"", "--repair-rounds", "2", "--polish-rounds", "1")
$d = Start-Process -FilePath $py -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -ArgumentList @("-u", "-m", "blocksfield.record_dashboard", "$run\dashboard", "--every", "30")
"build pid $($b.Id); recorder pid $($d.Id)"
