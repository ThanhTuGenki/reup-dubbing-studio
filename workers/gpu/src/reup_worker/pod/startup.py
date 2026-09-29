"""Pod startup steps: join the tailnet in userspace mode and wait for the Control Plane."""

from __future__ import annotations

import asyncio
import math
import os
import time
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path

import httpx

from .config import PROXY_URL, PodConfig
from .supervisor import Launcher, PodStartupError, ProcessHandle


async def bring_up_tailscale(
    config: PodConfig,
    launcher: Launcher,
    *,
    timeout: float = 60.0,  # noqa: ASYNC109
    poll: float = 0.5,
) -> ProcessHandle:
    """Start tailscaled (userspace, HTTP proxy on 127.0.0.1:1055) and join; the auth key goes through a 0600 file."""
    directory = config.state_root / "tailscale"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    socket = directory / "tailscaled.sock"
    # The container disk survives a restart: a socket left by the previous tailscaled must not count as ready.
    socket.unlink(missing_ok=True)
    env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")}
    daemon = await launcher.start(
        "tailscale",
        [
            "tailscaled",
            "--tun=userspace-networking",
            f"--state={directory / 'tailscaled.state'}",
            f"--socket={socket}",
            "--outbound-http-proxy-listen=127.0.0.1:1055",
        ],
        env,
    )
    key_file = directory / "authkey"
    deadline = time.monotonic() + timeout
    try:
        while not await _daemon_answers(launcher, socket, env, deadline):
            if time.monotonic() >= deadline:
                raise PodStartupError("TAILSCALE_UNAVAILABLE", 3)
            await asyncio.sleep(poll)
        # Budget the whole call at `timeout`, not `timeout` for the readiness wait plus another
        # `timeout` for `tailscale up`: spend only what's left of the deadline on the join.
        remaining = deadline - time.monotonic()
        descriptor = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(config.tailscale_auth_key or "")
        joined = await launcher.start(
            "tailscale",
            [
                "tailscale",
                f"--socket={socket}",
                "up",
                f"--auth-key=file:{key_file}",
                f"--hostname={config.hostname}",
                f"--timeout={max(1, math.ceil(remaining))}s",
            ],
            env,
        )
        try:
            code = await asyncio.wait_for(joined.wait(), max(remaining, 0.1))
        except TimeoutError:
            joined.terminate()
            raise PodStartupError("TAILSCALE_UNAVAILABLE", 3) from None
        except BaseException:
            joined.terminate()
            raise
        if code != 0:
            raise PodStartupError("TAILSCALE_UNAVAILABLE", 3)
    except BaseException:
        daemon.terminate()
        raise
    finally:
        key_file.unlink(missing_ok=True)
    return daemon


async def _daemon_answers(launcher: Launcher, socket: Path, env: Mapping[str, str], deadline: float) -> bool:
    """True once tailscaled answers `tailscale status --json` on `socket` (exit 0), bounded by `deadline`."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return False
    probe = await launcher.start("tailscale", ["tailscale", f"--socket={socket}", "status", "--json"], env)
    try:
        return await asyncio.wait_for(probe.wait(), remaining) == 0
    except TimeoutError:
        probe.terminate()
        return False
    except BaseException:
        probe.terminate()
        raise


async def wait_for_control_plane(
    config: PodConfig,
    *,
    timeout: float = 300.0,  # noqa: ASYNC109
    client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> None:
    deadline = clock() + timeout
    delay = 1.0
    async with client_factory(**({"proxy": PROXY_URL} if config.uses_tailscale else {}), timeout=10.0) as client:
        while True:
            try:
                if (await client.get(config.ready_url)).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            if clock() >= deadline:
                raise PodStartupError("CONTROL_PLANE_UNREACHABLE", 4)
            await sleep(delay)
            delay = min(delay * 2, 15.0)
