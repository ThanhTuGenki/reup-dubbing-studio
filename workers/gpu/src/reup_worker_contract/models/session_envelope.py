from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.meta import Meta
    from ..models.session_envelope_data import SessionEnvelopeData


T = TypeVar("T", bound="SessionEnvelope")


@_attrs_define
class SessionEnvelope:
    """
    Attributes:
        data (SessionEnvelopeData):
        meta (Meta):
    """

    data: SessionEnvelopeData
    meta: Meta

    def to_dict(self) -> dict[str, Any]:
        from ..models.meta import Meta
        from ..models.session_envelope_data import SessionEnvelopeData

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
        from ..models.session_envelope_data import SessionEnvelopeData

        d = dict(src_dict)
        data = SessionEnvelopeData.from_dict(d.pop("data"))

        meta = Meta.from_dict(d.pop("meta"))

        session_envelope = cls(
            data=data,
            meta=meta,
        )

        return session_envelope
