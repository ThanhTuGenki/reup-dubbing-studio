import asyncio
import contextlib
import time
from datetime import UTC, datetime
from uuid import UUID

import structlog

from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.complete_task_request import CompleteTaskRequest
from reup_worker_contract.models.complete_task_request_result import CompleteTaskRequestResult
from reup_worker_contract.models.fail_task_request import FailTaskRequest
from reup_worker_contract.models.heartbeat import Heartbeat
from reup_worker_contract.models.session_identity import SessionIdentity
from reup_worker_contract.models.task_metrics import TaskMetrics
from reup_worker_contract.models.task_progress_request import TaskProgressRequest
from reup_worker_contract.models.worker_capacity import WorkerCapacity
from reup_worker_contract.models.worker_desired_status import WorkerDesiredStatus
from reup_worker_contract.models.worker_failure_code import WorkerFailureCode
from reup_worker_contract.models.worker_telemetry import WorkerTelemetry
from reup_worker_contract.types import UNSET

from .control_plane import ControlPlaneError, SessionState
from .credential_store import CredentialStore
from .ports import ControlPlane, ExecutionResult, ProgressReporter, TaskExecutionCancelled, TaskExecutor

log = structlog.get_logger()


class TaskCancellationRequested(Exception):
    pass


class WorkerAgent:
    def __init__(
        self,
        control_plane: ControlPlane,
        credential_store: CredentialStore,
        identity: SessionIdentity,
        executor: TaskExecutor,
        enrollment_token: str | None,
    ) -> None:
        self._control_plane = control_plane
        self._credentials = credential_store
        self._identity = identity
        self._executor = executor
        self._enrollment_token = enrollment_token
        self._stopping = asyncio.Event()
        self._cancel_requested = asyncio.Event()
        self._active_task: ClaimedTask | None = None
        self._sequence = 0
        self._desired_status = "ACTIVE"

    def stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        session = await self._open_session()
        session_id = session.session.id
        self._sequence = int(session.session.last_heartbeat_sequence)
        self._desired_status = session.desired_status
        heartbeat = asyncio.create_task(
            self._heartbeat_loop(session_id, session.heartbeat_interval_seconds), name="worker-heartbeat"
        )
        try:
            while not self._stopping.is_set() and self._desired_status == "ACTIVE":
                task, retry_after, desired = await self._control_plane.claim(session_id)
                self._observe_desired_status(desired)
                if task is None:
                    if self._desired_status != "ACTIVE":
                        break
                    await wait_or_stop(self._stopping, max(1, retry_after))
                    continue
                await self._run_task(task)
        finally:
            self._stopping.set()
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat
            await self._control_plane.close()

    async def _open_session(self) -> SessionState:
        credential = self._credentials.load()
        if credential:
            return await self._control_plane.start_session(self._identity)
        if not self._enrollment_token:
            raise RuntimeError("enrollment token is required when no stored credential exists")
        credential, session = await self._control_plane.enroll(self._enrollment_token, self._identity)
        self._credentials.save(credential)
        return session

    async def _heartbeat_loop(self, session_id: UUID, interval: int) -> None:
        while not self._stopping.is_set():
            self._sequence += 1
            active = self._active_task
            try:
                response = await self._control_plane.heartbeat(
                    session_id,
                    Heartbeat(
                        sequence=str(self._sequence),
                        sent_at=datetime.now(UTC),
                        capacity=self._capacity(active is None),
                        current_task_count=int(active is not None),
                        active_lease_ids=[] if active is None else [active.lease_id],
                        telemetry=WorkerTelemetry(),
                        agent_version=self._identity.agent_version,
                        contract_version=self._identity.contract_version,
                    ),
                )
                self._observe_desired_status(response.data.desired_status)
                if active and active.lease_id in response.data.cancel_lease_ids:
                    self._cancel_requested.set()
            except Exception as error:  # heartbeat retries independently of the task lease
                log.warning("heartbeat_failed", error_type=type(error).__name__)
            await wait_or_stop(self._stopping, interval)

    async def _run_task(self, task: ClaimedTask) -> None:
        self._active_task = task
        self._cancel_requested.clear()
        started = time.monotonic()
        renewer: asyncio.Task[None] | None = None
        try:
            action = await self._control_plane.start(task)
            if action.data.cancel_requested:
                return
            renewer = asyncio.create_task(self._renew_loop(task), name=f"lease-{task.lease_id}")
            result = await self._execute_with_lease(task, renewer)
            if self._cancel_requested.is_set():
                return
            await self._complete(task, result, started)
        except TimeoutError:
            await self._safe_fail(task, "PROCESS_TIMEOUT", "Task process exceeded its configured timeout", started)
        except TaskCancellationRequested:
            return
        except TaskExecutionCancelled:
            return
        except asyncio.CancelledError:
            raise
        except ControlPlaneError as error:
            if error.code not in {"STALE_TASK_ATTEMPT", "TASK_CANCELLED", "TASK_LEASE_EXPIRED"}:
                log.error("control_plane_task_error", code=error.code)
        except Exception as error:
            await self._safe_fail(task, "INFERENCE_FAILED", f"Executor failed: {type(error).__name__}", started)
        finally:
            if renewer:
                renewer.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await renewer
            self._active_task = None
            self._cancel_requested.clear()

    async def _renew_loop(self, task: ClaimedTask) -> None:
        while True:
            await asyncio.sleep(task.renew_after_seconds)
            response = await self._control_plane.renew(task)
            if response.data.cancel_requested:
                self._cancel_requested.set()
                return

    async def _execute_with_lease(self, task: ClaimedTask, renewer: asyncio.Task[None]) -> ExecutionResult:
        execution = asyncio.create_task(
            self._executor.execute(task, self._progress_reporter(task), self._cancel_requested),
            name=f"execute-{task.attempt_id}",
        )
        done, _ = await asyncio.wait({execution, renewer}, return_when=asyncio.FIRST_COMPLETED)
        if renewer in done:
            error = renewer.exception()
            execution.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await execution
            if error:
                raise error
            raise TaskCancellationRequested
        return execution.result()

    def _progress_reporter(self, task: ClaimedTask) -> ProgressReporter:
        last = 0

        async def report(progress_bps: int, detail_safe: str | None = None) -> None:
            nonlocal last
            if not 0 <= progress_bps <= 10_000 or progress_bps < last:
                raise ValueError("progress must be monotonic and between 0 and 10000")
            last = progress_bps
            response = await self._control_plane.progress(
                task,
                TaskProgressRequest(
                    lease_id=task.lease_id,
                    fencing_token=task.fencing_token,
                    progress_bps=progress_bps,
                    detail_safe=detail_safe,
                ),
            )
            if response.data.cancel_requested:
                self._cancel_requested.set()

        return report

    async def _complete(self, task: ClaimedTask, result: ExecutionResult, started: float) -> None:
        body_result = CompleteTaskRequestResult()
        body_result.additional_properties.update(result.result)
        if result.metrics.execution_ms is UNSET:
            result.metrics.execution_ms = elapsed_ms(started)
        await self._control_plane.complete(
            task,
            CompleteTaskRequest(
                lease_id=task.lease_id,
                fencing_token=task.fencing_token,
                outputs=result.outputs,
                result=body_result,
                metrics=result.metrics,
            ),
        )

    async def _safe_fail(self, task: ClaimedTask, code: WorkerFailureCode, detail: str, started: float) -> None:
        if self._cancel_requested.is_set():
            return
        try:
            await self._control_plane.fail(
                task,
                FailTaskRequest(
                    lease_id=task.lease_id,
                    fencing_token=task.fencing_token,
                    code=code,
                    detail_safe=detail[:500],
                    metrics=TaskMetrics(execution_ms=elapsed_ms(started)),
                ),
            )
        except ControlPlaneError as error:
            if error.code not in {"STALE_TASK_ATTEMPT", "TASK_CANCELLED", "TASK_LEASE_EXPIRED"}:
                raise

    def _capacity(self, available: bool) -> WorkerCapacity:
        return WorkerCapacity(
            max_concurrent_tasks=1,
            available_task_slots=int(available and self._desired_status == "ACTIVE"),
            scratch_free_bytes=self._identity.capacity.scratch_free_bytes,
            vram_free_mb=self._identity.capacity.vram_free_mb,
        )

    def _observe_desired_status(self, status: WorkerDesiredStatus) -> None:
        if self._desired_status == "ACTIVE" or status == "REVOKED":
            self._desired_status = status


async def wait_or_stop(event: asyncio.Event, seconds: int) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(event.wait(), timeout=seconds)


def elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))
