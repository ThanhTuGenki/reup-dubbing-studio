from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.meta import Meta
    from ..models.upload_grant import UploadGrant


T = TypeVar("T", bound="UploadGrantEnvelope")


@_attrs_define
class UploadGrantEnvelope:
    """
    Attributes:
        data (UploadGrant):
        meta (Meta):
    """

    data: UploadGrant
    meta: Meta

    def to_dict(self) -> dict[str, Any]:
        from ..models.meta import Meta
        from ..models.upload_grant import UploadGrant

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
        from ..models.upload_grant import UploadGrant

        d = dict(src_dict)
        data = UploadGrant.from_dict(d.pop("data"))

        meta = Meta.from_dict(d.pop("meta"))

        upload_grant_envelope = cls(
            data=data,
            meta=meta,
        )

        return upload_grant_envelope
