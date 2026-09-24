import asyncio
from pathlib import Path
from uuid import UUID

from reup_worker.agent import WorkerAgent
from reup_worker.control_plane import SessionState
from reup_worker.credential_store import CredentialStore
from reup_worker.fake_executor import FakeExecutorConfig, FakeTaskExecutor
from reup_worker.ports import ExecutionResult, ProgressReporter
from reup_worker.workspace import WorkspaceLifecycle
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.complete_task_request import CompleteTaskRequest
from reup_worker_contract.models.fail_task_request import FailTaskRequest
from reup_worker_contract.models.heartbeat import Heartbeat
from reup_worker_contract.models.heartbeat_envelope import HeartbeatEnvelope
from reup_worker_contract.models.session_identity import SessionIdentity
from reup_worker_contract.models.task_action_envelope import TaskActionEnvelope
from reup_worker_contract.models.task_progress_request import TaskProgressRequest

SESSION_ID = "0191f3d2-7f5b-7abc-8b2e-123456789b01"
TASK_ID = "0191f3d2-7f5b-7abc-8b2e-123456789b02"
ATTEMPT_ID = "0191f3d2-7f5b-7abc-8b2e-123456789b03"
LEASE_ID = "0191f3d2-7f5b-7abc-8b2e-123456789b04"


class FakeExecutor:
    async def execute(
        self, task: ClaimedTask, report_progress: ProgressReporter, cancel_requested: asyncio.Event
    ) -> ExecutionResult:
        assert not cancel_requested.is_set()
        await report_progress(5000, "halfway")
        await asyncio.sleep(0)
        return ExecutionResult(result={"adapter": "fake"})


class FakeControlPlane:
    def __init__(self, task: ClaimedTask) -> None:
        self.task = task
        self.claims = 0
        self.progress_values: list[int] = []
        self.completed: CompleteTaskRequest | None = None
        self.failed: FailTaskRequest | None = None
        self.heartbeats: list[Heartbeat] = []
        self.renewals = 0
        self.cancel_active_lease = False

    async def enroll(self, token: str, identity: SessionIdentity) -> tuple[str, SessionState]:
        del token, identity
        return "wrk_test", session_state()

    async def start_session(self, identity: SessionIdentity) -> SessionState:
        del identity
        return session_state()

    async def heartbeat(self, session_id: UUID, body: Heartbeat) -> HeartbeatEnvelope:
        assert str(session_id) == SESSION_ID
        self.heartbeats.append(body)
        return HeartbeatEnvelope.from_dict(
            {
                "data": {
                    "acceptedSequence": body.sequence,
                    "workerId": SESSION_ID,
                    "sessionId": SESSION_ID,
                    "desiredStatus": "ACTIVE",
                    "cancelLeaseIds": [str(self.task.lease_id)] if self.cancel_active_lease and self.claims else [],
                },
                "meta": {"requestId": SESSION_ID},
            }
        )

    async def claim(self, session_id: UUID):  # type: ignore[no-untyped-def]
        assert str(session_id) == SESSION_ID
        self.claims += 1
        return (self.task, 0, "ACTIVE") if self.claims == 1 else (None, 0, "DRAINING")

    async def start(self, task: ClaimedTask) -> TaskActionEnvelope:
        return action(task, "RUNNING")

    async def renew(self, task: ClaimedTask) -> TaskActionEnvelope:
        self.renewals += 1
        return action(task, "RUNNING")

    async def progress(self, task: ClaimedTask, body: TaskProgressRequest) -> TaskActionEnvelope:
        self.progress_values.append(body.progress_bps)
        return action(task, "RUNNING")

    async def complete(self, task: ClaimedTask, body: CompleteTaskRequest) -> TaskActionEnvelope:
        self.completed = body
        return action(task, "SUCCEEDED")

    async def fail(self, task: ClaimedTask, body: FailTaskRequest) -> TaskActionEnvelope:
        self.failed = body
        return action(task, "FAILED")

    async def close(self) -> None:
        return None


async def test_agent_enrolls_runs_one_task_and_stops_on_drain(tmp_path: Path) -> None:
    control_plane = FakeControlPlane(claimed_task())
    credentials = CredentialStore(tmp_path / "credential")
    agent = WorkerAgent(control_plane, credentials, identity(), FakeExecutor(), "enr_test")
    await agent.run()
    assert credentials.load() == "wrk_test"
    assert control_plane.progress_values == [5000]
    assert control_plane.completed is not None
    assert control_plane.completed.result.to_dict() == {"adapter": "fake"}
    assert control_plane.claims == 2
    assert control_plane.heartbeats


async def test_agent_cleans_successful_attempt_workspace(tmp_path: Path) -> None:
    control_plane = FakeControlPlane(claimed_task())
    lifecycle = WorkspaceLifecycle(tmp_path / "work", success_retention_seconds=0)
    agent = WorkerAgent(
        control_plane,
        CredentialStore(tmp_path / "credential"),
        identity(),
        FakeExecutor(),
        "enr_test",
        lifecycle,
    )

    await agent.run()

    assert not (tmp_path / "work" / ATTEMPT_ID).exists()
    assert (tmp_path / "work" / ".diagnostics" / f"{ATTEMPT_ID}.json").is_file()


async def test_agent_renews_a_slow_fake_task(tmp_path: Path) -> None:
    task = claimed_task()
    task.renew_after_seconds = 1
    control_plane = FakeControlPlane(task)
    executor = FakeTaskExecutor(FakeExecutorConfig(step_delay_seconds=0.4))
    agent = WorkerAgent(control_plane, CredentialStore(tmp_path / "credential"), identity(), executor, "enr_test")

    await agent.run()

    assert control_plane.renewals >= 1
    assert control_plane.completed is not None


async def test_agent_reports_fake_failure_and_timeout(tmp_path: Path) -> None:
    for behavior, expected_code in (("fail", "INFERENCE_FAILED"), ("timeout", "PROCESS_TIMEOUT")):
        control_plane = FakeControlPlane(claimed_task())
        executor = FakeTaskExecutor(FakeExecutorConfig(behavior=behavior))  # type: ignore[arg-type]
        credential = CredentialStore(tmp_path / behavior)
        await WorkerAgent(control_plane, credential, identity(), executor, "enr_test").run()

        assert control_plane.completed is None
        assert control_plane.failed is not None
        assert control_plane.failed.code == expected_code


async def test_agent_propagates_control_plane_cancel_to_fake_executor(tmp_path: Path) -> None:
    control_plane = FakeControlPlane(claimed_task())
    control_plane.cancel_active_lease = True
    executor = FakeTaskExecutor(FakeExecutorConfig(behavior="wait-for-cancel"))
    agent = WorkerAgent(control_plane, CredentialStore(tmp_path / "credential"), identity(), executor, "enr_test")

    await asyncio.wait_for(agent.run(), timeout=2)

    assert control_plane.completed is None
    assert control_plane.failed is None
    assert any(beat.active_lease_ids for beat in control_plane.heartbeats)


def identity() -> SessionIdentity:
    return SessionIdentity.from_dict(
        {
            "sessionNonce": "0191f3d2-7f5b-7abc-8b2e-123456789b05",
            "role": "BATCH_MEDIA",
            "imageDigest": f"sha256:{'a' * 64}",
            "agentVersion": "0.1.0",
            "contractVersion": 1,
            "capabilities": ["media.render.ffmpeg.v1"],
            "gpuInventory": [],
            "cpuInventory": {"cores": 8},
            "capacity": {
                "maxConcurrentTasks": 1,
                "availableTaskSlots": 1,
                "scratchFreeBytes": "1000000",
            },
        }
    )


def session_state() -> SessionState:
    session = {
        "id": SESSION_ID,
        "sessionNonce": "0191f3d2-7f5b-7abc-8b2e-123456789b05",
        "imageDigest": f"sha256:{'a' * 64}",
        "agentVersion": "0.1.0",
        "contractVersion": 1,
        "capabilities": ["media.render.ffmpeg.v1"],
        "capacity": {"maxConcurrentTasks": 1, "availableTaskSlots": 1, "scratchFreeBytes": "1000000"},
        "currentTaskCount": 0,
        "lastHeartbeatSequence": "0",
        "startedAt": "2026-09-24T00:00:00Z",
        "lastHeartbeatAt": "2026-09-24T00:00:00Z",
    }
    from reup_worker_contract.models.worker_session import WorkerSession

    return SessionState(WorkerSession.from_dict(session), "ACTIVE", 1)


def claimed_task() -> ClaimedTask:
    return ClaimedTask.from_dict(
        {
            "taskId": TASK_ID,
            "attemptId": ATTEMPT_ID,
            "leaseId": LEASE_ID,
            "fencingToken": "1",
            "taskType": "RENDER",
            "payloadVersion": 1,
            "leaseExpiresAt": "2026-09-24T01:00:00Z",
            "renewAfterSeconds": 20,
            "requirements": {"resourceClass": "GPU_BATCH", "requiredCapabilities": ["media.render.ffmpeg.v1"]},
            "configuration": {"kind": "RENDER", "subtitleMode": "EXTERNAL_ONLY", "variants": []},
            "inputs": [],
            "outputs": [],
        }
    )


def action(task: ClaimedTask, status: str) -> TaskActionEnvelope:
    return TaskActionEnvelope.from_dict(
        {
            "data": {
                "taskId": str(task.task_id),
                "attemptId": str(task.attempt_id),
                "leaseId": str(task.lease_id),
                "taskStatus": status,
                "leaseExpiresAt": "2026-09-24T01:00:00Z" if status == "RUNNING" else None,
                "cancelRequested": False,
                "desiredStatus": "ACTIVE",
            },
            "meta": {"requestId": SESSION_ID},
        }
    )
