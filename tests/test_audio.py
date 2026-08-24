from pathlib import Path

import reup.audio as au
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


def test_mix_filter_no_voiced_segments_degenerates_to_single_input():
    segs = [Segment(0, 0.0, 1.0, text_vi="")]
    f = mix_filter(segs, {})
    assert f == "[0]amix=inputs=1:normalize=0"


def test_mix_builds_argv_skipping_untranslated_hole(monkeypatch, tmp_path):
    # mix_filter emits [k+1] input labels while mix() appends -i arguments;
    # the two independently-computed "voiced" lists must agree in order and
    # length, or a dub clip lands in the wrong time slot. Index 1 here is an
    # untranslated hole in the middle of the segment list.
    segs = [
        Segment(0, 0.0, 1.0, text_vi="a"),
        Segment(1, 1.0, 2.0, text_vi=""),
        Segment(2, 2.0, 3.0, text_vi="c"),
    ]
    dub_dir = tmp_path / "dub"
    dub_dir.mkdir()
    bg = tmp_path / "bg.wav"
    bg.write_bytes(b"bg")
    clip0 = dub_dir / "0000.wav"
    clip2 = dub_dir / "0002.wav"
    clip0.write_bytes(b"x")
    clip2.write_bytes(b"x")

    monkeypatch.setattr(au, "probe_duration", lambda p: 1.0)
    calls: list[list[str]] = []
    monkeypatch.setattr(au, "run_logged", lambda cmd, log_path=None: calls.append(cmd))

    out = tmp_path / "mix.wav"
    au.mix(bg, segs, dub_dir, out)

    assert len(calls) == 1
    cmd = calls[0]
    assert cmd[:4] == ["ffmpeg", "-y", "-i", str(bg)]
    i0 = cmd.index(str(clip0))
    i2 = cmd.index(str(clip2))
    assert i0 < i2
    assert str(dub_dir / "0001.wav") not in cmd

    fc = cmd[cmd.index("-filter_complex") + 1]
    assert fc == au.mix_filter(segs, {0: 1.0, 2: 1.0})
