from pathlib import Path

from reup.render import render_cmd


def test_render_cmd():
    cmd = render_cmd(Path("v.mp4"), Path("mix.wav"), Path("s.srt"), Path("out.mp4"))
    j = " ".join(cmd)
    assert "subtitles=s.srt" in j and "-map 0:v" in j and "-map 1:a" in j and "libx264" in j
