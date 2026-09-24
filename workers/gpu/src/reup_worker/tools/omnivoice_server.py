import argparse
import contextlib
import json
import os
import sys
from pathlib import Path
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--audio-tokenizer-id", required=True)
    parser.add_argument("--audio-tokenizer-revision", required=True)
    parser.add_argument("--model-cache-root", required=True)
    arguments = parser.parse_args()
    with contextlib.redirect_stdout(sys.stderr):
        import soundfile as sf  # type: ignore[import-not-found]
        import torch  # type: ignore[import-not-found]
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]
        from omnivoice import OmniVoice, VoiceClonePrompt  # type: ignore[import-not-found]

        model_path = assemble_model(
            Path(arguments.model_cache_root),
            snapshot_download(arguments.model_id, revision=arguments.revision),
            snapshot_download(arguments.audio_tokenizer_id, revision=arguments.audio_tokenizer_revision),
            arguments.revision,
        )
        model = OmniVoice.from_pretrained(str(model_path), device_map="cuda:0", dtype=torch.float16)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                if request["op"] == "prepare":
                    prompt = model.create_voice_clone_prompt(
                        ref_audio=request["reference"], ref_text=request["referenceText"]
                    )
                    prompt.save(request["output"])
                elif request["op"] == "synthesize":
                    prompt = VoiceClonePrompt.load(request["prompt"])
                    audio = model.generate(
                        text=request["text"],
                        voice_clone_prompt=prompt,
                        speed=request["speed"],
                        duration=request["duration"],
                    )
                    sf.write(request["output"], audio[0], 24_000)
                else:
                    raise ValueError("unsupported operation")
            respond({"ok": True, "vramMb": round(torch.cuda.memory_reserved() / 1024 / 1024)})
        except Exception as error:
            print(f"OmniVoice request failed: {type(error).__name__}", file=sys.stderr, flush=True)
            respond({"ok": False})


def respond(value: dict[str, Any]) -> None:
    print(json.dumps(value), flush=True)


def assemble_model(root: Path, model_snapshot: str, tokenizer_snapshot: str, revision: str) -> Path:
    destination = (root.resolve() / revision).resolve()
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    for source in Path(model_snapshot).iterdir():
        target = destination / source.name
        if not target.exists():
            os.symlink(source, target, target_is_directory=source.is_dir())
    tokenizer = destination / "audio_tokenizer"
    if not tokenizer.exists():
        os.symlink(tokenizer_snapshot, tokenizer, target_is_directory=True)
    return destination


if __name__ == "__main__":
    main()
