from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.render_output_variant import RenderOutputVariant, check_render_output_variant
from ..types import UNSET, Unset

T = TypeVar("T", bound="RenderVariant")


@_attrs_define
class RenderVariant:
    """
    Attributes:
        variant (RenderOutputVariant):
        output_slot (str):
        source_start_ms (int | None | Unset):
        source_end_ms (int | None | Unset):
    """

    variant: RenderOutputVariant
    output_slot: str
    source_start_ms: int | None | Unset = UNSET
    source_end_ms: int | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        variant: str = self.variant

        output_slot = self.output_slot

        source_start_ms: int | None | Unset
        if isinstance(self.source_start_ms, Unset):
            source_start_ms = UNSET
        else:
            source_start_ms = self.source_start_ms

        source_end_ms: int | None | Unset
        if isinstance(self.source_end_ms, Unset):
            source_end_ms = UNSET
        else:
            source_end_ms = self.source_end_ms

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "variant": variant,
                "outputSlot": output_slot,
            }
        )
        if source_start_ms is not UNSET:
            field_dict["sourceStartMs"] = source_start_ms
        if source_end_ms is not UNSET:
            field_dict["sourceEndMs"] = source_end_ms

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        variant = check_render_output_variant(d.pop("variant"))

        output_slot = d.pop("outputSlot")

        def _parse_source_start_ms(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        source_start_ms = _parse_source_start_ms(d.pop("sourceStartMs", UNSET))

        def _parse_source_end_ms(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        source_end_ms = _parse_source_end_ms(d.pop("sourceEndMs", UNSET))

        render_variant = cls(
            variant=variant,
            output_slot=output_slot,
            source_start_ms=source_start_ms,
            source_end_ms=source_end_ms,
        )

        return render_variant
