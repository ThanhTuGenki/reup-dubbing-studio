from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed worker settings.

    ``control_plane_url`` is intentionally required so a worker cannot start
    disconnected from its control plane.
    """

    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    control_plane_url: str = Field(validation_alias="CONTROL_PLANE_URL")
    worker_role: str = Field(default="batch_media", validation_alias="WORKER_ROLE")
    enrollment_token: str | None = Field(default=None, validation_alias="ENROLLMENT_TOKEN")
    workspace_dir: Path = Field(default=Path("/workspace"), validation_alias="WORKSPACE_DIR")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    log_format: str = Field(default="text", validation_alias="LOG_FORMAT")
    worker_id: str | None = Field(default=None, validation_alias="WORKER_ID")


def load_settings(*, worker_role: str | None = None) -> Settings:
    settings = Settings()  # type: ignore[call-arg]
    if worker_role is not None:
        settings.worker_role = worker_role
    return settings
