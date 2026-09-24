import asyncio
from pathlib import Path

from reup_worker.ports import ProgressReporter
from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.render_task_configuration import RenderTaskConfiguration

from .base import LocalInput, LocalOutput, one_input, output_path
from .command import CommandRunner, require_success


class FfmpegRenderAdapter:
    def __init__(self, runner: CommandRunner, ffmpeg: str = "ffmpeg") -> None:
        self._runner = runner
        self._ffmpeg = ffmpeg

    async def run(
        self,
        task: ClaimedTask,
        inputs: list[LocalInput],
        workspace: Path,
        report_progress: ProgressReporter,
        cancel_requested: asyncio.Event,
    ) -> list[LocalOutput]:
        del cancel_requested
        if not isinstance(task.configuration, RenderTaskConfiguration):
            raise ValueError("render task configuration is invalid")
        visual = one_input(inputs, "RAW", "DESUBBED")
        background = one_input(inputs, "BACKGROUND_AUDIO")
        dubs = sorted(
            (item for item in inputs if item.descriptor.kind == "DUB_AUDIO"),
            key=lambda item: metadata_int(item, "ordinal", 0),
        )
        if not dubs:
            raise ValueError("render requires at least one DUB_AUDIO input")
        outputs: list[LocalOutput] = []
        for index, variant in enumerate(task.configuration.variants):
            target = output_path(workspace, f"{variant.variant.lower()}.mp4")
            progress = 2500 + round(index / len(task.configuration.variants) * 5000)
            await report_progress(progress, f"rendering {variant.variant}")
            command = self._command(visual.path, background.path, dubs, variant.variant, target)
            start = variant.source_start_ms if isinstance(variant.source_start_ms, int) else 0
            end = variant.source_end_ms if isinstance(variant.source_end_ms, int) else None
            if isinstance(variant.source_start_ms, int):
                command[1:1] = ["-ss", milliseconds(start)]
            if end is not None:
                if end <= start:
                    raise ValueError("render source range is invalid")
                command[-1:-1] = ["-t", milliseconds(end - start)]
            result = await self._runner.run(str(task.attempt_id), command)
            require_success(result, "FFmpeg")
            if not target.is_file() or target.stat().st_size == 0:
                raise RuntimeError("FFmpeg did not produce a render output")
            outputs.append(
                LocalOutput(
                    variant.output_slot,
                    target,
                    "video/mp4",
                    {"variant": variant.variant, "subtitleMode": task.configuration.subtitle_mode},
                )
            )
        await report_progress(8500, "render outputs ready")
        return outputs

    def _command(
        self,
        visual: Path,
        background: Path,
        dubs: list[LocalInput],
        variant: str,
        target: Path,
    ) -> list[str]:
        command = [self._ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(visual), "-i", str(background)]
        for dub in dubs:
            command.extend(["-i", str(dub.path)])
        filters = ["[1:a]aresample=48000,volume=1[background]"]
        mix_inputs = ["[background]"]
        for index, dub in enumerate(dubs, start=2):
            delay = metadata_int(dub, "targetStartMs", 0)
            gain = metadata_number(dub, "gainDb", 0)
            label = f"dub{index}"
            filters.append(f"[{index}:a]aresample=48000,adelay={delay}|{delay},volume={gain}dB[{label}]")
            mix_inputs.append(f"[{label}]")
        filters.append(f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:duration=longest:normalize=0[mix]")
        width, height = (1080, 1920) if variant == "VERTICAL_9X16" else (1920, 1080)
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
        )
        command.extend(
            [
                "-filter_complex",
                ";".join(filters),
                "-map",
                "0:v:0",
                "-map",
                "[mix]",
                "-vf",
                video_filter,
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                "-shortest",
                str(target),
            ]
        )
        return command


def metadata_int(value: LocalInput, key: str, default: int) -> int:
    raw = value.descriptor.metadata.additional_properties.get(key, default)
    if not isinstance(raw, int) or isinstance(raw, bool) or raw < 0:
        raise ValueError(f"DUB_AUDIO metadata {key} must be a non-negative integer")
    return raw


def metadata_number(value: LocalInput, key: str, default: float) -> float:
    raw = value.descriptor.metadata.additional_properties.get(key, default)
    if not isinstance(raw, int | float) or isinstance(raw, bool) or not -60 <= raw <= 24:
        raise ValueError(f"DUB_AUDIO metadata {key} must be between -60 and 24")
    return float(raw)


def milliseconds(value: int) -> str:
    return f"{value / 1000:.3f}"
