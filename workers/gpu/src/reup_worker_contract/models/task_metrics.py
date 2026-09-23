from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="TaskMetrics")


@_attrs_define
class TaskMetrics:
    """
    Attributes:
        download_ms (int | Unset):
        model_load_ms (int | Unset):
        execution_ms (int | Unset):
        upload_ms (int | Unset):
        gpu_active_ms (int | Unset):
        peak_vram_mb (int | Unset):
        input_bytes (str | Unset):
        output_bytes (str | Unset):
        exit_code (int | None | Unset):
    """

    download_ms: int | Unset = UNSET
    model_load_ms: int | Unset = UNSET
    execution_ms: int | Unset = UNSET
    upload_ms: int | Unset = UNSET
    gpu_active_ms: int | Unset = UNSET
    peak_vram_mb: int | Unset = UNSET
    input_bytes: str | Unset = UNSET
    output_bytes: str | Unset = UNSET
    exit_code: int | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        download_ms = self.download_ms

        model_load_ms = self.model_load_ms

        execution_ms = self.execution_ms

        upload_ms = self.upload_ms

        gpu_active_ms = self.gpu_active_ms

        peak_vram_mb = self.peak_vram_mb

        input_bytes = self.input_bytes

        output_bytes = self.output_bytes

        exit_code: int | None | Unset
        if isinstance(self.exit_code, Unset):
            exit_code = UNSET
        else:
            exit_code = self.exit_code

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if download_ms is not UNSET:
            field_dict["downloadMs"] = download_ms
        if model_load_ms is not UNSET:
            field_dict["modelLoadMs"] = model_load_ms
        if execution_ms is not UNSET:
            field_dict["executionMs"] = execution_ms
        if upload_ms is not UNSET:
            field_dict["uploadMs"] = upload_ms
        if gpu_active_ms is not UNSET:
            field_dict["gpuActiveMs"] = gpu_active_ms
        if peak_vram_mb is not UNSET:
            field_dict["peakVramMb"] = peak_vram_mb
        if input_bytes is not UNSET:
            field_dict["inputBytes"] = input_bytes
        if output_bytes is not UNSET:
            field_dict["outputBytes"] = output_bytes
        if exit_code is not UNSET:
            field_dict["exitCode"] = exit_code

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        download_ms = d.pop("downloadMs", UNSET)

        model_load_ms = d.pop("modelLoadMs", UNSET)

        execution_ms = d.pop("executionMs", UNSET)

        upload_ms = d.pop("uploadMs", UNSET)

        gpu_active_ms = d.pop("gpuActiveMs", UNSET)

        peak_vram_mb = d.pop("peakVramMb", UNSET)

        input_bytes = d.pop("inputBytes", UNSET)

        output_bytes = d.pop("outputBytes", UNSET)

        def _parse_exit_code(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        exit_code = _parse_exit_code(d.pop("exitCode", UNSET))

        task_metrics = cls(
            download_ms=download_ms,
            model_load_ms=model_load_ms,
            execution_ms=execution_ms,
            upload_ms=upload_ms,
            gpu_active_ms=gpu_active_ms,
            peak_vram_mb=peak_vram_mb,
            input_bytes=input_bytes,
            output_bytes=output_bytes,
            exit_code=exit_code,
        )

        return task_metrics
