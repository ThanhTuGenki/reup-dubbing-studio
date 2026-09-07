# GPU worker images

The batch-media and interactive-TTS images share the same lightweight Python
scaffold. Model/runtime dependencies are deliberately deferred to their worker
implementation tasks; these images must remain CPU-buildable meanwhile.

```bash
docker build --build-arg BASE_IMAGE=python:3.11-slim -f docker/batch.Dockerfile .
docker build --build-arg BASE_IMAGE=python:3.11-slim -f docker/tts.Dockerfile .
```

Production GPU builds use the default CUDA runtime base. The image has no
secrets baked in and runs as the non-root `worker` user. `--health` is a
dependency-free container health probe; normal startup still fails fast unless
`CONTROL_PLANE_URL` is configured.
