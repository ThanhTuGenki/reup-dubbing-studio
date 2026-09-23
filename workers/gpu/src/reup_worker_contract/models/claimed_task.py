from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.worker_task_type import WorkerTaskType, check_worker_task_type
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.asr_task_configuration import AsrTaskConfiguration
    from ..models.desub_task_configuration import DesubTaskConfiguration
    from ..models.execution_requirements import ExecutionRequirements
    from ..models.initial_tts_task_configuration import InitialTtsTaskConfiguration
    from ..models.ocr_task_configuration import OcrTaskConfiguration
    from ..models.regenerate_tts_task_configuration import RegenerateTtsTaskConfiguration
    from ..models.render_task_configuration import RenderTaskConfiguration
    from ..models.separate_audio_task_configuration import SeparateAudioTaskConfiguration
    from ..models.task_input_asset import TaskInputAsset
    from ..models.task_output_specification import TaskOutputSpecification


T = TypeVar("T", bound="ClaimedTask")


@_attrs_define
class ClaimedTask:
    """
    Attributes:
        task_id (UUID):
        attempt_id (UUID):
        lease_id (UUID):
        fencing_token (str):
        task_type (WorkerTaskType):
        payload_version (Literal[1]):
        lease_expires_at (datetime.datetime):
        renew_after_seconds (int):
        requirements (ExecutionRequirements):
        configuration (AsrTaskConfiguration | DesubTaskConfiguration | InitialTtsTaskConfiguration |
            OcrTaskConfiguration | RegenerateTtsTaskConfiguration | RenderTaskConfiguration |
            SeparateAudioTaskConfiguration):
        inputs (list[TaskInputAsset]):
        outputs (list[TaskOutputSpecification]):
    """

    task_id: UUID
    attempt_id: UUID
    lease_id: UUID
    fencing_token: str
    task_type: WorkerTaskType
    payload_version: Literal[1]
    lease_expires_at: datetime.datetime
    renew_after_seconds: int
    requirements: ExecutionRequirements
    configuration: (
        AsrTaskConfiguration
        | DesubTaskConfiguration
        | InitialTtsTaskConfiguration
        | OcrTaskConfiguration
        | RegenerateTtsTaskConfiguration
        | RenderTaskConfiguration
        | SeparateAudioTaskConfiguration
    )
    inputs: list[TaskInputAsset]
    outputs: list[TaskOutputSpecification]

    def to_dict(self) -> dict[str, Any]:
        from ..models.asr_task_configuration import AsrTaskConfiguration
        from ..models.desub_task_configuration import DesubTaskConfiguration
        from ..models.execution_requirements import ExecutionRequirements
        from ..models.initial_tts_task_configuration import InitialTtsTaskConfiguration
        from ..models.ocr_task_configuration import OcrTaskConfiguration
        from ..models.regenerate_tts_task_configuration import RegenerateTtsTaskConfiguration
        from ..models.render_task_configuration import RenderTaskConfiguration
        from ..models.separate_audio_task_configuration import SeparateAudioTaskConfiguration
        from ..models.task_input_asset import TaskInputAsset
        from ..models.task_output_specification import TaskOutputSpecification

        task_id = str(self.task_id)

        attempt_id = str(self.attempt_id)

        lease_id = str(self.lease_id)

        fencing_token = self.fencing_token

        task_type: str = self.task_type

        payload_version = self.payload_version

        lease_expires_at = self.lease_expires_at.isoformat()

        renew_after_seconds = self.renew_after_seconds

        requirements = self.requirements.to_dict()

        configuration: dict[str, Any]
        if isinstance(self.configuration, DesubTaskConfiguration):
            configuration = self.configuration.to_dict()
        elif isinstance(self.configuration, OcrTaskConfiguration):
            configuration = self.configuration.to_dict()
        elif isinstance(self.configuration, AsrTaskConfiguration):
            configuration = self.configuration.to_dict()
        elif isinstance(self.configuration, InitialTtsTaskConfiguration):
            configuration = self.configuration.to_dict()
        elif isinstance(self.configuration, RegenerateTtsTaskConfiguration):
            configuration = self.configuration.to_dict()
        elif isinstance(self.configuration, SeparateAudioTaskConfiguration):
            configuration = self.configuration.to_dict()
        else:
            configuration = self.configuration.to_dict()

        inputs = []
        for inputs_item_data in self.inputs:
            inputs_item = inputs_item_data.to_dict()
            inputs.append(inputs_item)

        outputs = []
        for outputs_item_data in self.outputs:
            outputs_item = outputs_item_data.to_dict()
            outputs.append(outputs_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "taskId": task_id,
                "attemptId": attempt_id,
                "leaseId": lease_id,
                "fencingToken": fencing_token,
                "taskType": task_type,
                "payloadVersion": payload_version,
                "leaseExpiresAt": lease_expires_at,
                "renewAfterSeconds": renew_after_seconds,
                "requirements": requirements,
                "configuration": configuration,
                "inputs": inputs,
                "outputs": outputs,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.asr_task_configuration import AsrTaskConfiguration
        from ..models.desub_task_configuration import DesubTaskConfiguration
        from ..models.execution_requirements import ExecutionRequirements
        from ..models.initial_tts_task_configuration import InitialTtsTaskConfiguration
        from ..models.ocr_task_configuration import OcrTaskConfiguration
        from ..models.regenerate_tts_task_configuration import RegenerateTtsTaskConfiguration
        from ..models.render_task_configuration import RenderTaskConfiguration
        from ..models.separate_audio_task_configuration import SeparateAudioTaskConfiguration
        from ..models.task_input_asset import TaskInputAsset
        from ..models.task_output_specification import TaskOutputSpecification

        d = dict(src_dict)
        task_id = UUID(d.pop("taskId"))

        attempt_id = UUID(d.pop("attemptId"))

        lease_id = UUID(d.pop("leaseId"))

        fencing_token = d.pop("fencingToken")

        task_type = check_worker_task_type(d.pop("taskType"))

        payload_version = cast(Literal[1], d.pop("payloadVersion"))
        if payload_version != 1:
            raise ValueError(f"payloadVersion must match const 1, got '{payload_version}'")

        lease_expires_at = isoparse(d.pop("leaseExpiresAt"))

        renew_after_seconds = d.pop("renewAfterSeconds")

        requirements = ExecutionRequirements.from_dict(d.pop("requirements"))

        def _parse_configuration(
            data: object,
        ) -> (
            AsrTaskConfiguration
            | DesubTaskConfiguration
            | InitialTtsTaskConfiguration
            | OcrTaskConfiguration
            | RegenerateTtsTaskConfiguration
            | RenderTaskConfiguration
            | SeparateAudioTaskConfiguration
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_task_configuration_type_0 = DesubTaskConfiguration.from_dict(data)

                return componentsschemas_task_configuration_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_task_configuration_type_1 = OcrTaskConfiguration.from_dict(data)

                return componentsschemas_task_configuration_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_task_configuration_type_2 = AsrTaskConfiguration.from_dict(data)

                return componentsschemas_task_configuration_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_task_configuration_type_3 = InitialTtsTaskConfiguration.from_dict(data)

                return componentsschemas_task_configuration_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_task_configuration_type_4 = RegenerateTtsTaskConfiguration.from_dict(data)

                return componentsschemas_task_configuration_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_task_configuration_type_5 = SeparateAudioTaskConfiguration.from_dict(data)

                return componentsschemas_task_configuration_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_task_configuration_type_6 = RenderTaskConfiguration.from_dict(data)

            return componentsschemas_task_configuration_type_6

        configuration = _parse_configuration(d.pop("configuration"))

        inputs = []
        _inputs = d.pop("inputs")
        for inputs_item_data in _inputs:
            inputs_item = TaskInputAsset.from_dict(inputs_item_data)

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs")
        for outputs_item_data in _outputs:
            outputs_item = TaskOutputSpecification.from_dict(outputs_item_data)

            outputs.append(outputs_item)

        claimed_task = cls(
            task_id=task_id,
            attempt_id=attempt_id,
            lease_id=lease_id,
            fencing_token=fencing_token,
            task_type=task_type,
            payload_version=payload_version,
            lease_expires_at=lease_expires_at,
            renew_after_seconds=renew_after_seconds,
            requirements=requirements,
            configuration=configuration,
            inputs=inputs,
            outputs=outputs,
        )

        return claimed_task
