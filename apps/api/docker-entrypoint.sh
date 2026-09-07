#!/bin/sh
set -eu

echo "Running Prisma migrations..."
./node_modules/.bin/prisma migrate deploy
echo "Starting API..."
exec node dist/main.js
