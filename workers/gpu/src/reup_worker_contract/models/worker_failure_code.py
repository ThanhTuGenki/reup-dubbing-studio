from typing import Literal, cast

WorkerFailureCode = Literal[
    "CHECKSUM_FAILED",
    "DOWNLOAD_FAILED",
    "INFERENCE_FAILED",
    "INVALID_INPUT",
    "MODEL_LOAD_FAILED",
    "OUT_OF_MEMORY",
    "PROCESS_EXITED",
    "PROCESS_TIMEOUT",
    "SCRATCH_EXHAUSTED",
    "TRANSIENT_NETWORK_ERROR",
    "TRANSIENT_STORAGE_ERROR",
    "UPLOAD_FAILED",
]

WORKER_FAILURE_CODE_VALUES: set[WorkerFailureCode] = {
    "CHECKSUM_FAILED",
    "DOWNLOAD_FAILED",
    "INFERENCE_FAILED",
    "INVALID_INPUT",
    "MODEL_LOAD_FAILED",
    "OUT_OF_MEMORY",
    "PROCESS_EXITED",
    "PROCESS_TIMEOUT",
    "SCRATCH_EXHAUSTED",
    "TRANSIENT_NETWORK_ERROR",
    "TRANSIENT_STORAGE_ERROR",
    "UPLOAD_FAILED",
}


def check_worker_failure_code(value: str) -> WorkerFailureCode:
    if value in WORKER_FAILURE_CODE_VALUES:
        return cast(WorkerFailureCode, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {WORKER_FAILURE_CODE_VALUES!r}")
