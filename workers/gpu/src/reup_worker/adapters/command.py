from collections.abc import Sequence
from typing import Protocol

from reup_worker.process import ProcessResult


class CommandRunner(Protocol):
    async def run(self, attempt_id: str, command: Sequence[str]) -> ProcessResult: ...


def require_success(result: ProcessResult, tool: str) -> None:
    if result.exit_code:
        raise RuntimeError(f"{tool} exited with code {result.exit_code}")
