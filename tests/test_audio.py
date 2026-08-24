from pathlib import Path

from reup.audio import demucs_cmd, fit_tempo, mix_filter
from reup.segments import Segment


def test_demucs_cmd():
    cmd = demucs_cmd(Path("in.mp4"), Path("sep"))
    assert cmd[:2] == ["demucs", "--two-stems=vocals"] and "-o" in cmd


def test_fit_tempo_clamps():
    assert fit_tempo(2.0, 2.0) == 1.0
    assert fit_tempo(3.0, 2.0) == 1.15  # cần 1.5 nhưng kẹp trần
    assert abs(fit_tempo(2.2, 2.0) - 1.1) < 1e-9
    assert fit_tempo(1.0, 2.0) == 1.0  # ngắn hơn slot: không kéo chậm quá 1.0? -> giữ 1.0


def test_mix_filter_structure():
    segs = [Segment(0, 1.0, 3.0, text_vi="a"), Segment(1, 4.0, 6.0, text_vi="b")]
    f = mix_filter(segs, {0: 2.0, 1: 2.4})
    assert "[1]atempo=1.000,adelay=1000|1000[d0]" in f
    assert "[2]atempo=1.150,adelay=4000|4000[d1]" in f
    assert "amix=inputs=3:normalize=0" in f
