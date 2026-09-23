import asyncio
import signal

import structlog
from reup_worker_contract.models.claimed_task import ClaimedTask

from .agent import WorkerAgent
from .control_plane import GeneratedControlPlane
from .credential_store import CredentialStore
from .ports import ExecutionResult, ProgressReporter
from .runtime import build_identity
from .settings import WorkerSettings


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
        executor=MissingAdapterExecutor(),
        enrollment_token=settings.enrollment_token,
    )
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, agent.stop)
    await agent.run()


def main() -> None:
    structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
    asyncio.run(run())


if __name__ == "__main__":
    main()
