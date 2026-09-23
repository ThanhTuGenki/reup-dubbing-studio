from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.download_grant_headers import DownloadGrantHeaders


T = TypeVar("T", bound="DownloadGrant")


@_attrs_define
class DownloadGrant:
    """
    Attributes:
        asset_id (UUID):
        method (Literal['GET']):
        url (str):
        headers (DownloadGrantHeaders):
        expires_at (datetime.datetime):
        file_name (str):
        content_type (str):
        byte_size (str):
        checksum_sha_256 (None | str):
    """

    asset_id: UUID
    method: Literal["GET"]
    url: str
    headers: DownloadGrantHeaders
    expires_at: datetime.datetime
    file_name: str
    content_type: str
    byte_size: str
    checksum_sha_256: None | str

    def to_dict(self) -> dict[str, Any]:
        from ..models.download_grant_headers import DownloadGrantHeaders

        asset_id = str(self.asset_id)

        method = self.method

        url = self.url

        headers = self.headers.to_dict()

        expires_at = self.expires_at.isoformat()

        file_name = self.file_name

        content_type = self.content_type

        byte_size = self.byte_size

        checksum_sha_256: None | str
        checksum_sha_256 = self.checksum_sha_256

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "assetId": asset_id,
                "method": method,
                "url": url,
                "headers": headers,
                "expiresAt": expires_at,
                "fileName": file_name,
                "contentType": content_type,
                "byteSize": byte_size,
                "checksumSha256": checksum_sha_256,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.download_grant_headers import DownloadGrantHeaders

        d = dict(src_dict)
        asset_id = UUID(d.pop("assetId"))

        method = cast(Literal["GET"], d.pop("method"))
        if method != "GET":
            raise ValueError(f"method must match const 'GET', got '{method}'")

        url = d.pop("url")

        headers = DownloadGrantHeaders.from_dict(d.pop("headers"))

        expires_at = isoparse(d.pop("expiresAt"))

        file_name = d.pop("fileName")

        content_type = d.pop("contentType")

        byte_size = d.pop("byteSize")

        def _parse_checksum_sha_256(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        checksum_sha_256 = _parse_checksum_sha_256(d.pop("checksumSha256"))

        download_grant = cls(
            asset_id=asset_id,
            method=method,
            url=url,
            headers=headers,
            expires_at=expires_at,
            file_name=file_name,
            content_type=content_type,
            byte_size=byte_size,
            checksum_sha_256=checksum_sha_256,
        )

        return download_grant
