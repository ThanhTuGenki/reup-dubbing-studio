from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Meta")


@_attrs_define
class Meta:
    """
    Attributes:
        request_id (UUID):
    """

    request_id: UUID

    def to_dict(self) -> dict[str, Any]:
        request_id = str(self.request_id)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "requestId": request_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        request_id = UUID(d.pop("requestId"))

        meta = cls(
            request_id=request_id,
        )

        return meta
