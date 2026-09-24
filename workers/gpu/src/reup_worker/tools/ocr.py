import argparse
import json
from pathlib import Path
from typing import Any


def transcribe(input_path: Path, output_path: Path, language: str, frame_interval_ms: int) -> None:
    try:
        import cv2  # type: ignore[import-not-found]
        from paddleocr import PaddleOCR  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError("PaddleOCR and OpenCV are not installed in this Worker image") from error
    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError("OCR could not open the input video")
    ocr = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        lang=paddle_language(language),
    )
    segments: list[dict[str, Any]] = []
    timestamp = 0
    try:
        while True:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp)
            ok, frame = capture.read()
            if not ok:
                break
            lines = extract_lines(ocr.predict(frame))
            text = "\n".join(line[0] for line in lines if line[0].strip()).strip()
            confidence = sum(line[1] for line in lines) / len(lines) if lines else 0.0
            if text and (not segments or segments[-1]["text"] != text):
                segments.append(
                    {
                        "startMs": timestamp,
                        "endMs": timestamp + frame_interval_ms,
                        "text": text,
                        "confidence": round(confidence, 6),
                    }
                )
            elif text and segments:
                segments[-1]["endMs"] = timestamp + frame_interval_ms
            timestamp += frame_interval_ms
    finally:
        capture.release()
    payload = {"version": 1, "source": "OCR", "language": language, "segments": segments}
    output_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def extract_lines(results: Any) -> list[tuple[str, float]]:
    lines: list[tuple[str, float]] = []
    for result in results or []:
        value = result.json if hasattr(result, "json") else result
        if callable(value):
            value = value()
        if isinstance(value, str):
            value = json.loads(value)
        if not isinstance(value, dict):
            continue
        payload = value.get("res", value)
        texts = payload.get("rec_texts", []) if isinstance(payload, dict) else []
        scores = payload.get("rec_scores", []) if isinstance(payload, dict) else []
        lines.extend(
            (str(text), float(scores[index]) if index < len(scores) else 0.0) for index, text in enumerate(texts)
        )
    return lines


def paddle_language(value: str) -> str:
    normalized = value.lower()
    if normalized in {"zh", "zh-cn", "zh-hans"}:
        return "ch"
    return normalized.split("-", maxsplit=1)[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--frame-interval-ms", type=int, required=True)
    args = parser.parse_args()
    transcribe(args.input, args.output, args.language, args.frame_interval_ms)


if __name__ == "__main__":
    main()
