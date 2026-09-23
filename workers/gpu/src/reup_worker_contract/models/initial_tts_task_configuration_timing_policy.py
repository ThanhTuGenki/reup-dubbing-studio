from typing import Literal, cast

InitialTtsTaskConfigurationTimingPolicy = Literal["ALLOW_DRIFT", "FIT_SEGMENT", "PRESERVE_SEGMENT"]

INITIAL_TTS_TASK_CONFIGURATION_TIMING_POLICY_VALUES: set[InitialTtsTaskConfigurationTimingPolicy] = {
    "ALLOW_DRIFT",
    "FIT_SEGMENT",
    "PRESERVE_SEGMENT",
}


def check_initial_tts_task_configuration_timing_policy(value: str) -> InitialTtsTaskConfigurationTimingPolicy:
    if value in INITIAL_TTS_TASK_CONFIGURATION_TIMING_POLICY_VALUES:
        return cast(InitialTtsTaskConfigurationTimingPolicy, value)
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {INITIAL_TTS_TASK_CONFIGURATION_TIMING_POLICY_VALUES!r}"
    )
