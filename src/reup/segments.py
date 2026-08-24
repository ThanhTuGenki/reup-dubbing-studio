from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class Segment:
    index: int
    start: float
    end: float
    text_src: str = ""
    text_vi: str = ""
    speaker: str = "narrator"


def save_segments(segs: list[Segment], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps([asdict(s) for s in segs], ensure_ascii=False, indent=1), encoding="utf-8"
    )


def load_segments(path: Path) -> list[Segment]:
    return [Segment(**d) for d in json.loads(path.read_text(encoding="utf-8"))]


def fmt_ts(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(segs: list[Segment], use_vi: bool = True) -> str:
    out = []
    for i, sg in enumerate(segs, 1):
        text = sg.text_vi if use_vi else sg.text_src
        out.append(f"{i}\n{fmt_ts(sg.start)} --> {fmt_ts(sg.end)}\n{text}\n")
    return "\n".join(out)
