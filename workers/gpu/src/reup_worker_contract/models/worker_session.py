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


T = TypeVar("T", bound="WorkerSession")


@_attrs_define
class WorkerSession:
    """
    Attributes:
        id (UUID):
        session_nonce (UUID):
        image_digest (str):
        agent_version (str):
        contract_version (int):
        capabilities (list[str]):
        capacity (WorkerCapacity):
        current_task_count (int):
        last_heartbeat_sequence (str):
        started_at (datetime.datetime):
        last_heartbeat_at (datetime.datetime):
    """

    id: UUID
    session_nonce: UUID
    image_digest: str
    agent_version: str
    contract_version: int
    capabilities: list[str]
    capacity: WorkerCapacity
    current_task_count: int
    last_heartbeat_sequence: str
    started_at: datetime.datetime
    last_heartbeat_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.worker_capacity import WorkerCapacity

        id = str(self.id)

        session_nonce = str(self.session_nonce)

        image_digest = self.image_digest

        agent_version = self.agent_version

        contract_version = self.contract_version

        capabilities = self.capabilities

        capacity = self.capacity.to_dict()

        current_task_count = self.current_task_count

        last_heartbeat_sequence = self.last_heartbeat_sequence

        started_at = self.started_at.isoformat()

        last_heartbeat_at = self.last_heartbeat_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionNonce": session_nonce,
                "imageDigest": image_digest,
                "agentVersion": agent_version,
                "contractVersion": contract_version,
                "capabilities": capabilities,
                "capacity": capacity,
                "currentTaskCount": current_task_count,
                "lastHeartbeatSequence": last_heartbeat_sequence,
                "startedAt": started_at,
                "lastHeartbeatAt": last_heartbeat_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.worker_capacity import WorkerCapacity

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        session_nonce = UUID(d.pop("sessionNonce"))

        image_digest = d.pop("imageDigest")

        agent_version = d.pop("agentVersion")

        contract_version = d.pop("contractVersion")

        capabilities = cast(list[str], d.pop("capabilities"))

        capacity = WorkerCapacity.from_dict(d.pop("capacity"))

        current_task_count = d.pop("currentTaskCount")

        last_heartbeat_sequence = d.pop("lastHeartbeatSequence")

        started_at = isoparse(d.pop("startedAt"))

        last_heartbeat_at = isoparse(d.pop("lastHeartbeatAt"))

        worker_session = cls(
            id=id,
            session_nonce=session_nonce,
            image_digest=image_digest,
            agent_version=agent_version,
            contract_version=contract_version,
            capabilities=capabilities,
            capacity=capacity,
            current_task_count=current_task_count,
            last_heartbeat_sequence=last_heartbeat_sequence,
            started_at=started_at,
            last_heartbeat_at=last_heartbeat_at,
        )

        return worker_session
