from typing import Literal, cast

WorkerRole = Literal["BATCH_MEDIA", "INTERACTIVE_TTS"]

WORKER_ROLE_VALUES: set[WorkerRole] = {
    "BATCH_MEDIA",
    "INTERACTIVE_TTS",
}


def check_worker_role(value: str) -> WorkerRole:
    if value in WORKER_ROLE_VALUES:
        return cast(WorkerRole, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {WORKER_ROLE_VALUES!r}")
