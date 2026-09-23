from typing import Literal, cast

WorkerDesiredStatus = Literal["ACTIVE", "DRAINING", "REVOKED"]

WORKER_DESIRED_STATUS_VALUES: set[WorkerDesiredStatus] = {
    "ACTIVE",
    "DRAINING",
    "REVOKED",
}


def check_worker_desired_status(value: str) -> WorkerDesiredStatus:
    if value in WORKER_DESIRED_STATUS_VALUES:
        return cast(WorkerDesiredStatus, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {WORKER_DESIRED_STATUS_VALUES!r}")
