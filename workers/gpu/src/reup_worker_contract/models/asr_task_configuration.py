from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.asr_task_configuration_model_size import (
    AsrTaskConfigurationModelSize,
    check_asr_task_configuration_model_size,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="AsrTaskConfiguration")


@_attrs_define
class AsrTaskConfiguration:
    """
    Attributes:
        kind (Literal['TRANSCRIBE_ASR']):
        language (str):
        model_size (AsrTaskConfigurationModelSize):
    """

    kind: Literal["TRANSCRIBE_ASR"]
    language: str
    model_size: AsrTaskConfigurationModelSize

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        language = self.language

        model_size: str = self.model_size

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "language": language,
                "modelSize": model_size,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["TRANSCRIBE_ASR"], d.pop("kind"))
        if kind != "TRANSCRIBE_ASR":
            raise ValueError(f"kind must match const 'TRANSCRIBE_ASR', got '{kind}'")

        language = d.pop("language")

        model_size = check_asr_task_configuration_model_size(d.pop("modelSize"))

        asr_task_configuration = cls(
            kind=kind,
            language=language,
            model_size=model_size,
        )

        return asr_task_configuration
