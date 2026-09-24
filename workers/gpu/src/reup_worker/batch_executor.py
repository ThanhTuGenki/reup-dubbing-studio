import asyncio
import time
from collections.abc import Coroutine
from pathlib import Path
from typing import Any, Protocol

from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.task_input_asset import TaskInputAsset
from reup_worker_contract.models.task_metrics import TaskMetrics
from reup_worker_contract.models.task_output_reference import TaskOutputReference
from reup_worker_contract.models.task_output_specification import TaskOutputSpecification

from .adapters.base import LocalInput, LocalOutput, MediaAdapter
from .ports import ExecutionResult, ProgressReporter, TaskExecutionCancelled


class TaskAssets(Protocol):
    async def download(self, task: ClaimedTask, value: TaskInputAsset) -> Path: ...
    async def upload(
        self,
        task: ClaimedTask,
        specification: TaskOutputSpecification,
        path: Path,
        content_type: str,
        metadata: dict[str, object] | None = None,
    ) -> TaskOutputReference: ...
    async def close(self) -> None: ...


class BatchMediaExecutor:
    def __init__(self, workspace_root: Path, assets: TaskAssets, adapters: dict[str, MediaAdapter]) -> None:
        self._root = workspace_root.resolve()
        self._assets = assets
        self._adapters = adapters

    async def execute(
        self,
        task: ClaimedTask,
        report_progress: ProgressReporter,
        cancel_requested: asyncio.Event,
    ) -> ExecutionResult:
        adapter = self._adapters.get(task.task_type)
        if not adapter:
            raise RuntimeError(f"no batch adapter is registered for {task.task_type}")
        workspace = (self._root / str(task.attempt_id)).resolve()
        if not workspace.is_relative_to(self._root):
            raise RuntimeError("attempt workspace escapes its root")
        download_started = time.monotonic()
        inputs: list[LocalInput] = []
        for index, descriptor in enumerate(task.inputs):
            self._check_cancel(cancel_requested)
            inputs.append(LocalInput(descriptor, await self._assets.download(task, descriptor)))
            await report_progress(round((index + 1) / max(1, len(task.inputs)) * 1500), "downloading inputs")
        download_ms = elapsed(download_started)
        await report_progress(2000, "running media adapter")
        adapter_started = time.monotonic()
        outputs = await self._run_or_cancel(
            adapter.run(task, inputs, workspace, report_progress, cancel_requested), cancel_requested
        )
        execution_ms = elapsed(adapter_started)
        references: list[TaskOutputReference] = []
        upload_started = time.monotonic()
        for index, output in enumerate(outputs):
            self._check_cancel(cancel_requested)
            specification = output_specification(task.outputs, output.slot)
            references.append(
                await self._assets.upload(task, specification, output.path, output.content_type, output.metadata)
            )
            await report_progress(9000 + round((index + 1) / max(1, len(outputs)) * 900), "uploading outputs")
        return ExecutionResult(
            outputs=references,
            result={"adapter": task.task_type, "outputCount": len(references)},
            metrics=TaskMetrics(
                download_ms=download_ms,
                execution_ms=execution_ms,
                upload_ms=elapsed(upload_started),
                input_bytes=str(sum(item.path.stat().st_size for item in inputs)),
                output_bytes=str(sum(item.path.stat().st_size for item in outputs)),
            ),
        )

    async def close(self) -> None:
        await self._assets.close()

    async def _run_or_cancel(
        self,
        execution: Coroutine[Any, Any, list[LocalOutput]],
        cancel_requested: asyncio.Event,
    ) -> list[LocalOutput]:
        adapter_task = asyncio.create_task(execution)
        cancel_task = asyncio.create_task(cancel_requested.wait())
        done, _ = await asyncio.wait({adapter_task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
        if cancel_task in done and cancel_requested.is_set():
            adapter_task.cancel()
            try:
                await adapter_task
            except asyncio.CancelledError:
                pass
            raise TaskExecutionCancelled
        cancel_task.cancel()
        return await adapter_task

    @staticmethod
    def _check_cancel(cancel_requested: asyncio.Event) -> None:
        if cancel_requested.is_set():
            raise TaskExecutionCancelled


def output_specification(specifications: list[TaskOutputSpecification], slot: str) -> TaskOutputSpecification:
    matches = [item for item in specifications if item.slot == slot]
    if len(matches) != 1:
        raise ValueError(f"output slot {slot!r} is not declared exactly once")
    return matches[0]


def elapsed(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))
