import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from reup_worker.control_plane import SessionState
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.complete_task_request import CompleteTaskRequest
from reup_worker_contract.models.fail_task_request import FailTaskRequest
from reup_worker_contract.models.heartbeat import Heartbeat
from reup_worker_contract.models.heartbeat_envelope import HeartbeatEnvelope
from reup_worker_contract.models.session_identity import SessionIdentity
from reup_worker_contract.models.task_action_envelope import TaskActionEnvelope
from reup_worker_contract.models.task_metrics import TaskMetrics
from reup_worker_contract.models.task_output_reference import TaskOutputReference
from reup_worker_contract.models.task_progress_request import TaskProgressRequest
from reup_worker_contract.models.worker_desired_status import WorkerDesiredStatus

ProgressReporter = Callable[[int, str | None], Awaitable[None]]


class TaskExecutionCancelled(Exception):
    """Raised by an executor after it has observed the Agent cancellation signal."""


@dataclass
class ExecutionResult:
    outputs: list[TaskOutputReference] = field(default_factory=list)
    result: dict[str, object] = field(default_factory=dict)
    metrics: TaskMetrics = field(default_factory=TaskMetrics)


class TaskExecutor(Protocol):
    async def execute(
        self, task: ClaimedTask, report_progress: ProgressReporter, cancel_requested: asyncio.Event
    ) -> ExecutionResult: ...


class ControlPlane(Protocol):
    async def enroll(self, token: str, identity: SessionIdentity) -> tuple[str, SessionState]: ...
    async def start_session(self, identity: SessionIdentity) -> SessionState: ...
    async def heartbeat(self, session_id: UUID, body: Heartbeat) -> HeartbeatEnvelope: ...
    async def claim(self, session_id: UUID) -> tuple[ClaimedTask | None, int, WorkerDesiredStatus]: ...
    async def start(self, task: ClaimedTask) -> TaskActionEnvelope: ...
    async def renew(self, task: ClaimedTask) -> TaskActionEnvelope: ...
    async def progress(self, task: ClaimedTask, body: TaskProgressRequest) -> TaskActionEnvelope: ...
    async def complete(self, task: ClaimedTask, body: CompleteTaskRequest) -> TaskActionEnvelope: ...
    async def fail(self, task: ClaimedTask, body: FailTaskRequest) -> TaskActionEnvelope: ...
    async def close(self) -> None: ...
