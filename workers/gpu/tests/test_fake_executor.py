import asyncio

import pytest

from reup_worker.fake_executor import FakeExecutorConfig, FakeTaskExecutor
from reup_worker.ports import TaskExecutionCancelled
from test_agent import claimed_task


async def test_fake_executor_reports_progress_and_succeeds() -> None:
    values: list[int] = []

    async def report(value: int, detail: str | None) -> None:
        assert detail == f"fake:{value}"
        values.append(value)

    result = await FakeTaskExecutor().execute(claimed_task(), report, asyncio.Event())

    assert values == [1000, 5000, 9000]
    assert result.result["adapter"] == "fake"
    assert result.result["behavior"] == "success"


@pytest.mark.parametrize(
    ("behavior", "error"),
    [("fail", RuntimeError), ("timeout", TimeoutError)],
)
async def test_fake_executor_exposes_failure_modes(behavior: str, error: type[Exception]) -> None:
    async def report(value: int, detail: str | None) -> None:
        del value, detail

    executor = FakeTaskExecutor(FakeExecutorConfig(behavior=behavior))  # type: ignore[arg-type]
    with pytest.raises(error):
        await executor.execute(claimed_task(), report, asyncio.Event())


async def test_fake_executor_observes_cancel() -> None:
    cancel = asyncio.Event()

    async def report(value: int, detail: str | None) -> None:
        del value, detail

    execution = asyncio.create_task(
        FakeTaskExecutor(FakeExecutorConfig(behavior="wait-for-cancel")).execute(claimed_task(), report, cancel)
    )
    await asyncio.sleep(0)
    cancel.set()

    with pytest.raises(TaskExecutionCancelled):
        await execution
