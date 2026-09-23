import re
from collections.abc import Mapping
from typing import Any

_SECRET_KEYS = re.compile(r"authorization|cookie|credential|token|secret|signed|url", re.IGNORECASE)


def redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if _SECRET_KEYS.search(str(key)) else redact(item) for key, item in value.items()
        }
    if isinstance(value, list | tuple):
        return [redact(item) for item in value]
    return value
