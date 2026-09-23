from typing import Literal, cast

SeparateAudioTaskConfigurationModelName = Literal["htdemucs"]

SEPARATE_AUDIO_TASK_CONFIGURATION_MODEL_NAME_VALUES: set[SeparateAudioTaskConfigurationModelName] = {
    "htdemucs",
}


def check_separate_audio_task_configuration_model_name(value: str) -> SeparateAudioTaskConfigurationModelName:
    if value in SEPARATE_AUDIO_TASK_CONFIGURATION_MODEL_NAME_VALUES:
        return cast(SeparateAudioTaskConfigurationModelName, value)
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {SEPARATE_AUDIO_TASK_CONFIGURATION_MODEL_NAME_VALUES!r}"
    )
