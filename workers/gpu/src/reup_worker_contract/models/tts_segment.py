from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="TtsSegment")


@_attrs_define
class TtsSegment:
    """
    Attributes:
        segment_revision_id (UUID):
        text (str):
        language_id (str):
        voice_profile_id (UUID):
        target_duration_ms (int):
        output_slot (str):
    """

    segment_revision_id: UUID
    text: str
    language_id: str
    voice_profile_id: UUID
    target_duration_ms: int
    output_slot: str

    def to_dict(self) -> dict[str, Any]:
        segment_revision_id = str(self.segment_revision_id)

        text = self.text

        language_id = self.language_id

        voice_profile_id = str(self.voice_profile_id)

        target_duration_ms = self.target_duration_ms

        output_slot = self.output_slot

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "segmentRevisionId": segment_revision_id,
                "text": text,
                "languageId": language_id,
                "voiceProfileId": voice_profile_id,
                "targetDurationMs": target_duration_ms,
                "outputSlot": output_slot,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        segment_revision_id = UUID(d.pop("segmentRevisionId"))

        text = d.pop("text")

        language_id = d.pop("languageId")

        voice_profile_id = UUID(d.pop("voiceProfileId"))

        target_duration_ms = d.pop("targetDurationMs")

        output_slot = d.pop("outputSlot")

        tts_segment = cls(
            segment_revision_id=segment_revision_id,
            text=text,
            language_id=language_id,
            voice_profile_id=voice_profile_id,
            target_duration_ms=target_duration_ms,
            output_slot=output_slot,
        )

        return tts_segment
