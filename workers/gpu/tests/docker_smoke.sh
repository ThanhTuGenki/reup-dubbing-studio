#!/usr/bin/env bash
set -euo pipefail

docker build -f docker/batch.Dockerfile -t reup-batch:default-smoke .
docker build -f docker/tts.Dockerfile -t reup-tts:default-smoke .

for image in reup-batch:default-smoke reup-tts:default-smoke; do
    docker run --rm --entrypoint /bin/sh "$image" -c \
        'test -x /opt/venv/bin/python && /opt/venv/bin/python --version'
    docker run --rm "$image" --version
    docker run --rm "$image" --health
    test "$(docker run --rm --entrypoint whoami "$image")" = worker
done
