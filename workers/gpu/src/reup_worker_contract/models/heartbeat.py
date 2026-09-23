from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.worker_capacity import WorkerCapacity
    from ..models.worker_telemetry import WorkerTelemetry


T = TypeVar("T", bound="Heartbeat")


@_attrs_define
class Heartbeat:
    """
    Attributes:
        sequence (str):
        sent_at (datetime.datetime):
        capacity (WorkerCapacity):
        current_task_count (int):
        active_lease_ids (list[UUID]):
        telemetry (WorkerTelemetry):
        agent_version (str):
        contract_version (int):
    """

    sequence: str
    sent_at: datetime.datetime
    capacity: WorkerCapacity
    current_task_count: int
    active_lease_ids: list[UUID]
    telemetry: WorkerTelemetry
    agent_version: str
    contract_version: int

    def to_dict(self) -> dict[str, Any]:
        from ..models.worker_capacity import WorkerCapacity
        from ..models.worker_telemetry import WorkerTelemetry

        sequence = self.sequence

        sent_at = self.sent_at.isoformat()

        capacity = self.capacity.to_dict()

        current_task_count = self.current_task_count

        active_lease_ids = []
        for active_lease_ids_item_data in self.active_lease_ids:
            active_lease_ids_item = str(active_lease_ids_item_data)
            active_lease_ids.append(active_lease_ids_item)

        telemetry = self.telemetry.to_dict()

        agent_version = self.agent_version

        contract_version = self.contract_version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sequence": sequence,
                "sentAt": sent_at,
                "capacity": capacity,
                "currentTaskCount": current_task_count,
                "activeLeaseIds": active_lease_ids,
                "telemetry": telemetry,
                "agentVersion": agent_version,
                "contractVersion": contract_version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.worker_capacity import WorkerCapacity
        from ..models.worker_telemetry import WorkerTelemetry

        d = dict(src_dict)
        sequence = d.pop("sequence")

        sent_at = isoparse(d.pop("sentAt"))

        capacity = WorkerCapacity.from_dict(d.pop("capacity"))

        current_task_count = d.pop("currentTaskCount")

        active_lease_ids = []
        _active_lease_ids = d.pop("activeLeaseIds")
        for active_lease_ids_item_data in _active_lease_ids:
            active_lease_ids_item = UUID(active_lease_ids_item_data)

            active_lease_ids.append(active_lease_ids_item)

        telemetry = WorkerTelemetry.from_dict(d.pop("telemetry"))

        agent_version = d.pop("agentVersion")

        contract_version = d.pop("contractVersion")

        heartbeat = cls(
            sequence=sequence,
            sent_at=sent_at,
            capacity=capacity,
            current_task_count=current_task_count,
            active_lease_ids=active_lease_ids,
            telemetry=telemetry,
            agent_version=agent_version,
            contract_version=contract_version,
        )

        return heartbeat
