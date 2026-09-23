from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ClaimTaskRequest")


@_attrs_define
class ClaimTaskRequest:
    """
    Attributes:
        session_id (UUID):
        wait_seconds (int):
    """

    session_id: UUID
    wait_seconds: int

    def to_dict(self) -> dict[str, Any]:
        session_id = str(self.session_id)

        wait_seconds = self.wait_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionId": session_id,
                "waitSeconds": wait_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = UUID(d.pop("sessionId"))

        wait_seconds = d.pop("waitSeconds")

        claim_task_request = cls(
            session_id=session_id,
            wait_seconds=wait_seconds,
        )

        return claim_task_request
