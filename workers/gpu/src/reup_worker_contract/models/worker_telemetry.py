from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="WorkerTelemetry")


@_attrs_define
class WorkerTelemetry:
    """
    Attributes:
        gpu_utilization_percent (float | Unset):
        vram_used_mb (int | Unset):
        cpu_utilization_percent (float | Unset):
        memory_used_mb (int | Unset):
    """

    gpu_utilization_percent: float | Unset = UNSET
    vram_used_mb: int | Unset = UNSET
    cpu_utilization_percent: float | Unset = UNSET
    memory_used_mb: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        gpu_utilization_percent = self.gpu_utilization_percent

        vram_used_mb = self.vram_used_mb

        cpu_utilization_percent = self.cpu_utilization_percent

        memory_used_mb = self.memory_used_mb

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if gpu_utilization_percent is not UNSET:
            field_dict["gpuUtilizationPercent"] = gpu_utilization_percent
        if vram_used_mb is not UNSET:
            field_dict["vramUsedMb"] = vram_used_mb
        if cpu_utilization_percent is not UNSET:
            field_dict["cpuUtilizationPercent"] = cpu_utilization_percent
        if memory_used_mb is not UNSET:
            field_dict["memoryUsedMb"] = memory_used_mb

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        gpu_utilization_percent = d.pop("gpuUtilizationPercent", UNSET)

        vram_used_mb = d.pop("vramUsedMb", UNSET)

        cpu_utilization_percent = d.pop("cpuUtilizationPercent", UNSET)

        memory_used_mb = d.pop("memoryUsedMb", UNSET)

        worker_telemetry = cls(
            gpu_utilization_percent=gpu_utilization_percent,
            vram_used_mb=vram_used_mb,
            cpu_utilization_percent=cpu_utilization_percent,
            memory_used_mb=memory_used_mb,
        )

        return worker_telemetry
