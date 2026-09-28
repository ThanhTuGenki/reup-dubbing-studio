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

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        self.started.append((name, list(argv), dict(env)))
        queue = self.plan[name]
        return queue.pop(0) if len(queue) > 1 else queue[0]


def silent(source: str, message: str) -> None:
    del source, message


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
    for _ in range(50):
        await asyncio.sleep(0)
    await supervisor.shutdown()
    await agents
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
    for _ in range(50):
        await asyncio.sleep(0)
    await supervisor.shutdown()
    await agents
    assert delays == [1, 1]


async def test_kills_an_agent_that_ignores_terminate(tmp_path: Path) -> None:
    stubborn = FakeHandle(None, ignores_terminate=True)
    supervisor = Supervisor(
        config(tmp_path, "tts"), FakeLauncher({"tts": [stubborn]}), {}, log=silent, grace_seconds=0.05
    )
    agents = asyncio.create_task(supervisor.run_agents())
    await asyncio.sleep(0)
    await supervisor.shutdown()
    await agents
    assert stubborn.terminated and stubborn.killed


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
    for _ in range(20):
        await asyncio.sleep(0)
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
