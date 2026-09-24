import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import httpx
import pytest

from reup_worker.assets import AssetTransfer, AssetTransferError
from reup_worker_contract.models.committed_output import CommittedOutput
from reup_worker_contract.models.download_grant import DownloadGrant
from reup_worker_contract.models.output_grant_request import OutputGrantRequest
from reup_worker_contract.models.task_input_asset import TaskInputAsset
from reup_worker_contract.models.task_output_specification import TaskOutputSpecification
from reup_worker_contract.models.upload_grant import UploadGrant
from test_agent import claimed_task

ASSET_ID = "0191f3d2-7f5b-7abc-8b2e-123456789b09"


class AssetControlPlane:
    def __init__(self, download: DownloadGrant, upload: UploadGrant) -> None:
        self.download = download
        self.upload = upload
        self.request: OutputGrantRequest | None = None
        self.commits = 0
        self.input_refreshes = 0
        self.output_refreshes = 0

    async def refresh_input(self, task: object, asset_id: UUID) -> DownloadGrant:
        del task, asset_id
        self.input_refreshes += 1
        return self.download

    async def request_output(self, task: object, body: OutputGrantRequest) -> UploadGrant:
        del task
        self.request = body
        return self.upload

    async def refresh_output(self, task: object, asset_id: UUID) -> UploadGrant:
        del task, asset_id
        self.output_refreshes += 1
        return self.upload

    async def commit_output(self, task: object, asset_id: UUID, byte_size: str, checksum: str) -> CommittedOutput:
        del task
        self.commits += 1
        return CommittedOutput(
            asset_id=asset_id,
            slot="video",
            status="AVAILABLE",
            content_type="video/mp4",
            byte_size=byte_size,
            checksum_sha_256=checksum,
        )


async def test_streams_and_verifies_download(tmp_path: Path) -> None:
    content = b"small s3 fixture"
    grant = download_grant(content)
    control = AssetControlPlane(grant, upload_grant())
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, headers={"content-type": "video/mp4"}, content=content)
        )
    )
    transfer = AssetTransfer(control, tmp_path, max_input_bytes=1024, allow_http=True, client=client)

    path = await transfer.download(claimed_task(), task_input(grant))

    assert path.read_bytes() == content
    assert path.is_relative_to(tmp_path / str(claimed_task().attempt_id))
    await client.aclose()


async def test_rejects_unsafe_name_and_checksum_mismatch(tmp_path: Path) -> None:
    content = b"tampered"
    grant = download_grant(content, checksum="0" * 64)
    control = AssetControlPlane(grant, upload_grant())
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=content)))
    transfer = AssetTransfer(control, tmp_path, max_input_bytes=1024, allow_http=True, client=client)

    with pytest.raises(AssetTransferError, match="checksum"):
        await transfer.download(claimed_task(), task_input(grant))
    assert not list(tmp_path.rglob("*.part"))

    unsafe = download_grant(content)
    unsafe.file_name = "../escape.mp4"
    with pytest.raises(AssetTransferError, match="unsafe"):
        await transfer.download(claimed_task(), task_input(unsafe))
    await client.aclose()


async def test_refreshes_an_expiring_download_grant(tmp_path: Path) -> None:
    content = b"refreshed"
    fresh = download_grant(content)
    expiring = download_grant(content)
    expiring.expires_at = datetime.now(UTC) + timedelta(seconds=5)
    control = AssetControlPlane(fresh, upload_grant())
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=content)))
    transfer = AssetTransfer(control, tmp_path, max_input_bytes=1024, allow_http=True, client=client)

    assert (await transfer.download(claimed_task(), task_input(expiring))).read_bytes() == content
    assert control.input_refreshes == 1
    await client.aclose()


async def test_streams_upload_then_commits_verified_output(tmp_path: Path) -> None:
    received = b""

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal received
        received = await request.aread()
        return httpx.Response(200)

    control = AssetControlPlane(download_grant(b"input"), upload_grant())
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    transfer = AssetTransfer(control, tmp_path, max_input_bytes=1024, allow_http=True, client=client)
    task = claimed_task()
    output_dir = tmp_path / str(task.attempt_id) / "outputs"
    output_dir.mkdir(parents=True)
    output = output_dir / "render.mp4"
    output.write_bytes(b"rendered fixture")
    specification = TaskOutputSpecification(
        slot="video",
        kind="OUTPUT_VIDEO",
        min_items=1,
        max_items=1,
        allowed_content_types=["video/mp4"],
        max_byte_size="1024",
    )

    reference = await transfer.upload(task, specification, output, "video/mp4", {"variant": "FULL_16X9"})

    assert received == b"rendered fixture"
    assert reference.asset_id == UUID(ASSET_ID)
    assert control.request is not None
    assert control.request.checksum_sha_256 == hashlib.sha256(received).hexdigest()
    assert control.commits == 1
    await client.aclose()


async def test_retries_whole_object_with_a_refreshed_grant(tmp_path: Path) -> None:
    requests = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        await request.aread()
        return httpx.Response(403 if requests == 1 else 200)

    control = AssetControlPlane(download_grant(b"input"), upload_grant())
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    transfer = AssetTransfer(control, tmp_path, max_input_bytes=1024, allow_http=True, client=client)
    task = claimed_task()
    output_dir = tmp_path / str(task.attempt_id) / "outputs"
    output_dir.mkdir(parents=True)
    output = output_dir / "render.mp4"
    output.write_bytes(b"retry fixture")
    specification = TaskOutputSpecification("video", "OUTPUT_VIDEO", 1, 1, ["video/mp4"], "1024")

    await transfer.upload(task, specification, output, "video/mp4")

    assert requests == 2
    assert control.output_refreshes == 1
    assert control.commits == 1
    await client.aclose()


def download_grant(content: bytes, checksum: str | None = None) -> DownloadGrant:
    return DownloadGrant.from_dict(
        {
            "assetId": ASSET_ID,
            "method": "GET",
            "url": "http://s3.test/bucket/input.mp4?signature=safe",
            "headers": {},
            "expiresAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            "fileName": "input.mp4",
            "contentType": "video/mp4",
            "byteSize": str(len(content)),
            "checksumSha256": checksum or hashlib.sha256(content).hexdigest(),
        }
    )


def upload_grant() -> UploadGrant:
    return UploadGrant.from_dict(
        {
            "assetId": ASSET_ID,
            "slot": "video",
            "method": "PUT",
            "url": "http://s3.test/bucket/output.mp4?signature=safe",
            "headers": {"content-type": "video/mp4"},
            "expiresAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            "maxByteSize": "1024",
        }
    )


def task_input(grant: DownloadGrant) -> TaskInputAsset:
    return TaskInputAsset.from_dict(
        {"slot": "source", "kind": "RAW", "assetId": ASSET_ID, "metadata": {}, "download": grant.to_dict()}
    )
