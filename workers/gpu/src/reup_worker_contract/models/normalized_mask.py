from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="NormalizedMask")


@_attrs_define
class NormalizedMask:
    """
    Attributes:
        x (float):
        y (float):
        width (float):
        height (float):
    """

    x: float
    y: float
    width: float
    height: float

    def to_dict(self) -> dict[str, Any]:
        x = self.x

        y = self.y

        width = self.width

        height = self.height

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        x = d.pop("x")

        y = d.pop("y")

        width = d.pop("width")

        height = d.pop("height")

        normalized_mask = cls(
            x=x,
            y=y,
            width=width,
            height=height,
        )

        return normalized_mask
