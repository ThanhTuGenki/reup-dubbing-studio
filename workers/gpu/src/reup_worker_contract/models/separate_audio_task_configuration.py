from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.separate_audio_task_configuration_model_name import (
    SeparateAudioTaskConfigurationModelName,
    check_separate_audio_task_configuration_model_name,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="SeparateAudioTaskConfiguration")


@_attrs_define
class SeparateAudioTaskConfiguration:
    """
    Attributes:
        kind (Literal['SEPARATE_AUDIO']):
        model_name (SeparateAudioTaskConfigurationModelName):
    """

    kind: Literal["SEPARATE_AUDIO"]
    model_name: SeparateAudioTaskConfigurationModelName

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        model_name: str = self.model_name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "modelName": model_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["SEPARATE_AUDIO"], d.pop("kind"))
        if kind != "SEPARATE_AUDIO":
            raise ValueError(f"kind must match const 'SEPARATE_AUDIO', got '{kind}'")

        model_name = check_separate_audio_task_configuration_model_name(d.pop("modelName"))

        separate_audio_task_configuration = cls(
            kind=kind,
            model_name=model_name,
        )

        return separate_audio_task_configuration
