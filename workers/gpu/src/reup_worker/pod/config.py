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
        token_env="REUP_BATCH_ENROLLMENT_TOKEN",  # noqa: S106 -- env var name, not a credential
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
        token_env="REUP_TTS_ENROLLMENT_TOKEN",  # noqa: S106 -- env var name, not a credential
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
        return cls(
            base, tailscale_host, digest, roles, state_root, hostname, tokens, auth_key if tailscale_host else None
        )


def agent_env(config: PodConfig, spec: RoleSpec, base_env: Mapping[str, str]) -> dict[str, str]:
    """Environment for one agent: inherited basics, this role's settings, no pod secrets or foreign proxies."""
    env = {
        key: value
        for key, value in base_env.items()
        if key not in SECRET_ENV and not key.startswith("REUP_WORKER_") and key.upper() not in PROXY_ENV
    }
    root = config.state_root / spec.key
    env.update(
        {
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
        }
    )
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
