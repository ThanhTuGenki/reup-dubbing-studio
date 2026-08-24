import os
from pathlib import Path

import pytest

from reup.ingest import build_ytdlp_cmd, video_id


def test_cmd_basic():
    cmd = build_ytdlp_cmd("https://ex.com/v", Path("/tmp/raw.mp4"))
    assert cmd[0] == "yt-dlp"
    assert "--merge-output-format" in cmd and "mp4" in cmd
    assert "-o" in cmd and "/tmp/raw.mp4" in cmd
    assert "--cookies" not in cmd


def test_cmd_cookies():
    cmd = build_ytdlp_cmd("https://ex.com/v", Path("o.mp4"), cookies=Path("c.txt"))
    i = cmd.index("--cookies")
    assert cmd[i + 1] == "c.txt"


def test_video_id_stable():
    assert video_id("https://ex.com/v") == video_id("https://ex.com/v")
    assert len(video_id("https://ex.com/v")) == 8


def test_cmd_has_end_of_options_separator_before_url():
    url = "https://ex.com/v"
    cmd = build_ytdlp_cmd(url, Path("o.mp4"))
    assert cmd[-2] == "--"
    assert cmd[-1] == url


def test_cmd_rejects_flag_smuggling_url():
    with pytest.raises(ValueError):
        build_ytdlp_cmd("--exec=touch /tmp/pwned", Path("o.mp4"))


def test_cmd_rejects_non_http_scheme():
    with pytest.raises(ValueError):
        build_ytdlp_cmd("file:///etc/passwd", Path("o.mp4"))


@pytest.mark.integration
def test_download_real(tmp_path):
    from reup.ingest import download

    url = os.environ.get("REUP_TEST_URL")
    if not url:
        pytest.skip("set REUP_TEST_URL to run")
    out = download(url, tmp_path / "raw.mp4")
    assert out.exists() and out.stat().st_size > 0
