import asyncio
import json
import shutil
import subprocess
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from reup_worker.adapters.base import LocalInput
from reup_worker.adapters.render import FfmpegRenderAdapter
from reup_worker.adapters.separation import DemucsAdapter
from reup_worker.adapters.transcription import AsrAdapter
from reup_worker.main import batch_adapters
from reup_worker.process import IsolatedProcessRunner, ProcessResult
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.task_input_asset import TaskInputAsset

ATTEMPT = "0191f3d2-7f5b-7abc-8b2e-123456789b03"


class FakeRunner:
    def __init__(self, behavior: str) -> None:
        self.behavior = behavior
        self.commands: list[list[str]] = []

    async def run(self, attempt_id: str, command: Sequence[str]) -> ProcessResult:
        assert attempt_id == ATTEMPT
        value = list(command)
        self.commands.append(value)
        if self.behavior == "asr":
            target = Path(value[value.index("--output") + 1])
            source = self.behavior.upper()
            target.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "source": source,
                        "language": "zh",
                        "segments": [{"startMs": 0, "endMs": 500, "text": "你好", "confidence": 0.9}],
                    }
                )
            )
        elif self.behavior == "demucs":
            root = Path(value[value.index("-o") + 1])
            model = value[value.index("-n") + 1]
            source = Path(value[-1])
            stem = root / model / source.stem / "no_vocals.wav"
            stem.parent.mkdir(parents=True)
            stem.write_bytes(b"wave")
        elif self.behavior == "render":
            Path(value[-1]).write_bytes(b"mp4")
        return ProcessResult(0, "", "")


async def progress(value: int, detail: str | None) -> None:
    assert 0 <= value <= 10_000
    assert detail


async def test_asr_adapter_writes_normalized_timestamps(tmp_path: Path) -> None:
    workspace = create_workspace(tmp_path)
    source = workspace / "inputs" / "source.mp4"
    source.write_bytes(b"video")
    runner = FakeRunner("asr")
    task = media_task("TRANSCRIBE_ASR")
    adapter = AsrAdapter(runner)

    outputs = await adapter.run(task, [LocalInput(input_asset("RAW"), source)], workspace, progress, asyncio.Event())

    assert outputs[0].slot == "transcript"
    assert task.outputs[0].kind == "ASR_JSON"
    assert json.loads(outputs[0].path.read_text())["segments"][0]["startMs"] == 0


async def test_demucs_adapter_collects_background_stem(tmp_path: Path) -> None:
    workspace = create_workspace(tmp_path)
    source = workspace / "inputs" / "source.mp4"
    source.write_bytes(b"video")

    outputs = await DemucsAdapter(FakeRunner("demucs")).run(
        media_task("SEPARATE_AUDIO"),
        [LocalInput(input_asset("RAW"), source)],
        workspace,
        progress,
        asyncio.Event(),
    )

    assert outputs[0].path.read_bytes() == b"wave"
    assert outputs[0].content_type == "audio/wav"


async def test_render_builds_external_subtitle_ffmpeg_command(tmp_path: Path) -> None:
    workspace = create_workspace(tmp_path)
    runner = FakeRunner("render")
    inputs = render_inputs(workspace)

    outputs = await FfmpegRenderAdapter(runner).run(media_task("RENDER"), inputs, workspace, progress, asyncio.Event())

    command = runner.commands[0]
    assert "subtitles=" not in " ".join(command)
    assert "amix=inputs=2" in command[command.index("-filter_complex") + 1]
    assert "scale=1920:1080" in command[command.index("-vf") + 1]
    assert outputs[0].metadata["subtitleMode"] == "EXTERNAL_ONLY"


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is not installed")
async def test_ffmpeg_adapter_renders_a_short_local_fixture(tmp_path: Path) -> None:
    workspace = create_workspace(tmp_path)
    inputs = render_inputs(workspace)
    visual, background, dub = (item.path for item in inputs)
    run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x180:d=0.25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.25",
            "-shortest",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            str(visual),
        ]
    )
    run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=0.25", str(background)])
    run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:duration=0.20", str(dub)])
    runner = IsolatedProcessRunner(tmp_path, 30)

    outputs = await FfmpegRenderAdapter(runner).run(media_task("RENDER"), inputs, workspace, progress, asyncio.Event())

    assert outputs[0].path.stat().st_size > 0


def create_workspace(root: Path) -> Path:
    workspace = root / ATTEMPT
    (workspace / "inputs").mkdir(parents=True)
    (workspace / "outputs").mkdir()
    return workspace


def render_inputs(workspace: Path) -> list[LocalInput]:
    visual = workspace / "inputs" / "visual.mp4"
    background = workspace / "inputs" / "background.wav"
    dub = workspace / "inputs" / "dub.wav"
    for path in (visual, background, dub):
        path.touch()
    return [
        LocalInput(input_asset("RAW"), visual),
        LocalInput(input_asset("BACKGROUND_AUDIO"), background),
        LocalInput(input_asset("DUB_AUDIO", {"ordinal": 1, "targetStartMs": 25, "gainDb": -2}), dub),
    ]


def input_asset(kind: str, metadata: dict[str, object] | None = None) -> TaskInputAsset:
    return TaskInputAsset.from_dict(
        {
            "slot": kind.lower(),
            "kind": kind,
            "assetId": "0191f3d2-7f5b-7abc-8b2e-123456789b09",
            "metadata": metadata or {},
            "download": {
                "assetId": "0191f3d2-7f5b-7abc-8b2e-123456789b09",
                "method": "GET",
                "url": "https://s3.test/input",
                "headers": {},
                "expiresAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
                "fileName": "input.bin",
                "contentType": "application/octet-stream",
                "byteSize": "1",
                "checksumSha256": None,
            },
        }
    )


def media_task(task_type: str) -> ClaimedTask:
    configurations = {
        "TRANSCRIBE_ASR": {"kind": "TRANSCRIBE_ASR", "language": "zh", "modelSize": "small"},
        "SEPARATE_AUDIO": {"kind": "SEPARATE_AUDIO", "modelName": "htdemucs"},
        "RENDER": {
            "kind": "RENDER",
            "subtitleMode": "EXTERNAL_ONLY",
            "variants": [{"variant": "FULL_16X9", "outputSlot": "video"}],
        },
    }
    output_kinds = {
        "TRANSCRIBE_ASR": "ASR_JSON",
        "SEPARATE_AUDIO": "BACKGROUND_AUDIO",
        "RENDER": "OUTPUT_VIDEO",
    }
    content_types = {
        "TRANSCRIBE_ASR": "application/json",
        "SEPARATE_AUDIO": "audio/wav",
        "RENDER": "video/mp4",
    }
    slot = "transcript" if "TRANSCRIBE" in task_type else "background" if task_type == "SEPARATE_AUDIO" else "video"
    return ClaimedTask.from_dict(
        {
            "taskId": "0191f3d2-7f5b-7abc-8b2e-123456789b02",
            "attemptId": ATTEMPT,
            "leaseId": "0191f3d2-7f5b-7abc-8b2e-123456789b04",
            "fencingToken": "1",
            "taskType": task_type,
            "payloadVersion": 1,
            "leaseExpiresAt": "2026-09-24T12:00:00Z",
            "renewAfterSeconds": 20,
            "requirements": {"resourceClass": "GPU_BATCH", "requiredCapabilities": ["test.v1"]},
            "configuration": configurations[task_type],
            "inputs": [],
            "outputs": [
                {
                    "slot": slot,
                    "kind": output_kinds[task_type],
                    "minItems": 1,
                    "maxItems": 1,
                    "allowedContentTypes": [content_types[task_type]],
                    "maxByteSize": "10000000",
                }
            ],
        }
    )


def run_ffmpeg(arguments: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments], check=True)  # noqa: S603,S607


def test_batch_capabilities_only_include_supported_media_adapters(tmp_path: Path) -> None:
    adapters = batch_adapters(IsolatedProcessRunner(tmp_path, 10))

    assert "DESUB" not in adapters
    assert set(adapters) == {"TRANSCRIBE_ASR", "SEPARATE_AUDIO", "RENDER"}
