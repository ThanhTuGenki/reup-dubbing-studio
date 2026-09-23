from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.regenerate_tts_task_configuration_timing_policy import (
    RegenerateTtsTaskConfigurationTimingPolicy,
    check_regenerate_tts_task_configuration_timing_policy,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.tts_segment import TtsSegment


T = TypeVar("T", bound="RegenerateTtsTaskConfiguration")


@_attrs_define
class RegenerateTtsTaskConfiguration:
    """
    Attributes:
        kind (Literal['REGENERATE_SEGMENT']):
        speed (float):
        timing_policy (RegenerateTtsTaskConfigurationTimingPolicy):
        segment (TtsSegment):
    """

    kind: Literal["REGENERATE_SEGMENT"]
    speed: float
    timing_policy: RegenerateTtsTaskConfigurationTimingPolicy
    segment: TtsSegment

    def to_dict(self) -> dict[str, Any]:
        from ..models.tts_segment import TtsSegment

        kind = self.kind

        speed = self.speed

        timing_policy: str = self.timing_policy

        segment = self.segment.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "speed": speed,
                "timingPolicy": timing_policy,
                "segment": segment,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tts_segment import TtsSegment

        d = dict(src_dict)
        kind = cast(Literal["REGENERATE_SEGMENT"], d.pop("kind"))
        if kind != "REGENERATE_SEGMENT":
            raise ValueError(f"kind must match const 'REGENERATE_SEGMENT', got '{kind}'")

        speed = d.pop("speed")

        timing_policy = check_regenerate_tts_task_configuration_timing_policy(d.pop("timingPolicy"))

        segment = TtsSegment.from_dict(d.pop("segment"))

        regenerate_tts_task_configuration = cls(
            kind=kind,
            speed=speed,
            timing_policy=timing_policy,
            segment=segment,
        )

        return regenerate_tts_task_configuration
