from pathlib import Path

from reup.render import render_cmd


def test_render_cmd():
    cmd = render_cmd(Path("v.mp4"), Path("mix.wav"), Path("s.srt"), Path("out.mp4"))
    j = " ".join(cmd)
    assert "subtitles=s.srt" in j and "-map 0:v" in j and "-map 1:a" in j and "libx264" in j


def test_render_cmd_escapes_special_chars_in_srt_path():
    # A --data-root containing ':', '\'', or '\\' would otherwise corrupt the
    # ffmpeg filtergraph, since those characters are syntactically meaningful
    # inside a filter option string.
    srt = Path("/data/it's: a\\path/s.srt")
    cmd = render_cmd(Path("v.mp4"), Path("mix.wav"), srt, Path("out.mp4"))
    vf = cmd[cmd.index("-vf") + 1]
    assert str(srt) not in vf
    assert "\\\\" in vf  # backslash escaped
    assert "\\:" in vf  # colon escaped
    assert "\\'" in vf  # single-quote escaped
