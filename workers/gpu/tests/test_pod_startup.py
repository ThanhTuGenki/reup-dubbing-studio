import asyncio
import time
from collections.abc import Mapping, Sequence
from pathlib import Path

import httpx
import pytest
import respx

from reup_worker.pod.config import PodConfig
from reup_worker.pod.startup import bring_up_tailscale, wait_for_control_plane
from reup_worker.pod.supervisor import PodStartupError, ProcessHandle

DIGEST = "sha256:" + "c" * 64


def tailnet(tmp_path: Path) -> PodConfig:
    return PodConfig.from_env(
        {
            "REUP_CONTROL_PLANE_HOST": "cp.ts.net",
            "TS_AUTHKEY": "tskey-auth-secret",
            "REUP_WORKER_IMAGE_DIGEST": DIGEST,
            "REUP_BATCH_ENROLLMENT_TOKEN": "b",
            "REUP_TTS_ENROLLMENT_TOKEN": "t",
            "REUP_POD_STATE_ROOT": str(tmp_path),
            "RUNPOD_POD_ID": "pod1",
        }
    )


class Done:
    def __init__(self, code: int) -> None:
        self.code = code
        self.terminated = False

    async def wait(self) -> int:
        return self.code

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.terminated = True


class Hangs:
    """A `ProcessHandle` whose `wait()` never returns on its own, only after `terminate()`/`kill()`."""

    def __init__(self) -> None:
        self.terminated = False
        self._done = asyncio.Event()

    async def wait(self) -> int:
        await self._done.wait()
        return -15

    def terminate(self) -> None:
        self.terminated = True
        self._done.set()

    def kill(self) -> None:
        self.terminated = True
        self._done.set()


class TailscaleLauncher:
    """Fakes `tailscaled`, `tailscale status` and `tailscale up`.

    `ready_after` is how many `status` probes fail before the daemon answers (`None`: it never answers).
    """

    def __init__(self, socket_dir: Path, up_code: int = 0, ready_after: int | None = 0, hang_up: bool = False) -> None:
        self.calls: list[list[str]] = []
        self.key_seen: str | None = None
        self.daemon = Done(0)
        self.up_handle: Hangs | Done | None = None
        self.socket_existed_at_launch: bool | None = None
        self.status_probes = 0
        self._socket_dir, self._up_code, self._ready_after, self._hang_up = (
            socket_dir,
            up_code,
            ready_after,
            hang_up,
        )

    @property
    def up_calls(self) -> list[list[str]]:
        return [argv for argv in self.calls if "up" in argv]

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        assert name == "tailscale" and "TS_AUTHKEY" not in env
        self.calls.append(list(argv))
        if argv[0] == "tailscaled":
            self.socket_existed_at_launch = (self._socket_dir / "tailscaled.sock").exists()
            return self.daemon
        if "status" in argv:
            assert argv[1] == f"--socket={self._socket_dir / 'tailscaled.sock'}" and "--json" in argv
            self.status_probes += 1
            ready = self._ready_after is not None and self.status_probes > self._ready_after
            return Done(0 if ready else 1)
        key_arg = next(arg for arg in argv if arg.startswith("--auth-key="))
        key_file = Path(key_arg.removeprefix("--auth-key=file:"))
        self.key_seen = key_file.read_text()
        assert oct(key_file.stat().st_mode & 0o777) == "0o600"
        self.up_handle = Hangs() if self._hang_up else Done(self._up_code)
        return self.up_handle


async def test_tailscale_joins_with_a_key_file_never_on_argv(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale")
    daemon = await bring_up_tailscale(tailnet(tmp_path), launcher, poll=0.01)
    daemon_argv, status_argv, up_argv = launcher.calls
    assert status_argv[0] == "tailscale" and "status" in status_argv
    assert daemon_argv[:2] == ["tailscaled", "--tun=userspace-networking"]
    assert "--outbound-http-proxy-listen=127.0.0.1:1055" in daemon_argv
    assert up_argv[:3] == ["tailscale", f"--socket={tmp_path / 'tailscale' / 'tailscaled.sock'}", "up"]
    assert "--hostname=reup-runpod-pod1" in up_argv
    assert not any("tskey-auth-secret" in arg for arg in daemon_argv + up_argv)
    assert launcher.key_seen == "tskey-auth-secret"
    assert not (tmp_path / "tailscale" / "authkey").exists()
    assert daemon is launcher.daemon


async def test_tailscale_failure_stops_the_daemon(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale", up_code=1)
    with pytest.raises(PodStartupError) as raised:
        await bring_up_tailscale(tailnet(tmp_path), launcher, poll=0.01)
    assert (raised.value.code, raised.value.exit_code) == ("TAILSCALE_UNAVAILABLE", 3)
    assert launcher.daemon.terminated
    assert not (tmp_path / "tailscale" / "authkey").exists()


async def test_tailscale_daemon_that_never_answers(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale", ready_after=None)
    with pytest.raises(PodStartupError):
        await bring_up_tailscale(tailnet(tmp_path), launcher, timeout=0.05, poll=0.01)
    assert launcher.daemon.terminated


@respx.mock
async def test_waits_until_the_control_plane_is_ready(tmp_path: Path) -> None:
    config = PodConfig.from_env(
        {
            "REUP_CONTROL_PLANE_URL": "http://cp.test/worker/v1",
            "REUP_WORKER_IMAGE_DIGEST": DIGEST,
            "REUP_BATCH_ENROLLMENT_TOKEN": "b",
            "REUP_TTS_ENROLLMENT_TOKEN": "t",
            "REUP_POD_STATE_ROOT": str(tmp_path),
        }
    )
    route = respx.get("http://cp.test/v1/health/ready").mock(
        side_effect=[httpx.ConnectError("down"), httpx.Response(503), httpx.Response(200)]
    )

    async def no_sleep(seconds: float) -> None:
        del seconds

    await wait_for_control_plane(config, sleep=no_sleep)
    assert route.call_count == 3


@respx.mock
async def test_gives_up_on_an_unreachable_control_plane(tmp_path: Path) -> None:
    config = PodConfig.from_env(
        {
            "REUP_CONTROL_PLANE_URL": "http://cp.test/worker/v1",
            "REUP_WORKER_IMAGE_DIGEST": DIGEST,
            "REUP_BATCH_ENROLLMENT_TOKEN": "b",
            "REUP_TTS_ENROLLMENT_TOKEN": "t",
            "REUP_POD_STATE_ROOT": str(tmp_path),
        }
    )
    respx.get("http://cp.test/v1/health/ready").mock(return_value=httpx.Response(503))
    ticks = iter([0.0, 100.0, 400.0])

    async def no_sleep(seconds: float) -> None:
        await asyncio.sleep(0)

    with pytest.raises(PodStartupError) as raised:
        await wait_for_control_plane(config, sleep=no_sleep, clock=lambda: next(ticks, 400.0))
    assert raised.value.code == "CONTROL_PLANE_UNREACHABLE"


async def test_an_up_that_never_exits_is_bounded_by_the_startup_budget(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale", hang_up=True)
    started = time.monotonic()
    with pytest.raises(PodStartupError) as raised:
        await bring_up_tailscale(tailnet(tmp_path), launcher, timeout=0.2, poll=0.01)
    elapsed = time.monotonic() - started
    assert (raised.value.code, raised.value.exit_code) == ("TAILSCALE_UNAVAILABLE", 3)
    assert elapsed < 2.0  # well under 2x the 0.2s budget; guards against the "up" call getting its own budget
    assert launcher.daemon.terminated
    assert launcher.up_handle is not None and launcher.up_handle.terminated
    assert not (tmp_path / "tailscale" / "authkey").exists()


async def test_cancelling_bring_up_terminates_the_daemon_and_leaves_no_key_file(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale", ready_after=None)
    task = asyncio.ensure_future(bring_up_tailscale(tailnet(tmp_path), launcher, timeout=5.0, poll=0.01))
    await asyncio.sleep(0.03)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert launcher.daemon.terminated
    assert not (tmp_path / "tailscale" / "authkey").exists()


async def test_a_stale_socket_is_removed_and_not_taken_for_readiness(tmp_path: Path) -> None:
    """Regression: a restarted container keeps the old socket file; `up` must wait for the daemon to answer."""
    directory = tmp_path / "tailscale"
    directory.mkdir()
    (directory / "tailscaled.sock").touch()
    launcher = TailscaleLauncher(directory, ready_after=None)
    with pytest.raises(PodStartupError) as raised:
        await bring_up_tailscale(tailnet(tmp_path), launcher, timeout=0.1, poll=0.01)
    assert (raised.value.code, raised.value.exit_code) == ("TAILSCALE_UNAVAILABLE", 3)
    assert launcher.socket_existed_at_launch is False
    assert launcher.up_calls == []
    assert launcher.status_probes >= 1
    assert launcher.daemon.terminated


async def test_up_runs_only_once_the_daemon_answers_status(tmp_path: Path) -> None:
    directory = tmp_path / "tailscale"
    directory.mkdir()
    (directory / "tailscaled.sock").touch()
    launcher = TailscaleLauncher(directory, ready_after=2)
    daemon = await bring_up_tailscale(tailnet(tmp_path), launcher, poll=0.01)
    assert daemon is launcher.daemon and not daemon.terminated
    assert launcher.socket_existed_at_launch is False
    assert launcher.status_probes == 3
    assert [argv[0] for argv in launcher.calls] == ["tailscaled", "tailscale", "tailscale", "tailscale", "tailscale"]
    assert launcher.calls[-1] == launcher.up_calls[0]
