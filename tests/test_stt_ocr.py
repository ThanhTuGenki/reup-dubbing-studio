from pathlib import Path

from reup.stt_ocr import extract_texts, frame_extract_cmd, group_ocr_lines


def test_group_same_text_merges():
    lines = [(0.0, "你好"), (0.5, "你好"), (1.0, "你好"), (1.5, "再见"), (2.0, "再见")]
    segs = group_ocr_lines(lines)
    assert len(segs) == 2
    assert segs[0].text_src == "你好" and segs[0].start == 0.0 and segs[0].end == 1.5
    assert segs[1].start == 1.5


def test_group_gap_splits():
    lines = [(0.0, "A"), (0.5, "A"), (5.0, "A")]  # đứt quãng > gap
    segs = group_ocr_lines(lines, gap=1.0)
    assert len(segs) == 2


def test_frame_cmd_has_crop_and_fps():
    cmd = frame_extract_cmd(Path("v.mp4"), Path("fr"), (600, 700, 0, 1280), fps=2)
    j = " ".join(cmd)
    assert "crop=1280:100:0:600" in j and "fps=2" in j


def test_extract_texts_current_shape():
    res = [{"rec_texts": ["你好", "世界"]}]
    assert extract_texts(res) == "你好 世界"


def test_extract_texts_legacy_shape():
    res = [[[[0, 0], [1, 0], [1, 1], [0, 1]], ("你好", 0.99)]]
    assert extract_texts(res) == "你好"


def test_extract_texts_empty_or_absent():
    assert extract_texts(None) == ""
    assert extract_texts([]) == ""
    assert extract_texts([[]]) == ""
    assert extract_texts([{"rec_texts": []}]) == ""
