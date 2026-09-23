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
    from ..models.upload_grant_headers import UploadGrantHeaders


T = TypeVar("T", bound="UploadGrant")


@_attrs_define
class UploadGrant:
    """
    Attributes:
        asset_id (UUID):
        slot (str):
        method (Literal['PUT']):
        url (str):
        headers (UploadGrantHeaders):
        expires_at (datetime.datetime):
        max_byte_size (str):
    """

    asset_id: UUID
    slot: str
    method: Literal["PUT"]
    url: str
    headers: UploadGrantHeaders
    expires_at: datetime.datetime
    max_byte_size: str

    def to_dict(self) -> dict[str, Any]:
        from ..models.upload_grant_headers import UploadGrantHeaders

        asset_id = str(self.asset_id)

        slot = self.slot

        method = self.method

        url = self.url

        headers = self.headers.to_dict()

        expires_at = self.expires_at.isoformat()

        max_byte_size = self.max_byte_size

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "assetId": asset_id,
                "slot": slot,
                "method": method,
                "url": url,
                "headers": headers,
                "expiresAt": expires_at,
                "maxByteSize": max_byte_size,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.upload_grant_headers import UploadGrantHeaders

        d = dict(src_dict)
        asset_id = UUID(d.pop("assetId"))

        slot = d.pop("slot")

        method = cast(Literal["PUT"], d.pop("method"))
        if method != "PUT":
            raise ValueError(f"method must match const 'PUT', got '{method}'")

        url = d.pop("url")

        headers = UploadGrantHeaders.from_dict(d.pop("headers"))

        expires_at = isoparse(d.pop("expiresAt"))

        max_byte_size = d.pop("maxByteSize")

        upload_grant = cls(
            asset_id=asset_id,
            slot=slot,
            method=method,
            url=url,
            headers=headers,
            expires_at=expires_at,
            max_byte_size=max_byte_size,
        )

        return upload_grant
