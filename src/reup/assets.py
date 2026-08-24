from __future__ import annotations
import json
from pathlib import Path

class AssetStore:
    def __init__(self, root: Path):
        self.root = Path(root)

    def dir(self, vid: str) -> Path:
        d = self.root / "videos" / vid
        d.mkdir(parents=True, exist_ok=True)
        return d

    def p(self, vid: str, name: str) -> Path:
        path = self.dir(vid) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_json(self, vid: str, name: str, obj) -> None:
        self.p(vid, name).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

    def read_json(self, vid: str, name: str):
        return json.loads(self.p(vid, name).read_text(encoding="utf-8"))
