from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CommitOutputRequest")


@_attrs_define
class CommitOutputRequest:
    """
    Attributes:
        lease_id (UUID):
        fencing_token (str):
        byte_size (str):
        checksum_sha_256 (str):
    """

    lease_id: UUID
    fencing_token: str
    byte_size: str
    checksum_sha_256: str

    def to_dict(self) -> dict[str, Any]:
        lease_id = str(self.lease_id)

        fencing_token = self.fencing_token

        byte_size = self.byte_size

        checksum_sha_256 = self.checksum_sha_256

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "leaseId": lease_id,
                "fencingToken": fencing_token,
                "byteSize": byte_size,
                "checksumSha256": checksum_sha_256,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        lease_id = UUID(d.pop("leaseId"))

        fencing_token = d.pop("fencingToken")

        byte_size = d.pop("byteSize")

        checksum_sha_256 = d.pop("checksumSha256")

        commit_output_request = cls(
            lease_id=lease_id,
            fencing_token=fencing_token,
            byte_size=byte_size,
            checksum_sha_256=checksum_sha_256,
        )

        return commit_output_request
