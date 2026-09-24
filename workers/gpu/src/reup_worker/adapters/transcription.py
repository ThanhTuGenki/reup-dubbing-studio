import asyncio
import json
import sys
from pathlib import Path

from reup_worker.ports import ProgressReporter
from reup_worker_contract.models.asr_task_configuration import AsrTaskConfiguration
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.ocr_task_configuration import OcrTaskConfiguration

from .base import LocalInput, LocalOutput, one_input, output_path
from .command import CommandRunner, require_success


class AsrAdapter:
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
        if not isinstance(task.configuration, AsrTaskConfiguration):
            raise ValueError("ASR task configuration is invalid")
        source = one_input(inputs, "RAW")
        target = output_path(workspace, "asr.json")
        await report_progress(3000, "transcribing audio")
        result = await self._runner.run(
            str(task.attempt_id),
            [
                self._python,
                "-m",
                "reup_worker.tools.asr",
                "--input",
                str(source.path),
                "--output",
                str(target),
                "--language",
                task.configuration.language,
                "--model",
                task.configuration.model_size,
            ],
        )
        require_success(result, "ASR")
        validate_transcript(target, "ASR")
        await report_progress(8500, "ASR transcript ready")
        return [LocalOutput(output_slot(task, "ASR_JSON"), target, "application/json", {"schemaVersion": 1})]


class OcrAdapter:
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
        if not isinstance(task.configuration, OcrTaskConfiguration):
            raise ValueError("OCR task configuration is invalid")
        source = one_input(inputs, "RAW")
        target = output_path(workspace, "ocr.json")
        await report_progress(3000, "extracting subtitle frames")
        result = await self._runner.run(
            str(task.attempt_id),
            [
                self._python,
                "-m",
                "reup_worker.tools.ocr",
                "--input",
                str(source.path),
                "--output",
                str(target),
                "--language",
                task.configuration.language,
                "--frame-interval-ms",
                str(task.configuration.frame_interval_ms),
            ],
        )
        require_success(result, "OCR")
        validate_transcript(target, "OCR")
        await report_progress(8500, "OCR transcript ready")
        return [LocalOutput(output_slot(task, "OCR_JSON"), target, "application/json", {"schemaVersion": 1})]


def validate_transcript(path: Path, source: str) -> None:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("version") != 1 or value.get("source") != source or not isinstance(value.get("segments"), list):
        raise ValueError(f"{source} output does not follow normalized transcript schema v1")
    last_end = 0
    for segment in value["segments"]:
        if not isinstance(segment, dict):
            raise ValueError("transcript segment is invalid")
        start = segment.get("startMs")
        end = segment.get("endMs")
        text = segment.get("text")
        if not isinstance(start, int) or not isinstance(end, int) or start < last_end or end <= start:
            raise ValueError("transcript timestamps are invalid")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("transcript text is invalid")
        last_end = end


def output_slot(task: ClaimedTask, kind: str) -> str:
    matches = [item.slot for item in task.outputs if item.kind == kind]
    if len(matches) != 1:
        raise ValueError(f"task must declare exactly one {kind} output")
    return matches[0]
