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
    # index=7 at list position 0 distinguishes "named by index" from "named by
    # position" -- a bug that reuses position would produce 0000.wav here.
    monkeypatch.setattr("subprocess.run", lambda cmd, check: None)
    a = TemplateTTS("x", "echo {text} {out}")
    segs = [Segment(7, 0, 1, text_vi="A"), Segment(1, 1, 2, text_vi="")]
    outs = synth_segments(segs, a, tmp_path)
    assert outs == [tmp_path / "0007.wav"]


def test_synth_segments_writes_log_for_each_synth_call(tmp_path):
    # Uses the real `echo` binary (no heavy deps) so the log file is actually
    # populated by run_logged, proving log_path is threaded all the way from
    # synth_segments into each adapter.synth(...) call.
    a = TemplateTTS("x", "echo {text} {out}")
    log = tmp_path / "logs" / "tts.log"
    dub_dir = tmp_path / "dub"
    segs = [Segment(0, 0, 1, text_vi="A"), Segment(1, 1, 2, text_vi="B")]
    outs = synth_segments(segs, a, dub_dir, log_path=log)
    assert outs == [dub_dir / "0000.wav", dub_dir / "0001.wav"]
    assert log.exists()
    content = log.read_text()
    assert content.count("$ echo") == 2


def test_get_adapter_reads_config():
    a = get_adapter("vieneu", {"tts": {"vieneu": {"cmd": "run {text} {out}"}}})
    assert a.name == "vieneu"
