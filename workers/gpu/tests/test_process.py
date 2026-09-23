import asyncio
import sys
from pathlib import Path

import pytest

from reup_worker.process import IsolatedProcessRunner

ATTEMPT_ID = "0191f3d2-7f5b-7abc-8b2e-123456789b03"


async def test_process_runs_in_an_attempt_workspace_and_cleans_it(tmp_path: Path) -> None:
    runner = IsolatedProcessRunner(tmp_path, timeout_seconds=5)
    result = await runner.run(
        ATTEMPT_ID, [sys.executable, "-c", "from pathlib import Path; Path('ok').write_text('1')"]
    )
    assert result.exit_code == 0
    assert (tmp_path / ATTEMPT_ID / "ok").read_text() == "1"
    runner.cleanup(ATTEMPT_ID)
    assert not (tmp_path / ATTEMPT_ID).exists()


async def test_process_timeout_terminates_the_subprocess(tmp_path: Path) -> None:
    runner = IsolatedProcessRunner(tmp_path, timeout_seconds=1)
    with pytest.raises(TimeoutError):
        await runner.run(ATTEMPT_ID, [sys.executable, "-c", "import time; time.sleep(10)"])


async def test_process_cancellation_terminates_the_subprocess(tmp_path: Path) -> None:
    runner = IsolatedProcessRunner(tmp_path, timeout_seconds=30)
    execution = asyncio.create_task(runner.run(ATTEMPT_ID, [sys.executable, "-c", "import time; time.sleep(30)"]))
    await asyncio.sleep(0.05)
    execution.cancel()
    with pytest.raises(asyncio.CancelledError):
        await execution
