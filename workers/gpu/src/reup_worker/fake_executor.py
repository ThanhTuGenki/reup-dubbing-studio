import asyncio
from dataclasses import dataclass
from typing import Literal

from reup_worker_contract.models.claimed_task import ClaimedTask

from .ports import ExecutionResult, ProgressReporter, TaskExecutionCancelled

FakeBehavior = Literal["success", "fail", "timeout", "wait-for-cancel"]


@dataclass(frozen=True)
class FakeExecutorConfig:
    behavior: FakeBehavior = "success"
    step_delay_seconds: float = 0.01
    progress_steps: tuple[int, ...] = (1000, 5000, 9000)


class FakeTaskExecutor:
    """Deterministic no-GPU adapter used to exercise the complete Worker lifecycle."""

    def __init__(self, config: FakeExecutorConfig | None = None) -> None:
        self._config = config or FakeExecutorConfig()

    async def execute(
        self,
        task: ClaimedTask,
        report_progress: ProgressReporter,
        cancel_requested: asyncio.Event,
    ) -> ExecutionResult:
        if self._config.behavior == "wait-for-cancel":
            await cancel_requested.wait()
            raise TaskExecutionCancelled

        for progress in self._config.progress_steps:
            await self._wait_or_cancel(cancel_requested)
            await report_progress(progress, f"fake:{progress}")

        if self._config.behavior == "fail":
            raise RuntimeError("fake executor failure")
        if self._config.behavior == "timeout":
            raise TimeoutError("fake executor timeout")

        return ExecutionResult(
            result={
                "adapter": "fake",
                "taskId": str(task.task_id),
                "behavior": self._config.behavior,
            }
        )

    async def _wait_or_cancel(self, cancel_requested: asyncio.Event) -> None:
        try:
            await asyncio.wait_for(cancel_requested.wait(), timeout=self._config.step_delay_seconds)
        except TimeoutError:
            return
        raise TaskExecutionCancelled
