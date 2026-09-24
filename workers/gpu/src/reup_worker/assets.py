import hashlib
import os
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from reup_worker_contract.models.claimed_task import ClaimedTask
from reup_worker_contract.models.download_grant import DownloadGrant
from reup_worker_contract.models.output_grant_request import OutputGrantRequest
from reup_worker_contract.models.output_grant_request_metadata import OutputGrantRequestMetadata
from reup_worker_contract.models.task_input_asset import TaskInputAsset
from reup_worker_contract.models.task_output_reference import TaskOutputReference
from reup_worker_contract.models.task_output_specification import TaskOutputSpecification
from reup_worker_contract.models.upload_grant import UploadGrant

from .ports import AssetControlPlane

CHUNK_SIZE = 1024 * 1024
S3_SINGLE_PUT_LIMIT = 5 * 1024 * 1024 * 1024


class AssetTransferError(RuntimeError):
    pass


class AssetGrantExpired(AssetTransferError):
    pass


class AssetTransfer:
    def __init__(
        self,
        control_plane: AssetControlPlane,
        workspace_root: Path,
        *,
        max_input_bytes: int,
        allow_http: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._control_plane = control_plane
        self._root = workspace_root.resolve()
        self._max_input_bytes = max_input_bytes
        self._allow_http = allow_http
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15))
        self._owns_client = client is None

    async def download(self, task: ClaimedTask, value: TaskInputAsset) -> Path:
        grant = value.download
        if grant.expires_at <= datetime.now(UTC) + timedelta(seconds=30):
            grant = await self._control_plane.refresh_input(task, value.asset_id)
        self._validate_expiry(grant.expires_at)
        self._validate_url(grant.url)
        expected = parse_size(grant.byte_size, "input byte size")
        if expected > self._max_input_bytes:
            raise AssetTransferError("input exceeds the configured byte limit")
        destination = self._input_path(task, grant)
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = destination.with_suffix(f"{destination.suffix}.part")
        digest = hashlib.sha256()
        received = 0
        try:
            async with self._client.stream("GET", grant.url, headers=headers(grant.headers)) as response:
                response.raise_for_status()
                response_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
                if response_type and response_type != grant.content_type.lower():
                    raise AssetTransferError("download content type does not match its grant")
                with temporary.open("xb") as output:
                    async for chunk in response.aiter_bytes(CHUNK_SIZE):
                        received += len(chunk)
                        if received > expected or received > self._max_input_bytes:
                            raise AssetTransferError("download exceeded its declared byte size")
                        digest.update(chunk)
                        output.write(chunk)
            if received != expected:
                raise AssetTransferError("download byte size does not match its grant")
            if grant.checksum_sha_256 and digest.hexdigest() != grant.checksum_sha_256:
                raise AssetTransferError("download checksum verification failed")
            os.replace(temporary, destination)
            destination.chmod(0o600)
            return destination
        except Exception:
            temporary.unlink(missing_ok=True)
            raise

    async def upload(
        self,
        task: ClaimedTask,
        specification: TaskOutputSpecification,
        path: Path,
        content_type: str,
        metadata: Mapping[str, object] | None = None,
    ) -> TaskOutputReference:
        source = self._output_path(task, path)
        if content_type not in specification.allowed_content_types:
            raise AssetTransferError("output content type is not allowed for its slot")
        size = source.stat().st_size
        if size < 1 or size > parse_size(specification.max_byte_size, "output byte limit"):
            raise AssetTransferError("output exceeds its declared byte limit")
        if size > S3_SINGLE_PUT_LIMIT:
            raise AssetTransferError("output requires a multipart upload grant")
        checksum = file_sha256(source)
        meta = OutputGrantRequestMetadata()
        meta.additional_properties.update(metadata or {})
        grant = await self._control_plane.request_output(
            task,
            OutputGrantRequest(
                lease_id=task.lease_id,
                fencing_token=task.fencing_token,
                slot=specification.slot,
                file_name=safe_name(source.name),
                content_type=content_type,
                byte_size=str(size),
                checksum_sha_256=checksum,
                metadata=meta,
            ),
        )
        if grant.expires_at <= datetime.now(UTC) + timedelta(seconds=30):
            grant = await self._control_plane.refresh_output(task, grant.asset_id)
        self._validate_expiry(grant.expires_at)
        try:
            await self._put(grant, source, size)
        except (AssetGrantExpired, httpx.TransportError):
            grant = await self._control_plane.refresh_output(task, grant.asset_id)
            await self._put(grant, source, size)
        committed = await self._control_plane.commit_output(task, grant.asset_id, str(size), checksum)
        if committed.byte_size != str(size) or committed.checksum_sha_256 != checksum:
            raise AssetTransferError("committed output does not match the uploaded file")
        return TaskOutputReference(slot=committed.slot, asset_id=committed.asset_id)

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _put(self, grant: UploadGrant, source: Path, size: int) -> None:
        self._validate_expiry(grant.expires_at)
        self._validate_url(grant.url)
        if size > parse_size(grant.max_byte_size, "upload grant byte limit"):
            raise AssetTransferError("output exceeds its upload grant")
        request_headers = headers(grant.headers)
        request_headers["Content-Length"] = str(size)
        response = await self._client.put(grant.url, headers=request_headers, content=file_chunks(source))
        if response.status_code in {401, 403}:
            raise AssetGrantExpired("upload grant expired during transfer")
        if response.status_code not in {200, 201, 204}:
            raise AssetTransferError(f"upload failed with HTTP {response.status_code}")

    def _input_path(self, task: ClaimedTask, grant: DownloadGrant) -> Path:
        name = safe_name(grant.file_name)
        return self._inside(task, Path("inputs") / str(grant.asset_id) / name)

    def _output_path(self, task: ClaimedTask, path: Path) -> Path:
        resolved = path.resolve()
        output_root = self._inside(task, Path("outputs"))
        if not resolved.is_relative_to(output_root) or not resolved.is_file():
            raise AssetTransferError("output file is outside the attempt workspace")
        return resolved

    def _inside(self, task: ClaimedTask, relative: Path) -> Path:
        attempt = (self._root / str(task.attempt_id)).resolve()
        path = (attempt / relative).resolve()
        if not path.is_relative_to(attempt):
            raise AssetTransferError("asset path escapes the attempt workspace")
        return path

    def _validate_url(self, value: str) -> None:
        parsed = httpx.URL(value)
        allowed = {"https"} | ({"http"} if self._allow_http else set())
        if parsed.scheme not in allowed or not parsed.host or parsed.username or parsed.password:
            raise AssetTransferError("asset grant URL is not allowed")

    def _validate_expiry(self, value: datetime) -> None:
        if value.tzinfo is None or value <= datetime.now(UTC):
            raise AssetTransferError("asset grant has expired")


async def file_chunks(path: Path) -> AsyncIterator[bytes]:
    with path.open("rb") as source:
        while chunk := source.read(CHUNK_SIZE):
            yield chunk


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def safe_name(value: str) -> str:
    if not value or value in {".", ".."} or "/" in value or "\\" in value or "\0" in value:
        raise AssetTransferError("asset file name is unsafe")
    return value


def parse_size(value: str, label: str) -> int:
    if not value.isdigit():
        raise AssetTransferError(f"{label} is invalid")
    return int(value)


def headers(value: object) -> dict[str, str]:
    if not hasattr(value, "to_dict"):
        raise AssetTransferError("asset grant headers are invalid")
    raw = value.to_dict()
    valid_headers = isinstance(raw, dict) and all(
        isinstance(key, str) and isinstance(item, str) for key, item in raw.items()
    )
    if not valid_headers:
        raise AssetTransferError("asset grant headers are invalid")
    return {str(key): str(item) for key, item in raw.items()}
