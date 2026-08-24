from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import urlparse

from reup.logutil import run_logged


def video_id(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:8]


def build_ytdlp_cmd(url: str, out_path: Path, cookies: Path | None = None) -> list[str]:
    scheme = urlparse(url).scheme
    if scheme not in ("http", "https"):
        raise ValueError(f"URL phải dùng scheme http/https, nhận: {url!r}")
    cmd = ["yt-dlp", "--merge-output-format", "mp4", "-f", "bv*+ba/b", "-o", str(out_path)]
    if cookies:
        cmd += ["--cookies", str(cookies)]
    return cmd + ["--", url]


def download(
    url: str,
    out_path: Path,
    cookies: Path | None = None,
    log_path: Path | None = None,
) -> Path:
    run_logged(build_ytdlp_cmd(url, out_path, cookies), log_path)
    return out_path
