from dataclasses import dataclass
from typing import TypeVar
from uuid import UUID, uuid4

import httpx

from reup_worker_contract.api.default import (
    claim_worker_task,
    commit_worker_task_output,
    complete_worker_task_attempt,
    enroll_worker,
    fail_worker_task_attempt,
    heartbeat_worker_session,
    refresh_worker_task_input_grant,
    refresh_worker_task_output_grant,
    renew_worker_task_lease,
    report_worker_task_progress,
    request_worker_task_output_grant,
    start_worker_session,
    start_worker_task_attempt,
)
from reup_worker_contract.client import AuthenticatedClient
from reup_worker_contract.models.claim_task_envelope import ClaimTaskEnvelope
from reup_worker_contract.models.claim_task_request import ClaimTaskRequest
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.commit_output_request import CommitOutputRequest
from reup_worker_contract.models.committed_output import CommittedOutput
from reup_worker_contract.models.committed_output_envelope import CommittedOutputEnvelope
from reup_worker_contract.models.complete_task_request import CompleteTaskRequest
from reup_worker_contract.models.download_grant import DownloadGrant
from reup_worker_contract.models.download_grant_envelope import DownloadGrantEnvelope
from reup_worker_contract.models.enrollment_envelope import EnrollmentEnvelope
from reup_worker_contract.models.fail_task_request import FailTaskRequest
from reup_worker_contract.models.heartbeat import Heartbeat
from reup_worker_contract.models.heartbeat_envelope import HeartbeatEnvelope
from reup_worker_contract.models.lease_action_request import LeaseActionRequest
from reup_worker_contract.models.output_grant_request import OutputGrantRequest
from reup_worker_contract.models.problem_details import ProblemDetails
from reup_worker_contract.models.session_envelope import SessionEnvelope
from reup_worker_contract.models.session_identity import SessionIdentity
from reup_worker_contract.models.task_action_envelope import TaskActionEnvelope
from reup_worker_contract.models.task_progress_request import TaskProgressRequest
from reup_worker_contract.models.upload_grant import UploadGrant
from reup_worker_contract.models.upload_grant_envelope import UploadGrantEnvelope
from reup_worker_contract.models.worker_desired_status import WorkerDesiredStatus
from reup_worker_contract.models.worker_session import WorkerSession

T = TypeVar("T")


class ControlPlaneError(RuntimeError):
    def __init__(self, problem: ProblemDetails) -> None:
        super().__init__(f"{problem.code}: {problem.detail or problem.title}")
        self.code = problem.code


@dataclass(frozen=True)
class SessionState:
    session: WorkerSession
    desired_status: WorkerDesiredStatus
    heartbeat_interval_seconds: int


class GeneratedControlPlane:
    def __init__(self, base_url: str, credential: str | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._credential = credential
        self._api_client = self._make_client(credential) if credential else None

    async def enroll(self, token: str, identity: SessionIdentity) -> tuple[str, SessionState]:
        client = self._make_client(token)
        parsed = await enroll_worker.asyncio(client=client, body=identity)
        envelope = expect(parsed, EnrollmentEnvelope)
        await client.get_async_httpx_client().aclose()
        self._credential = envelope.data.credential
        self._api_client = self._make_client(envelope.data.credential)
        return envelope.data.credential, SessionState(
            session=envelope.data.session,
            desired_status="ACTIVE",
            heartbeat_interval_seconds=envelope.data.heartbeat_interval_seconds,
        )

    async def start_session(self, identity: SessionIdentity) -> SessionState:
        parsed = await start_worker_session.asyncio(
            client=self._authenticated(), body=identity, idempotency_key=str(uuid4())
        )
        envelope = expect(parsed, SessionEnvelope)
        return SessionState(
            session=envelope.data.session,
            desired_status=envelope.data.desired_status,
            heartbeat_interval_seconds=envelope.data.heartbeat_interval_seconds,
        )

    async def heartbeat(self, session_id: UUID, body: Heartbeat) -> HeartbeatEnvelope:
        parsed = await heartbeat_worker_session.asyncio(
            session_id, client=self._authenticated(), body=body, idempotency_key=str(uuid4())
        )
        return expect(parsed, HeartbeatEnvelope)

    async def claim(self, session_id: UUID) -> tuple[ClaimedTask | None, int, WorkerDesiredStatus]:
        parsed = await claim_worker_task.asyncio(
            client=self._authenticated(),
            body=ClaimTaskRequest(session_id=session_id, wait_seconds=25),
            idempotency_key=str(uuid4()),
        )
        envelope = expect(parsed, ClaimTaskEnvelope)
        return envelope.data.task, envelope.data.retry_after_seconds, envelope.data.desired_status

    async def start(self, task: ClaimedTask) -> TaskActionEnvelope:
        parsed = await start_worker_task_attempt.asyncio(
            task.task_id,
            task.attempt_id,
            client=self._authenticated(),
            body=lease_action(task),
            idempotency_key=str(uuid4()),
        )
        return expect(parsed, TaskActionEnvelope)

    async def renew(self, task: ClaimedTask) -> TaskActionEnvelope:
        parsed = await renew_worker_task_lease.asyncio(
            task.task_id,
            task.attempt_id,
            client=self._authenticated(),
            body=lease_action(task),
            idempotency_key=str(uuid4()),
        )
        return expect(parsed, TaskActionEnvelope)

    async def progress(self, task: ClaimedTask, body: TaskProgressRequest) -> TaskActionEnvelope:
        parsed = await report_worker_task_progress.asyncio(
            task.task_id,
            task.attempt_id,
            client=self._authenticated(),
            body=body,
            idempotency_key=str(uuid4()),
        )
        return expect(parsed, TaskActionEnvelope)

    async def complete(self, task: ClaimedTask, body: CompleteTaskRequest) -> TaskActionEnvelope:
        parsed = await complete_worker_task_attempt.asyncio(
            task.task_id,
            task.attempt_id,
            client=self._authenticated(),
            body=body,
            idempotency_key=str(uuid4()),
        )
        return expect(parsed, TaskActionEnvelope)

    async def fail(self, task: ClaimedTask, body: FailTaskRequest) -> TaskActionEnvelope:
        parsed = await fail_worker_task_attempt.asyncio(
            task.task_id,
            task.attempt_id,
            client=self._authenticated(),
            body=body,
            idempotency_key=str(uuid4()),
        )
        return expect(parsed, TaskActionEnvelope)

    async def refresh_input(self, task: ClaimedTask, asset_id: UUID) -> DownloadGrant:
        parsed = await refresh_worker_task_input_grant.asyncio(
            task.task_id,
            task.attempt_id,
            asset_id,
            client=self._authenticated(),
            body=lease_action(task),
            idempotency_key=asset_key("input", task, asset_id),
        )
        return expect(parsed, DownloadGrantEnvelope).data

    async def request_output(self, task: ClaimedTask, body: OutputGrantRequest) -> UploadGrant:
        parsed = await request_worker_task_output_grant.asyncio(
            task.task_id,
            task.attempt_id,
            client=self._authenticated(),
            body=body,
            idempotency_key=asset_key("output", task, body.slot, body.checksum_sha_256),
        )
        return expect(parsed, UploadGrantEnvelope).data

    async def refresh_output(self, task: ClaimedTask, asset_id: UUID) -> UploadGrant:
        parsed = await refresh_worker_task_output_grant.asyncio(
            task.task_id,
            task.attempt_id,
            asset_id,
            client=self._authenticated(),
            body=lease_action(task),
            idempotency_key=asset_key("refresh", task, asset_id),
        )
        return expect(parsed, UploadGrantEnvelope).data

    async def commit_output(self, task: ClaimedTask, asset_id: UUID, byte_size: str, checksum: str) -> CommittedOutput:
        parsed = await commit_worker_task_output.asyncio(
            task.task_id,
            task.attempt_id,
            asset_id,
            client=self._authenticated(),
            body=CommitOutputRequest(
                lease_id=task.lease_id,
                fencing_token=task.fencing_token,
                byte_size=byte_size,
                checksum_sha_256=checksum,
            ),
            idempotency_key=asset_key("commit", task, asset_id, checksum),
        )
        return expect(parsed, CommittedOutputEnvelope).data

    async def close(self) -> None:
        if self._api_client:
            await self._api_client.get_async_httpx_client().aclose()

    def _authenticated(self) -> AuthenticatedClient:
        if not self._credential:
            raise RuntimeError("worker credential is unavailable")
        if not self._api_client:
            self._api_client = self._make_client(self._credential)
        return self._api_client

    def _make_client(self, token: str) -> AuthenticatedClient:
        return AuthenticatedClient(
            base_url=self._base_url, token=token, timeout=httpx.Timeout(35.0), raise_on_unexpected_status=True
        )


def expect(value: T | ProblemDetails | None, expected: type[T]) -> T:
    if isinstance(value, ProblemDetails):
        raise ControlPlaneError(value)
    if not isinstance(value, expected):
        raise RuntimeError("Control Plane returned an empty or invalid response")
    return value


def lease_action(task: ClaimedTask) -> LeaseActionRequest:
    return LeaseActionRequest(lease_id=task.lease_id, fencing_token=task.fencing_token)


def asset_key(operation: str, task: ClaimedTask, *parts: object) -> str:
    from uuid import NAMESPACE_URL, uuid5

    value = ":".join([operation, str(task.attempt_id), *(str(part) for part in parts)])
    return str(uuid5(NAMESPACE_URL, value))
