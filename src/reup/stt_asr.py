from __future__ import annotations

from pathlib import Path

from .segments import Segment


def whisper_to_segments(raw_segs: list) -> list[Segment]:
    return [
        Segment(index=i, start=float(r.start), end=float(r.end), text_src=r.text.strip())
        for i, r in enumerate(raw_segs)
    ]


def transcribe(path: Path, model_size: str = "large-v3") -> list[Segment]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="int8")
    raw, _info = model.transcribe(str(path), language="zh", vad_filter=True)
    return whisper_to_segments(list(raw))
