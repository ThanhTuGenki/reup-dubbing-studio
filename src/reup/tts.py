from __future__ import annotations

import shlex
from pathlib import Path

from .logutil import run_logged
from .segments import Segment


class TemplateTTS:
    def __init__(self, name: str, template: str):
        if not template:
            raise RuntimeError(f"Chưa cấu hình [tts.{name}].cmd trong config.toml")
        self.name, self.template = name, template

    def synth(self, text: str, out_wav: Path, log_path: Path | None = None) -> Path:
        parts = shlex.split(self.template)
        cmd = [p.replace("{text}", text).replace("{out}", str(out_wav)) for p in parts]
        run_logged(cmd, log_path)
        return out_wav


def synth_segments(
    segs: list[Segment],
    adapter: TemplateTTS,
    dub_dir: Path,
    log_path: Path | None = None,
) -> list[Path]:
    dub_dir.mkdir(parents=True, exist_ok=True)
    outs = []
    for s in segs:
        if not s.text_vi.strip():
            continue
        outs.append(adapter.synth(s.text_vi, dub_dir / f"{s.index:04d}.wav", log_path))
    return outs


def get_adapter(name: str, cfg: dict) -> TemplateTTS:
    return TemplateTTS(name, cfg["tts"][name]["cmd"])
