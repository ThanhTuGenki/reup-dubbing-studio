from pathlib import Path

from pydantic import Field, HttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from reup_worker_contract.models.worker_role import WorkerRole


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="REUP_WORKER_", env_file=".env", extra="ignore")

    control_plane_url: HttpUrl = HttpUrl("http://localhost:3000/worker/v1")
    role: WorkerRole
    image_digest: str
    agent_version: str = "0.1.0"
    contract_version: int = Field(default=1, ge=1)
    capabilities: tuple[str, ...]
    credential_file: Path = Path(".state/credential")
    workspace_root: Path = Path(".work")
    enrollment_token: str | None = Field(default=None, repr=False)
    heartbeat_interval_seconds: int = Field(default=15, ge=5, le=60)
    task_timeout_seconds: int = Field(default=3600, ge=1)
    executor: str = "missing"
    fake_behavior: str = "success"
    fake_step_delay_seconds: float = Field(default=0.01, ge=0.001, le=60)
    max_input_bytes: int = Field(default=10 * 1024 * 1024 * 1024, ge=1)
    allow_http_asset_urls: bool = False
    success_workspace_retention_seconds: int = Field(default=0, ge=0)
    failure_workspace_retention_seconds: int = Field(default=3600, ge=0)
    asr_python: str = "python"
    ocr_python: str = "python"
    demucs_python: str = "python"
    tts_model_id: str = "k2-fsa/OmniVoice"
    tts_model_revision: str = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
    tts_audio_tokenizer_id: str = "eustlb/higgs-audio-v2-tokenizer"
    tts_audio_tokenizer_revision: str = "528e871c2a26c4f0f7773b9754e2e1acae20899d"
    tts_model_cache_root: Path = Path(".state/models")
    tts_model_license: str = "CC_BY_NC"
    tts_usage_mode: str = "prototype"
    tts_prompt_cache_root: Path = Path(".state/voice-prompts")
    tts_request_timeout_seconds: int = Field(default=300, ge=1)
    tts_max_requests_before_restart: int = Field(default=100, ge=1)
    tts_max_vram_mb_before_restart: int = Field(default=10500, ge=1)

    @field_validator("executor")
    @classmethod
    def validate_executor(cls, value: str) -> str:
        if value not in {"missing", "fake", "batch", "interactive-tts"}:
            raise ValueError("executor must be 'missing', 'fake', 'batch', or 'interactive-tts'")
        return value

    @field_validator("tts_usage_mode")
    @classmethod
    def validate_tts_usage_mode(cls, value: str) -> str:
        if value not in {"prototype", "production-commercial"}:
            raise ValueError("TTS usage mode must be 'prototype' or 'production-commercial'")
        return value

    @field_validator("tts_model_license")
    @classmethod
    def validate_tts_model_license(cls, value: str) -> str:
        if value not in {"CC_BY_NC", "COMMERCIAL_LICENSED"}:
            raise ValueError("TTS model license must be 'CC_BY_NC' or 'COMMERCIAL_LICENSED'")
        return value

    @field_validator("tts_model_revision", "tts_audio_tokenizer_revision")
    @classmethod
    def validate_model_revision(cls, value: str) -> str:
        if len(value) != 40 or any(character not in "0123456789abcdef" for character in value):
            raise ValueError("TTS model revisions must be full lowercase Git SHAs")
        return value

    @field_validator("fake_behavior")
    @classmethod
    def validate_fake_behavior(cls, value: str) -> str:
        if value not in {"success", "fail", "timeout", "wait-for-cancel"}:
            raise ValueError("unsupported fake behavior")
        return value

    @field_validator("image_digest")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        if not value.startswith("sha256:") or len(value) != 71:
            raise ValueError("image digest must be an immutable sha256 digest")
        return value

    @field_validator("capabilities", mode="before")
    @classmethod
    def parse_capabilities(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(part.strip() for part in value.split(",") if part.strip())
        return value
