from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.worker_desired_status import WorkerDesiredStatus, check_worker_desired_status
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.worker_session import WorkerSession


T = TypeVar("T", bound="SessionEnvelopeData")


@_attrs_define
class SessionEnvelopeData:
    """
    Attributes:
        session (WorkerSession):
        desired_status (WorkerDesiredStatus):
        heartbeat_interval_seconds (int):
        offline_timeout_seconds (int):
    """

    session: WorkerSession
    desired_status: WorkerDesiredStatus
    heartbeat_interval_seconds: int
    offline_timeout_seconds: int

    def to_dict(self) -> dict[str, Any]:
        from ..models.worker_session import WorkerSession

        session = self.session.to_dict()

        desired_status: str = self.desired_status

        heartbeat_interval_seconds = self.heartbeat_interval_seconds

        offline_timeout_seconds = self.offline_timeout_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "session": session,
                "desiredStatus": desired_status,
                "heartbeatIntervalSeconds": heartbeat_interval_seconds,
                "offlineTimeoutSeconds": offline_timeout_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.worker_session import WorkerSession

        d = dict(src_dict)
        session = WorkerSession.from_dict(d.pop("session"))

        desired_status = check_worker_desired_status(d.pop("desiredStatus"))

        heartbeat_interval_seconds = d.pop("heartbeatIntervalSeconds")

        offline_timeout_seconds = d.pop("offlineTimeoutSeconds")

        session_envelope_data = cls(
            session=session,
            desired_status=desired_status,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
            offline_timeout_seconds=offline_timeout_seconds,
        )

        return session_envelope_data
