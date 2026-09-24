import json
import shutil
import time
from collections.abc import Mapping
from pathlib import Path

from .process import re_uuid_v7
from .redaction import redact


class WorkspaceLifecycle:
    def __init__(
        self,
        root: Path,
        *,
        success_retention_seconds: int = 0,
        failure_retention_seconds: int = 3600,
        diagnostic_max_bytes: int = 64 * 1024,
    ) -> None:
        self._root = root.resolve()
        self._success_retention = success_retention_seconds
        self._failure_retention = failure_retention_seconds
        self._diagnostic_max_bytes = diagnostic_max_bytes

    def create(self, attempt_id: str) -> Path:
        workspace = self._workspace(attempt_id)
        workspace.mkdir(mode=0o700, parents=True, exist_ok=False)
        (workspace / "inputs").mkdir(mode=0o700)
        (workspace / "outputs").mkdir(mode=0o700)
        return workspace

    def finish(self, attempt_id: str, *, succeeded: bool, diagnostic: Mapping[str, object] | None = None) -> None:
        workspace = self._workspace(attempt_id)
        if diagnostic:
            self._write_diagnostic(attempt_id, diagnostic)
        retention = self._success_retention if succeeded else self._failure_retention
        if retention <= 0:
            shutil.rmtree(workspace, ignore_errors=True)
            return
        (workspace / ".retain-until").write_text(str(int(time.time()) + retention), encoding="ascii")

    def reap(self, now: int | None = None) -> list[str]:
        removed: list[str] = []
        current = int(time.time()) if now is None else now
        if not self._root.exists():
            return removed
        for child in self._root.iterdir():
            marker = child / ".retain-until"
            if not child.is_dir() or not re_uuid_v7(child.name) or not marker.is_file():
                continue
            try:
                deadline = int(marker.read_text(encoding="ascii"))
            except ValueError:
                deadline = 0
            if deadline <= current:
                shutil.rmtree(child, ignore_errors=True)
                removed.append(child.name)
        return removed

    def _write_diagnostic(self, attempt_id: str, value: Mapping[str, object]) -> None:
        directory = self._root / ".diagnostics"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        payload = json.dumps(redact(value), ensure_ascii=False, separators=(",", ":")).encode()
        path = directory / f"{attempt_id}.json"
        path.write_bytes(payload[: self._diagnostic_max_bytes])
        path.chmod(0o600)

    def _workspace(self, attempt_id: str) -> Path:
        if not re_uuid_v7(attempt_id):
            raise ValueError("attempt id must be UUID v7")
        workspace = (self._root / attempt_id).resolve()
        if not workspace.is_relative_to(self._root):
            raise ValueError("workspace escapes its configured root")
        return workspace
