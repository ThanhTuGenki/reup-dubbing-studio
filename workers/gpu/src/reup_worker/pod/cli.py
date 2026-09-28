"""`reup-pod-supervisor` entry point and the real subprocess launcher."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import signal
from collections.abc import Mapping, Sequence

from .config import PodConfig, PodConfigError
from .startup import bring_up_tailscale, wait_for_control_plane
from .supervisor import Log, ProcessHandle, run_pod


def log(source: str, message: str) -> None:
    print(f"[{source}] {message}", flush=True)


class _SubprocessHandle:
    def __init__(self, process: asyncio.subprocess.Process, pump: asyncio.Task[None]) -> None:
        self._process = process
        self._pump = pump

    async def wait(self) -> int:
        code = await self._process.wait()
        await asyncio.shield(self._pump)
        return code

    def terminate(self) -> None:
        with contextlib.suppress(ProcessLookupError):
            if self._process.returncode is None:
                self._process.terminate()

    def kill(self) -> None:
        with contextlib.suppress(ProcessLookupError):
            if self._process.returncode is None:
                self._process.kill()


class SubprocessLauncher:
    """Starts a child with merged stdout/stderr and relays each line as `[name] line`."""

    def __init__(self, log: Log) -> None:
        self._log = log

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        process = await asyncio.create_subprocess_exec(
            *argv, env=dict(env), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        return _SubprocessHandle(process, asyncio.ensure_future(self._relay(name, process)))

    async def _relay(self, name: str, process: asyncio.subprocess.Process) -> None:
        assert process.stdout is not None  # noqa: S101
        async for raw in process.stdout:
            self._log(name, raw.decode(errors="replace").rstrip())


async def _run(config: PodConfig) -> int:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(name, stop.set)
    return await run_pod(
        config,
        launcher=SubprocessLauncher(log),
        base_env=os.environ,
        stop=stop,
        log=log,
        bring_up_tailscale=bring_up_tailscale,
        wait_for_control_plane=wait_for_control_plane,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="reup-pod-supervisor")
    parser.add_argument("--check", action="store_true", help="validate the pod environment without networking")
    arguments = parser.parse_args(argv)
    try:
        config = PodConfig.from_env(os.environ)
    except PodConfigError as error:
        for problem in error.problems:
            log("supervisor", problem)
        raise SystemExit(2) from None
    if arguments.check:
        roles = ",".join(spec.key for spec in config.roles)
        log("supervisor", f"configuration ok: roles={roles} tailscale={'yes' if config.uses_tailscale else 'no'}")
        return
    raise SystemExit(asyncio.run(_run(config)))
