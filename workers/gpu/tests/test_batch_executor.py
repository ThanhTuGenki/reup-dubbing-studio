import asyncio
from pathlib import Path

import pytest

from reup_worker.adapters.base import LocalInput, LocalOutput
from reup_worker.batch_executor import BatchMediaExecutor
from reup_worker.ports import ProgressReporter, TaskExecutionCancelled
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.task_input_asset import TaskInputAsset
from reup_worker_contract.models.task_output_reference import TaskOutputReference
from reup_worker_contract.models.task_output_specification import TaskOutputSpecification
from test_media_adapters import input_asset, media_task


class FakeAssets:
    def __init__(self, source: Path) -> None:
        self.source = source
        self.uploaded: list[Path] = []
        self.closed = False

    async def download(self, task: ClaimedTask, value: TaskInputAsset) -> Path:
        del task, value
        return self.source

    async def upload(
        self,
        task: ClaimedTask,
        specification: TaskOutputSpecification,
        path: Path,
        content_type: str,
        metadata: dict[str, object] | None = None,
    ) -> TaskOutputReference:
        del task, content_type, metadata
        self.uploaded.append(path)
        return TaskOutputReference(slot=specification.slot, asset_id=specification_asset_id())

    async def close(self) -> None:
        self.closed = True


class FakeAdapter:
    async def run(
        self,
        task: ClaimedTask,
        inputs: list[LocalInput],
        workspace: Path,
        report_progress: ProgressReporter,
        cancel_requested: asyncio.Event,
    ) -> list[LocalOutput]:
        del task, inputs, cancel_requested
        target = workspace / "outputs" / "video.mp4"
        target.write_bytes(b"rendered")
        await report_progress(8000, "adapter done")
        return [LocalOutput("video", target, "video/mp4")]


async def test_batch_executor_downloads_dispatches_and_uploads(tmp_path: Path) -> None:
    task = media_task("RENDER")
    task.inputs = [input_asset("RAW")]
    workspace = tmp_path / str(task.attempt_id)
    (workspace / "inputs").mkdir(parents=True)
    (workspace / "outputs").mkdir()
    source = workspace / "inputs" / "source.mp4"
    source.write_bytes(b"source")
    assets = FakeAssets(source)
    values: list[int] = []

    async def progress(value: int, detail: str | None) -> None:
        del detail
        values.append(value)

    result = await BatchMediaExecutor(tmp_path, assets, {"RENDER": FakeAdapter()}).execute(
        task, progress, asyncio.Event()
    )

    assert values == sorted(values)
    assert result.outputs[0].slot == "video"
    assert result.metrics.input_bytes == str(len(b"source"))
    assert result.metrics.output_bytes == str(len(b"rendered"))
    assert assets.uploaded[0].read_bytes() == b"rendered"


async def test_batch_executor_stops_before_work_when_cancelled(tmp_path: Path) -> None:
    task = media_task("RENDER")
    task.inputs = [input_asset("RAW")]
    cancel = asyncio.Event()
    cancel.set()
    assets = FakeAssets(tmp_path / "missing")

    with pytest.raises(TaskExecutionCancelled):
        await BatchMediaExecutor(tmp_path, assets, {"RENDER": FakeAdapter()}).execute(
            task, lambda value, detail: asyncio.sleep(0), cancel
        )


def specification_asset_id():
    from uuid import UUID

    return UUID("0191f3d2-7f5b-7abc-8b2e-123456789b09")
