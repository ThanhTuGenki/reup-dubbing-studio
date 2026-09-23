from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.worker_failure_code import WorkerFailureCode, check_worker_failure_code
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.task_metrics import TaskMetrics


T = TypeVar("T", bound="FailTaskRequest")


@_attrs_define
class FailTaskRequest:
    """
    Attributes:
        lease_id (UUID):
        fencing_token (str):
        code (WorkerFailureCode):
        detail_safe (str):
        metrics (TaskMetrics):
    """

    lease_id: UUID
    fencing_token: str
    code: WorkerFailureCode
    detail_safe: str
    metrics: TaskMetrics

    def to_dict(self) -> dict[str, Any]:
        from ..models.task_metrics import TaskMetrics

        lease_id = str(self.lease_id)

        fencing_token = self.fencing_token

        code: str = self.code

        detail_safe = self.detail_safe

        metrics = self.metrics.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "leaseId": lease_id,
                "fencingToken": fencing_token,
                "code": code,
                "detailSafe": detail_safe,
                "metrics": metrics,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.task_metrics import TaskMetrics

        d = dict(src_dict)
        lease_id = UUID(d.pop("leaseId"))

        fencing_token = d.pop("fencingToken")

        code = check_worker_failure_code(d.pop("code"))

        detail_safe = d.pop("detailSafe")

        metrics = TaskMetrics.from_dict(d.pop("metrics"))

        fail_task_request = cls(
            lease_id=lease_id,
            fencing_token=fencing_token,
            code=code,
            detail_safe=detail_safe,
            metrics=metrics,
        )

        return fail_task_request
