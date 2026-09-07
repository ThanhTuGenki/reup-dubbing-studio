from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def worker_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTROL_PLANE_URL", "https://control.example.test")
    monkeypatch.setenv("WORKER_ROLE", "batch_media")
    monkeypatch.delenv("ENROLLMENT_TOKEN", raising=False)
    monkeypatch.delenv("LOG_FORMAT", raising=False)
