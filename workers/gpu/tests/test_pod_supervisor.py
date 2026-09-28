import asyncio
from collections.abc import Mapping, Sequence
from pathlib import Path

from reup_worker.pod.config import PodConfig
from reup_worker.pod.supervisor import (
    Launcher,
    PodStartupError,
    ProcessHandle,
    Supervisor,
    restart_delay,
    run_pod,
)

DIGEST = "sha256:" + "b" * 64


def config(tmp_path: Path, roles: str = "batch,tts") -> PodConfig:
    return PodConfig.from_env(
        {
            "REUP_CONTROL_PLANE_URL": "http://127.0.0.1:18080/worker/v1",
            "REUP_WORKER_IMAGE_DIGEST": DIGEST,
            "REUP_BATCH_ENROLLMENT_TOKEN": "b",
            "REUP_TTS_ENROLLMENT_TOKEN": "t",
            "REUP_POD_STATE_ROOT": str(tmp_path),
            "REUP_POD_ROLES": roles,
        }
    )


class FakeHandle:
    def __init__(self, exit_code: int | None, ignores_terminate: bool = False) -> None:
        self._done = asyncio.Event()
        self.code = 0
        self.terminated = self.killed = False
        self._ignores_terminate = ignores_terminate
        if exit_code is not None:
            self.code = exit_code
            self._done.set()

    async def wait(self) -> int:
        await self._done.wait()
        return self.code

    def terminate(self) -> None:
        self.terminated = True
        if not self._ignores_terminate:
            self.code = -15
            self._done.set()

    def kill(self) -> None:
        self.killed = True
        self.code = -9
        self._done.set()


class FakeLauncher:
    def __init__(self, plan: dict[str, list[FakeHandle]]) -> None:
        self.plan = plan
        self.started: list[tuple[str, list[str], dict[str, str]]] = []
        self.started_events: dict[str, asyncio.Event] = {name: asyncio.Event() for name in plan}

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        self.started.append((name, list(argv), dict(env)))
        queue = self.plan[name]
        handle = queue.pop(0) if len(queue) > 1 else queue[0]
        self.started_events[name].set()
        return handle


class GatedLauncher:
    """A launcher whose `start` blocks on a gate the test controls, to simulate a slow/in-flight launch."""

    def __init__(self, handle: FakeHandle) -> None:
        self._handle = handle
        self.gate = asyncio.Event()
        self.entered = asyncio.Event()
        self.started: list[tuple[str, list[str], dict[str, str]]] = []

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        self.entered.set()
        await self.gate.wait()
        self.started.append((name, list(argv), dict(env)))
        return self._handle


class RelaunchLauncher:
    """A launcher whose first `start` returns immediately (a crash); its second blocks on a gate."""

    def __init__(self, first: FakeHandle, second: FakeHandle) -> None:
        self._first = first
        self._second = second
        self._calls = 0
        self.gate = asyncio.Event()
        self.entered_second = asyncio.Event()
        self.started: list[tuple[str, list[str], dict[str, str]]] = []

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        self.started.append((name, list(argv), dict(env)))
        self._calls += 1
        if self._calls == 1:
            return self._first
        self.entered_second.set()
        await self.gate.wait()
        return self._second


class FlakyLauncher:
    """A launcher whose first `start` raises; its second succeeds."""

    def __init__(self, handle: FakeHandle) -> None:
        self._handle = handle
        self._calls = 0
        self.started: list[tuple[str, list[str], dict[str, str]]] = []
        self.succeeded = asyncio.Event()

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        self._calls += 1
        if self._calls == 1:
            raise RuntimeError("boom")
        self.started.append((name, list(argv), dict(env)))
        self.succeeded.set()
        return self._handle


def silent(source: str, message: str) -> None:
    del source, message


async def observe_starts(event: asyncio.Event, count: int = 1) -> None:
    """Wait until `event` has been set (and re-armed) `count` times, deterministically."""
    for _ in range(count):
        await asyncio.wait_for(event.wait(), 1)
        event.clear()


def test_restart_delay_doubles_to_a_minute() -> None:
    assert [restart_delay(n) for n in range(1, 8)] == [5, 10, 20, 40, 60, 60, 60]


async def test_runs_both_agents_and_restarts_a_crashed_one(tmp_path: Path) -> None:
    running = FakeHandle(None)
    launcher = FakeLauncher({"batch": [FakeHandle(1), FakeHandle(1), running], "tts": [FakeHandle(None)]})
    delays: list[int] = []

    def delay(failures: int) -> float:
        delays.append(failures)
        return 0.0

    supervisor = Supervisor(config(tmp_path), launcher, {}, log=silent, delay=delay, clock=lambda: 0.0)
    agents = asyncio.create_task(supervisor.run_agents())
    await observe_starts(launcher.started_events["batch"], 3)
    await observe_starts(launcher.started_events["tts"], 1)
    await supervisor.shutdown()
    await asyncio.wait_for(agents, 1)
    names = [name for name, _, _ in launcher.started]
    assert names.count("batch") == 3 and names.count("tts") == 1
    assert delays == [1, 2]
    assert launcher.started[0][1] == ["/opt/reup-worker/bin/python", "-m", "reup_worker.main"]
    assert running.terminated
    assert (tmp_path / "batch").is_dir() and (tmp_path / "tts").is_dir()


async def test_a_stable_run_resets_the_backoff(tmp_path: Path) -> None:
    times = iter([0.0, 100.0, 100.0, 200.0])
    launcher = FakeLauncher({"batch": [FakeHandle(1), FakeHandle(1), FakeHandle(None)]})
    delays: list[int] = []

    def delay(failures: int) -> float:
        delays.append(failures)
        return 0.0

    supervisor = Supervisor(
        config(tmp_path, "batch"), launcher, {}, log=silent, delay=delay, clock=lambda: next(times, 200.0)
    )
    agents = asyncio.create_task(supervisor.run_agents())
    await observe_starts(launcher.started_events["batch"], 3)
    await supervisor.shutdown()
    await asyncio.wait_for(agents, 1)
    assert delays == [1, 1]


async def test_kills_an_agent_that_ignores_terminate(tmp_path: Path) -> None:
    stubborn = FakeHandle(None, ignores_terminate=True)
    launcher = FakeLauncher({"tts": [stubborn]})
    supervisor = Supervisor(config(tmp_path, "tts"), launcher, {}, log=silent, grace_seconds=0.05)
    agents = asyncio.create_task(supervisor.run_agents())
    await asyncio.wait_for(launcher.started_events["tts"].wait(), 1)
    await supervisor.shutdown()
    await asyncio.wait_for(agents, 1)
    assert stubborn.terminated and stubborn.killed


async def test_kills_an_agent_that_finishes_launching_after_stop(tmp_path: Path) -> None:
    """Regression: stop() runs while the role is still inside launcher.start(); it must still be killed."""
    stubborn = FakeHandle(None, ignores_terminate=True)
    launcher = GatedLauncher(stubborn)
    supervisor = Supervisor(config(tmp_path, "tts"), launcher, {}, log=silent, grace_seconds=0.05)
    agents = asyncio.create_task(supervisor.run_agents())
    await asyncio.wait_for(launcher.entered.wait(), 1)
    supervisor.stop()
    launcher.gate.set()
    await asyncio.wait_for(supervisor.shutdown(), 1)
    await asyncio.wait_for(agents, 1)
    assert stubborn.terminated and stubborn.killed


async def test_kills_an_agent_relaunching_after_a_crash(tmp_path: Path) -> None:
    """Regression: shutdown happens while a crashed role is mid-relaunch (inside its second launcher.start())."""
    crashed = FakeHandle(1)
    stubborn = FakeHandle(None, ignores_terminate=True)
    launcher = RelaunchLauncher(crashed, stubborn)

    def delay(failures: int) -> float:
        return 0.0

    supervisor = Supervisor(config(tmp_path, "batch"), launcher, {}, log=silent, delay=delay, grace_seconds=0.05)
    agents = asyncio.create_task(supervisor.run_agents())
    await asyncio.wait_for(launcher.entered_second.wait(), 1)
    supervisor.stop()
    launcher.gate.set()
    await asyncio.wait_for(supervisor.shutdown(), 1)
    await asyncio.wait_for(agents, 1)
    assert stubborn.terminated and stubborn.killed
    assert [name for name, _, _ in launcher.started] == ["batch", "batch"]


async def test_a_launch_failure_backs_off_like_a_crash(tmp_path: Path) -> None:
    handle = FakeHandle(None)
    launcher = FlakyLauncher(handle)
    delays: list[int] = []

    def delay(failures: int) -> float:
        delays.append(failures)
        return 0.0

    supervisor = Supervisor(config(tmp_path, "tts"), launcher, {}, log=silent, delay=delay)
    agents = asyncio.create_task(supervisor.run_agents())
    await asyncio.wait_for(launcher.succeeded.wait(), 1)
    await supervisor.shutdown()
    await asyncio.wait_for(agents, 1)
    assert [name for name, _, _ in launcher.started] == ["tts"]
    assert delays == [1]


async def test_run_pod_starts_tailscale_then_agents_and_stops_cleanly(tmp_path: Path) -> None:
    order: list[str] = []
    daemon = FakeHandle(None)

    async def tailscale(cfg: PodConfig, launcher: Launcher) -> ProcessHandle:
        del cfg, launcher
        order.append("tailscale")
        return daemon

    async def ready(cfg: PodConfig) -> None:
        del cfg
        order.append("ready")

    stop = asyncio.Event()
    launcher = FakeLauncher({"batch": [FakeHandle(None)], "tts": [FakeHandle(None)]})
    tailnet_config = PodConfig.from_env(
        {
            "REUP_CONTROL_PLANE_HOST": "cp.ts.net",
            "TS_AUTHKEY": "k",
            "REUP_WORKER_IMAGE_DIGEST": DIGEST,
            "REUP_BATCH_ENROLLMENT_TOKEN": "b",
            "REUP_TTS_ENROLLMENT_TOKEN": "t",
            "REUP_POD_STATE_ROOT": str(tmp_path),
        }
    )
    pod = asyncio.create_task(
        run_pod(
            tailnet_config,
            launcher=launcher,
            base_env={},
            stop=stop,
            log=silent,
            bring_up_tailscale=tailscale,
            wait_for_control_plane=ready,
        )
    )
    await asyncio.wait_for(launcher.started_events["batch"].wait(), 1)
    await asyncio.wait_for(launcher.started_events["tts"].wait(), 1)
    assert order == ["tailscale", "ready"] and len(launcher.started) == 2
    stop.set()
    assert await pod == 0
    assert daemon.terminated


async def test_run_pod_reports_startup_failures(tmp_path: Path) -> None:
    async def unreachable(cfg: PodConfig) -> None:
        del cfg
        raise PodStartupError("CONTROL_PLANE_UNREACHABLE", 4)

    async def no_tailscale(cfg: PodConfig, launcher: Launcher) -> ProcessHandle:
        raise AssertionError("direct mode must not start Tailscale")

    launcher = FakeLauncher({})
    code = await run_pod(
        config(tmp_path),
        launcher=launcher,
        base_env={},
        stop=asyncio.Event(),
        log=silent,
        bring_up_tailscale=no_tailscale,
        wait_for_control_plane=unreachable,
    )
    assert code == 4 and launcher.started == []


async def test_run_pod_stops_promptly_during_startup(tmp_path: Path) -> None:
    async def never_ready(cfg: PodConfig) -> None:
        del cfg
        await asyncio.sleep(3600)

    async def no_tailscale(cfg: PodConfig, launcher: Launcher) -> ProcessHandle:
        raise AssertionError("direct mode must not start Tailscale")

    stop = asyncio.Event()
    pod = asyncio.create_task(
        run_pod(
            config(tmp_path),
            launcher=FakeLauncher({}),
            base_env={},
            stop=stop,
            log=silent,
            bring_up_tailscale=no_tailscale,
            wait_for_control_plane=never_ready,
        )
    )
    await asyncio.sleep(0)
    stop.set()
    assert await asyncio.wait_for(pod, 1) == 0


async def test_run_pod_exits_3_and_stops_agents_when_tailscaled_dies(tmp_path: Path) -> None:
    daemon = FakeHandle(None)
    messages: list[str] = []

    async def tailscale(cfg: PodConfig, launcher: Launcher) -> ProcessHandle:
        del cfg, launcher
        return daemon

    async def ready(cfg: PodConfig) -> None:
        del cfg

    batch, tts = FakeHandle(None), FakeHandle(None)
    launcher = FakeLauncher({"batch": [batch], "tts": [tts]})
    tailnet_config = PodConfig.from_env(
        {
            "REUP_CONTROL_PLANE_HOST": "cp.ts.net",
            "TS_AUTHKEY": "k",
            "REUP_WORKER_IMAGE_DIGEST": DIGEST,
            "REUP_BATCH_ENROLLMENT_TOKEN": "b",
            "REUP_TTS_ENROLLMENT_TOKEN": "t",
            "REUP_POD_STATE_ROOT": str(tmp_path),
        }
    )
    pod = asyncio.create_task(
        run_pod(
            tailnet_config,
            launcher=launcher,
            base_env={},
            stop=asyncio.Event(),
            log=lambda source, message: messages.append(f"[{source}] {message}"),
            bring_up_tailscale=tailscale,
            wait_for_control_plane=ready,
        )
    )
    await asyncio.wait_for(launcher.started_events["batch"].wait(), 1)
    await asyncio.wait_for(launcher.started_events["tts"].wait(), 1)
    daemon.kill()  # tailscaled dies mid-run
    assert await asyncio.wait_for(pod, 1) == 3
    assert batch.terminated and tts.terminated
    assert "[supervisor] tailscaled exited: TAILSCALE_UNAVAILABLE" in messages
