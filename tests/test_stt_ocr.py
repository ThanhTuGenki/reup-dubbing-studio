import sys
import types
from pathlib import Path

import pytest

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


def test_extract_texts_unrecognised_shape_never_raises():
    assert extract_texts([42]) == ""
    assert extract_texts("x") == ""


def test_group_scales_pad_with_frame_dur():
    lines = [(0.0, "A"), (0.1, "A"), (0.2, "A")]
    segs = group_ocr_lines(lines, frame_dur=0.1)
    assert len(segs) == 1
    assert segs[0].end == pytest.approx(0.3)


def test_transcribe_clears_stale_frames_before_extracting(tmp_path, monkeypatch):
    # On a resume, leftover %06d.jpg files from a previous, longer run must
    # not survive into this run's sorted(frames.glob(...)) -- otherwise they
    # become phantom trailing segments.
    workdir = tmp_path
    frames = workdir / "frames"
    frames.mkdir(parents=True)
    stale = frames / "000099.jpg"
    stale.write_bytes(b"stale")

    monkeypatch.setattr("reup.stt_ocr.run_logged", lambda cmd, log_path=None: None)

    fake_paddleocr = types.ModuleType("paddleocr")

    class FakePaddleOCR:
        def __init__(self, **kwargs):
            pass

        def predict(self, path):
            return []

    fake_paddleocr.PaddleOCR = FakePaddleOCR
    monkeypatch.setitem(sys.modules, "paddleocr", fake_paddleocr)

    from reup.stt_ocr import transcribe

    transcribe(Path("v.mp4"), (0, 100, 0, 200), workdir)

    assert not stale.exists()
