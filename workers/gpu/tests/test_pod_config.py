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
    config = PodConfig.from_env(
        env(
            tmp_path,
            REUP_CONTROL_PLANE_HOST="",
            TS_AUTHKEY="",
            REUP_CONTROL_PLANE_URL="http://127.0.0.1:18080/worker/v1/",
        )
    )
    assert config.control_plane_url == "http://127.0.0.1:18080/worker/v1"
    assert not config.uses_tailscale


def test_reports_every_problem_without_values(tmp_path: Path) -> None:
    with pytest.raises(PodConfigError) as raised:
        PodConfig.from_env(
            {"REUP_POD_STATE_ROOT": str(tmp_path), "REUP_WORKER_IMAGE_DIGEST": "latest", "REUP_POD_ROLES": "batch,gpu"}
        )
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
    base = {
        "PATH": "/usr/bin",
        "TS_AUTHKEY": "tskey-auth-secret",
        "REUP_WORKER_ROLE": "stale",
        "https_proxy": "http://other:1",
        "REUP_TTS_ENROLLMENT_TOKEN": "tts-token",
        "HF_HOME": "/hf",
    }
    batch = agent_env(config, ROLES["batch"], base)
    assert batch["PATH"] == "/usr/bin" and batch["HF_HOME"] == "/hf"
    assert "TS_AUTHKEY" not in batch and "REUP_TTS_ENROLLMENT_TOKEN" not in batch
    assert batch["REUP_WORKER_ROLE"] == "BATCH_MEDIA" and batch["REUP_WORKER_EXECUTOR"] == "batch"
    assert json.loads(batch["REUP_WORKER_CAPABILITIES"]) == [
        "transcript.asr.v1",
        "audio.separate.demucs.v1",
        "media.render.ffmpeg.v1",
    ]
    assert batch["REUP_WORKER_DEMUCS_PYTHON"] == "/opt/reup-demucs/bin/python"
    assert batch["REUP_WORKER_CREDENTIAL_FILE"] == str(tmp_path / "batch" / "credential")
    assert batch["REUP_WORKER_ENROLLMENT_TOKEN"] == "batch-token"  # noqa: S105 -- test fixture value
    assert batch["HTTPS_PROXY"] == batch["https_proxy"] == PROXY_URL and batch["NO_PROXY"] == NO_PROXY
    tts = agent_env(config, ROLES["tts"], base)
    assert tts["REUP_WORKER_ROLE"] == "INTERACTIVE_TTS"
    assert json.loads(tts["REUP_WORKER_CAPABILITIES"]) == ["tts.omnivoice.v1"]
    assert tts["REUP_WORKER_TTS_MODEL_CACHE_ROOT"] == str(tmp_path / "tts" / "models")
    assert tts["REUP_WORKER_ENROLLMENT_TOKEN"] == "tts-token"  # noqa: S105 -- test fixture value


def test_agent_env_drops_the_token_once_enrolled_and_proxy_in_direct_mode(tmp_path: Path) -> None:
    config = PodConfig.from_env(
        env(
            tmp_path,
            REUP_CONTROL_PLANE_HOST="",
            TS_AUTHKEY="",
            REUP_CONTROL_PLANE_URL="http://127.0.0.1:18080/worker/v1",
        )
    )
    (tmp_path / "batch").mkdir()
    (tmp_path / "batch" / "credential").write_text("{}")
    batch = agent_env(config, ROLES["batch"], {"HTTP_PROXY": "http://other:1"})
    assert "REUP_WORKER_ENROLLMENT_TOKEN" not in batch
    assert "HTTP_PROXY" not in batch and "HTTPS_PROXY" not in batch
