from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.worker_desired_status import WorkerDesiredStatus, check_worker_desired_status
from ..models.worker_task_status import WorkerTaskStatus, check_worker_task_status
from ..types import UNSET, Unset

T = TypeVar("T", bound="TaskActionEnvelopeData")


@_attrs_define
class TaskActionEnvelopeData:
    """
    Attributes:
        task_id (UUID):
        attempt_id (UUID):
        lease_id (UUID):
        task_status (WorkerTaskStatus):
        lease_expires_at (datetime.datetime | None):
        cancel_requested (bool):
        desired_status (WorkerDesiredStatus):
    """

    task_id: UUID
    attempt_id: UUID
    lease_id: UUID
    task_status: WorkerTaskStatus
    lease_expires_at: datetime.datetime | None
    cancel_requested: bool
    desired_status: WorkerDesiredStatus

    def to_dict(self) -> dict[str, Any]:
        task_id = str(self.task_id)

        attempt_id = str(self.attempt_id)

        lease_id = str(self.lease_id)

        task_status: str = self.task_status

        lease_expires_at: None | str
        if isinstance(self.lease_expires_at, datetime.datetime):
            lease_expires_at = self.lease_expires_at.isoformat()
        else:
            lease_expires_at = self.lease_expires_at

        cancel_requested = self.cancel_requested

        desired_status: str = self.desired_status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "taskId": task_id,
                "attemptId": attempt_id,
                "leaseId": lease_id,
                "taskStatus": task_status,
                "leaseExpiresAt": lease_expires_at,
                "cancelRequested": cancel_requested,
                "desiredStatus": desired_status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        task_id = UUID(d.pop("taskId"))

        attempt_id = UUID(d.pop("attemptId"))

        lease_id = UUID(d.pop("leaseId"))

        task_status = check_worker_task_status(d.pop("taskStatus"))

        def _parse_lease_expires_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                lease_expires_at_type_0 = isoparse(data)

                return lease_expires_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        lease_expires_at = _parse_lease_expires_at(d.pop("leaseExpiresAt"))

        cancel_requested = d.pop("cancelRequested")

        desired_status = check_worker_desired_status(d.pop("desiredStatus"))

        task_action_envelope_data = cls(
            task_id=task_id,
            attempt_id=attempt_id,
            lease_id=lease_id,
            task_status=task_status,
            lease_expires_at=lease_expires_at,
            cancel_requested=cancel_requested,
            desired_status=desired_status,
        )

        return task_action_envelope_data
