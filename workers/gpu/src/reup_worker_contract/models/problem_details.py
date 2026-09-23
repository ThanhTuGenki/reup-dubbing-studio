from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.worker_problem_code import WorkerProblemCode, check_worker_problem_code
from ..types import UNSET, Unset

T = TypeVar("T", bound="ProblemDetails")


@_attrs_define
class ProblemDetails:
    """
    Attributes:
        type_ (str):
        title (str):
        status (int):
        code (WorkerProblemCode):
        request_id (UUID):
        detail (str | Unset):
    """

    type_: str
    title: str
    status: int
    code: WorkerProblemCode
    request_id: UUID
    detail: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        title = self.title

        status = self.status

        code: str = self.code

        request_id = str(self.request_id)

        detail = self.detail

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "title": title,
                "status": status,
                "code": code,
                "requestId": request_id,
            }
        )
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        title = d.pop("title")

        status = d.pop("status")

        code = check_worker_problem_code(d.pop("code"))

        request_id = UUID(d.pop("requestId"))

        detail = d.pop("detail", UNSET)

        problem_details = cls(
            type_=type_,
            title=title,
            status=status,
            code=code,
            request_id=request_id,
            detail=detail,
        )

        return problem_details
