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

    @field_validator("executor")
    @classmethod
    def validate_executor(cls, value: str) -> str:
        if value not in {"missing", "fake"}:
            raise ValueError("executor must be 'missing' or 'fake'")
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
