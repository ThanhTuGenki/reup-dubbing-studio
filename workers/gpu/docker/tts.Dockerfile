ARG BASE_IMAGE=nvidia/cuda:12.4.1-runtime-ubuntu22.04

FROM ${BASE_IMAGE} AS builder
ENV VIRTUAL_ENV=/opt/venv UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_INSTALL_DIR=/opt/python PATH="/opt/venv/bin:/usr/local/bin:$PATH"
RUN if ! command -v python >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
      && ln -s /usr/bin/python3 /usr/local/bin/python \
      && rm -rf /var/lib/apt/lists/*; \
    fi
RUN python -m pip install --no-cache-dir uv
RUN uv python install 3.11
WORKDIR /build
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --python 3.11 --no-dev

FROM ${BASE_IMAGE} AS runtime
ENV VIRTUAL_ENV=/opt/venv PATH="/opt/venv/bin:/usr/local/bin:$PATH" PYTHONPATH=/app/src PYTHONUNBUFFERED=1
RUN if ! command -v python >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates \
      && ln -s /usr/bin/python3 /usr/local/bin/python \
      && rm -rf /var/lib/apt/lists/*; \
    fi
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/python /opt/python
COPY --from=builder /build/src /app/src
RUN useradd --create-home --uid 10001 worker
USER worker
WORKDIR /workspace
HEALTHCHECK --interval=30s --timeout=3s CMD ["reup-tts-worker", "--health"]
ENTRYPOINT ["reup-tts-worker"]
