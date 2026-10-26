# Records natural Japanese voices for Fluentia with VOICEVOX (free neural text-to-speech, runs on
# this computer): every word of the word list and every line of the speaking practice. The app plays
# these instead of the browser's voice. Run it again after adding words or dialogues: only what is
# new gets recorded.
#
# Usage:   .\tools\voices-to-fluentia.ps1                 (words and speaking lines, ~25 MB)
#          .\tools\voices-to-fluentia.ps1 -Sentences      (also the example sentences on word cards)
#          .\tools\voices-to-fluentia.ps1 -Limit 20       (a quick test)
# Output:  public\audio\ja\ (commit it), public\packs\ja\pitch.json (pitch accent shown on word cards)
#
# Setup, once: the VOICEVOX engine (https://github.com/VOICEVOX/voicevox_engine/releases, e.g.
# voicevox_engine-windows-directml-<version>.vvpp, which is a zip) unpacked under
# %USERPROFILE%\voicevox-engine, and the whisper-env Python of video-to-fluentia.ps1 (it has PyAV).
# Voices used: VOICEVOX:冥鳴ひまり and VOICEVOX:青山龍星; their terms ask to credit them (see CREDITS.md).
param(
  [switch]$Sentences,
  [int]$Limit = 0
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $env:USERPROFILE 'whisper-env\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Python not found at $python (see Setup at the top of this script)." }
$engine = Get-ChildItem (Join-Path $env:USERPROFILE 'voicevox-engine') -Recurse -Filter 'run.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $engine) { throw "VOICEVOX engine (run.exe) not found under $env:USERPROFILE\voicevox-engine (see Setup)." }

function Test-Engine {
  try { Invoke-RestMethod 'http://127.0.0.1:50021/version' -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

$started = $null
if (-not (Test-Engine)) {
  Write-Host 'Starting the VOICEVOX engine...'
  $started = Start-Process $engine.FullName -ArgumentList '--host', '127.0.0.1', '--port', '50021', '--use_gpu' -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddMinutes(3)
  while (-not (Test-Engine)) {
    if ((Get-Date) -gt $deadline) { Stop-Process $started -ErrorAction SilentlyContinue; throw 'The VOICEVOX engine did not start within 3 minutes.' }
    Start-Sleep -Seconds 2
  }
}

try {
  $pyArgs = @()
  if ($Sentences) { $pyArgs += '--sentences' }
  if ($Limit -gt 0) { $pyArgs += '--limit', $Limit }
  $env:PYTHONIOENCODING = 'utf-8'
  & $python -I -X utf8 (Join-Path $PSScriptRoot 'voices_to_fluentia.py') @pyArgs
  if ($LASTEXITCODE -ne 0) { throw "Recording failed (exit code $LASTEXITCODE); see the messages above." }
} finally {
  if ($started) { Stop-Process $started -ErrorAction SilentlyContinue }
}
