from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.meta import Meta
    from ..models.task_action_envelope_data import TaskActionEnvelopeData


T = TypeVar("T", bound="TaskActionEnvelope")


@_attrs_define
class TaskActionEnvelope:
    """
    Attributes:
        data (TaskActionEnvelopeData):
        meta (Meta):
    """

    data: TaskActionEnvelopeData
    meta: Meta

    def to_dict(self) -> dict[str, Any]:
        from ..models.meta import Meta
        from ..models.task_action_envelope_data import TaskActionEnvelopeData

        data = self.data.to_dict()

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.meta import Meta
        from ..models.task_action_envelope_data import TaskActionEnvelopeData

        d = dict(src_dict)
        data = TaskActionEnvelopeData.from_dict(d.pop("data"))

        meta = Meta.from_dict(d.pop("meta"))

        task_action_envelope = cls(
            data=data,
            meta=meta,
        )

        return task_action_envelope
