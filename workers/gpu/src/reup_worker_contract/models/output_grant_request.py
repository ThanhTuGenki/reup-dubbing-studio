from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.output_grant_request_metadata import OutputGrantRequestMetadata


T = TypeVar("T", bound="OutputGrantRequest")


@_attrs_define
class OutputGrantRequest:
    """
    Attributes:
        lease_id (UUID):
        fencing_token (str):
        slot (str):
        file_name (str):
        content_type (str):
        byte_size (str):
        checksum_sha_256 (str):
        metadata (OutputGrantRequestMetadata):
    """

    lease_id: UUID
    fencing_token: str
    slot: str
    file_name: str
    content_type: str
    byte_size: str
    checksum_sha_256: str
    metadata: OutputGrantRequestMetadata

    def to_dict(self) -> dict[str, Any]:
        from ..models.output_grant_request_metadata import OutputGrantRequestMetadata

        lease_id = str(self.lease_id)

        fencing_token = self.fencing_token

        slot = self.slot

        file_name = self.file_name

        content_type = self.content_type

        byte_size = self.byte_size

        checksum_sha_256 = self.checksum_sha_256

        metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "leaseId": lease_id,
                "fencingToken": fencing_token,
                "slot": slot,
                "fileName": file_name,
                "contentType": content_type,
                "byteSize": byte_size,
                "checksumSha256": checksum_sha_256,
                "metadata": metadata,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.output_grant_request_metadata import OutputGrantRequestMetadata

        d = dict(src_dict)
        lease_id = UUID(d.pop("leaseId"))

        fencing_token = d.pop("fencingToken")

        slot = d.pop("slot")

        file_name = d.pop("fileName")

        content_type = d.pop("contentType")

        byte_size = d.pop("byteSize")

        checksum_sha_256 = d.pop("checksumSha256")

        metadata = OutputGrantRequestMetadata.from_dict(d.pop("metadata"))

        output_grant_request = cls(
            lease_id=lease_id,
            fencing_token=fencing_token,
            slot=slot,
            file_name=file_name,
            content_type=content_type,
            byte_size=byte_size,
            checksum_sha_256=checksum_sha_256,
            metadata=metadata,
        )

        return output_grant_request
