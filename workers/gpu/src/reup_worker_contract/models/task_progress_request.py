from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="TaskProgressRequest")


@_attrs_define
class TaskProgressRequest:
    """
    Attributes:
        lease_id (UUID):
        fencing_token (str):
        progress_bps (int):
        detail_safe (None | str | Unset):
    """

    lease_id: UUID
    fencing_token: str
    progress_bps: int
    detail_safe: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        lease_id = str(self.lease_id)

        fencing_token = self.fencing_token

        progress_bps = self.progress_bps

        detail_safe: None | str | Unset
        if isinstance(self.detail_safe, Unset):
            detail_safe = UNSET
        else:
            detail_safe = self.detail_safe

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "leaseId": lease_id,
                "fencingToken": fencing_token,
                "progressBps": progress_bps,
            }
        )
        if detail_safe is not UNSET:
            field_dict["detailSafe"] = detail_safe

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        lease_id = UUID(d.pop("leaseId"))

        fencing_token = d.pop("fencingToken")

        progress_bps = d.pop("progressBps")

        def _parse_detail_safe(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        detail_safe = _parse_detail_safe(d.pop("detailSafe", UNSET))

        task_progress_request = cls(
            lease_id=lease_id,
            fencing_token=fencing_token,
            progress_bps=progress_bps,
            detail_safe=detail_safe,
        )

        return task_progress_request
