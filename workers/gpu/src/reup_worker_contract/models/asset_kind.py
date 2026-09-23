from typing import Literal, cast

AssetKind = Literal[
    "ASR_JSON",
    "BACKGROUND_AUDIO",
    "DESUBBED",
    "DUB_AUDIO",
    "INTRO",
    "LOGO",
    "OCR_JSON",
    "OUTPUT_VIDEO",
    "OUTRO",
    "RAW",
    "VOICE_PROMPT",
    "VOICE_SAMPLE",
    "WATERMARK",
]

ASSET_KIND_VALUES: set[AssetKind] = {
    "ASR_JSON",
    "BACKGROUND_AUDIO",
    "DESUBBED",
    "DUB_AUDIO",
    "INTRO",
    "LOGO",
    "OCR_JSON",
    "OUTPUT_VIDEO",
    "OUTRO",
    "RAW",
    "VOICE_PROMPT",
    "VOICE_SAMPLE",
    "WATERMARK",
}


def check_asset_kind(value: str) -> AssetKind:
    if value in ASSET_KIND_VALUES:
        return cast(AssetKind, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {ASSET_KIND_VALUES!r}")
