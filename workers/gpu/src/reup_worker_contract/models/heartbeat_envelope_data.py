from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.worker_desired_status import WorkerDesiredStatus, check_worker_desired_status
from ..types import UNSET, Unset

T = TypeVar("T", bound="HeartbeatEnvelopeData")


@_attrs_define
class HeartbeatEnvelopeData:
    """
    Attributes:
        accepted_sequence (str):
        worker_id (UUID):
        session_id (UUID):
        desired_status (WorkerDesiredStatus):
        cancel_lease_ids (list[UUID]):
    """

    accepted_sequence: str
    worker_id: UUID
    session_id: UUID
    desired_status: WorkerDesiredStatus
    cancel_lease_ids: list[UUID]

    def to_dict(self) -> dict[str, Any]:
        accepted_sequence = self.accepted_sequence

        worker_id = str(self.worker_id)

        session_id = str(self.session_id)

        desired_status: str = self.desired_status

        cancel_lease_ids = []
        for cancel_lease_ids_item_data in self.cancel_lease_ids:
            cancel_lease_ids_item = str(cancel_lease_ids_item_data)
            cancel_lease_ids.append(cancel_lease_ids_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "acceptedSequence": accepted_sequence,
                "workerId": worker_id,
                "sessionId": session_id,
                "desiredStatus": desired_status,
                "cancelLeaseIds": cancel_lease_ids,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        accepted_sequence = d.pop("acceptedSequence")

        worker_id = UUID(d.pop("workerId"))

        session_id = UUID(d.pop("sessionId"))

        desired_status = check_worker_desired_status(d.pop("desiredStatus"))

        cancel_lease_ids = []
        _cancel_lease_ids = d.pop("cancelLeaseIds")
        for cancel_lease_ids_item_data in _cancel_lease_ids:
            cancel_lease_ids_item = UUID(cancel_lease_ids_item_data)

            cancel_lease_ids.append(cancel_lease_ids_item)

        heartbeat_envelope_data = cls(
            accepted_sequence=accepted_sequence,
            worker_id=worker_id,
            session_id=session_id,
            desired_status=desired_status,
            cancel_lease_ids=cancel_lease_ids,
        )

        return heartbeat_envelope_data
