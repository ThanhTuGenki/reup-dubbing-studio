from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.initial_tts_task_configuration_timing_policy import (
    InitialTtsTaskConfigurationTimingPolicy,
    check_initial_tts_task_configuration_timing_policy,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.tts_segment import TtsSegment


T = TypeVar("T", bound="InitialTtsTaskConfiguration")


@_attrs_define
class InitialTtsTaskConfiguration:
    """
    Attributes:
        kind (Literal['GENERATE_INITIAL_TTS']):
        speed (float):
        timing_policy (InitialTtsTaskConfigurationTimingPolicy):
        segments (list[TtsSegment]):
    """

    kind: Literal["GENERATE_INITIAL_TTS"]
    speed: float
    timing_policy: InitialTtsTaskConfigurationTimingPolicy
    segments: list[TtsSegment]

    def to_dict(self) -> dict[str, Any]:
        from ..models.tts_segment import TtsSegment

        kind = self.kind

        speed = self.speed

        timing_policy: str = self.timing_policy

        segments = []
        for segments_item_data in self.segments:
            segments_item = segments_item_data.to_dict()
            segments.append(segments_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "speed": speed,
                "timingPolicy": timing_policy,
                "segments": segments,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tts_segment import TtsSegment

        d = dict(src_dict)
        kind = cast(Literal["GENERATE_INITIAL_TTS"], d.pop("kind"))
        if kind != "GENERATE_INITIAL_TTS":
            raise ValueError(f"kind must match const 'GENERATE_INITIAL_TTS', got '{kind}'")

        speed = d.pop("speed")

        timing_policy = check_initial_tts_task_configuration_timing_policy(d.pop("timingPolicy"))

        segments = []
        _segments = d.pop("segments")
        for segments_item_data in _segments:
            segments_item = TtsSegment.from_dict(segments_item_data)

            segments.append(segments_item)

        initial_tts_task_configuration = cls(
            kind=kind,
            speed=speed,
            timing_policy=timing_policy,
            segments=segments,
        )

        return initial_tts_task_configuration
