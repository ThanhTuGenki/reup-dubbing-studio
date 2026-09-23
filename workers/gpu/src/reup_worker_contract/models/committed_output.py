from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CommittedOutput")


@_attrs_define
class CommittedOutput:
    """
    Attributes:
        asset_id (UUID):
        slot (str):
        status (Literal['AVAILABLE']):
        content_type (str):
        byte_size (str):
        checksum_sha_256 (str):
    """

    asset_id: UUID
    slot: str
    status: Literal["AVAILABLE"]
    content_type: str
    byte_size: str
    checksum_sha_256: str

    def to_dict(self) -> dict[str, Any]:
        asset_id = str(self.asset_id)

        slot = self.slot

        status = self.status

        content_type = self.content_type

        byte_size = self.byte_size

        checksum_sha_256 = self.checksum_sha_256

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "assetId": asset_id,
                "slot": slot,
                "status": status,
                "contentType": content_type,
                "byteSize": byte_size,
                "checksumSha256": checksum_sha_256,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        asset_id = UUID(d.pop("assetId"))

        slot = d.pop("slot")

        status = cast(Literal["AVAILABLE"], d.pop("status"))
        if status != "AVAILABLE":
            raise ValueError(f"status must match const 'AVAILABLE', got '{status}'")

        content_type = d.pop("contentType")

        byte_size = d.pop("byteSize")

        checksum_sha_256 = d.pop("checksumSha256")

        committed_output = cls(
            asset_id=asset_id,
            slot=slot,
            status=status,
            content_type=content_type,
            byte_size=byte_size,
            checksum_sha_256=checksum_sha_256,
        )

        return committed_output
