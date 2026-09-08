#!/bin/sh
set -eu

echo "Running Prisma migrations..."
node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma
node node_modules/prisma/build/index.js migrate deploy
echo "Starting API..."
exec node dist/main.js
