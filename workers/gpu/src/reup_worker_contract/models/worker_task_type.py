from typing import Literal, cast

WorkerTaskType = Literal[
    "DESUB",
    "GENERATE_INITIAL_TTS",
    "REGENERATE_SEGMENT",
    "RENDER",
    "SEPARATE_AUDIO",
    "TRANSCRIBE_ASR",
    "TRANSCRIBE_OCR",
]

WORKER_TASK_TYPE_VALUES: set[WorkerTaskType] = {
    "DESUB",
    "GENERATE_INITIAL_TTS",
    "REGENERATE_SEGMENT",
    "RENDER",
    "SEPARATE_AUDIO",
    "TRANSCRIBE_ASR",
    "TRANSCRIBE_OCR",
}


def check_worker_task_type(value: str) -> WorkerTaskType:
    if value in WORKER_TASK_TYPE_VALUES:
        return cast(WorkerTaskType, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {WORKER_TASK_TYPE_VALUES!r}")
