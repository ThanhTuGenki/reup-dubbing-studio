from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.worker_resource_class import WorkerResourceClass, check_worker_resource_class
from ..types import UNSET, Unset

T = TypeVar("T", bound="ExecutionRequirements")


@_attrs_define
class ExecutionRequirements:
    """
    Attributes:
        resource_class (WorkerResourceClass):
        required_capabilities (list[str]):
        minimum_vram_mb (int | None | Unset):
        minimum_scratch_bytes (None | str | Unset):
        expected_runtime_seconds (int | None | Unset):
    """

    resource_class: WorkerResourceClass
    required_capabilities: list[str]
    minimum_vram_mb: int | None | Unset = UNSET
    minimum_scratch_bytes: None | str | Unset = UNSET
    expected_runtime_seconds: int | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        resource_class: str = self.resource_class

        required_capabilities = self.required_capabilities

        minimum_vram_mb: int | None | Unset
        if isinstance(self.minimum_vram_mb, Unset):
            minimum_vram_mb = UNSET
        else:
            minimum_vram_mb = self.minimum_vram_mb

        minimum_scratch_bytes: None | str | Unset
        if isinstance(self.minimum_scratch_bytes, Unset):
            minimum_scratch_bytes = UNSET
        else:
            minimum_scratch_bytes = self.minimum_scratch_bytes

        expected_runtime_seconds: int | None | Unset
        if isinstance(self.expected_runtime_seconds, Unset):
            expected_runtime_seconds = UNSET
        else:
            expected_runtime_seconds = self.expected_runtime_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "resourceClass": resource_class,
                "requiredCapabilities": required_capabilities,
            }
        )
        if minimum_vram_mb is not UNSET:
            field_dict["minimumVramMb"] = minimum_vram_mb
        if minimum_scratch_bytes is not UNSET:
            field_dict["minimumScratchBytes"] = minimum_scratch_bytes
        if expected_runtime_seconds is not UNSET:
            field_dict["expectedRuntimeSeconds"] = expected_runtime_seconds

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        resource_class = check_worker_resource_class(d.pop("resourceClass"))

        required_capabilities = cast(list[str], d.pop("requiredCapabilities"))

        def _parse_minimum_vram_mb(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        minimum_vram_mb = _parse_minimum_vram_mb(d.pop("minimumVramMb", UNSET))

        def _parse_minimum_scratch_bytes(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        minimum_scratch_bytes = _parse_minimum_scratch_bytes(d.pop("minimumScratchBytes", UNSET))

        def _parse_expected_runtime_seconds(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        expected_runtime_seconds = _parse_expected_runtime_seconds(d.pop("expectedRuntimeSeconds", UNSET))

        execution_requirements = cls(
            resource_class=resource_class,
            required_capabilities=required_capabilities,
            minimum_vram_mb=minimum_vram_mb,
            minimum_scratch_bytes=minimum_scratch_bytes,
            expected_runtime_seconds=expected_runtime_seconds,
        )

        return execution_requirements
