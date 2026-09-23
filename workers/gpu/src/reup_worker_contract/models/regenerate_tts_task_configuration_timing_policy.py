from typing import Literal, cast

RegenerateTtsTaskConfigurationTimingPolicy = Literal["ALLOW_DRIFT", "FIT_SEGMENT", "PRESERVE_SEGMENT"]

REGENERATE_TTS_TASK_CONFIGURATION_TIMING_POLICY_VALUES: set[RegenerateTtsTaskConfigurationTimingPolicy] = {
    "ALLOW_DRIFT",
    "FIT_SEGMENT",
    "PRESERVE_SEGMENT",
}


def check_regenerate_tts_task_configuration_timing_policy(value: str) -> RegenerateTtsTaskConfigurationTimingPolicy:
    if value in REGENERATE_TTS_TASK_CONFIGURATION_TIMING_POLICY_VALUES:
        return cast(RegenerateTtsTaskConfigurationTimingPolicy, value)
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {REGENERATE_TTS_TASK_CONFIGURATION_TIMING_POLICY_VALUES!r}"
    )
