from __future__ import annotations

from pathlib import Path

from .logutil import run_logged


def render_cmd(video: Path, audio: Path, srt: Path, out: Path) -> list[str]:
    style = "FontName=Be Vietnam Pro,FontSize=18,OutlineColour=&H80000000,Outline=2"
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-vf",
        f"subtitles={srt}:force_style='{style}'",
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-shortest",
        str(out),
    ]


def render(
    video: Path,
    audio: Path,
    srt: Path,
    out: Path,
    log_path: Path | None = None,
) -> Path:
    run_logged(render_cmd(video, audio, srt, out), log_path)
    return out
