from __future__ import annotations

import json
import logging
import os
import subprocess
import sys

import pytest

from reup_worker.common.config import Settings
from reup_worker.common.logging import JsonFormatter, bind_context


def test_control_plane_url_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CONTROL_PLANE_URL", raising=False)
    with pytest.raises(ValueError, match="CONTROL_PLANE_URL"):
        Settings()


def test_json_formatter_contains_context_and_redacts_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENROLLMENT_TOKEN", "secret-token")
    monkeypatch.setenv("WORKER_ROLE", "batch_media")
    bind_context(trace_id="trace-1", task_id="task-1", attempt=2)
    record = logging.LogRecord("test", logging.INFO, "", 0, "token=secret-token", (), None)
    data = json.loads(JsonFormatter().format(record))
    assert data["worker_role"] == "batch_media"
    assert data["trace_id"] == "trace-1"
    assert data["task_id"] == "task-1"
    assert data["attempt"] == 2
    assert "secret-token" not in data["message"]


@pytest.mark.integration
def test_integration_marker_is_collectable() -> None:
    pass


@pytest.mark.gpu
def test_gpu_marker_is_collectable() -> None:
    pass


def test_entrypoints_fail_fast_without_config() -> None:
    env = os.environ.copy()
    env.pop("CONTROL_PLANE_URL", None)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "reup_worker.batch_media",
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "CONTROL_PLANE_URL" in result.stderr
