from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="LeaseActionRequest")


@_attrs_define
class LeaseActionRequest:
    """
    Attributes:
        lease_id (UUID):
        fencing_token (str):
    """

    lease_id: UUID
    fencing_token: str

    def to_dict(self) -> dict[str, Any]:
        lease_id = str(self.lease_id)

        fencing_token = self.fencing_token

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "leaseId": lease_id,
                "fencingToken": fencing_token,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        lease_id = UUID(d.pop("leaseId"))

        fencing_token = d.pop("fencingToken")

        lease_action_request = cls(
            lease_id=lease_id,
            fencing_token=fencing_token,
        )

        return lease_action_request
