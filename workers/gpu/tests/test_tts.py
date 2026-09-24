import asyncio
import struct
import sys
import wave
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from reup_worker.adapters.base import LocalInput
from reup_worker.main import build_executor
from reup_worker.settings import WorkerSettings
from reup_worker.tts import OmniVoiceAdapter, OmniVoiceProcess, OmniVoiceProcessConfig, VoicePromptCache
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.task_input_asset import TaskInputAsset

ATTEMPT = "0191f3d2-7f5b-7abc-8b2e-123456789b03"
PROFILE = "0191f3d2-7f5b-7abc-8b2e-123456789b05"
SEGMENT = "0191f3d2-7f5b-7abc-8b2e-123456789b06"


class FakeRuntime:
    def __init__(self) -> None:
        self.prepared = 0
        self.synthesized: list[dict[str, object]] = []

    async def prepare_voice(self, reference: Path, reference_text: str, destination: Path) -> None:
        assert reference.read_bytes() == b"sample"
        assert reference_text == "reference transcript"
        self.prepared += 1
        destination.write_bytes(b"prompt")

    async def synthesize(
        self, text: str, language_id: str, prompt: Path, destination: Path, speed: float, duration: float
    ) -> None:
        self.synthesized.append(
            {"text": text, "language": language_id, "prompt": prompt, "speed": speed, "duration": duration}
        )
        write_wav(destination)

    async def close(self) -> None:
        pass


async def progress(value: int, detail: str | None) -> None:
    assert 0 <= value <= 10_000
    assert detail


@pytest.mark.parametrize("task_type", ["GENERATE_INITIAL_TTS", "REGENERATE_SEGMENT"])
async def test_tts_adapter_prepares_cached_prompt_and_writes_wav(tmp_path: Path, task_type: str) -> None:
    workspace = tmp_path / ATTEMPT
    (workspace / "inputs").mkdir(parents=True)
    (workspace / "outputs").mkdir()
    source = workspace / "inputs" / "voice.wav"
    source.write_bytes(b"sample")
    runtime = FakeRuntime()
    adapter = OmniVoiceAdapter(runtime, VoicePromptCache(tmp_path / "cache", "model-revision"))
    task = tts_task(task_type)
    local = LocalInput(voice_asset("VOICE_SAMPLE"), source)

    first = await adapter.run(task, [local], workspace, progress, asyncio.Event())
    second = await adapter.run(task, [local], workspace, progress, asyncio.Event())

    assert runtime.prepared == 1
    assert runtime.synthesized[0]["duration"] == 1.25
    assert first[0].slot == "dub-1"
    assert first[0].metadata["segmentRevisionId"] == SEGMENT
    assert second[0].path.read_bytes()[:4] == b"RIFF"


async def test_tts_adapter_reuses_downloaded_voice_prompt(tmp_path: Path) -> None:
    workspace = tmp_path / ATTEMPT
    (workspace / "outputs").mkdir(parents=True)
    prompt = workspace / "prompt.pt"
    prompt.write_bytes(b"prompt")
    runtime = FakeRuntime()
    await OmniVoiceAdapter(runtime, VoicePromptCache(tmp_path / "cache", "revision")).run(
        tts_task("REGENERATE_SEGMENT"),
        [LocalInput(voice_asset("VOICE_PROMPT"), prompt)],
        workspace,
        progress,
        asyncio.Event(),
    )
    assert runtime.prepared == 0
    assert runtime.synthesized[0]["prompt"] == prompt


def test_voice_prompt_cache_changes_with_checksum_and_revision(tmp_path: Path) -> None:
    first = LocalInput(voice_asset("VOICE_SAMPLE"), tmp_path / "one")
    second = LocalInput(voice_asset("VOICE_SAMPLE", checksum="b" * 64), tmp_path / "two")
    one = VoicePromptCache(tmp_path / "cache", "r1").path(first, PROFILE, "vi")
    two = VoicePromptCache(tmp_path / "cache", "r1").path(second, PROFILE, "vi")
    three = VoicePromptCache(tmp_path / "cache", "r2").path(first, PROFILE, "vi")
    assert len({one, two, three}) == 3


def test_commercial_mode_blocks_cc_by_nc_weights(tmp_path: Path) -> None:
    settings = WorkerSettings(
        role="INTERACTIVE_TTS",
        image_digest="sha256:" + "a" * 64,
        capabilities=("tts.omnivoice.v1",),
        executor="interactive-tts",
        tts_usage_mode="production-commercial",
        tts_model_license="CC_BY_NC",
        workspace_root=tmp_path,
    )
    with pytest.raises(ValueError, match="blocked for commercial production"):
        build_executor(settings, object())  # type: ignore[arg-type]


async def test_warm_process_restarts_after_request_limit(tmp_path: Path) -> None:
    script = tmp_path / "fake_server.py"
    script.write_text(
        "import argparse,json,sys\n"
        "p=argparse.ArgumentParser();"
        "[p.add_argument(x) for x in ['--model-id','--revision','--audio-tokenizer-id',"
        "'--audio-tokenizer-revision','--model-cache-root']];p.parse_args()\n"
        "for line in sys.stdin:\n"
        " r=json.loads(line); open(r['output'],'wb').write(b'x'); "
        "print(json.dumps({'ok':True,'vramMb':1}),flush=True)\n"
    )
    runtime = OmniVoiceProcess(process_config(tmp_path, script, max_requests=1))
    reference = tmp_path / "reference.wav"
    reference.touch()
    await runtime.prepare_voice(reference, "text", tmp_path / "one.pt")
    first_pid = runtime.pid
    await runtime.prepare_voice(reference, "text", tmp_path / "two.pt")
    second_pid = runtime.pid
    await runtime.close()
    assert first_pid != second_pid


@pytest.mark.parametrize(("response", "raises"), [({"ok": True, "vramMb": 99}, False), ({"ok": False}, True)])
async def test_warm_process_restarts_after_vram_threshold_or_error(
    tmp_path: Path, response: dict[str, object], raises: bool
) -> None:
    script = tmp_path / "fake_server.py"
    script.write_text(
        "import argparse,json,sys\n"
        "p=argparse.ArgumentParser();"
        "[p.add_argument(x) for x in ['--model-id','--revision','--audio-tokenizer-id',"
        "'--audio-tokenizer-revision','--model-cache-root']];p.parse_args()\n"
        "for line in sys.stdin:\n"
        f" r=json.loads(line); open(r['output'],'wb').write(b'x'); print({json_repr(response)},flush=True)\n"
    )
    runtime = OmniVoiceProcess(process_config(tmp_path, script, max_vram_mb=10))
    reference = tmp_path / "reference.wav"
    reference.touch()
    if raises:
        with pytest.raises(RuntimeError, match="inference failed"):
            await runtime.prepare_voice(reference, "text", tmp_path / "prompt.pt")
    else:
        await runtime.prepare_voice(reference, "text", tmp_path / "prompt.pt")
    assert runtime.pid is None


def json_repr(value: dict[str, object]) -> str:
    return f"json.dumps({value!r})"


def process_config(tmp_path: Path, script: Path, **overrides: object) -> OmniVoiceProcessConfig:
    values: dict[str, object] = {
        "model_id": "model",
        "model_revision": "a" * 40,
        "audio_tokenizer_id": "tokenizer",
        "audio_tokenizer_revision": "b" * 40,
        "model_cache_root": tmp_path / "models",
        "command": (sys.executable, str(script)),
    }
    values.update(overrides)
    return OmniVoiceProcessConfig(**values)  # type: ignore[arg-type]


def write_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24_000)
        output.writeframes(struct.pack("<h", 0) * 240)


def voice_asset(kind: str, checksum: str = "a" * 64) -> TaskInputAsset:
    return TaskInputAsset.from_dict(
        {
            "slot": "voice",
            "kind": kind,
            "assetId": "0191f3d2-7f5b-7abc-8b2e-123456789b09",
            "metadata": {"voiceProfileId": PROFILE, "languageId": "vi", "referenceText": "reference transcript"},
            "download": {
                "assetId": "0191f3d2-7f5b-7abc-8b2e-123456789b09",
                "method": "GET",
                "url": "https://s3.test/input",
                "headers": {},
                "expiresAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
                "fileName": "voice.wav",
                "contentType": "audio/wav",
                "byteSize": "1",
                "checksumSha256": checksum,
            },
        }
    )


def tts_task(task_type: str) -> ClaimedTask:
    segment = {
        "segmentRevisionId": SEGMENT,
        "text": "Xin chào",
        "languageId": "vi",
        "voiceProfileId": PROFILE,
        "targetDurationMs": 1250,
        "outputSlot": "dub-1",
    }
    configuration = (
        {"kind": "GENERATE_INITIAL_TTS", "speed": 1.0, "timingPolicy": "FIT_SEGMENT", "segments": [segment]}
        if task_type == "GENERATE_INITIAL_TTS"
        else {"kind": "REGENERATE_SEGMENT", "speed": 1.0, "timingPolicy": "FIT_SEGMENT", "segment": segment}
    )
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
            "requirements": {"resourceClass": "GPU_TTS_INTERACTIVE", "requiredCapabilities": ["tts.omnivoice.v1"]},
            "configuration": configuration,
            "inputs": [],
            "outputs": [
                {
                    "slot": "dub-1",
                    "kind": "DUB_AUDIO",
                    "minItems": 1,
                    "maxItems": 1,
                    "allowedContentTypes": ["audio/wav"],
                    "maxByteSize": "10000000",
                }
            ],
        }
    )
