from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.worker_desired_status import WorkerDesiredStatus, check_worker_desired_status
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.claimed_task import ClaimedTask


T = TypeVar("T", bound="ClaimTaskEnvelopeData")


@_attrs_define
class ClaimTaskEnvelopeData:
    """
    Attributes:
        task (ClaimedTask | None):
        retry_after_seconds (int):
        desired_status (WorkerDesiredStatus):
    """

    task: ClaimedTask | None
    retry_after_seconds: int
    desired_status: WorkerDesiredStatus

    def to_dict(self) -> dict[str, Any]:
        from ..models.claimed_task import ClaimedTask

        task: dict[str, Any] | None
        if isinstance(self.task, ClaimedTask):
            task = self.task.to_dict()
        else:
            task = self.task

        retry_after_seconds = self.retry_after_seconds

        desired_status: str = self.desired_status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "task": task,
                "retryAfterSeconds": retry_after_seconds,
                "desiredStatus": desired_status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.claimed_task import ClaimedTask

        d = dict(src_dict)

        def _parse_task(data: object) -> ClaimedTask | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                task_type_0 = ClaimedTask.from_dict(data)

                return task_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ClaimedTask | None, data)

        task = _parse_task(d.pop("task"))

        retry_after_seconds = d.pop("retryAfterSeconds")

        desired_status = check_worker_desired_status(d.pop("desiredStatus"))

        claim_task_envelope_data = cls(
            task=task,
            retry_after_seconds=retry_after_seconds,
            desired_status=desired_status,
        )

        return claim_task_envelope_data
