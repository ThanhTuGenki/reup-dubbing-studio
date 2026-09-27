"""Contains all the data models used in inputs/outputs"""

from .asr_task_configuration import AsrTaskConfiguration
from .asr_task_configuration_model_size import AsrTaskConfigurationModelSize
from .asset_kind import AssetKind
from .claim_task_envelope import ClaimTaskEnvelope
from .claim_task_envelope_data import ClaimTaskEnvelopeData
from .claim_task_request import ClaimTaskRequest
from .claimed_task import ClaimedTask
from .commit_output_request import CommitOutputRequest
from .committed_output import CommittedOutput
from .committed_output_envelope import CommittedOutputEnvelope
from .complete_task_request import CompleteTaskRequest
from .complete_task_request_result import CompleteTaskRequestResult
from .desub_task_configuration import DesubTaskConfiguration
from .download_grant import DownloadGrant
from .download_grant_envelope import DownloadGrantEnvelope
from .download_grant_headers import DownloadGrantHeaders
from .enrollment_envelope import EnrollmentEnvelope
from .enrollment_envelope_data import EnrollmentEnvelopeData
from .execution_requirements import ExecutionRequirements
from .fail_task_request import FailTaskRequest
from .heartbeat import Heartbeat
from .heartbeat_envelope import HeartbeatEnvelope
from .heartbeat_envelope_data import HeartbeatEnvelopeData
from .initial_tts_task_configuration import InitialTtsTaskConfiguration
from .initial_tts_task_configuration_timing_policy import InitialTtsTaskConfigurationTimingPolicy
from .lease_action_request import LeaseActionRequest
from .meta import Meta
from .normalized_mask import NormalizedMask
from .output_grant_request import OutputGrantRequest
from .output_grant_request_metadata import OutputGrantRequestMetadata
from .problem_details import ProblemDetails
from .regenerate_tts_task_configuration import RegenerateTtsTaskConfiguration
from .regenerate_tts_task_configuration_timing_policy import RegenerateTtsTaskConfigurationTimingPolicy
from .render_output_variant import RenderOutputVariant
from .render_task_configuration import RenderTaskConfiguration
from .render_variant import RenderVariant
from .separate_audio_task_configuration import SeparateAudioTaskConfiguration
from .separate_audio_task_configuration_model_name import SeparateAudioTaskConfigurationModelName
from .session_envelope import SessionEnvelope
from .session_envelope_data import SessionEnvelopeData
from .session_identity import SessionIdentity
from .session_identity_cpu_inventory import SessionIdentityCpuInventory
from .session_identity_gpu_inventory_item import SessionIdentityGpuInventoryItem
from .task_action_envelope import TaskActionEnvelope
from .task_action_envelope_data import TaskActionEnvelopeData
from .task_input_asset import TaskInputAsset
from .task_input_asset_metadata import TaskInputAssetMetadata
from .task_metrics import TaskMetrics
from .task_output_reference import TaskOutputReference
from .task_output_specification import TaskOutputSpecification
from .task_progress_request import TaskProgressRequest
from .tts_segment import TtsSegment
from .upload_grant import UploadGrant
from .upload_grant_envelope import UploadGrantEnvelope
from .upload_grant_headers import UploadGrantHeaders
from .worker_capacity import WorkerCapacity
from .worker_desired_status import WorkerDesiredStatus
from .worker_failure_code import WorkerFailureCode
from .worker_problem_code import WorkerProblemCode
from .worker_resource_class import WorkerResourceClass
from .worker_role import WorkerRole
from .worker_session import WorkerSession
from .worker_task_status import WorkerTaskStatus
from .worker_task_type import WorkerTaskType
from .worker_telemetry import WorkerTelemetry

__all__ = (
    "AsrTaskConfiguration",
    "AsrTaskConfigurationModelSize",
    "AssetKind",
    "ClaimedTask",
    "ClaimTaskEnvelope",
    "ClaimTaskEnvelopeData",
    "ClaimTaskRequest",
    "CommitOutputRequest",
    "CommittedOutput",
    "CommittedOutputEnvelope",
    "CompleteTaskRequest",
    "CompleteTaskRequestResult",
    "DesubTaskConfiguration",
    "DownloadGrant",
    "DownloadGrantEnvelope",
    "DownloadGrantHeaders",
    "EnrollmentEnvelope",
    "EnrollmentEnvelopeData",
    "ExecutionRequirements",
    "FailTaskRequest",
    "Heartbeat",
    "HeartbeatEnvelope",
    "HeartbeatEnvelopeData",
    "InitialTtsTaskConfiguration",
    "InitialTtsTaskConfigurationTimingPolicy",
    "LeaseActionRequest",
    "Meta",
    "NormalizedMask",
    "OutputGrantRequest",
    "OutputGrantRequestMetadata",
    "ProblemDetails",
    "RegenerateTtsTaskConfiguration",
    "RegenerateTtsTaskConfigurationTimingPolicy",
    "RenderOutputVariant",
    "RenderTaskConfiguration",
    "RenderVariant",
    "SeparateAudioTaskConfiguration",
    "SeparateAudioTaskConfigurationModelName",
    "SessionEnvelope",
    "SessionEnvelopeData",
    "SessionIdentity",
    "SessionIdentityCpuInventory",
    "SessionIdentityGpuInventoryItem",
    "TaskActionEnvelope",
    "TaskActionEnvelopeData",
    "TaskInputAsset",
    "TaskInputAssetMetadata",
    "TaskMetrics",
    "TaskOutputReference",
    "TaskOutputSpecification",
    "TaskProgressRequest",
    "TtsSegment",
    "UploadGrant",
    "UploadGrantEnvelope",
    "UploadGrantHeaders",
    "WorkerCapacity",
    "WorkerDesiredStatus",
    "WorkerFailureCode",
    "WorkerProblemCode",
    "WorkerResourceClass",
    "WorkerRole",
    "WorkerSession",
    "WorkerTaskStatus",
    "WorkerTaskType",
    "WorkerTelemetry",
)
