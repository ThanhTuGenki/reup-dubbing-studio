from typing import Literal, cast

WorkerResourceClass = Literal["GPU_BATCH", "GPU_TTS_INTERACTIVE"]

WORKER_RESOURCE_CLASS_VALUES: set[WorkerResourceClass] = {
    "GPU_BATCH",
    "GPU_TTS_INTERACTIVE",
}


def check_worker_resource_class(value: str) -> WorkerResourceClass:
    if value in WORKER_RESOURCE_CLASS_VALUES:
        return cast(WorkerResourceClass, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {WORKER_RESOURCE_CLASS_VALUES!r}")
