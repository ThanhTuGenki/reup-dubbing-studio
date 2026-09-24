import asyncio
import os
import shutil
import signal
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProcessResult:
    exit_code: int
    stdout: str
    stderr: str


class IsolatedProcessRunner:
    def __init__(self, workspace_root: Path, timeout_seconds: int) -> None:
        self._root = workspace_root.resolve()
        self._timeout = timeout_seconds

    async def run(self, attempt_id: str, command: Sequence[str]) -> ProcessResult:
        workspace = self._workspace(attempt_id)
        workspace.mkdir(mode=0o700, parents=True, exist_ok=True)
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=workspace,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=self._timeout)
        except (asyncio.CancelledError, TimeoutError):
            os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=10)
            except TimeoutError:
                os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
            raise
        return ProcessResult(process.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace"))

    def cleanup(self, attempt_id: str) -> None:
        shutil.rmtree(self._workspace(attempt_id), ignore_errors=True)

    def _workspace(self, attempt_id: str) -> Path:
        if not re_uuid_v7(attempt_id):
            raise ValueError("attempt id must be UUID v7")
        workspace = (self._root / attempt_id).resolve()
        if not workspace.is_relative_to(self._root):
            raise ValueError("workspace escapes its configured root")
        return workspace


def re_uuid_v7(value: str) -> bool:
    parts = value.split("-")
    return len(parts) == 5 and len(value) == 36 and len(parts[2]) == 4 and parts[2].startswith("7")
