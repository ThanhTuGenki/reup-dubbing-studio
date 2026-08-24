from __future__ import annotations

import json
import re

from .segments import Segment

_RULES = (
    "Bạn là dịch giả phim. Dịch từng dòng tiếng Trung sau sang tiếng Việt tự nhiên, "
    "văn nói, phù hợp lồng tiếng; giữ độ dài tương đương câu gốc (để khớp thời lượng đọc); "
    'giữ nguyên index; chỉ trả về JSON dạng [{"index": n, "vi": "..."}], không giải thích.\n'
)


def build_prompt(segs: list[Segment]) -> str:
    lines = json.dumps(
        [{"index": s.index, "text": s.text_src} for s in segs], ensure_ascii=False, indent=1
    )
    return _RULES + lines


def parse_response(text: str) -> dict[int, str]:
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        raise ValueError(f"Không tìm thấy JSON trong phản hồi: {text[:200]}")
    return {int(d["index"]): d["vi"] for d in json.loads(m.group(0))}


def translate(segs: list[Segment], client=None, model: str = "claude-sonnet-5") -> list[Segment]:
    if client is None:
        import anthropic

        client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=8000,
        messages=[{"role": "user", "content": build_prompt(segs)}],
    )
    vi = parse_response(resp.content[0].text)
    for s in segs:
        s.text_vi = vi.get(s.index, "")
    return segs
