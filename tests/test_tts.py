from pathlib import Path

from reup.segments import Segment
from reup.tts import TemplateTTS, get_adapter, synth_segments


def test_template_cmd(monkeypatch):
    calls = []
    monkeypatch.setattr("subprocess.run", lambda cmd, check: calls.append(cmd))
    a = TemplateTTS("x", "echo --text {text} --out {out}")
    a.synth("xin chào", Path("o.wav"))
    assert calls[0] == ["echo", "--text", "xin chào", "--out", "o.wav"]


def test_template_cmd_preserves_multiword_text_as_one_arg(monkeypatch):
    calls = []
    monkeypatch.setattr("subprocess.run", lambda cmd, check: calls.append(cmd))
    a = TemplateTTS("x", "say {text} {out}")
    text = 'Ta nói "xin chào" nhé'
    a.synth(text, Path("o.wav"))
    assert calls[0] == ["say", text, "o.wav"]


def test_synth_segments_paths(monkeypatch, tmp_path):
    monkeypatch.setattr("subprocess.run", lambda cmd, check: None)
    a = TemplateTTS("x", "echo {text} {out}")
    segs = [Segment(0, 0, 1, text_vi="A"), Segment(1, 1, 2, text_vi="")]
    outs = synth_segments(segs, a, tmp_path)
    assert outs == [tmp_path / "0000.wav"]


def test_get_adapter_reads_config():
    a = get_adapter("vieneu", {"tts": {"vieneu": {"cmd": "run {text} {out}"}}})
    assert a.name == "vieneu"
