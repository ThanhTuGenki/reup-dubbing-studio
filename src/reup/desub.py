from __future__ import annotations

import shlex
from pathlib import Path

from reup.logutil import run_logged


def render_cmd(
    template: str, input: Path, output: Path, mask: tuple[int, int, int, int]
) -> list[str]:
    ymin, ymax, xmin, xmax = mask
    subs = {
        "{input}": str(input),
        "{output}": str(output),
        "{ymin}": str(ymin),
        "{ymax}": str(ymax),
        "{xmin}": str(xmin),
        "{xmax}": str(xmax),
    }
    filled = []
    for token in shlex.split(template):
        for placeholder, value in subs.items():
            token = token.replace(placeholder, value)
        filled.append(token)
    return filled


def desub(
    input: Path,
    output: Path,
    mask: tuple[int, int, int, int],
    template: str,
    log_path: Path | None = None,
) -> Path:
    if not template:
        raise RuntimeError("Chưa cấu hình [desub].cmd trong config.toml")
    run_logged(render_cmd(template, input, output, mask), log_path)
    if not output.exists():
        raise RuntimeError(f"desub không tạo ra file {output}")
    return output
