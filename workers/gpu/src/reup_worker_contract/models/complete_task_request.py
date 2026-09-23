from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.complete_task_request_result import CompleteTaskRequestResult
    from ..models.task_metrics import TaskMetrics
    from ..models.task_output_reference import TaskOutputReference


T = TypeVar("T", bound="CompleteTaskRequest")


@_attrs_define
class CompleteTaskRequest:
    """
    Attributes:
        lease_id (UUID):
        fencing_token (str):
        outputs (list[TaskOutputReference]):
        result (CompleteTaskRequestResult):
        metrics (TaskMetrics):
    """

    lease_id: UUID
    fencing_token: str
    outputs: list[TaskOutputReference]
    result: CompleteTaskRequestResult
    metrics: TaskMetrics

    def to_dict(self) -> dict[str, Any]:
        from ..models.complete_task_request_result import CompleteTaskRequestResult
        from ..models.task_metrics import TaskMetrics
        from ..models.task_output_reference import TaskOutputReference

        lease_id = str(self.lease_id)

        fencing_token = self.fencing_token

        outputs = []
        for outputs_item_data in self.outputs:
            outputs_item = outputs_item_data.to_dict()
            outputs.append(outputs_item)

        result = self.result.to_dict()

        metrics = self.metrics.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "leaseId": lease_id,
                "fencingToken": fencing_token,
                "outputs": outputs,
                "result": result,
                "metrics": metrics,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.complete_task_request_result import CompleteTaskRequestResult
        from ..models.task_metrics import TaskMetrics
        from ..models.task_output_reference import TaskOutputReference

        d = dict(src_dict)
        lease_id = UUID(d.pop("leaseId"))

        fencing_token = d.pop("fencingToken")

        outputs = []
        _outputs = d.pop("outputs")
        for outputs_item_data in _outputs:
            outputs_item = TaskOutputReference.from_dict(outputs_item_data)

            outputs.append(outputs_item)

        result = CompleteTaskRequestResult.from_dict(d.pop("result"))

        metrics = TaskMetrics.from_dict(d.pop("metrics"))

        complete_task_request = cls(
            lease_id=lease_id,
            fencing_token=fencing_token,
            outputs=outputs,
            result=result,
            metrics=metrics,
        )

        return complete_task_request
