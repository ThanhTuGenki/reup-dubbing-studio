from typing import Literal, cast

WorkerTaskStatus = Literal["CANCELLED", "FAILED", "LEASED", "RUNNING", "SUCCEEDED"]

WORKER_TASK_STATUS_VALUES: set[WorkerTaskStatus] = {
    "CANCELLED",
    "FAILED",
    "LEASED",
    "RUNNING",
    "SUCCEEDED",
}


def check_worker_task_status(value: str) -> WorkerTaskStatus:
    if value in WORKER_TASK_STATUS_VALUES:
        return cast(WorkerTaskStatus, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {WORKER_TASK_STATUS_VALUES!r}")
