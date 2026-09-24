import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from reup_worker.ports import ProgressReporter
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.task_input_asset import TaskInputAsset


@dataclass(frozen=True)
class LocalInput:
    descriptor: TaskInputAsset
    path: Path


@dataclass(frozen=True)
class LocalOutput:
    slot: str
    path: Path
    content_type: str
    metadata: dict[str, object] = field(default_factory=dict)


class MediaAdapter(Protocol):
    async def run(
        self,
        task: ClaimedTask,
        inputs: list[LocalInput],
        workspace: Path,
        report_progress: ProgressReporter,
        cancel_requested: asyncio.Event,
    ) -> list[LocalOutput]: ...


def one_input(inputs: list[LocalInput], *kinds: str) -> LocalInput:
    matches = [item for item in inputs if item.descriptor.kind in kinds]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one input of kind {kinds}")
    return matches[0]


def output_path(workspace: Path, name: str) -> Path:
    path = (workspace / "outputs" / name).resolve()
    root = (workspace / "outputs").resolve()
    if not path.is_relative_to(root):
        raise ValueError("adapter output escapes its workspace")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path
