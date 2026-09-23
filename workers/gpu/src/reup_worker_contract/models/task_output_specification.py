from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.asset_kind import AssetKind, check_asset_kind
from ..types import UNSET, Unset

T = TypeVar("T", bound="TaskOutputSpecification")


@_attrs_define
class TaskOutputSpecification:
    """
    Attributes:
        slot (str):
        kind (AssetKind):
        min_items (int):
        max_items (int):
        allowed_content_types (list[str]):
        max_byte_size (str):
    """

    slot: str
    kind: AssetKind
    min_items: int
    max_items: int
    allowed_content_types: list[str]
    max_byte_size: str

    def to_dict(self) -> dict[str, Any]:
        slot = self.slot

        kind: str = self.kind

        min_items = self.min_items

        max_items = self.max_items

        allowed_content_types = self.allowed_content_types

        max_byte_size = self.max_byte_size

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slot": slot,
                "kind": kind,
                "minItems": min_items,
                "maxItems": max_items,
                "allowedContentTypes": allowed_content_types,
                "maxByteSize": max_byte_size,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        slot = d.pop("slot")

        kind = check_asset_kind(d.pop("kind"))

        min_items = d.pop("minItems")

        max_items = d.pop("maxItems")

        allowed_content_types = cast(list[str], d.pop("allowedContentTypes"))

        max_byte_size = d.pop("maxByteSize")

        task_output_specification = cls(
            slot=slot,
            kind=kind,
            min_items=min_items,
            max_items=max_items,
            allowed_content_types=allowed_content_types,
            max_byte_size=max_byte_size,
        )

        return task_output_specification
