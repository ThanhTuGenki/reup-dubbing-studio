#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
COMPOSE_FILE="$ROOT_DIR/infra/compose/local.yml"

docker compose -f "$COMPOSE_FILE" up -d --wait postgres minio
docker compose -f "$COMPOSE_FILE" run --rm minio-init

cat <<EOF
Local services are ready.
DATABASE_URL=postgresql://${POSTGRES_USER:-reup}:${POSTGRES_PASSWORD:-reup-dev-password}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-reup}
MinIO API: http://localhost:${MINIO_API_PORT:-9000}
MinIO console: http://localhost:${MINIO_CONSOLE_PORT:-9001}
EOF
