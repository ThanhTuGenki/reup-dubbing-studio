# syntax=docker/dockerfile:1.7

ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.8.22@sha256:9874eb7afe5ca16c363fe80b294fe700e460df29a55532bbfea234a0f12eddb1
ARG CUDA_IMAGE=nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04@sha256:17e2934e1fa96152b14f78078bfbafd0f00f391df995dc6c641a720fce1202bb

FROM ${UV_IMAGE} AS uv
FROM ${CUDA_IMAGE} AS foundation

ARG TARGETARCH
ARG VCS_REF=unknown
ARG IMAGE_VERSION=0.1.0
ARG CONTRACT_VERSION=2

LABEL org.opencontainers.image.source="https://github.com/ThanhTuGenki/reup-dubbing-studio" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      io.reup.worker.contract-version="${CONTRACT_VERSION}"

ENV DEBIAN_FRONTEND=noninteractive \
    UV_LINK_MODE=copy \
    UV_HTTP_TIMEOUT=600 \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    VIRTUAL_ENV=/opt/reup-worker \
    PATH=/opt/reup-worker/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/var/lib/reup-worker/models/huggingface

COPY --from=uv /uv /usr/local/bin/uv

RUN test "${TARGETARCH}" = "amd64" \
    && sed -i 's|http://archive.ubuntu.com/ubuntu/|http://archive.ubuntu.mirror.rafal.ca/ubuntu/|g; s|http://security.ubuntu.com/ubuntu/|http://archive.ubuntu.mirror.rafal.ca/ubuntu/|g' /etc/apt/sources.list \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get update -o Acquire::Retries=5 \
    && apt-get install --yes --no-install-recommends -o Acquire::Retries=5 ca-certificates ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && uv python install 3.11 \
    && uv venv --python 3.11 "${VIRTUAL_ENV}"

WORKDIR /opt/source
COPY workers/gpu/pyproject.toml workers/gpu/README.md ./
COPY workers/gpu/src ./src
RUN uv pip install --python "${VIRTUAL_ENV}" . \
    && rm -rf /root/.cache /tmp/*

RUN groupadd --gid 10001 reup \
    && useradd --uid 10001 --gid reup --create-home --home-dir /var/lib/reup-worker reup \
    && install -d -o reup -g reup -m 0700 /var/lib/reup-worker/state /var/lib/reup-worker/work

FROM foundation AS batch
COPY workers/gpu/containers/batch-asr.requirements.lock /tmp/batch-asr.requirements.lock
COPY workers/gpu/containers/batch-demucs.requirements.lock /tmp/batch-demucs.requirements.lock
RUN uv pip install --python "${VIRTUAL_ENV}" --requirement /tmp/batch-asr.requirements.lock \
    && uv venv --python 3.11 /opt/reup-demucs \
    && uv pip install --python /opt/reup-demucs \
      --extra-index-url https://download.pytorch.org/whl/cu128 \
      --requirement /tmp/batch-demucs.requirements.lock \
    && uv pip install --python /opt/reup-demucs --no-deps . \
    && rm -rf /root/.cache /tmp/*
ENV REUP_WORKER_ROLE=BATCH_MEDIA \
    REUP_WORKER_EXECUTOR=batch \
    REUP_WORKER_CAPABILITIES=media.asr.faster-whisper.v1,media.separate.demucs.v1,media.render.ffmpeg.v1 \
    REUP_WORKER_ASR_PYTHON=/opt/reup-worker/bin/python \
    REUP_WORKER_DEMUCS_PYTHON=/opt/reup-demucs/bin/python \
    REUP_WORKER_CREDENTIAL_FILE=/var/lib/reup-worker/state/credential \
    REUP_WORKER_WORKSPACE_ROOT=/var/lib/reup-worker/work
USER 10001:10001
WORKDIR /var/lib/reup-worker
ENTRYPOINT ["reup-gpu-worker"]

FROM foundation AS interactive-tts
COPY workers/gpu/tts/requirements.lock /tmp/tts.requirements.lock
RUN uv pip install --python "${VIRTUAL_ENV}" \
      --extra-index-url https://download.pytorch.org/whl/cu128 \
      --requirement /tmp/tts.requirements.lock \
    && rm -rf /root/.cache /tmp/*
ENV REUP_WORKER_ROLE=INTERACTIVE_TTS \
    REUP_WORKER_EXECUTOR=interactive-tts \
    REUP_WORKER_CAPABILITIES=tts.omnivoice.v1 \
    REUP_WORKER_CREDENTIAL_FILE=/var/lib/reup-worker/state/credential \
    REUP_WORKER_WORKSPACE_ROOT=/var/lib/reup-worker/work \
    REUP_WORKER_TTS_PROMPT_CACHE_ROOT=/var/lib/reup-worker/state/voice-prompts \
    REUP_WORKER_TTS_MODEL_CACHE_ROOT=/var/lib/reup-worker/models/assembled
USER 10001:10001
WORKDIR /var/lib/reup-worker
ENTRYPOINT ["reup-gpu-worker"]
