# Conduit Worker — Temporal worker that runs workflows and spawns agent-runner
# containers via Docker. Built from the monorepo root:
#   docker build -f apps/worker/Dockerfile .

# ---- builder ---------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /build

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/agent/package.json packages/agent/
COPY apps/worker/package.json apps/worker/

RUN npm ci --include=dev --ignore-scripts \
      --workspace=@conduit/worker \
      --workspace=@conduit/database \
      --workspace=@conduit/shared \
      --workspace=@conduit/agent \
      --include-workspace-root

COPY packages/database/ packages/database/
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/
COPY apps/worker/ apps/worker/

RUN npm run build --workspace @conduit/shared \
 && npm run build --workspace @conduit/database \
 && npm run build --workspace @conduit/agent \
 && npm run build --workspace @conduit/worker

RUN npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime

# Docker CLI — the worker spawns agent-runner containers via `docker run`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli git \
 && git config --system user.email conduit@local \
 && git config --system user.name Conduit \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/worker

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/shared/dist ./node_modules/@conduit/shared/dist
COPY --from=builder /build/packages/shared/package.json ./node_modules/@conduit/shared/package.json
COPY --from=builder /build/packages/database/dist ./node_modules/@conduit/database/dist
COPY --from=builder /build/packages/database/package.json ./node_modules/@conduit/database/package.json
COPY --from=builder /build/packages/agent/dist ./node_modules/@conduit/agent/dist
COPY --from=builder /build/packages/agent/package.json ./node_modules/@conduit/agent/package.json

COPY --from=builder /build/node_modules/.prisma ./node_modules/.prisma

COPY --from=builder /build/apps/worker/dist ./dist
COPY --from=builder /build/apps/worker/package.json ./package.json

ENTRYPOINT ["node", "dist/main.js"]
