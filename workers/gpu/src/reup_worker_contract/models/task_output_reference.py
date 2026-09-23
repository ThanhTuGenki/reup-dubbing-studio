from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="TaskOutputReference")


@_attrs_define
class TaskOutputReference:
    """
    Attributes:
        slot (str):
        asset_id (UUID):
    """

    slot: str
    asset_id: UUID

    def to_dict(self) -> dict[str, Any]:
        slot = self.slot

        asset_id = str(self.asset_id)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slot": slot,
                "assetId": asset_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        slot = d.pop("slot")

        asset_id = UUID(d.pop("assetId"))

        task_output_reference = cls(
            slot=slot,
            asset_id=asset_id,
        )

        return task_output_reference
