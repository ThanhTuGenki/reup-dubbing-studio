from __future__ import annotations

import tomllib
from pathlib import Path


def load_config(path: Path = Path("config.toml")) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))
