import json

from reup.segments import Segment
from reup.translate import build_prompt, parse_response, translate


def test_prompt_contains_lines_and_rules():
    p = build_prompt([Segment(0, 0, 1, text_src="你好")])
    assert '"index": 0' in p and "你好" in p and "độ dài tương đương" in p


def test_parse_plain_and_fenced():
    body = json.dumps([{"index": 0, "vi": "Xin chào"}], ensure_ascii=False)
    assert parse_response(body) == {0: "Xin chào"}
    assert parse_response(f"```json\n{body}\n```") == {0: "Xin chào"}


class FakeClient:
    class messages:
        @staticmethod
        def create(**kw):
            class R:
                content = [type("B", (), {"text": '[{"index": 0, "vi": "Xin chào"}]'})]

            return R()


def test_translate_fills_vi():
    segs = translate([Segment(0, 0, 1, text_src="你好")], client=FakeClient())
    assert segs[0].text_vi == "Xin chào"
