from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.render_variant import RenderVariant


T = TypeVar("T", bound="RenderTaskConfiguration")


@_attrs_define
class RenderTaskConfiguration:
    """
    Attributes:
        kind (Literal['RENDER']):
        subtitle_mode (Literal['EXTERNAL_ONLY']):
        variants (list[RenderVariant]):
    """

    kind: Literal["RENDER"]
    subtitle_mode: Literal["EXTERNAL_ONLY"]
    variants: list[RenderVariant]

    def to_dict(self) -> dict[str, Any]:
        from ..models.render_variant import RenderVariant

        kind = self.kind

        subtitle_mode = self.subtitle_mode

        variants = []
        for variants_item_data in self.variants:
            variants_item = variants_item_data.to_dict()
            variants.append(variants_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "subtitleMode": subtitle_mode,
                "variants": variants,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.render_variant import RenderVariant

        d = dict(src_dict)
        kind = cast(Literal["RENDER"], d.pop("kind"))
        if kind != "RENDER":
            raise ValueError(f"kind must match const 'RENDER', got '{kind}'")

        subtitle_mode = cast(Literal["EXTERNAL_ONLY"], d.pop("subtitleMode"))
        if subtitle_mode != "EXTERNAL_ONLY":
            raise ValueError(f"subtitleMode must match const 'EXTERNAL_ONLY', got '{subtitle_mode}'")

        variants = []
        _variants = d.pop("variants")
        for variants_item_data in _variants:
            variants_item = RenderVariant.from_dict(variants_item_data)

            variants.append(variants_item)

        render_task_configuration = cls(
            kind=kind,
            subtitle_mode=subtitle_mode,
            variants=variants,
        )

        return render_task_configuration
