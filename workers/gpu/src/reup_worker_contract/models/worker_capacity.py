from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="WorkerCapacity")


@_attrs_define
class WorkerCapacity:
    """
    Attributes:
        max_concurrent_tasks (int):
        available_task_slots (int):
        scratch_free_bytes (str):
        vram_free_mb (int | Unset):
    """

    max_concurrent_tasks: int
    available_task_slots: int
    scratch_free_bytes: str
    vram_free_mb: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        max_concurrent_tasks = self.max_concurrent_tasks

        available_task_slots = self.available_task_slots

        scratch_free_bytes = self.scratch_free_bytes

        vram_free_mb = self.vram_free_mb

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "maxConcurrentTasks": max_concurrent_tasks,
                "availableTaskSlots": available_task_slots,
                "scratchFreeBytes": scratch_free_bytes,
            }
        )
        if vram_free_mb is not UNSET:
            field_dict["vramFreeMb"] = vram_free_mb

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        max_concurrent_tasks = d.pop("maxConcurrentTasks")

        available_task_slots = d.pop("availableTaskSlots")

        scratch_free_bytes = d.pop("scratchFreeBytes")

        vram_free_mb = d.pop("vramFreeMb", UNSET)

        worker_capacity = cls(
            max_concurrent_tasks=max_concurrent_tasks,
            available_task_slots=available_task_slots,
            scratch_free_bytes=scratch_free_bytes,
            vram_free_mb=vram_free_mb,
        )

        return worker_capacity
