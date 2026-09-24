import asyncio
import signal

import structlog

from reup_worker_contract.models.claimed_task import ClaimedTask

from .agent import WorkerAgent
from .control_plane import GeneratedControlPlane
from .credential_store import CredentialStore
from .fake_executor import FakeExecutorConfig, FakeTaskExecutor
from .ports import ExecutionResult, ProgressReporter
from .runtime import build_identity
from .settings import WorkerSettings
from .workspace import WorkspaceLifecycle


class MissingAdapterExecutor:
    async def execute(
        self, task: ClaimedTask, report_progress: ProgressReporter, cancel_requested: asyncio.Event
    ) -> ExecutionResult:
        del task, report_progress, cancel_requested
        raise RuntimeError("No task adapter is registered in the foundation image")


async def run() -> None:
    settings = WorkerSettings()  # type: ignore[call-arg]
    credential_store = CredentialStore(settings.credential_file)
    control_plane = GeneratedControlPlane(str(settings.control_plane_url), credential_store.load())
    agent = WorkerAgent(
        control_plane=control_plane,
        credential_store=credential_store,
        identity=build_identity(settings),
        executor=build_executor(settings),
        enrollment_token=settings.enrollment_token,
        workspace_lifecycle=WorkspaceLifecycle(
            settings.workspace_root,
            success_retention_seconds=settings.success_workspace_retention_seconds,
            failure_retention_seconds=settings.failure_workspace_retention_seconds,
        ),
    )
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, agent.stop)
    await agent.run()


def build_executor(settings: WorkerSettings) -> MissingAdapterExecutor | FakeTaskExecutor:
    if settings.executor == "fake":
        return FakeTaskExecutor(
            FakeExecutorConfig(
                behavior=settings.fake_behavior,  # type: ignore[arg-type]
                step_delay_seconds=settings.fake_step_delay_seconds,
            )
        )
    return MissingAdapterExecutor()


def main() -> None:
    structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
    asyncio.run(run())


if __name__ == "__main__":
    main()
