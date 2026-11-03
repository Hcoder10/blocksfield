param([Parameter(Mandatory = $true)][string]$Pitch, [Parameter(Mandatory = $true)][string]$Id, [string]$Title = "",
      [int]$Repair = 2, [switch]$DryRun, [string]$Redo = "")
# Detached web-game build (blocksfield.web_run) with its log in runs\web_<id>\build.log; resumes when relaunched.
$ErrorActionPreference = "Stop"
$py = if ($env:BLOCKSFIELD_PYTHON) { $env:BLOCKSFIELD_PYTHON } else { "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\python.exe" }
$root = Split-Path $PSScriptRoot -Parent
$harness = if ($env:BLOCKSFIELD_HARNESS) { $env:BLOCKSFIELD_HARNESS } else { Join-Path $HOME "cybus-harness" }
$dir = Join-Path $root "runs\web_$Id"
New-Item -ItemType Directory -Force $dir | Out-Null
$env:PYTHONPATH = "$harness;$root"
$env:PYTHONUTF8 = "1"
$argv = @("-u", "-m", "blocksfield.web_run", "`"$Pitch`"", "--id", $Id, "--repair-rounds", "$Repair")
if ($Title) { $argv += @("--title", "`"$Title`"") }
if ($DryRun) { $argv += "--dry-run" }
if ($Redo) { $argv += @("--redo", $Redo) }
$b = Start-Process -FilePath $py -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $dir "build.log") -RedirectStandardError (Join-Path $dir "build.err.log") `
  -ArgumentList $argv
"web build pid $($b.Id); log $dir\build.log; game web\games\$Id\"
