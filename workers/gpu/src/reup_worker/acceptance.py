import argparse
import asyncio
import json
import os
import platform
import shutil
import statistics
import subprocess
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .tts import OmniVoiceProcess, OmniVoiceProcessConfig, validate_wav

MODEL_ID = "k2-fsa/OmniVoice"
MODEL_REVISION = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
TOKENIZER_ID = "eustlb/higgs-audio-v2-tokenizer"
TOKENIZER_REVISION = "528e871c2a26c4f0f7773b9754e2e1acae20899d"


def percentile(values: Sequence[float], percent: float) -> float:
    if not values:
        raise ValueError("percentile requires at least one value")
    ordered = sorted(values)
    position = (len(ordered) - 1) * percent
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def gpu_inventory() -> list[dict[str, str]]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return []
    query = "index,name,uuid,memory.total,driver_version"
    result = subprocess.run(  # noqa: S603
        [executable, f"--query-gpu={query}", "--format=csv,noheader,nounits"],
        check=True,
        capture_output=True,
        text=True,
    )
    keys = ("index", "name", "uuid", "memoryTotalMiB", "driverVersion")
    return [
        dict(zip(keys, (part.strip() for part in line.split(",")), strict=True)) for line in result.stdout.splitlines()
    ]


async def sample_peak_vram(stop: asyncio.Event, interval_seconds: float = 0.25) -> int | None:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return None
    peak = 0
    while not stop.is_set():
        process = await asyncio.create_subprocess_exec(
            executable,
            "--query-gpu=memory.used",
            "--format=csv,noheader,nounits",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await process.communicate()
        if process.returncode == 0:
            for value in stdout.decode().splitlines():
                try:
                    peak = max(peak, int(value.strip()))
                except ValueError:
                    continue
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except TimeoutError:
            pass
    return peak


def base_report(kind: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": kind,
        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "host": {"platform": platform.platform(), "python": platform.python_version(), "gpus": gpu_inventory()},
        "imageDigest": os.environ.get("REUP_WORKER_IMAGE_DIGEST"),
        "contractVersion": os.environ.get("REUP_WORKER_CONTRACT_VERSION"),
    }


def timing_summary(latencies: Sequence[float]) -> dict[str, float | int]:
    return {
        "requests": len(latencies),
        "minimumSeconds": round(min(latencies), 6),
        "meanSeconds": round(statistics.fmean(latencies), 6),
        "p50Seconds": round(percentile(latencies, 0.50), 6),
        "p95Seconds": round(percentile(latencies, 0.95), 6),
        "maximumSeconds": round(max(latencies), 6),
    }


async def benchmark_command(
    command: Sequence[str], iterations: int, warmups: int, label: str = "benchmark"
) -> dict[str, Any]:
    if not command:
        raise ValueError("benchmark command is required")
    stop = asyncio.Event()
    sampler = asyncio.create_task(sample_peak_vram(stop))
    latencies: list[float] = []
    try:
        for index in range(warmups + iterations):
            started = time.perf_counter()
            process = await asyncio.create_subprocess_exec(*command)
            return_code = await process.wait()
            elapsed = time.perf_counter() - started
            if return_code != 0:
                raise RuntimeError(f"acceptance command exited with status {return_code}")
            if index >= warmups:
                latencies.append(elapsed)
    finally:
        stop.set()
    peak = await sampler
    report = base_report("command")
    report.update(
        {
            "commandLabel": label,
            "commandExecutable": Path(command[0]).name,
            "warmups": warmups,
            "timing": timing_summary(latencies),
            "peakVramMiB": peak,
        }
    )
    return report


async def benchmark_tts(arguments: argparse.Namespace) -> dict[str, Any]:
    output_root = arguments.output_dir.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    runtime = OmniVoiceProcess(
        OmniVoiceProcessConfig(
            model_id=MODEL_ID,
            model_revision=MODEL_REVISION,
            audio_tokenizer_id=TOKENIZER_ID,
            audio_tokenizer_revision=TOKENIZER_REVISION,
            model_cache_root=arguments.model_cache.resolve(),
            timeout_seconds=arguments.timeout_seconds,
            max_requests=arguments.restart_after,
            max_vram_mb=arguments.restart_vram_mib,
        )
    )
    stop = asyncio.Event()
    sampler = asyncio.create_task(sample_peak_vram(stop))
    prompt = output_root / "voice-prompt.pt"
    latencies: list[float] = []
    process_ids: list[int | None] = []
    try:
        await runtime.prepare_voice(arguments.reference.resolve(), arguments.reference_text, prompt)
        for index in range(arguments.requests):
            destination = output_root / f"request-{index + 1:03d}.wav"
            started = time.perf_counter()
            await runtime.synthesize(
                arguments.text,
                arguments.language,
                prompt,
                destination,
                arguments.speed,
                arguments.duration_seconds,
            )
            latencies.append(time.perf_counter() - started)
            process_ids.append(runtime.pid)
            validate_wav(destination)
    finally:
        try:
            await runtime.close()
        finally:
            stop.set()
    peak = await sampler
    report = base_report("omnivoice")
    report.update(
        {
            "model": {"id": MODEL_ID, "revision": MODEL_REVISION},
            "audioTokenizer": {"id": TOKENIZER_ID, "revision": TOKENIZER_REVISION},
            "timing": timing_summary(latencies),
            "peakVramMiB": peak,
            "restartAfterRequests": arguments.restart_after,
            "observedProcessStarts": len({value for value in process_ids if value is not None}),
            "outputDirectory": str(output_root),
        }
    )
    return report


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Record reproducible NVIDIA Worker acceptance evidence")
    subparsers = root.add_subparsers(dest="operation", required=True)
    inventory = subparsers.add_parser("inventory")
    inventory.add_argument("--output", type=Path, required=True)
    command = subparsers.add_parser("command")
    command.add_argument("--output", type=Path, required=True)
    command.add_argument("--iterations", type=int, default=1)
    command.add_argument("--warmups", type=int, default=0)
    command.add_argument("--label", default="benchmark")
    command.add_argument("argv", nargs=argparse.REMAINDER)
    tts = subparsers.add_parser("tts")
    tts.add_argument("--output", type=Path, required=True)
    tts.add_argument("--output-dir", type=Path, required=True)
    tts.add_argument("--reference", type=Path, required=True)
    tts.add_argument("--reference-text", required=True)
    tts.add_argument("--text", required=True)
    tts.add_argument("--language", default="vi")
    tts.add_argument("--requests", type=int, default=101)
    tts.add_argument("--restart-after", type=int, default=100)
    tts.add_argument("--restart-vram-mib", type=int, default=10500)
    tts.add_argument("--timeout-seconds", type=int, default=300)
    tts.add_argument("--duration-seconds", type=float, default=3.0)
    tts.add_argument("--speed", type=float, default=1.0)
    tts.add_argument("--model-cache", type=Path, default=Path("/var/lib/reup-worker/models"))
    return root


async def run(arguments: argparse.Namespace) -> dict[str, Any]:
    if arguments.operation == "inventory":
        return base_report("inventory")
    if arguments.operation == "command":
        if arguments.iterations < 1 or arguments.warmups < 0:
            raise ValueError("iterations must be positive and warmups non-negative")
        command = arguments.argv[1:] if arguments.argv[:1] == ["--"] else arguments.argv
        return await benchmark_command(command, arguments.iterations, arguments.warmups, arguments.label)
    if arguments.requests < 100:
        raise ValueError("OmniVoice acceptance requires at least 100 requests")
    return await benchmark_tts(arguments)


def main() -> None:
    arguments = parser().parse_args()
    report = asyncio.run(run(arguments))
    write_report(arguments.output, report)
    print(arguments.output)


if __name__ == "__main__":
    main()
