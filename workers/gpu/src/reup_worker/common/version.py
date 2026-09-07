from __future__ import annotations

import os
from importlib.metadata import PackageNotFoundError, version


def package_version() -> str:
    try:
        return version("reup-gpu-worker")
    except PackageNotFoundError:
        return "0.1.0"


def version_string() -> str:
    digest = os.getenv("IMAGE_DIGEST")
    return f"{package_version()} ({digest})" if digest else package_version()
