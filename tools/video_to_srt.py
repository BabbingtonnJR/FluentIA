"""Writes a Japanese subtitle file (.srt) for a video with Whisper, on this computer.

Usage: python video_to_srt.py VIDEO [--model large-v3] [--out FILE]
Called by video-to-fluentia.ps1, which sets up the paths; see the Setup notes there.
"""

import argparse
import os
import sys
import time
from pathlib import Path


def add_cuda_dlls():
    """The CUDA libraries come as pip packages (nvidia-cublas-cu12, nvidia-cudnn-cu12); Windows needs their folders."""
    import site

    for base in site.getsitepackages():
        for lib in ("cublas", "cudnn", "cuda_nvrtc"):
            folder = Path(base) / "nvidia" / lib / "bin"
            if folder.is_dir():
                os.add_dll_directory(str(folder))
                os.environ["PATH"] = f"{folder}{os.pathsep}{os.environ['PATH']}"


def stamp(seconds: float) -> str:
    ms = max(0, round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


SENTENCE_END = tuple("。！？!?")
MAX_SECONDS = 7.0
COMMA = tuple("、,")
MAX_CHARS = 24
HARD_MAX_CHARS = 60
PAUSE = 0.8


def cues(segments):
    """Sentence-sized lines: Whisper's segments can run for several sentences, which is hard to read along."""
    words, out = [], []

    def flush():
        text = "".join(w.word for w in words).strip()
        if text:
            out.append((words[0].start, words[-1].end, text))
        words.clear()

    for seg in segments:
        print(f"  {stamp(seg.start)[:8]}  {seg.text.strip()}", flush=True)
        for w in seg.words or []:
            if words and (w.start - words[-1].end > PAUSE or w.end - words[0].start > MAX_SECONDS):
                flush()
            words.append(w)
            text = "".join(x.word for x in words).strip()
            # Long lines break at a comma, so a word is never cut from its ending (行った｜んですね).
            if text.endswith(SENTENCE_END) or (len(text) >= MAX_CHARS and text.endswith(COMMA)) or len(text) >= HARD_MAX_CHARS:
                flush()
        flush()
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--out")
    args = parser.parse_args()

    video = Path(args.video)
    out = Path(args.out) if args.out else video.with_suffix(".ja.srt")

    add_cuda_dlls()
    from faster_whisper import WhisperModel

    try:
        model = WhisperModel(args.model, device="cuda", compute_type="float16")
        device = "GPU"
    except Exception as e:  # No usable NVIDIA GPU: the CPU works too, just several times slower.
        print(f"GPU not available ({e}); using the CPU.", flush=True)
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        device = "CPU"

    started = time.time()
    segments, info = model.transcribe(
        str(video),
        language="ja",
        word_timestamps=True,
        # Skips music and silence, where Whisper otherwise invents lines.
        vad_filter=True,
        # A punctuated example nudges Whisper to write 。 and ？, which the lines are split on.
        initial_prompt="こんにちは。今日は、いい天気ですね。そうですか？",
        condition_on_previous_text=False,
    )
    print(f"Transcribing {info.duration / 60:.1f} min of audio on the {device}...", flush=True)
    lines = cues(segments)

    with out.open("w", encoding="utf-8") as f:
        for i, (start, end, text) in enumerate(lines, 1):
            f.write(f"{i}\n{stamp(start)} --> {stamp(end)}\n{text}\n\n")
    print(f"{len(lines)} lines in {time.time() - started:.0f} s -> {out}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
