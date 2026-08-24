from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .logutil import run_logged
from .segments import Segment, voiced


def demucs_cmd(input: Path, out_dir: Path) -> list[str]:
    return ["demucs", "--two-stems=vocals", "-o", str(out_dir), str(input)]


def fit_tempo(
    clip_dur: float, slot_dur: float, max_speed: float = 1.15, min_speed: float = 1.0
) -> float:
    if slot_dur <= 0 or clip_dur <= slot_dur:
        return 1.0
    return min(max_speed, max(min_speed, clip_dur / slot_dur))


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
        capture_output=True,
        check=True,
    )
    return float(json.loads(out.stdout)["format"]["duration"])


def mix_filter(segs: list[Segment], clip_durs: dict[int, float]) -> str:
    parts, labels = [], []
    vsegs = voiced(segs)
    for k, s in enumerate(vsegs):
        tempo = fit_tempo(clip_durs[s.index], s.end - s.start)
        ms = round(s.start * 1000)
        parts.append(f"[{k + 1}]atempo={tempo:.3f},adelay={ms}|{ms}[d{k}]")
        labels.append(f"[d{k}]")
    parts.append(f"[0]{''.join(labels)}amix=inputs={len(vsegs) + 1}:normalize=0")
    return ";".join(parts)


def mix(
    bg: Path,
    segs: list[Segment],
    dub_dir: Path,
    out: Path,
    log_path: Path | None = None,
) -> Path:
    vsegs = voiced(segs)
    clips = [dub_dir / f"{s.index:04d}.wav" for s in vsegs]
    durs = {s.index: probe_duration(c) for s, c in zip(vsegs, clips, strict=True)}
    cmd = ["ffmpeg", "-y", "-i", str(bg)]
    for c in clips:
        cmd += ["-i", str(c)]
    cmd += ["-filter_complex", mix_filter(segs, durs), str(out)]
    run_logged(cmd, log_path)
    return out
