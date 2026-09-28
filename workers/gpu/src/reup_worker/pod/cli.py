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


_CHUNK_SIZE = 65536
_LINE_CAP = 16 * 1024
_TRUNCATED_SUFFIX = "…[truncated]"


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
        """Drain stdout until EOF, one `[name] line` per log call. Never raises: a dead pump would stop draining

        the pipe (blocking the child once its buffer fills) and would re-raise through the shielded `wait()`,
        which the supervisor does not catch. Lines are read as raw chunks (not `readline`, whose default 64 KiB
        limit raises `ValueError` on one long, unterminated line) and split on `\\n` ourselves; any single line
        over `_LINE_CAP` is truncated before logging so one runaway line can't grow memory or the log unbounded.
        """
        assert process.stdout is not None  # noqa: S101
        stream = process.stdout
        buffer = bytearray()
        overflowing = False
        try:
            while True:
                chunk = await stream.read(_CHUNK_SIZE)
                if not chunk:
                    break
                start = 0
                while True:
                    newline = chunk.find(b"\n", start)
                    if newline == -1:
                        if not overflowing:
                            buffer.extend(chunk[start:])
                            if len(buffer) > _LINE_CAP:
                                overflowing = True
                                del buffer[_LINE_CAP:]
                        break
                    if not overflowing:
                        buffer.extend(chunk[start:newline])
                    self._emit(name, bytes(buffer), overflowing or len(buffer) > _LINE_CAP)
                    buffer.clear()
                    overflowing = False
                    start = newline + 1
            if buffer or overflowing:
                self._emit(name, bytes(buffer), overflowing)
        except Exception as error:
            # Defensive: a relay bug must not escape into the shielded `wait()` and starve the supervisor.
            self._log(name, f"[relay error] {type(error).__name__}: {error}")

    def _emit(self, name: str, data: bytes, truncated: bool) -> None:
        text = data.decode(errors="replace")
        if text.endswith("\r"):
            text = text[:-1]
        if truncated:
            text = text[:_LINE_CAP] + _TRUNCATED_SUFFIX
        self._log(name, text)


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
