"""Runs the pod's agents: restart with backoff, forward shutdown, and order startup (Tailscale, Control Plane)."""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Protocol

from .config import PodConfig, RoleSpec, agent_env

STABLE_RUN_SECONDS = 60.0
Log = Callable[[str, str], None]


class ProcessHandle(Protocol):
    async def wait(self) -> int: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...


class Launcher(Protocol):
    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle: ...


class PodStartupError(RuntimeError):
    def __init__(self, code: str, exit_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.exit_code = exit_code


def restart_delay(consecutive_failures: int) -> float:
    return float(min(5 * 2 ** max(consecutive_failures - 1, 0), 60))


class Supervisor:
    def __init__(
        self,
        config: PodConfig,
        launcher: Launcher,
        base_env: Mapping[str, str],
        *,
        log: Log,
        delay: Callable[[int], float] = restart_delay,
        clock: Callable[[], float] = time.monotonic,
        grace_seconds: float = 30.0,
    ) -> None:
        self._config = config
        self._launcher = launcher
        self._base_env = dict(base_env)
        self._log = log
        self._delay = delay
        self._clock = clock
        self._grace_seconds = grace_seconds
        self._stopping = asyncio.Event()
        self._running: dict[str, ProcessHandle] = {}
        self._deadline: float | None = None
        self._tasks: list[asyncio.Task[None]] = []

    async def run_agents(self) -> None:
        self._tasks = [asyncio.ensure_future(self._supervise(spec)) for spec in self._config.roles]
        await asyncio.gather(*self._tasks)

    def stop(self) -> None:
        if self._deadline is None:
            self._deadline = self._clock() + self._grace_seconds
        self._stopping.set()
        for handle in list(self._running.values()):
            handle.terminate()

    async def shutdown(self) -> None:
        """Stop every role and wait for its process to exit or be killed and reaped. Never returns early."""
        self.stop()
        await asyncio.gather(*self._tasks)

    async def _supervise(self, spec: RoleSpec) -> None:
        failures = 0
        while not self._stopping.is_set():
            started = self._clock()
            try:
                (self._config.state_root / spec.key).mkdir(mode=0o700, parents=True, exist_ok=True)
                handle = await self._launcher.start(
                    spec.key, [spec.python, "-m", "reup_worker.main"], agent_env(self._config, spec, self._base_env)
                )
            except Exception as error:
                self._log("supervisor", f"{spec.key} agent failed to start: {type(error).__name__}")
                failures += 1
                seconds = self._delay(failures)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stopping.wait(), seconds)
                continue
            self._running[spec.key] = handle
            code = await self._run_until_stopped(spec, handle)
            self._running.pop(spec.key, None)
            if self._stopping.is_set():
                return
            failures = 1 if self._clock() - started >= STABLE_RUN_SECONDS else failures + 1
            seconds = self._delay(failures)
            self._log("supervisor", f"{spec.key} agent exited with {code}; restarting in {seconds:.0f}s")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stopping.wait(), seconds)

    async def _run_until_stopped(self, spec: RoleSpec, handle: ProcessHandle) -> int:
        """Wait for `handle` to exit on its own, or enforce shutdown (terminate, grace, kill) once requested.

        Checks `_stopping` both before this call (a shutdown requested while `launcher.start` was still
        running) and while waiting (a shutdown requested while the agent is running), so a role that
        finishes launching after `stop()` has already run is still terminated and, if needed, killed.
        """
        wait_task: asyncio.Task[int] = asyncio.ensure_future(handle.wait())
        if not self._stopping.is_set():
            stop_task = asyncio.ensure_future(self._stopping.wait())
            done, _ = await asyncio.wait({wait_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
            if wait_task in done:
                stop_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await stop_task
                return wait_task.result()
        handle.terminate()
        deadline = self._deadline if self._deadline is not None else self._clock()
        remaining = max(0.0, deadline - self._clock())
        try:
            return await asyncio.wait_for(wait_task, remaining)
        except TimeoutError:
            self._log("supervisor", f"{spec.key} agent did not stop in time; killed")
            handle.kill()
            # wait_for already cancelled wait_task on timeout, so it cannot be awaited again for a
            # result; ProcessHandle.wait() is documented as callable multiple times, so call it fresh.
            return await handle.wait()


async def run_pod(
    config: PodConfig,
    *,
    launcher: Launcher,
    base_env: Mapping[str, str],
    stop: asyncio.Event,
    log: Log,
    bring_up_tailscale: Callable[[PodConfig, Launcher], Awaitable[ProcessHandle]],
    wait_for_control_plane: Callable[[PodConfig], Awaitable[None]],
    supervisor_factory: Callable[..., Supervisor] = Supervisor,
) -> int:
    """Start Tailscale (if used), wait for the Control Plane, run agents until `stop`; return the exit code."""
    daemon: ProcessHandle | None = None

    async def start() -> None:
        nonlocal daemon
        if config.uses_tailscale:
            daemon = await bring_up_tailscale(config, launcher)
        await wait_for_control_plane(config)

    try:
        startup = asyncio.ensure_future(start())
        stopped = asyncio.ensure_future(stop.wait())
        await asyncio.wait({startup, stopped}, return_when=asyncio.FIRST_COMPLETED)
        if not startup.done():
            startup.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await startup
            return 0
        stopped.cancel()
        try:
            startup.result()
        except PodStartupError as error:
            log("supervisor", f"startup failed: {error.code}")
            return error.exit_code
        log("supervisor", "starting agents: " + ",".join(spec.key for spec in config.roles))
        supervisor = supervisor_factory(config, launcher, base_env, log=log)
        agents = asyncio.ensure_future(supervisor.run_agents())
        await stop.wait()
        log("supervisor", "stopping")
        await supervisor.shutdown()
        await agents
        return 0
    finally:
        if daemon is not None:
            daemon.terminate()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(daemon.wait(), 10)
