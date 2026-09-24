import argparse
import importlib
import importlib.metadata
import os
import shutil
import sys

DEPENDENCIES = {
    "interactive-tts": ("reup-dubbing-gpu-worker", "omnivoice", "torch", "torchaudio", "transformers"),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=("batch", "interactive-tts"))
    arguments = parser.parse_args()
    if sys.version_info[:2] != (3, 11):
        raise RuntimeError("Worker image requires Python 3.11")
    if os.geteuid() == 0:
        raise RuntimeError("Worker image must not run as root")
    if arguments.role == "batch":
        check_batch_environments()
    else:
        for package in DEPENDENCIES[arguments.role]:
            importlib.metadata.version(package)
    if not shutil.which("ffmpeg"):
        raise RuntimeError("Worker image requires FFmpeg")
    importlib.import_module("reup_worker.acceptance")
    print(f"{arguments.role} image smoke check passed")


def check_batch_environments() -> None:
    import subprocess

    environments = {
        "/opt/reup-worker/bin/python": ("reup-dubbing-gpu-worker", "faster-whisper"),
        "/opt/reup-demucs/bin/python": ("reup-dubbing-gpu-worker", "demucs", "torch", "torchaudio"),
        "/opt/reup-ocr/bin/python": ("reup-dubbing-gpu-worker", "paddleocr", "paddlepaddle-gpu"),
    }
    for executable, packages in environments.items():
        command = "import importlib.metadata as m;" + ";".join(f"m.version({item!r})" for item in packages)
        subprocess.run([executable, "-c", command], check=True)  # noqa: S603


if __name__ == "__main__":
    main()
