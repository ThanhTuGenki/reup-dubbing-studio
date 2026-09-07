from __future__ import annotations

import argparse
import logging
import sys

from reup_worker.common.config import load_settings
from reup_worker.common.logging import bind_context, setup_logging
from reup_worker.common.version import version_string


def main() -> int:
    parser = argparse.ArgumentParser(prog="reup-tts-worker")
    parser.add_argument("--version", action="version", version=version_string())
    parser.add_argument("--health", action="store_true", help="report container health")
    args = parser.parse_args()
    if args.health:
        sys.stdout.write("ok\n")
        return 0
    settings = load_settings(worker_role="interactive_tts")
    setup_logging(settings.log_level, settings.log_format)
    bind_context(worker_role=settings.worker_role)
    logging.getLogger(__name__).info("starting")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
