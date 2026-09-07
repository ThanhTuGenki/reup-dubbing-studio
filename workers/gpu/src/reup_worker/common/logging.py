from __future__ import annotations

import contextvars
import json
import logging
import os
import socket
import sys
from typing import Any

worker_id = contextvars.ContextVar("worker_id", default=None)
worker_role = contextvars.ContextVar("worker_role", default=None)
trace_id = contextvars.ContextVar("trace_id", default=None)
task_id = contextvars.ContextVar("task_id", default=None)
attempt = contextvars.ContextVar("attempt", default=None)


def bind_context(**values: Any) -> None:
    for name, value in values.items():
        variable = globals().get(name)
        if isinstance(variable, contextvars.ContextVar):
            variable.set(value)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        for secret in (os.getenv("ENROLLMENT_TOKEN"),):
            if secret:
                message = message.replace(secret, "[REDACTED]")
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
            "worker_id": worker_id.get() or os.getenv("WORKER_ID") or socket.gethostname(),
            "worker_role": worker_role.get() or os.getenv("WORKER_ROLE") or "unknown",
            "trace_id": trace_id.get(),
            "task_id": task_id.get(),
            "attempt": attempt.get(),
        }
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(level: str = "INFO", log_format: str = "text") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level.upper())
    if log_format.lower() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())
