from __future__ import annotations

import logging
import shlex
import subprocess
from pathlib import Path


def run_logged(cmd: list[str], log_path: Path | None = None) -> None:
    if log_path is None:
        subprocess.run(cmd, check=True)
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(f"\n$ {shlex.join(cmd)}\n")
        f.flush()
        proc = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
    if proc.returncode != 0:
        tail = "".join(log_path.read_text(encoding="utf-8").splitlines(keepends=True)[-20:])
        raise RuntimeError(
            f"Lệnh thất bại (exit {proc.returncode}): {cmd[0]}\n"
            f"Log: {log_path}\n--- 20 dòng cuối ---\n{tail}"
        )


def setup_logging(logfile: Path | None = None) -> None:
    fmt = "%(asctime)s %(levelname)s %(name)s %(message)s"
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    handlers[0].setLevel(logging.INFO)
    if logfile:
        logfile.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(logfile, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        handlers.append(fh)
    logging.basicConfig(level=logging.DEBUG, format=fmt, handlers=handlers, force=True)
