# GPU Worker scaffold

This directory contains the Python 3.11+ scaffold for two independent worker
roles: `batch_media` and `interactive_tts`. It intentionally has no worker
protocol, lease loop, subprocess runner, model logic, or task implementation.

## Local development

```bash
uv sync --all-groups
export CONTROL_PLANE_URL=https://control.example.test
uv run reup-batch-worker --version
uv run reup-tts-worker --version
make check
```

Set `LOG_FORMAT=json` for one JSON object per startup log line. Log context is
ready for `worker_id`, `trace_id`, `task_id`, and `attempt`; enrollment tokens
are redacted.

The worker follows the pipeline conventions in `docs/architecture/mvp-pipeline.md`:
pure command/transform helpers stay separate from runners, heavy dependencies
are imported inside the operation that needs them, and stage output will use
per-stage logs when runtime work is added. Runtime protocol and task behavior
are intentionally reserved for later issues.

## Container preflight

`make check` is the local quality gate. The production CUDA-base path is
covered by `tests/docker_smoke.sh`, which builds both images with their default
CUDA base, checks the bundled Python interpreter, runs version/health
entrypoints, and verifies the non-root user.

```bash
tests/docker_smoke.sh
```
