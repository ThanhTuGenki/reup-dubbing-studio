import asyncio
import signal

import structlog

from reup_worker_contract.models.claimed_task import ClaimedTask

from .adapters.base import MediaAdapter
from .adapters.render import FfmpegRenderAdapter
from .adapters.separation import DemucsAdapter
from .adapters.transcription import AsrAdapter, OcrAdapter
from .agent import WorkerAgent
from .assets import AssetTransfer
from .batch_executor import BatchMediaExecutor
from .control_plane import GeneratedControlPlane
from .credential_store import CredentialStore
from .fake_executor import FakeExecutorConfig, FakeTaskExecutor
from .ports import ExecutionResult, ProgressReporter
from .process import IsolatedProcessRunner
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
        executor=build_executor(settings, control_plane),
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


def build_executor(
    settings: WorkerSettings, control_plane: GeneratedControlPlane
) -> MissingAdapterExecutor | FakeTaskExecutor | BatchMediaExecutor:
    if settings.executor == "fake":
        return FakeTaskExecutor(
            FakeExecutorConfig(
                behavior=settings.fake_behavior,  # type: ignore[arg-type]
                step_delay_seconds=settings.fake_step_delay_seconds,
            )
        )
    if settings.executor == "batch":
        if settings.role != "BATCH_MEDIA":
            raise ValueError("batch executor requires the BATCH_MEDIA role")
        runner = IsolatedProcessRunner(settings.workspace_root, settings.task_timeout_seconds)
        assets = AssetTransfer(
            control_plane,
            settings.workspace_root,
            max_input_bytes=settings.max_input_bytes,
            allow_http=settings.allow_http_asset_urls,
        )
        return BatchMediaExecutor(
            settings.workspace_root,
            assets,
            batch_adapters(runner),
        )
    return MissingAdapterExecutor()


def batch_adapters(runner: IsolatedProcessRunner) -> dict[str, MediaAdapter]:
    return {
        "TRANSCRIBE_ASR": AsrAdapter(runner),
        "TRANSCRIBE_OCR": OcrAdapter(runner),
        "SEPARATE_AUDIO": DemucsAdapter(runner),
        "RENDER": FfmpegRenderAdapter(runner),
    }


def main() -> None:
    structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
    asyncio.run(run())


if __name__ == "__main__":
    main()
