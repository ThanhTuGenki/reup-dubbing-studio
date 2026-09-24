from pathlib import Path

from reup_worker.workspace import WorkspaceLifecycle

ATTEMPT = "0191f3d2-7f5b-7abc-8b2e-123456789b03"


def test_cleans_success_and_keeps_redacted_diagnostic(tmp_path: Path) -> None:
    lifecycle = WorkspaceLifecycle(tmp_path, success_retention_seconds=0)
    workspace = lifecycle.create(ATTEMPT)
    (workspace / "outputs" / "large.bin").write_bytes(b"large")

    lifecycle.finish(ATTEMPT, succeeded=True, diagnostic={"status": "ok", "authorization": "Bearer secret"})

    assert not workspace.exists()
    diagnostic = (tmp_path / ".diagnostics" / f"{ATTEMPT}.json").read_text()
    assert "Bearer secret" not in diagnostic
    assert "[REDACTED]" in diagnostic


def test_reaps_failed_workspace_after_retention(tmp_path: Path) -> None:
    lifecycle = WorkspaceLifecycle(tmp_path, failure_retention_seconds=10)
    workspace = lifecycle.create(ATTEMPT)
    lifecycle.finish(ATTEMPT, succeeded=False)
    deadline = int((workspace / ".retain-until").read_text())

    assert lifecycle.reap(deadline - 1) == []
    assert lifecycle.reap(deadline) == [ATTEMPT]
    assert not workspace.exists()
