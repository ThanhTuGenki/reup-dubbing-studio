import asyncio
import shutil
import sys
from pathlib import Path

from reup_worker.ports import ProgressReporter
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.separate_audio_task_configuration import SeparateAudioTaskConfiguration

from .base import LocalInput, LocalOutput, one_input, output_path
from .command import CommandRunner, require_success
from .transcription import output_slot


class DemucsAdapter:
    def __init__(self, runner: CommandRunner, python_executable: str = sys.executable) -> None:
        self._runner = runner
        self._python = python_executable

    async def run(
        self,
        task: ClaimedTask,
        inputs: list[LocalInput],
        workspace: Path,
        report_progress: ProgressReporter,
        cancel_requested: asyncio.Event,
    ) -> list[LocalOutput]:
        del cancel_requested
        if not isinstance(task.configuration, SeparateAudioTaskConfiguration):
            raise ValueError("audio separation task configuration is invalid")
        source = one_input(inputs, "RAW")
        demucs_root = workspace / "demucs"
        await report_progress(3000, "separating background audio")
        result = await self._runner.run(
            str(task.attempt_id),
            [
                self._python,
                "-m",
                "demucs",
                "--two-stems",
                "vocals",
                "-n",
                task.configuration.model_name,
                "-o",
                str(demucs_root),
                str(source.path),
            ],
        )
        require_success(result, "Demucs")
        stem = demucs_root / task.configuration.model_name / source.path.stem / "no_vocals.wav"
        if not stem.is_file():
            raise RuntimeError("Demucs did not produce the background stem")
        target = output_path(workspace, "background.wav")
        shutil.move(stem, target)
        await report_progress(8500, "background audio ready")
        return [LocalOutput(output_slot(task, "BACKGROUND_AUDIO"), target, "audio/wav")]
