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

    async def run_agents(self) -> None:
        specs = self._config.roles
        if len(specs) == 1:
            # Avoid wrapping a single role in its own Task: that adds a scheduling tick before
            # the agent actually starts, which matters when a caller stops the supervisor right
            # after launching it (see test_kills_an_agent_that_ignores_terminate).
            await self._supervise(specs[0])
        else:
            await asyncio.gather(*(self._supervise(spec) for spec in specs))

    def stop(self) -> None:
        self._stopping.set()
        for handle in list(self._running.values()):
            handle.terminate()

    async def shutdown(self) -> None:
        handles = list(self._running.values())
        self.stop()
        try:
            await asyncio.wait_for(asyncio.gather(*(handle.wait() for handle in handles)), self._grace_seconds)
        except TimeoutError:
            for handle in handles:
                handle.kill()
            self._log("supervisor", "agents did not stop in time; killed")

    async def _supervise(self, spec: RoleSpec) -> None:
        failures = 0
        while not self._stopping.is_set():
            (self._config.state_root / spec.key).mkdir(mode=0o700, parents=True, exist_ok=True)
            started = self._clock()
            handle = await self._launcher.start(
                spec.key, [spec.python, "-m", "reup_worker.main"], agent_env(self._config, spec, self._base_env)
            )
            self._running[spec.key] = handle
            if self._stopping.is_set():
                handle.terminate()
            code = await handle.wait()
            self._running.pop(spec.key, None)
            if self._stopping.is_set():
                return
            failures = 1 if self._clock() - started >= STABLE_RUN_SECONDS else failures + 1
            seconds = self._delay(failures)
            self._log("supervisor", f"{spec.key} agent exited with {code}; restarting in {seconds:.0f}s")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stopping.wait(), seconds)


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
