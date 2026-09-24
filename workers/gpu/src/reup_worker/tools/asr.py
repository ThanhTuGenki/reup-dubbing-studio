import argparse
import json
import math
from pathlib import Path
from typing import Any


def transcribe(input_path: Path, output_path: Path, language: str, model_size: str) -> None:
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError("faster-whisper is not installed in this Worker image") from error
    model = WhisperModel(model_size, device="cuda", compute_type="float16")
    raw_segments, info = model.transcribe(str(input_path), language=language, vad_filter=True)
    segments: list[dict[str, Any]] = []
    for item in raw_segments:
        text = item.text.strip()
        if not text:
            continue
        segments.append(
            {
                "startMs": max(0, round(item.start * 1000)),
                "endMs": max(1, round(item.end * 1000)),
                "text": text,
                "confidence": round(min(1.0, max(0.0, math.exp(item.avg_logprob))), 6),
            }
        )
    payload = {"version": 1, "source": "ASR", "language": info.language, "segments": segments}
    output_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    transcribe(args.input, args.output, args.language, args.model)


if __name__ == "__main__":
    main()
