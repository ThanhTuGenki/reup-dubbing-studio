from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="OcrTaskConfiguration")


@_attrs_define
class OcrTaskConfiguration:
    """
    Attributes:
        kind (Literal['TRANSCRIBE_OCR']):
        language (str):
        frame_interval_ms (int):
    """

    kind: Literal["TRANSCRIBE_OCR"]
    language: str
    frame_interval_ms: int

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        language = self.language

        frame_interval_ms = self.frame_interval_ms

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "language": language,
                "frameIntervalMs": frame_interval_ms,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["TRANSCRIBE_OCR"], d.pop("kind"))
        if kind != "TRANSCRIBE_OCR":
            raise ValueError(f"kind must match const 'TRANSCRIBE_OCR', got '{kind}'")

        language = d.pop("language")

        frame_interval_ms = d.pop("frameIntervalMs")

        ocr_task_configuration = cls(
            kind=kind,
            language=language,
            frame_interval_ms=frame_interval_ms,
        )

        return ocr_task_configuration
