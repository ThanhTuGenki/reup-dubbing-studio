import asyncio
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


class TailscaleLauncher:
    def __init__(self, socket_dir: Path, up_code: int = 0, create_socket: bool = True) -> None:
        self.calls: list[list[str]] = []
        self.key_seen: str | None = None
        self.daemon = Done(0)
        self._socket_dir, self._up_code, self._create_socket = socket_dir, up_code, create_socket

    async def start(self, name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle:
        assert name == "tailscale" and "TS_AUTHKEY" not in env
        self.calls.append(list(argv))
        if argv[0] == "tailscaled":
            if self._create_socket:
                (self._socket_dir / "tailscaled.sock").touch()
            return self.daemon
        key_arg = next(arg for arg in argv if arg.startswith("--auth-key="))
        key_file = Path(key_arg.removeprefix("--auth-key=file:"))
        self.key_seen = key_file.read_text()
        assert oct(key_file.stat().st_mode & 0o777) == "0o600"
        return Done(self._up_code)


async def test_tailscale_joins_with_a_key_file_never_on_argv(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale")
    daemon = await bring_up_tailscale(tailnet(tmp_path), launcher, poll=0.01)
    daemon_argv, up_argv = launcher.calls
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


async def test_tailscale_daemon_that_never_opens_its_socket(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale", create_socket=False)
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


async def test_cancelling_bring_up_terminates_the_daemon_and_leaves_no_key_file(tmp_path: Path) -> None:
    launcher = TailscaleLauncher(tmp_path / "tailscale", create_socket=False)
    task = asyncio.ensure_future(bring_up_tailscale(tailnet(tmp_path), launcher, timeout=5.0, poll=0.01))
    await asyncio.sleep(0.03)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert launcher.daemon.terminated
    assert not (tmp_path / "tailscale" / "authkey").exists()
