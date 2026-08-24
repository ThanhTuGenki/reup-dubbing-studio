from __future__ import annotations

import re
from pathlib import Path

from .logutil import run_logged
from .segments import Segment


def _norm(t: str) -> str:
    return re.sub(r"[\s，。！？,.!?…~·]", "", t)


def frame_extract_cmd(
    video: Path, out_dir: Path, mask: tuple[int, int, int, int], fps: int = 2
) -> list[str]:
    ymin, ymax, xmin, xmax = mask
    w, h = xmax - xmin, ymax - ymin
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(video),
        "-vf",
        f"crop={w}:{h}:{xmin}:{ymin},fps={fps}",
        str(out_dir / "%06d.jpg"),
    ]


def group_ocr_lines(lines: list[tuple[float, str]], gap: float = 1.0) -> list[Segment]:
    segs: list[Segment] = []
    for t, text in lines:
        if not text.strip():
            continue
        if segs and _norm(text) == _norm(segs[-1].text_src) and t - segs[-1].end <= gap:
            segs[-1].end = t + 0.5
        else:
            if segs:
                segs[-1].end = min(segs[-1].end, t)
            segs.append(Segment(index=len(segs), start=t, end=t + 0.5, text_src=text.strip()))
    return segs


def extract_texts(res) -> str:
    """Join the recognised text from one PaddleOCR per-image result.

    Handles the current shape (a list of dicts carrying a ``rec_texts`` list),
    the legacy shape (a list of ``[box, (text, confidence)]`` pairs), and
    empty/absent results. Never raises on an unrecognised shape.
    """
    try:
        if not res:
            return ""
        parts: list[str] = []
        for r in res:
            if isinstance(r, dict):
                rec_texts = r.get("rec_texts") or []
                parts.extend(str(t) for t in rec_texts)
            elif isinstance(r, (list, tuple)) and len(r) >= 2:
                second = r[1]
                if isinstance(second, (list, tuple)) and second:
                    parts.append(str(second[0]))
        return " ".join(parts)
    except Exception:
        return ""


def transcribe(
    video: Path,
    mask: tuple[int, int, int, int],
    workdir: Path,
    fps: int = 2,
    log_path: Path | None = None,
) -> list[Segment]:
    frames = workdir / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    run_logged(frame_extract_cmd(video, frames, mask, fps), log_path)
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(lang="ch", use_textline_orientation=True)
    lines: list[tuple[float, str]] = []
    for i, f in enumerate(sorted(frames.glob("*.jpg"))):
        res = ocr.predict(str(f))
        lines.append((i / fps, extract_texts(res)))
    return group_ocr_lines(lines)
