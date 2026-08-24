from types import SimpleNamespace

from reup.stt_asr import whisper_to_segments


def test_map():
    raw = [
        SimpleNamespace(start=0.0, end=2.0, text=" 你好 "),
        SimpleNamespace(start=2.5, end=4.0, text="再见"),
    ]
    segs = whisper_to_segments(raw)
    assert segs[0].text_src == "你好" and segs[0].index == 0
    assert segs[1].start == 2.5 and segs[1].index == 1
