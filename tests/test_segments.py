from pathlib import Path

from reup.segments import Segment, fmt_ts, load_segments, save_segments, to_srt, voiced


def test_roundtrip(tmp_path: Path):
    segs = [Segment(0, 0.0, 2.5, text_src="你好", text_vi="Xin chào")]
    p = tmp_path / "s.json"
    save_segments(segs, p)
    assert load_segments(p) == segs


def test_fmt_ts():
    assert fmt_ts(3661.5) == "01:01:01,500"
    assert fmt_ts(0.0) == "00:00:00,000"


def test_to_srt():
    segs = [Segment(0, 0.0, 1.0, text_vi="A"), Segment(1, 1.2, 3.0, text_vi="B")]
    srt = to_srt(segs)
    assert "1\n00:00:00,000 --> 00:00:01,000\nA\n" in srt
    assert "2\n00:00:01,200 --> 00:00:03,000\nB\n" in srt


def test_voiced_filters_blank_text_vi():
    segs = [
        Segment(0, 0, 1, text_vi="a"),
        Segment(1, 1, 2, text_vi="   "),  # whitespace-only counts as blank
        Segment(2, 2, 3, text_vi="c"),
    ]
    assert [s.index for s in voiced(segs)] == [0, 2]
