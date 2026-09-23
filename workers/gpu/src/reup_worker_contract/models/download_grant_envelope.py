from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.download_grant import DownloadGrant
    from ..models.meta import Meta


T = TypeVar("T", bound="DownloadGrantEnvelope")


@_attrs_define
class DownloadGrantEnvelope:
    """
    Attributes:
        data (DownloadGrant):
        meta (Meta):
    """

    data: DownloadGrant
    meta: Meta

    def to_dict(self) -> dict[str, Any]:
        from ..models.download_grant import DownloadGrant
        from ..models.meta import Meta

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
        from ..models.download_grant import DownloadGrant
        from ..models.meta import Meta

        d = dict(src_dict)
        data = DownloadGrant.from_dict(d.pop("data"))

        meta = Meta.from_dict(d.pop("meta"))

        download_grant_envelope = cls(
            data=data,
            meta=meta,
        )

        return download_grant_envelope
