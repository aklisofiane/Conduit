#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma db push --schema=./prisma/schema.prisma --skip-generate
echo "Migrations complete."

exec node dist/main.js
