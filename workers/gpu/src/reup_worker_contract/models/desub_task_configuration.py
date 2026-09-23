from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.normalized_mask import NormalizedMask


T = TypeVar("T", bound="DesubTaskConfiguration")


@_attrs_define
class DesubTaskConfiguration:
    """
    Attributes:
        kind (Literal['DESUB']):
        mask (NormalizedMask):
        model_profile (str):
    """

    kind: Literal["DESUB"]
    mask: NormalizedMask
    model_profile: str

    def to_dict(self) -> dict[str, Any]:
        from ..models.normalized_mask import NormalizedMask

        kind = self.kind

        mask = self.mask.to_dict()

        model_profile = self.model_profile

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "mask": mask,
                "modelProfile": model_profile,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.normalized_mask import NormalizedMask

        d = dict(src_dict)
        kind = cast(Literal["DESUB"], d.pop("kind"))
        if kind != "DESUB":
            raise ValueError(f"kind must match const 'DESUB', got '{kind}'")

        mask = NormalizedMask.from_dict(d.pop("mask"))

        model_profile = d.pop("modelProfile")

        desub_task_configuration = cls(
            kind=kind,
            mask=mask,
            model_profile=model_profile,
        )

        return desub_task_configuration
