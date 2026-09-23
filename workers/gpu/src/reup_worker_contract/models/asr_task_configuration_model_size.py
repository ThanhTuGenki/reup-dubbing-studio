from typing import Literal, cast

AsrTaskConfigurationModelSize = Literal["large-v3", "medium", "small"]

ASR_TASK_CONFIGURATION_MODEL_SIZE_VALUES: set[AsrTaskConfigurationModelSize] = {
    "large-v3",
    "medium",
    "small",
}


def check_asr_task_configuration_model_size(value: str) -> AsrTaskConfigurationModelSize:
    if value in ASR_TASK_CONFIGURATION_MODEL_SIZE_VALUES:
        return cast(AsrTaskConfigurationModelSize, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {ASR_TASK_CONFIGURATION_MODEL_SIZE_VALUES!r}")
