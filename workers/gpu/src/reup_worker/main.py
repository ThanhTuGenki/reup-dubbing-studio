import asyncio
import signal

import structlog

from reup_worker_contract.models.claimed_task import ClaimedTask

from .adapters.base import MediaAdapter
from .adapters.render import FfmpegRenderAdapter
from .adapters.separation import DemucsAdapter
from .adapters.transcription import AsrAdapter
from .agent import WorkerAgent
from .assets import AssetTransfer
from .batch_executor import BatchMediaExecutor, InteractiveTtsExecutor
from .control_plane import GeneratedControlPlane
from .credential_store import CredentialStore
from .fake_executor import FakeExecutorConfig, FakeTaskExecutor
from .ports import ExecutionResult, ProgressReporter
from .process import IsolatedProcessRunner
from .runtime import build_identity
from .settings import WorkerSettings
from .tts import OmniVoiceAdapter, OmniVoiceProcess, OmniVoiceProcessConfig, VoicePromptCache
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
) -> MissingAdapterExecutor | FakeTaskExecutor | BatchMediaExecutor | InteractiveTtsExecutor:
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
            batch_adapters(runner, settings),
        )
    if settings.executor == "interactive-tts":
        if settings.role != "INTERACTIVE_TTS":
            raise ValueError("interactive TTS executor requires the INTERACTIVE_TTS role")
        if settings.tts_usage_mode == "production-commercial" and settings.tts_model_license == "CC_BY_NC":
            raise ValueError("CC-BY-NC OmniVoice weights are blocked for commercial production")
        runtime = OmniVoiceProcess(
            OmniVoiceProcessConfig(
                model_id=settings.tts_model_id,
                model_revision=settings.tts_model_revision,
                audio_tokenizer_id=settings.tts_audio_tokenizer_id,
                audio_tokenizer_revision=settings.tts_audio_tokenizer_revision,
                model_cache_root=settings.tts_model_cache_root,
                timeout_seconds=settings.tts_request_timeout_seconds,
                max_requests=settings.tts_max_requests_before_restart,
                max_vram_mb=settings.tts_max_vram_mb_before_restart,
            )
        )
        assets = AssetTransfer(
            control_plane,
            settings.workspace_root,
            max_input_bytes=settings.max_input_bytes,
            allow_http=settings.allow_http_asset_urls,
        )
        adapter = OmniVoiceAdapter(
            runtime,
            VoicePromptCache(settings.tts_prompt_cache_root, settings.tts_model_revision),
        )
        return InteractiveTtsExecutor(settings.workspace_root, assets, adapter, runtime)
    return MissingAdapterExecutor()


def batch_adapters(runner: IsolatedProcessRunner, settings: WorkerSettings | None = None) -> dict[str, MediaAdapter]:
    return {
        "TRANSCRIBE_ASR": AsrAdapter(runner, settings.asr_python if settings else "python"),
        "SEPARATE_AUDIO": DemucsAdapter(runner, settings.demucs_python if settings else "python"),
        "RENDER": FfmpegRenderAdapter(runner),
    }


def main() -> None:
    structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()])
    asyncio.run(run())


if __name__ == "__main__":
    main()
