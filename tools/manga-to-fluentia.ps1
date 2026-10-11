# Prepares a manga volume for Fluentia: reads the text in every speech bubble with mokuro (free OCR,
# runs on this computer) and zips the folder with the result, ready to import in the app
# (Literature > Manga > Import a manga).
#
# Usage:   .\tools\manga-to-fluentia.ps1 "C:\manga\My Manga\vol1"
#          (a folder of page images, in reading order by file name)
# Output:  "C:\manga\My Manga\vol1.fluentia.zip"
#
# Setup, once: Python 3.12 and mokuro in a virtual environment at %USERPROFILE%\mokuro-env, e.g.
#   py -3.12 -m venv $env:USERPROFILE\mokuro-env
#   & $env:USERPROFILE\mokuro-env\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
#   & $env:USERPROFILE\mokuro-env\Scripts\python -m pip install mokuro
param(
  [Parameter(Mandatory = $true)][string]$Folder
)

$ErrorActionPreference = 'Stop'
$mokuro = Join-Path $env:USERPROFILE 'mokuro-env\Scripts\mokuro.exe'
if (-not (Test-Path $mokuro)) { throw "mokuro not found at $mokuro (see Setup at the top of this script)." }

$Folder = (Resolve-Path $Folder).Path.TrimEnd('\')
$parent = Split-Path $Folder -Parent
$name = Split-Path $Folder -Leaf
$result = Join-Path $parent "$name.mokuro"
$zip = Join-Path $parent "$name.fluentia.zip"

# The first run downloads the OCR models (~0.5 GB); later pages take about a second each on a GPU.
$env:PYTHONIOENCODING = 'utf-8'
# mokuro logs progress and warnings on stderr, which Windows PowerShell would treat as errors.
$ErrorActionPreference = 'Continue'
& $mokuro $Folder --disable_confirmation 2>&1 | ForEach-Object { "$_" }
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $result)) { throw "mokuro failed (exit code $LASTEXITCODE); see the messages above." }

Compress-Archive -Path $Folder, $result -DestinationPath $zip -Force
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Ready: $zip ($size MB). Send it to your phone and import it in Fluentia (Literature > Manga)."
