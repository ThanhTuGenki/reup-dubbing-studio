import asyncio
import hashlib
import json
import os
import sys
import wave
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.initial_tts_task_configuration import InitialTtsTaskConfiguration
from reup_worker_contract.models.regenerate_tts_task_configuration import RegenerateTtsTaskConfiguration
from reup_worker_contract.models.tts_segment import TtsSegment

from .adapters.base import LocalInput, LocalOutput, output_path
from .ports import ProgressReporter


class TtsRuntime(Protocol):
    async def prepare_voice(self, reference: Path, reference_text: str, destination: Path) -> None: ...
    async def synthesize(
        self, text: str, language_id: str, prompt: Path, destination: Path, speed: float, duration: float
    ) -> None: ...
    async def close(self) -> None: ...


@dataclass(frozen=True)
class OmniVoiceProcessConfig:
    model_id: str
    model_revision: str
    audio_tokenizer_id: str
    audio_tokenizer_revision: str
    model_cache_root: Path
    timeout_seconds: int = 300
    max_requests: int = 100
    max_vram_mb: int = 10_500
    command: Sequence[str] | None = None


class OmniVoiceProcess:
    """Serial JSON-lines client for the long-lived, isolated model process."""

    def __init__(self, config: OmniVoiceProcessConfig) -> None:
        self._config = config
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._requests = 0

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process else None

    async def prepare_voice(self, reference: Path, reference_text: str, destination: Path) -> None:
        temporary = destination.with_suffix(".part")
        await self._request(
            {"op": "prepare", "reference": str(reference), "referenceText": reference_text, "output": str(temporary)}
        )
        temporary.chmod(0o600)
        os.replace(temporary, destination)

    async def synthesize(
        self, text: str, language_id: str, prompt: Path, destination: Path, speed: float, duration: float
    ) -> None:
        await self._request(
            {
                "op": "synthesize",
                "text": text,
                "languageId": language_id,
                "prompt": str(prompt),
                "output": str(destination),
                "speed": speed,
                "duration": duration,
            }
        )

    async def close(self) -> None:
        async with self._lock:
            await self._stop()

    async def _request(self, payload: dict[str, object]) -> dict[str, Any]:
        async with self._lock:
            if self._requests >= self._config.max_requests:
                await self._stop()
            process = await self._start()
            if not process.stdin or not process.stdout:
                raise RuntimeError("OmniVoice process pipes are unavailable")
            try:
                process.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode())
                await process.stdin.drain()
                raw = await asyncio.wait_for(process.stdout.readline(), timeout=self._config.timeout_seconds)
                if not raw:
                    raise RuntimeError("OmniVoice process exited without a response")
                response = json.loads(raw)
                if not isinstance(response, dict) or response.get("ok") is not True:
                    raise RuntimeError("OmniVoice inference failed")
                self._requests += 1
                vram = response.get("vramMb", 0)
                if isinstance(vram, (int, float)) and not isinstance(vram, bool) and vram > self._config.max_vram_mb:
                    await self._stop()
                return response
            except BaseException:
                await self._stop()
                raise

    async def _start(self) -> asyncio.subprocess.Process:
        if self._process and self._process.returncode is None:
            return self._process
        command = list(self._config.command or (sys.executable, "-m", "reup_worker.tools.omnivoice_server"))
        self._process = await asyncio.create_subprocess_exec(
            *command,
            "--model-id",
            self._config.model_id,
            "--revision",
            self._config.model_revision,
            "--audio-tokenizer-id",
            self._config.audio_tokenizer_id,
            "--audio-tokenizer-revision",
            self._config.audio_tokenizer_revision,
            "--model-cache-root",
            str(self._config.model_cache_root),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
        self._requests = 0
        return self._process

    async def _stop(self) -> None:
        process, self._process = self._process, None
        self._requests = 0
        if not process or process.returncode is not None:
            return
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=10)
        except TimeoutError:
            process.kill()
            await process.wait()


class VoicePromptCache:
    def __init__(self, root: Path, model_revision: str) -> None:
        self._root = root.resolve()
        self._revision = model_revision

    def path(self, value: LocalInput, voice_profile_id: str, language_id: str) -> Path:
        checksum = value.descriptor.download.checksum_sha_256
        if not checksum:
            raise ValueError("voice input requires a checksum for safe prompt caching")
        key = hashlib.sha256(
            f"{voice_profile_id}\0{language_id}\0{value.descriptor.asset_id}\0{checksum}\0{self._revision}".encode()
        ).hexdigest()
        self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
        result = (self._root / f"{key}.pt").resolve()
        if not result.is_relative_to(self._root):
            raise ValueError("voice prompt cache path escapes its root")
        return result


class OmniVoiceAdapter:
    def __init__(self, runtime: TtsRuntime, cache: VoicePromptCache) -> None:
        self._runtime = runtime
        self._cache = cache

    async def run(
        self,
        task: ClaimedTask,
        inputs: list[LocalInput],
        workspace: Path,
        report_progress: ProgressReporter,
        cancel_requested: asyncio.Event,
    ) -> list[LocalOutput]:
        configuration = task.configuration
        if isinstance(configuration, InitialTtsTaskConfiguration):
            segments = configuration.segments
        elif isinstance(configuration, RegenerateTtsTaskConfiguration):
            segments = [configuration.segment]
        else:
            raise ValueError("TTS task configuration is invalid")
        if task.task_type == "REGENERATE_SEGMENT" and len(segments) != 1:
            raise ValueError("regeneration must contain exactly one segment")
        outputs: list[LocalOutput] = []
        for index, segment in enumerate(segments):
            if cancel_requested.is_set():
                raise asyncio.CancelledError
            voice = voice_input(inputs, segment)
            prompt = await self._prompt(voice, segment)
            target = output_path(workspace, f"{segment.segment_revision_id}.wav")
            await self._runtime.synthesize(
                segment.text,
                segment.language_id,
                prompt,
                target,
                configuration.speed,
                segment.target_duration_ms / 1000,
            )
            validate_wav(target)
            outputs.append(
                LocalOutput(
                    segment.output_slot,
                    target,
                    "audio/wav",
                    {
                        "segmentRevisionId": str(segment.segment_revision_id),
                        "voiceProfileId": str(segment.voice_profile_id),
                        "languageId": segment.language_id,
                        "targetDurationMs": segment.target_duration_ms,
                    },
                )
            )
            await report_progress(2500 + round((index + 1) / len(segments) * 6000), "synthesizing speech")
        return outputs

    async def _prompt(self, voice: LocalInput, segment: TtsSegment) -> Path:
        if voice.descriptor.kind == "VOICE_PROMPT":
            return voice.path
        reference_text = voice.descriptor.metadata.additional_properties.get("referenceText")
        if not isinstance(reference_text, str) or not reference_text.strip():
            raise ValueError("VOICE_SAMPLE metadata requires referenceText")
        destination = self._cache.path(voice, str(segment.voice_profile_id), segment.language_id)
        if not destination.is_file():
            await self._runtime.prepare_voice(voice.path, reference_text, destination)
        return destination


def voice_input(inputs: list[LocalInput], segment: TtsSegment) -> LocalInput:
    matches = []
    for item in inputs:
        if item.descriptor.kind not in {"VOICE_SAMPLE", "VOICE_PROMPT"}:
            continue
        profile = item.descriptor.metadata.additional_properties.get("voiceProfileId")
        language = item.descriptor.metadata.additional_properties.get("languageId")
        if profile == str(segment.voice_profile_id) and (language is None or language == segment.language_id):
            matches.append(item)
    if len(matches) != 1:
        raise ValueError("each TTS segment requires exactly one matching voice input")
    return matches[0]


def validate_wav(path: Path) -> None:
    try:
        with wave.open(str(path), "rb") as audio:
            if audio.getframerate() != 24_000 or audio.getnframes() < 1 or audio.getnchannels() not in {1, 2}:
                raise ValueError("OmniVoice output must be non-empty 24 kHz mono or stereo WAV")
    except (EOFError, wave.Error) as error:
        raise ValueError("OmniVoice output is not a valid WAV") from error
