import hashlib
import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from uuid import UUID

import pytest
from minio import Minio

from reup_worker.assets import AssetTransfer
from reup_worker_contract.models.committed_output import CommittedOutput
from reup_worker_contract.models.download_grant import DownloadGrant
from reup_worker_contract.models.output_grant_request import OutputGrantRequest
from reup_worker_contract.models.task_input_asset import TaskInputAsset
from reup_worker_contract.models.task_output_specification import TaskOutputSpecification
from reup_worker_contract.models.upload_grant import UploadGrant
from test_agent import claimed_task

ENDPOINT = os.getenv("REUP_WORKER_TEST_S3_ENDPOINT")
pytestmark = pytest.mark.skipif(not ENDPOINT, reason="S3-compatible integration endpoint is not configured")


class S3ControlPlane:
    def __init__(self, download: DownloadGrant, upload: UploadGrant) -> None:
        self.download = download
        self.upload = upload

    async def refresh_input(self, task: object, asset_id: UUID) -> DownloadGrant:
        del task, asset_id
        return self.download

    async def request_output(self, task: object, body: OutputGrantRequest) -> UploadGrant:
        del task, body
        return self.upload

    async def refresh_output(self, task: object, asset_id: UUID) -> UploadGrant:
        del task, asset_id
        return self.upload

    async def commit_output(self, task: object, asset_id: UUID, byte_size: str, checksum: str) -> CommittedOutput:
        del task
        return CommittedOutput(
            asset_id=asset_id,
            slot="video",
            status="AVAILABLE",
            content_type="video/mp4",
            byte_size=byte_size,
            checksum_sha_256=checksum,
        )


async def test_round_trip_against_s3_compatible_storage(tmp_path: Path) -> None:
    assert ENDPOINT
    access = os.getenv("REUP_WORKER_TEST_S3_ACCESS_KEY", "minioadmin")
    secret = os.getenv("REUP_WORKER_TEST_S3_SECRET_KEY", "minioadmin")
    bucket = os.getenv("REUP_WORKER_TEST_S3_BUCKET", "worker-assets")
    s3 = Minio(ENDPOINT, access_key=access, secret_key=secret, secure=False)
    if not s3.bucket_exists(bucket):
        s3.make_bucket(bucket)
    source = b"s3-compatible worker input"
    s3.put_object(bucket, "input/source.mp4", BytesIO(source), len(source), content_type="video/mp4")
    asset_id = UUID("0191f3d2-7f5b-7abc-8b2e-123456789b09")
    expires = datetime.now(UTC) + timedelta(minutes=5)
    download = DownloadGrant.from_dict(
        {
            "assetId": str(asset_id),
            "method": "GET",
            "url": s3.presigned_get_object(bucket, "input/source.mp4", expires=timedelta(minutes=5)),
            "headers": {},
            "expiresAt": expires.isoformat(),
            "fileName": "source.mp4",
            "contentType": "video/mp4",
            "byteSize": str(len(source)),
            "checksumSha256": hashlib.sha256(source).hexdigest(),
        }
    )
    upload = UploadGrant.from_dict(
        {
            "assetId": str(asset_id),
            "slot": "video",
            "method": "PUT",
            "url": s3.presigned_put_object(bucket, "output/render.mp4", expires=timedelta(minutes=5)),
            "headers": {"content-type": "video/mp4"},
            "expiresAt": expires.isoformat(),
            "maxByteSize": "1024",
        }
    )
    transfer = AssetTransfer(S3ControlPlane(download, upload), tmp_path, max_input_bytes=1024, allow_http=True)
    task = claimed_task()
    input_asset = TaskInputAsset.from_dict(
        {"slot": "source", "kind": "RAW", "assetId": str(asset_id), "metadata": {}, "download": download.to_dict()}
    )
    assert (await transfer.download(task, input_asset)).read_bytes() == source
    output_dir = tmp_path / str(task.attempt_id) / "outputs"
    output_dir.mkdir(parents=True)
    rendered = b"s3-compatible worker output"
    output_path = output_dir / "render.mp4"
    output_path.write_bytes(rendered)
    spec = TaskOutputSpecification("video", "OUTPUT_VIDEO", 1, 1, ["video/mp4"], "1024")
    await transfer.upload(task, spec, output_path, "video/mp4")
    response = s3.get_object(bucket, "output/render.mp4")
    try:
        assert response.read() == rendered
    finally:
        response.close()
        response.release_conn()
        await transfer.close()
        s3.remove_object(bucket, "input/source.mp4")
        s3.remove_object(bucket, "output/render.mp4")
