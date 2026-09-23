from typing import Literal, cast

RenderOutputVariant = Literal["FULL_16X9", "HIGHLIGHT_9X16"]

RENDER_OUTPUT_VARIANT_VALUES: set[RenderOutputVariant] = {
    "FULL_16X9",
    "HIGHLIGHT_9X16",
}


def check_render_output_variant(value: str) -> RenderOutputVariant:
    if value in RENDER_OUTPUT_VARIANT_VALUES:
        return cast(RenderOutputVariant, value)
    raise TypeError(f"Unexpected value {value!r}. Expected one of {RENDER_OUTPUT_VARIANT_VALUES!r}")
