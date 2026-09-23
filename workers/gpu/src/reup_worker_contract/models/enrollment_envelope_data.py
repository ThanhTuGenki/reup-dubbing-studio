from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.worker_session import WorkerSession


T = TypeVar("T", bound="EnrollmentEnvelopeData")


@_attrs_define
class EnrollmentEnvelopeData:
    """
    Attributes:
        credential (str):
        session (WorkerSession):
        heartbeat_interval_seconds (int):
        offline_timeout_seconds (int):
    """

    credential: str
    session: WorkerSession
    heartbeat_interval_seconds: int
    offline_timeout_seconds: int

    def to_dict(self) -> dict[str, Any]:
        from ..models.worker_session import WorkerSession

        credential = self.credential

        session = self.session.to_dict()

        heartbeat_interval_seconds = self.heartbeat_interval_seconds

        offline_timeout_seconds = self.offline_timeout_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "credential": credential,
                "session": session,
                "heartbeatIntervalSeconds": heartbeat_interval_seconds,
                "offlineTimeoutSeconds": offline_timeout_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.worker_session import WorkerSession

        d = dict(src_dict)
        credential = d.pop("credential")

        session = WorkerSession.from_dict(d.pop("session"))

        heartbeat_interval_seconds = d.pop("heartbeatIntervalSeconds")

        offline_timeout_seconds = d.pop("offlineTimeoutSeconds")

        enrollment_envelope_data = cls(
            credential=credential,
            session=session,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
            offline_timeout_seconds=offline_timeout_seconds,
        )

        return enrollment_envelope_data
