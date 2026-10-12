# Makes a Japanese subtitle file for a video with Whisper (free speech recognition, runs on this
# computer, uses an NVIDIA GPU when there is one), ready to import in the app together with the video
# (Literature > Videos > Import a video).
#
# Usage:   .\tools\video-to-fluentia.ps1 "C:\videos\episode1.mp4"
#          .\tools\video-to-fluentia.ps1 "C:\videos\episode1.mp4" -Model large-v3-turbo   (faster, a bit less accurate)
#          .\tools\video-to-fluentia.ps1 "C:\videos"        (every video in the folder that has no .ja.srt yet)
# Output:  "C:\videos\episode1.ja.srt" next to the video
#
# Setup, once: Python 3.12 and faster-whisper in a virtual environment at %USERPROFILE%\whisper-env, e.g.
#   py -3.12 -m venv $env:USERPROFILE\whisper-env
#   & $env:USERPROFILE\whisper-env\Scripts\python -m pip install faster-whisper "av<16" nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Model = 'large-v3'
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $env:USERPROFILE 'whisper-env\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Python not found at $python (see Setup at the top of this script)." }
$script = Join-Path $PSScriptRoot 'video_to_srt.py'

$Path = (Resolve-Path $Path).Path
if (Test-Path $Path -PathType Container) {
  $videos = Get-ChildItem $Path -File |
    Where-Object { $_.Extension -match '^\.(mp4|mkv|webm|mov|m4v|avi)$' } |
    Where-Object { -not (Test-Path (Join-Path $_.DirectoryName "$($_.BaseName).ja.srt")) } |
    Sort-Object Name
} else {
  $videos = @(Get-Item $Path)
}
if (-not $videos) { Write-Host "No videos without subtitles found."; return }

# The first run downloads the model (~3 GB for large-v3); then an episode of 24 min takes a few minutes on a GPU.
$env:PYTHONIOENCODING = 'utf-8'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
foreach ($video in $videos) {
  Write-Host "`n$($video.Name)"
  # Download progress and warnings go to stderr, which Windows PowerShell would treat as errors.
  $ErrorActionPreference = 'Continue'
  & $python -I -X utf8 $script $video.FullName --model $Model 2>&1 | ForEach-Object { "$_" }
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "Whisper failed on $($video.Name) (exit code $LASTEXITCODE); see the messages above." }
}

Write-Host "`nDone. In Fluentia: Literature > Videos > Import a video, pick the .ja.srt and the video."
Write-Host "Whisper mishears some words (names especially); the lines are a study aid, not official subtitles."
