# Image worker cho RunPod — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build image `gpu-worker-runpod`. Một pod RunPod tạo từ image này tự nối
Tailscale và chạy cả hai worker `BATCH_MEDIA` và `INTERACTIVE_TTS` trên cùng một
GPU, không cần SSH hay `bootstrap.sh`.

**Architecture:**
- Thêm package Python `reup_worker.pod`, gồm:
  - `config`: đọc env, tính env riêng cho từng agent;
  - `supervisor`: chạy agent, tự khởi động lại, tắt an toàn;
  - `startup`: bật Tailscale, chờ Control Plane sẵn sàng;
  - `cli`: entry point `reup-pod-supervisor`.

  Toàn bộ là code thuần, test được bằng fake launcher.
- Thêm target `runpod` vào `workers/gpu/containers/Dockerfile`:
  - copy venv của `batch`;
  - build venv TTS thẳng tại `/opt/reup-worker-tts`;
  - lấy binary Tailscale từ image chính thức, khóa theo digest.
- Thêm target `runpod` vào CI để build, smoke test, scan và push.

**Tech Stack:** Python 3.11, asyncio, httpx 0.28, pydantic-settings (agent hiện
có), pytest + pytest-asyncio + respx, ruff, mypy strict, Docker BuildKit
(`syntax=docker/dockerfile:1.7`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-28-runpod-worker-image-design.md`

## Global Constraints

- Chạy lệnh Python từ `workers/gpu`: `uv run pytest …`, `uv run ruff check src tests`,
  `uv run ruff format --check src tests`, `uv run mypy`. Gộp lại là `make -C workers/gpu check`.
- mypy `strict = true`. Ruff chọn `E,F,I,UP,B,ASYNC,S,RUF`, dài tối đa 120 ký tự.
- **Capability dùng JSON** với đúng các tên sau:
  - Batch: `["transcript.asr.v1","audio.separate.demucs.v1","media.render.ffmpeg.v1"]`;
  - TTS: `["tts.omnivoice.v1"]`.
- **Đường dẫn:**
  - Batch python là `/opt/reup-worker/bin/python`;
  - Demucs python là `/opt/reup-demucs/bin/python`;
  - TTS python là `/opt/reup-worker-tts/bin/python`;
  - state root là `/var/lib/reup-worker`; mỗi role một thư mục `<root>/batch/` hoặc `<root>/tts/`.
- **Proxy:** Tailscale mở HTTP proxy ở `http://127.0.0.1:1055`. Danh sách `NO_PROXY` là
  `localhost,127.0.0.1,.r2.cloudflarestorage.com,huggingface.co,.huggingface.co,.hf.co,download.pytorch.org,dl.fbaipublicfiles.com`.
- **Thời gian:**
  - Tailscale phải lên trong 60 s;
  - chờ Control Plane sẵn sàng tối đa 300 s;
  - agent crash thì chờ 5 s rồi khởi động lại, lỗi liên tục thì nhân đôi, tối đa 60 s;
  - agent chạy ≥ 60 s mới coi là ổn định;
  - khi tắt, chờ agent tối đa 30 s rồi mới `SIGKILL`.
- **Mã thoát:**
  - `0`: tắt bình thường;
  - `2`: cấu hình sai;
  - `3`: `TAILSCALE_UNAVAILABLE`;
  - `4`: `CONTROL_PLANE_UNREACHABLE`.
- **Không bao giờ log** giá trị của `TS_AUTHKEY`, `REUP_BATCH_ENROLLMENT_TOKEN`,
  `REUP_TTS_ENROLLMENT_TOKEN` hay credential. Env truyền cho agent con không được chứa
  `TS_AUTHKEY`. Auth key đưa cho `tailscale up` qua file `0600` (`--auth-key=file:<path>`),
  không đặt trên argv.
- **Image:** chỉ `linux/amd64`, chạy UID `10001`. Không đóng model vào image. Không
  `curl | sh`. Base image và image phụ đều khóa bằng digest, giống `UV_IMAGE` và `CUDA_IMAGE`.
- Hai target `batch` và `interactive-tts` cùng `workers/gpu/rental/*` **phải giữ nguyên hành vi**.
- **Commit message** kết thúc bằng một dòng trống, rồi
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Token bị lộ hoặc bị dùng lại.** Không được có token hay auth key trong log, trong
   argv hay trong env của agent. Token chỉ gửi ở lần chạy đầu. Khi file credential đã
   có, lần khởi động lại không được gửi token nữa. Test ở Task 1 (`agent_env`) và Task 3
   (argv của `tailscale up`).
2. **Pod nhận `SIGTERM` giữa lúc khởi động**, khi Tailscale chưa lên hoặc Control Plane
   chưa sẵn sàng. Supervisor phải thoát `0` ngay, không treo tới hết timeout, và không
   để lại `tailscaled`. Test ở Task 2 (`run_pod` bị dừng trong startup).
3. **Agent crash liên tục** (sai token, GPU lỗi). Không được spin nhanh: backoff phải
   đúng 5, 10, 20, 40, 60, 60… Chạy đủ 60 s thì reset về 5. Test ở Task 2.
4. **Agent không chịu dừng khi tắt pod.** Hết 30 s phải `kill`, và supervisor vẫn thoát
   `0`. Test ở Task 2.
5. **Chỉ bật một role** (`REUP_POD_ROLES=tts`). Chỉ agent đó chạy, và không đòi token
   của role kia. Test ở Task 1 và Task 2.

---

## File Structure

| File | Trách nhiệm |
| --- | --- |
| `workers/gpu/src/reup_worker/pod/__init__.py` | Docstring package |
| `workers/gpu/src/reup_worker/pod/config.py` | `RoleSpec`, `ROLES`, `PodConfig.from_env`, `PodConfigError`, `agent_env`, hằng số proxy |
| `workers/gpu/src/reup_worker/pod/supervisor.py` | `ProcessHandle`/`Launcher` Protocol, `restart_delay`, `Supervisor`, `PodStartupError`, `run_pod` |
| `workers/gpu/src/reup_worker/pod/startup.py` | `bring_up_tailscale`, `wait_for_control_plane` |
| `workers/gpu/src/reup_worker/pod/cli.py` | `log`, `SubprocessLauncher`, `main` (`--check`) |
| `workers/gpu/pyproject.toml` | script `reup-pod-supervisor` |
| `workers/gpu/src/reup_worker/image_smoke.py` | thêm role `runpod` |
| `workers/gpu/tests/test_pod_config.py`, `test_pod_supervisor.py`, `test_pod_startup.py`, `test_pod_cli.py` | test |
| `workers/gpu/containers/Dockerfile` | stage `tailscale`, `runpod-tts-venv`, target `runpod` |
| `.github/workflows/gpu-worker-images.yml` | matrix `runpod`, free disk, `--check` smoke |
| `docs/operations/gpu-worker-images.md` | runbook RunPod |

---

### Task 1: `reup_worker.pod.config`

**Files:**
- Create: `workers/gpu/src/reup_worker/pod/__init__.py`, `workers/gpu/src/reup_worker/pod/config.py`
- Test: `workers/gpu/tests/test_pod_config.py`

**Interfaces:**
- Produces:
  - `RoleSpec(key, role, executor, python, capabilities, token_env, extra_env)`;
  - `ROLES: dict[str, RoleSpec]` (`"batch"`, `"tts"`);
  - `PROXY_URL`, `NO_PROXY`;
  - `PodConfigError(problems: list[str])`;
  - `PodConfig` với các field `control_plane_url`, `tailscale_host`, `image_digest`, `roles`,
    `state_root`, `hostname`, `tokens` (repr=False), `tailscale_auth_key` (repr=False);
  - thuộc tính `uses_tailscale`, `ready_url`;
  - `PodConfig.from_env(env: Mapping[str, str]) -> PodConfig`;
  - `agent_env(config: PodConfig, spec: RoleSpec, base_env: Mapping[str, str]) -> dict[str, str]`.

- [ ] **Step 1: Viết test (fail)**

`workers/gpu/tests/test_pod_config.py`:

```python
import json
from pathlib import Path

import pytest

from reup_worker.pod.config import NO_PROXY, PROXY_URL, ROLES, PodConfig, PodConfigError, agent_env

DIGEST = "sha256:" + "a" * 64


def env(tmp_path: Path, **overrides: str) -> dict[str, str]:
    values = {
        "REUP_CONTROL_PLANE_HOST": "cp.tail.ts.net",
        "TS_AUTHKEY": "tskey-auth-secret",
        "REUP_WORKER_IMAGE_DIGEST": DIGEST,
        "REUP_BATCH_ENROLLMENT_TOKEN": "batch-token",
        "REUP_TTS_ENROLLMENT_TOKEN": "tts-token",
        "REUP_POD_STATE_ROOT": str(tmp_path),
        "RUNPOD_POD_ID": "Abc_123",
    }
    values.update(overrides)
    return {key: value for key, value in values.items() if value != ""}


def test_host_mode_goes_through_tailscale(tmp_path: Path) -> None:
    config = PodConfig.from_env(env(tmp_path))
    assert config.control_plane_url == "https://cp.tail.ts.net/worker/v1"
    assert config.ready_url == "https://cp.tail.ts.net/v1/health/ready"
    assert config.uses_tailscale and config.tailscale_auth_key == "tskey-auth-secret"
    assert [spec.key for spec in config.roles] == ["batch", "tts"]
    assert config.hostname == "reup-runpod-abc123"
    assert "secret" not in repr(config) and "batch-token" not in repr(config)


def test_direct_url_skips_tailscale(tmp_path: Path) -> None:
    config = PodConfig.from_env(env(tmp_path, REUP_CONTROL_PLANE_HOST="", TS_AUTHKEY="",
                                    REUP_CONTROL_PLANE_URL="http://127.0.0.1:18080/worker/v1/"))
    assert config.control_plane_url == "http://127.0.0.1:18080/worker/v1"
    assert not config.uses_tailscale


def test_reports_every_problem_without_values(tmp_path: Path) -> None:
    with pytest.raises(PodConfigError) as raised:
        PodConfig.from_env({"REUP_POD_STATE_ROOT": str(tmp_path), "REUP_WORKER_IMAGE_DIGEST": "latest",
                            "REUP_POD_ROLES": "batch,gpu"})
    problems = raised.value.problems
    assert "set REUP_CONTROL_PLANE_HOST or REUP_CONTROL_PLANE_URL" in problems
    assert "REUP_WORKER_IMAGE_DIGEST must be sha256:<64 hex>" in problems
    assert "REUP_POD_ROLES must list batch and/or tts" in problems
    assert "REUP_BATCH_ENROLLMENT_TOKEN is required until the batch worker has enrolled" in problems
    assert not any("latest" in problem for problem in problems)


def test_host_mode_requires_an_auth_key(tmp_path: Path) -> None:
    with pytest.raises(PodConfigError) as raised:
        PodConfig.from_env(env(tmp_path, TS_AUTHKEY=""))
    assert raised.value.problems == ["TS_AUTHKEY is required with REUP_CONTROL_PLANE_HOST"]


def test_single_role_needs_only_its_token(tmp_path: Path) -> None:
    config = PodConfig.from_env(env(tmp_path, REUP_POD_ROLES="tts", REUP_BATCH_ENROLLMENT_TOKEN=""))
    assert [spec.key for spec in config.roles] == ["tts"]


def test_existing_credential_replaces_the_token(tmp_path: Path) -> None:
    (tmp_path / "batch").mkdir()
    (tmp_path / "batch" / "credential").write_text("{}")
    config = PodConfig.from_env(env(tmp_path, REUP_BATCH_ENROLLMENT_TOKEN=""))
    assert [spec.key for spec in config.roles] == ["batch", "tts"]


def test_agent_env_is_role_specific_and_secret_free(tmp_path: Path) -> None:
    config = PodConfig.from_env(env(tmp_path))
    base = {"PATH": "/usr/bin", "TS_AUTHKEY": "tskey-auth-secret", "REUP_WORKER_ROLE": "stale",
            "https_proxy": "http://other:1", "REUP_TTS_ENROLLMENT_TOKEN": "tts-token", "HF_HOME": "/hf"}
    batch = agent_env(config, ROLES["batch"], base)
    assert batch["PATH"] == "/usr/bin" and batch["HF_HOME"] == "/hf"
    assert "TS_AUTHKEY" not in batch and "REUP_TTS_ENROLLMENT_TOKEN" not in batch
    assert batch["REUP_WORKER_ROLE"] == "BATCH_MEDIA" and batch["REUP_WORKER_EXECUTOR"] == "batch"
    assert json.loads(batch["REUP_WORKER_CAPABILITIES"]) == ["transcript.asr.v1", "audio.separate.demucs.v1",
                                                             "media.render.ffmpeg.v1"]
    assert batch["REUP_WORKER_DEMUCS_PYTHON"] == "/opt/reup-demucs/bin/python"
    assert batch["REUP_WORKER_CREDENTIAL_FILE"] == str(tmp_path / "batch" / "credential")
    assert batch["REUP_WORKER_ENROLLMENT_TOKEN"] == "batch-token"
    assert batch["HTTPS_PROXY"] == batch["https_proxy"] == PROXY_URL and batch["NO_PROXY"] == NO_PROXY
    tts = agent_env(config, ROLES["tts"], base)
    assert tts["REUP_WORKER_ROLE"] == "INTERACTIVE_TTS"
    assert json.loads(tts["REUP_WORKER_CAPABILITIES"]) == ["tts.omnivoice.v1"]
    assert tts["REUP_WORKER_TTS_MODEL_CACHE_ROOT"] == str(tmp_path / "tts" / "models")
    assert tts["REUP_WORKER_ENROLLMENT_TOKEN"] == "tts-token"


def test_agent_env_drops_the_token_once_enrolled_and_proxy_in_direct_mode(tmp_path: Path) -> None:
    config = PodConfig.from_env(env(tmp_path, REUP_CONTROL_PLANE_HOST="", TS_AUTHKEY="",
                                    REUP_CONTROL_PLANE_URL="http://127.0.0.1:18080/worker/v1"))
    (tmp_path / "batch").mkdir()
    (tmp_path / "batch" / "credential").write_text("{}")
    batch = agent_env(config, ROLES["batch"], {"HTTP_PROXY": "http://other:1"})
    assert "REUP_WORKER_ENROLLMENT_TOKEN" not in batch
    assert "HTTP_PROXY" not in batch and "HTTPS_PROXY" not in batch
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd workers/gpu && uv run pytest tests/test_pod_config.py`
Expected: FAIL `ModuleNotFoundError: No module named 'reup_worker.pod'`.

- [ ] **Step 3: Viết code**

`workers/gpu/src/reup_worker/pod/__init__.py`:

```python
"""RunPod pod supervisor: joins Tailscale and runs the Batch and Interactive TTS agents in one container."""
```

`workers/gpu/src/reup_worker/pod/config.py`:

```python
"""Pod configuration: which agents run, and the environment each one receives."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

PROXY_URL = "http://127.0.0.1:1055"
NO_PROXY = (
    "localhost,127.0.0.1,.r2.cloudflarestorage.com,huggingface.co,.huggingface.co,.hf.co,"
    "download.pytorch.org,dl.fbaipublicfiles.com"
)
SECRET_ENV = frozenset({"TS_AUTHKEY", "REUP_BATCH_ENROLLMENT_TOKEN", "REUP_TTS_ENROLLMENT_TOKEN"})
PROXY_ENV = frozenset({"HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "ALL_PROXY"})
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


@dataclass(frozen=True)
class RoleSpec:
    key: str
    role: str
    executor: str
    python: str
    capabilities: tuple[str, ...]
    token_env: str
    extra_env: tuple[tuple[str, str], ...] = ()


ROLES: dict[str, RoleSpec] = {
    "batch": RoleSpec(
        key="batch",
        role="BATCH_MEDIA",
        executor="batch",
        python="/opt/reup-worker/bin/python",
        capabilities=("transcript.asr.v1", "audio.separate.demucs.v1", "media.render.ffmpeg.v1"),
        token_env="REUP_BATCH_ENROLLMENT_TOKEN",
        extra_env=(
            ("REUP_WORKER_ASR_PYTHON", "/opt/reup-worker/bin/python"),
            ("REUP_WORKER_DEMUCS_PYTHON", "/opt/reup-demucs/bin/python"),
        ),
    ),
    "tts": RoleSpec(
        key="tts",
        role="INTERACTIVE_TTS",
        executor="interactive-tts",
        python="/opt/reup-worker-tts/bin/python",
        capabilities=("tts.omnivoice.v1",),
        token_env="REUP_TTS_ENROLLMENT_TOKEN",
    ),
}


class PodConfigError(ValueError):
    """Invalid pod environment; problems name variables but never contain their values."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class PodConfig:
    control_plane_url: str
    tailscale_host: str | None
    image_digest: str
    roles: tuple[RoleSpec, ...]
    state_root: Path
    hostname: str
    tokens: Mapping[str, str] = field(default_factory=dict, repr=False)
    tailscale_auth_key: str | None = field(default=None, repr=False)

    @property
    def uses_tailscale(self) -> bool:
        return self.tailscale_host is not None

    @property
    def ready_url(self) -> str:
        return self.control_plane_url.removesuffix("/worker/v1") + "/v1/health/ready"

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> PodConfig:
        problems: list[str] = []
        url = env.get("REUP_CONTROL_PLANE_URL", "").strip().rstrip("/")
        host = env.get("REUP_CONTROL_PLANE_HOST", "").strip()
        auth_key = env.get("TS_AUTHKEY", "").strip() or None
        tailscale_host: str | None = None
        if url:
            base = url
        elif host:
            base, tailscale_host = f"https://{host}/worker/v1", host
            if auth_key is None:
                problems.append("TS_AUTHKEY is required with REUP_CONTROL_PLANE_HOST")
        else:
            base = ""
            problems.append("set REUP_CONTROL_PLANE_HOST or REUP_CONTROL_PLANE_URL")
        digest = env.get("REUP_WORKER_IMAGE_DIGEST", "").strip()
        if not DIGEST.fullmatch(digest):
            problems.append("REUP_WORKER_IMAGE_DIGEST must be sha256:<64 hex>")
        keys = [key.strip() for key in env.get("REUP_POD_ROLES", "batch,tts").split(",") if key.strip()]
        if not keys or any(key not in ROLES for key in keys):
            problems.append("REUP_POD_ROLES must list batch and/or tts")
        roles = tuple(ROLES[key] for key in dict.fromkeys(keys) if key in ROLES)
        state_root = Path(env.get("REUP_POD_STATE_ROOT", "/var/lib/reup-worker"))
        tokens = {spec.key: env[spec.token_env].strip() for spec in roles if env.get(spec.token_env, "").strip()}
        for spec in roles:
            if spec.key not in tokens and not (state_root / spec.key / "credential").exists():
                problems.append(f"{spec.token_env} is required until the {spec.key} worker has enrolled")
        if problems:
            raise PodConfigError(problems)
        pod_id = env.get("RUNPOD_POD_ID") or env.get("HOSTNAME") or "pod"
        hostname = "reup-runpod-" + re.sub(r"[^a-z0-9-]", "", pod_id.lower())[:40]
        return cls(base, tailscale_host, digest, roles, state_root, hostname, tokens,
                   auth_key if tailscale_host else None)


def agent_env(config: PodConfig, spec: RoleSpec, base_env: Mapping[str, str]) -> dict[str, str]:
    """Environment for one agent: inherited basics, this role's settings, no pod secrets or foreign proxies."""
    env = {
        key: value
        for key, value in base_env.items()
        if key not in SECRET_ENV and not key.startswith("REUP_WORKER_") and key.upper() not in PROXY_ENV
    }
    root = config.state_root / spec.key
    env.update({
        "REUP_WORKER_CONTROL_PLANE_URL": config.control_plane_url,
        "REUP_WORKER_CONTRACT_VERSION": "2",
        "REUP_WORKER_IMAGE_DIGEST": config.image_digest,
        "REUP_WORKER_ROLE": spec.role,
        "REUP_WORKER_EXECUTOR": spec.executor,
        "REUP_WORKER_CAPABILITIES": json.dumps(list(spec.capabilities)),
        "REUP_WORKER_CREDENTIAL_FILE": str(root / "credential"),
        "REUP_WORKER_WORKSPACE_ROOT": str(root / "work"),
        "PYTHONUNBUFFERED": "1",
        "NO_PROXY": NO_PROXY,
        "no_proxy": NO_PROXY,
    })
    if spec.key == "tts":
        env["REUP_WORKER_TTS_PROMPT_CACHE_ROOT"] = str(root / "voice-prompts")
        env["REUP_WORKER_TTS_MODEL_CACHE_ROOT"] = str(root / "models")
    env.update(dict(spec.extra_env))
    if config.uses_tailscale:
        env.update(dict.fromkeys(("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"), PROXY_URL))
    token = config.tokens.get(spec.key)
    if token and not (root / "credential").exists():
        env["REUP_WORKER_ENROLLMENT_TOKEN"] = token
    return env
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd workers/gpu && uv run pytest tests/test_pod_config.py && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy`
Expected: PASS (8 test), ruff và mypy sạch. Nếu `ruff format --check` báo lỗi, chạy `uv run ruff format src/reup_worker/pod tests/test_pod_config.py` rồi chạy lại.

- [ ] **Step 5: Commit**

```bash
git add workers/gpu/src/reup_worker/pod workers/gpu/tests/test_pod_config.py
git commit -m "feat(worker): derive per-agent environment for a RunPod pod"
```

---

### Task 2: `reup_worker.pod.supervisor`

**Files:**
- Create: `workers/gpu/src/reup_worker/pod/supervisor.py`
- Test: `workers/gpu/tests/test_pod_supervisor.py`

**Interfaces:**
- Consumes: `PodConfig`, `RoleSpec`, `agent_env` (Task 1).
- Produces:
  - Protocol `ProcessHandle`: `wait() -> int` (async, gọi nhiều lần được), `terminate()`, `kill()`.
  - Protocol `Launcher`: `start(name: str, argv: Sequence[str], env: Mapping[str, str]) -> ProcessHandle` (async).
  - `Log = Callable[[str, str], None]`.
  - `restart_delay(consecutive_failures: int) -> float`.
  - `PodStartupError(code: str, exit_code: int)`.
  - `Supervisor(config, launcher, base_env, *, log, delay=restart_delay, clock=time.monotonic, grace_seconds=30.0)`,
    gồm các method `run_agents()`, `stop()`, `shutdown()`.
  - `run_pod(config, *, launcher, base_env, stop, log, bring_up_tailscale, wait_for_control_plane, supervisor_factory=Supervisor) -> int`,
    với:
    - `bring_up_tailscale: Callable[[PodConfig, Launcher], Awaitable[ProcessHandle]]`;
    - `wait_for_control_plane: Callable[[PodConfig], Awaitable[None]]`.

- [ ] **Step 1: Viết test (fail)**

`workers/gpu/tests/test_pod_supervisor.py`:

```python
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
    return PodConfig.from_env({
        "REUP_CONTROL_PLANE_URL": "http://127.0.0.1:18080/worker/v1", "REUP_WORKER_IMAGE_DIGEST": DIGEST,
        "REUP_BATCH_ENROLLMENT_TOKEN": "b", "REUP_TTS_ENROLLMENT_TOKEN": "t", "REUP_POD_STATE_ROOT": str(tmp_path),
        "REUP_POD_ROLES": roles,
    })


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

    supervisor = Supervisor(config(tmp_path, "batch"), launcher, {}, log=silent, delay=delay,
                            clock=lambda: next(times, 200.0))
    agents = asyncio.create_task(supervisor.run_agents())
    for _ in range(50):
        await asyncio.sleep(0)
    await supervisor.shutdown()
    await agents
    assert delays == [1, 1]


async def test_kills_an_agent_that_ignores_terminate(tmp_path: Path) -> None:
    stubborn = FakeHandle(None, ignores_terminate=True)
    supervisor = Supervisor(config(tmp_path, "tts"), FakeLauncher({"tts": [stubborn]}), {}, log=silent,
                            grace_seconds=0.05)
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
    tailnet_config = PodConfig.from_env({
        "REUP_CONTROL_PLANE_HOST": "cp.ts.net", "TS_AUTHKEY": "k", "REUP_WORKER_IMAGE_DIGEST": DIGEST,
        "REUP_BATCH_ENROLLMENT_TOKEN": "b", "REUP_TTS_ENROLLMENT_TOKEN": "t", "REUP_POD_STATE_ROOT": str(tmp_path),
    })
    pod = asyncio.create_task(run_pod(tailnet_config, launcher=launcher, base_env={}, stop=stop, log=silent,
                                      bring_up_tailscale=tailscale, wait_for_control_plane=ready))
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
    code = await run_pod(config(tmp_path), launcher=launcher, base_env={}, stop=asyncio.Event(), log=silent,
                         bring_up_tailscale=no_tailscale, wait_for_control_plane=unreachable)
    assert code == 4 and launcher.started == []


async def test_run_pod_stops_promptly_during_startup(tmp_path: Path) -> None:
    async def never_ready(cfg: PodConfig) -> None:
        del cfg
        await asyncio.sleep(3600)

    async def no_tailscale(cfg: PodConfig, launcher: Launcher) -> ProcessHandle:
        raise AssertionError("direct mode must not start Tailscale")

    stop = asyncio.Event()
    pod = asyncio.create_task(run_pod(config(tmp_path), launcher=FakeLauncher({}), base_env={}, stop=stop,
                                      log=silent, bring_up_tailscale=no_tailscale, wait_for_control_plane=never_ready))
    await asyncio.sleep(0)
    stop.set()
    assert await asyncio.wait_for(pod, 1) == 0
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd workers/gpu && uv run pytest tests/test_pod_supervisor.py`
Expected: FAIL `ModuleNotFoundError: No module named 'reup_worker.pod.supervisor'`.

- [ ] **Step 3: Viết code**

`workers/gpu/src/reup_worker/pod/supervisor.py`:

```python
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
        await asyncio.gather(*(self._supervise(spec) for spec in self._config.roles))

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
```

Lưu ý: `failures = 1 if … stable …` nghĩa là sau một lần chạy ổn định, lần crash kế tiếp tính là lần lỗi đầu tiên (chờ 5 s). Hai test `delays == [1, 2]` và `delays == [1, 1]` kiểm tra đúng điều này.

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd workers/gpu && uv run pytest tests/test_pod_supervisor.py tests/test_pod_config.py && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy`
Expected: PASS, không có warning nào kiểu "Task was destroyed but it is pending". Nếu mypy phàn nàn về `supervisor_factory: Callable[..., Supervisor]`, giữ nguyên chữ ký đó và đổi lời gọi thành
`supervisor_factory(config, launcher, base_env, log=log)`, vì đây đúng là lời gọi hiện có.

- [ ] **Step 5: Commit**

```bash
git add workers/gpu/src/reup_worker/pod/supervisor.py workers/gpu/tests/test_pod_supervisor.py
git commit -m "feat(worker): supervise both agents inside one pod"
```

---

### Task 3: `reup_worker.pod.startup` và `reup_worker.pod.cli`

**Files:**
- Create: `workers/gpu/src/reup_worker/pod/startup.py`, `workers/gpu/src/reup_worker/pod/cli.py`
- Modify: `workers/gpu/pyproject.toml` (`[project.scripts]`)
- Test: `workers/gpu/tests/test_pod_startup.py`, `workers/gpu/tests/test_pod_cli.py`

**Interfaces:**
- Consumes: `PodConfig`, `PROXY_URL`, `PodConfigError` (Task 1); `Launcher`, `ProcessHandle`,
  `PodStartupError`, `run_pod`, `Log` (Task 2).
- Produces:
  - `bring_up_tailscale(config, launcher, *, timeout=60.0, poll=0.5) -> ProcessHandle`;
  - `wait_for_control_plane(config, *, timeout=300.0, client_factory=httpx.AsyncClient, sleep=asyncio.sleep, clock=time.monotonic) -> None`;
  - `log(source, message)`;
  - `SubprocessLauncher(log)`;
  - `main(argv: list[str] | None = None) -> None`;
  - script `reup-pod-supervisor = "reup_worker.pod.cli:main"`.

- [ ] **Step 1: Viết test (fail)**

`workers/gpu/tests/test_pod_startup.py`:

```python
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
    return PodConfig.from_env({
        "REUP_CONTROL_PLANE_HOST": "cp.ts.net", "TS_AUTHKEY": "tskey-auth-secret", "REUP_WORKER_IMAGE_DIGEST": DIGEST,
        "REUP_BATCH_ENROLLMENT_TOKEN": "b", "REUP_TTS_ENROLLMENT_TOKEN": "t", "REUP_POD_STATE_ROOT": str(tmp_path),
        "RUNPOD_POD_ID": "pod1",
    })


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
    config = PodConfig.from_env({
        "REUP_CONTROL_PLANE_URL": "http://cp.test/worker/v1", "REUP_WORKER_IMAGE_DIGEST": DIGEST,
        "REUP_BATCH_ENROLLMENT_TOKEN": "b", "REUP_TTS_ENROLLMENT_TOKEN": "t", "REUP_POD_STATE_ROOT": str(tmp_path),
    })
    route = respx.get("http://cp.test/v1/health/ready").mock(
        side_effect=[httpx.ConnectError("down"), httpx.Response(503), httpx.Response(200)]
    )

    async def no_sleep(seconds: float) -> None:
        del seconds

    await wait_for_control_plane(config, sleep=no_sleep)
    assert route.call_count == 3


@respx.mock
async def test_gives_up_on_an_unreachable_control_plane(tmp_path: Path) -> None:
    config = PodConfig.from_env({
        "REUP_CONTROL_PLANE_URL": "http://cp.test/worker/v1", "REUP_WORKER_IMAGE_DIGEST": DIGEST,
        "REUP_BATCH_ENROLLMENT_TOKEN": "b", "REUP_TTS_ENROLLMENT_TOKEN": "t", "REUP_POD_STATE_ROOT": str(tmp_path),
    })
    respx.get("http://cp.test/v1/health/ready").mock(return_value=httpx.Response(503))
    ticks = iter([0.0, 100.0, 400.0])

    async def no_sleep(seconds: float) -> None:
        await asyncio.sleep(0)

    with pytest.raises(PodStartupError) as raised:
        await wait_for_control_plane(config, sleep=no_sleep, clock=lambda: next(ticks, 400.0))
    assert raised.value.code == "CONTROL_PLANE_UNREACHABLE"
```

`workers/gpu/tests/test_pod_cli.py`:

```python
import sys
from pathlib import Path

import pytest

from reup_worker.pod.cli import SubprocessLauncher, main

DIGEST = "sha256:" + "d" * 64


def test_check_accepts_a_valid_pod_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
                                               capsys: pytest.CaptureFixture[str]) -> None:
    for key, value in {"REUP_CONTROL_PLANE_URL": "https://cp.example/worker/v1", "REUP_WORKER_IMAGE_DIGEST": DIGEST,
                       "REUP_BATCH_ENROLLMENT_TOKEN": "batch-secret", "REUP_TTS_ENROLLMENT_TOKEN": "tts-secret",
                       "REUP_POD_STATE_ROOT": str(tmp_path)}.items():
        monkeypatch.setenv(key, value)
    main(["--check"])
    output = capsys.readouterr().out
    assert "[supervisor] configuration ok: roles=batch,tts tailscale=no" in output
    assert "secret" not in output


def test_invalid_environment_exits_2_and_names_variables(monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
                                                         capsys: pytest.CaptureFixture[str]) -> None:
    for key in ("REUP_CONTROL_PLANE_URL", "REUP_CONTROL_PLANE_HOST", "REUP_WORKER_IMAGE_DIGEST"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("REUP_POD_STATE_ROOT", str(tmp_path))
    with pytest.raises(SystemExit) as raised:
        main(["--check"])
    assert raised.value.code == 2
    assert "[supervisor] set REUP_CONTROL_PLANE_HOST or REUP_CONTROL_PLANE_URL" in capsys.readouterr().out


async def test_subprocess_launcher_prefixes_output(capsys: pytest.CaptureFixture[str]) -> None:
    lines: list[tuple[str, str]] = []
    launcher = SubprocessLauncher(lambda source, message: lines.append((source, message)))
    handle = await launcher.start("batch", [sys.executable, "-c", "print('hello'); import sys; sys.exit(3)"], {})
    assert await handle.wait() == 3
    assert await handle.wait() == 3
    assert ("batch", "hello") in lines
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd workers/gpu && uv run pytest tests/test_pod_startup.py tests/test_pod_cli.py`
Expected: FAIL `ModuleNotFoundError` cho `reup_worker.pod.startup` và `reup_worker.pod.cli`.

- [ ] **Step 3: Viết code**

`workers/gpu/src/reup_worker/pod/startup.py`:

```python
"""Pod startup steps: join the tailnet in userspace mode and wait for the Control Plane."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable

import httpx

from .config import PROXY_URL, PodConfig
from .supervisor import Launcher, PodStartupError, ProcessHandle


async def bring_up_tailscale(
    config: PodConfig, launcher: Launcher, *, timeout: float = 60.0, poll: float = 0.5
) -> ProcessHandle:
    """Start tailscaled (userspace, HTTP proxy on 127.0.0.1:1055) and join; the auth key goes through a 0600 file."""
    directory = config.state_root / "tailscale"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    socket = directory / "tailscaled.sock"
    env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")}
    daemon = await launcher.start("tailscale", [
        "tailscaled", "--tun=userspace-networking", f"--state={directory / 'tailscaled.state'}",
        f"--socket={socket}", "--outbound-http-proxy-listen=127.0.0.1:1055",
    ], env)
    key_file = directory / "authkey"
    try:
        deadline = time.monotonic() + timeout
        while not socket.exists():
            if time.monotonic() >= deadline:
                raise PodStartupError("TAILSCALE_UNAVAILABLE", 3)
            await asyncio.sleep(poll)
        descriptor = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(config.tailscale_auth_key or "")
        joined = await launcher.start("tailscale", [
            "tailscale", f"--socket={socket}", "up", f"--auth-key=file:{key_file}",
            f"--hostname={config.hostname}", f"--timeout={int(timeout)}s",
        ], env)
        if await joined.wait() != 0:
            raise PodStartupError("TAILSCALE_UNAVAILABLE", 3)
    except BaseException:
        daemon.terminate()
        raise
    finally:
        key_file.unlink(missing_ok=True)
    return daemon


async def wait_for_control_plane(
    config: PodConfig,
    *,
    timeout: float = 300.0,
    client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> None:
    deadline = clock() + timeout
    delay = 1.0
    async with client_factory(proxy=PROXY_URL if config.uses_tailscale else None, timeout=10.0) as client:
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
```

`workers/gpu/src/reup_worker/pod/cli.py`:

```python
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
```

Trong `workers/gpu/pyproject.toml`, ở `[project.scripts]`, thêm dòng:

```toml
reup-pod-supervisor = "reup_worker.pod.cli:main"
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd workers/gpu && uv sync && make check`
Expected: toàn bộ lint, typecheck và test pass. Riêng test pod: 8 (Task 1) + 7 (Task 2) + 5 + 3. Output không có warning.
- Nếu ruff cảnh báo `S603`/`S607` (subprocess) ở `cli.py`, thêm `# noqa: S603` tại dòng `create_subprocess_exec`. argv do code tự dựng, không lấy từ input người dùng.
- Nếu `httpx.AsyncClient(proxy=None)` báo lỗi kiểu (mypy), đổi thành truyền `**({"proxy": PROXY_URL} if config.uses_tailscale else {})`.

- [ ] **Step 5: Commit**

```bash
git add workers/gpu/src/reup_worker/pod workers/gpu/tests/test_pod_startup.py workers/gpu/tests/test_pod_cli.py workers/gpu/pyproject.toml workers/gpu/uv.lock
git commit -m "feat(worker): reup-pod-supervisor entry point with Tailscale startup"
```

(`uv.lock` chỉ add nếu `uv sync` làm nó thay đổi.)

---

### Task 4: Target `runpod` trong Dockerfile, smoke và CI

**Files:**
- Modify: `workers/gpu/src/reup_worker/image_smoke.py`
- Modify: `workers/gpu/containers/Dockerfile`
- Modify: `.github/workflows/gpu-worker-images.yml`

**Interfaces:**
- Consumes: script `reup-pod-supervisor` (Task 3).
- Produces: image `ghcr.io/<owner>/gpu-worker-runpod` (tag `0.1.0` và `sha-<sha>`), artifact `gpu-worker-runpod.digest.txt`.

- [ ] **Step 1: Thêm role `runpod` vào `image_smoke`**

Trong `workers/gpu/src/reup_worker/image_smoke.py`:
- đổi `choices=("batch", "interactive-tts")` thành `choices=("batch", "interactive-tts", "runpod")`;
- thay khối `if arguments.role == "batch": … else: …` bằng:

```python
    if arguments.role == "batch":
        check_batch_environments()
    elif arguments.role == "runpod":
        check_batch_environments()
        check_runpod_tts_environment()
        for binary in ("tailscale", "tailscaled", "reup-pod-supervisor"):
            if not shutil.which(binary):
                raise RuntimeError(f"RunPod image requires {binary}")
    else:
        for package in DEPENDENCIES[arguments.role]:
            importlib.metadata.version(package)
```

và thêm hàm:

```python
def check_runpod_tts_environment() -> None:
    import subprocess

    packages = DEPENDENCIES["interactive-tts"]
    command = "import importlib.metadata as m;" + ";".join(f"m.version({item!r})" for item in packages)
    command += ";__import__('omnivoice');__import__('reup_worker.main')"
    subprocess.run(["/opt/reup-worker-tts/bin/python", "-c", command], check=True)  # noqa: S603
```

Run: `cd workers/gpu && make check`
Expected: PASS. Hàm mới chỉ chạy trong image; `make check` chỉ cần lint và typecheck sạch.

- [ ] **Step 2: Thêm stage vào Dockerfile**

Trong `workers/gpu/containers/Dockerfile`:

(a) Sau dòng `ARG CUDA_IMAGE=…`, thêm:

```dockerfile
ARG TAILSCALE_IMAGE=tailscale/tailscale:<TAILSCALE_TAG>@sha256:<TAILSCALE_DIGEST>
```

Để có giá trị ghim:
- chạy `docker buildx imagetools inspect tailscale/tailscale:stable`, lấy tag phiên bản (`v1.x.y`) mà `stable` đang trỏ tới, và digest của **index** (dòng `Digest:` đầu tiên);
- rồi chạy `docker buildx imagetools inspect tailscale/tailscale:<tag>` để xác nhận digest trùng.

Nếu máy không truy cập được Docker Hub, dừng lại và báo `NEEDS_CONTEXT`. Không đoán digest.

(b) Ngay sau dòng `FROM ${UV_IMAGE} AS uv` (trước `FROM ${CUDA_IMAGE} AS foundation`), thêm:

```dockerfile
FROM ${TAILSCALE_IMAGE} AS tailscale
```

(c) Thêm vào cuối file:

```dockerfile
FROM foundation AS runpod-tts-venv
COPY workers/gpu/tts/requirements.lock /tmp/tts.requirements.lock
RUN uv venv --python 3.11 /opt/reup-worker-tts \
    && uv pip install --python /opt/reup-worker-tts \
      --extra-index-url https://download.pytorch.org/whl/cu128 \
      --requirement /tmp/tts.requirements.lock \
    && uv pip install --python /opt/reup-worker-tts /opt/source \
    && rm -rf /root/.cache /tmp/*

FROM foundation AS runpod
COPY --from=batch /opt/reup-worker /opt/reup-worker
COPY --from=batch /opt/reup-demucs /opt/reup-demucs
COPY --from=runpod-tts-venv /opt/reup-worker-tts /opt/reup-worker-tts
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscaled /usr/local/bin/
ENV REUP_POD_STATE_ROOT=/var/lib/reup-worker
USER 10001:10001
WORKDIR /var/lib/reup-worker
ENTRYPOINT ["reup-pod-supervisor"]
```

Ghi chú:
- `foundation` đã cài package `reup_worker` vào `/opt/reup-worker`, nên có script `reup-pod-supervisor` sau Task 3.
- `COPY --from=batch /opt/reup-worker` ghi đè bằng venv đã có thêm dependency ASR.
- Không đặt `REUP_WORKER_ROLE` hay capability ở target này, vì supervisor tự đặt cho từng agent.

- [ ] **Step 3: Thêm vào CI**

Trong `.github/workflows/gpu-worker-images.yml`, job `image`:

(a) Thêm vào `matrix.include`:

```yaml
          - target: runpod
            repository: gpu-worker-runpod
```

(b) Thêm bước đầu tiên trong `steps` (trước `actions/checkout`), để image gộp không làm hết đĩa runner:

```yaml
      - name: Free runner disk space
        if: matrix.target == 'runpod'
        run: |
          sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL
          docker system prune -af
          df -h /
```

(c) Sau bước `Smoke test image without model inference`, thêm:

```yaml
      - name: Validate pod supervisor configuration
        if: matrix.target == 'runpod'
        run: >-
          docker run --rm
          -e REUP_CONTROL_PLANE_URL=https://control-plane.invalid/worker/v1
          -e REUP_WORKER_IMAGE_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000
          -e REUP_BATCH_ENROLLMENT_TOKEN=ci-batch -e REUP_TTS_ENROLLMENT_TOKEN=ci-tts
          local/${{ matrix.repository }}:${{ github.sha }} --check
```

Bước smoke hiện có (`python -m reup_worker.image_smoke ${{ matrix.target }}`) tự chạy cho `runpod` nhờ Step 1.

- [ ] **Step 4: Kiểm tra cú pháp**

Run:
- `cd workers/gpu && make check`;
- `docker buildx build --check -f workers/gpu/containers/Dockerfile .`, chạy từ repo root, lint Dockerfile, không build thật;
- `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/gpu-worker-images.yml'))"`.
  Nếu không có PyYAML thì dùng `ruby -ryaml -e "YAML.load_file('.github/workflows/gpu-worker-images.yml')"`.

Expected: không lỗi.

Máy Mac arm64 **không** build được target này: Dockerfile yêu cầu `TARGETARCH=amd64`, và image CUDA/torch rất lớn. Việc build thật diễn ra ở CI (Task 6).

- [ ] **Step 5: Commit**

```bash
git add workers/gpu/src/reup_worker/image_smoke.py workers/gpu/containers/Dockerfile .github/workflows/gpu-worker-images.yml
git commit -m "feat(worker): build a single RunPod image for both agents"
```

---

### Task 5: Runbook RunPod

**Files:**
- Modify: `docs/operations/gpu-worker-images.md` (thêm mục cuối file)
- Modify: `docs/superpowers/specs/2026-09-28-runpod-worker-image-design.md` (đổi trạng thái)

- [ ] **Step 1: Viết mục `## RunPod (một pod, hai worker)`**

Nội dung bằng tiếng Việt, theo giọng văn của file, gồm các bước theo thứ tự:

1. Lấy digest từ artifact `gpu-worker-runpod.digest.txt` của workflow thành công.
2. `POST /worker-images` hai lần với cùng `imageDigest` và `contractVersion=2`:
   - `role=BATCH_MEDIA`, capabilities `transcript.asr.v1`, `audio.separate.demucs.v1`, `media.render.ffmpeg.v1`;
   - `role=INTERACTIVE_TTS`, capability `tts.omnivoice.v1`.
3. Tạo hai Worker từ hai approved image đó, cùng đặt `provider=RunPod`:
   - Worker Batch mang giá thuê theo giờ của pod;
   - Worker TTS đặt `hourlyRateCp=0`, để không đếm trùng chi phí.

   Lấy hai enrollment token.
4. Tạo auth key Tailscale loại **ephemeral, pre-approved**, gắn `tag:gpu`. ACL chỉ cho `tag:gpu` gọi Control Plane qua HTTPS.
5. Tạo template RunPod:
   - image `ghcr.io/thanhtugenki/gpu-worker-runpod@sha256:<digest>`;
   - Secure Cloud, GPU 24 GB, container disk ≥ 60 GB;
   - các biến môi trường ở spec §5.1.
6. Tạo pod, xem Logs có dòng `[supervisor] starting agents: batch,tts`, và xác nhận hai Worker `ACTIVE` trên UI. Điền `providerInstanceId` = pod ID nếu muốn.
7. Khi xong việc:
   - **terminate** pod, không dùng stop rồi resume, vì credential nằm trên container disk;
   - lần sau tạo Worker hoặc token mới.
8. Bảng xử lý lỗi theo exit code `2/3/4` và mã log `TAILSCALE_UNAVAILABLE`, `CONTROL_PLANE_UNREACHABLE`.

- [ ] **Step 2: Cập nhật trạng thái spec**

Đổi `**Trạng thái:** \`DRAFT\`, chờ duyệt.` thành `**Trạng thái:** \`IMPLEMENTED\` (chờ chạy thử trên RunPod).`

- [ ] **Step 3: Commit**

```bash
git add docs/operations/gpu-worker-images.md docs/superpowers/specs/2026-09-28-runpod-worker-image-design.md
git commit -m "docs: runbook for running both workers on one RunPod pod"
```

---

### Task 6: Chạy CI để build image thật

**Files:** không có. Task này dành cho controller.

- [ ] **Step 1: Xin người vận hành xác nhận push.** Push nhánh `feat/runpod-worker-image` và mở PR draft vào `main`, để workflow `GPU Worker images` chạy trên `pull_request`: build và smoke cả ba target, chưa push image.
- [ ] **Step 2: Theo dõi kết quả.** Chạy `gh pr checks <n> --watch`. Job `image (runpod)` phải qua các bước build, `image_smoke runpod`, `--check`, scan.
  - Nếu hết đĩa, hoặc import lỗi trong venv TTS, sửa trên nhánh rồi push lại. Mỗi lần sửa là một commit riêng, theo quy tắc review.
- [ ] **Step 3: Báo kết quả.** Báo lại cho người vận hành. Việc merge (để CI push image `0.1.0`) và chạy thử trên RunPod thật là quyết định của người vận hành.
