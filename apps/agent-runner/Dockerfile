# Per-run agent execution sandbox. Pre-baked toolchain image, built once per
# release. Spawned ad-hoc by the worker process: one short-lived container per
# agent node. The orchestrator writes a `RunnerRequest` to stdin; the runner
# streams `RunnerEvent` lines on stdout.
#
# Bake into the image: the system toolchain agents commonly reach for
# (`git`, `gh`, `ripgrep`, `fd`, `jq`, native build deps), the provider SDKs
# (Claude + Codex), and the compiled runner artifact.
#
# Do NOT bake into the image: MCP server packages (user-configured per
# workflow, fetched at run time by their `command`) and user project deps
# (the agent installs them inside the workspace).

# ---- builder ---------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /build

# tsc + npm install need git for some optional deps; nothing else.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Copy the workspace manifests first so `npm ci` caches across rebuilds.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/
COPY apps/agent-runner/package.json apps/agent-runner/
RUN npm ci --include=dev --ignore-scripts

COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/
COPY apps/agent-runner/ apps/agent-runner/

# Build only what the runner needs — shared, agent, runner. Avoids dragging in
# api/web/worker tsconfigs and Prisma codegen.
# `agent-runner`'s top-level `build` chains `docker build` after `tsc` so any
# workspace build keeps the image current; inside the image we only need the
# `tsc` half (`build:ts`), and shelling out to `docker` from a build stage
# would recurse anyway.
RUN npm run build --workspace @conduit/shared \
 && npm run build --workspace @conduit/agent \
 && npm run build:ts --workspace @conduit/agent-runner

# Drop devDependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime

# System utilities the agents commonly reach for. `make`/`python3`/`g++`/
# `pkg-config` cover native module builds during agent-driven `npm install`.
# `gh` is fetched from the official deb repo so the agent can call the
# GitHub CLI in writeback turns.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends \
      git make python3 g++ pkg-config jq ripgrep fd-find gh \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/bin/fdfind /usr/local/bin/fd

WORKDIR /opt/agent-runner

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/shared/dist ./node_modules/@conduit/shared/dist
COPY --from=builder /build/packages/shared/package.json ./node_modules/@conduit/shared/package.json
COPY --from=builder /build/packages/agent/dist ./node_modules/@conduit/agent/dist
COPY --from=builder /build/packages/agent/package.json ./node_modules/@conduit/agent/package.json
COPY --from=builder /build/apps/agent-runner/dist ./dist
COPY --from=builder /build/apps/agent-runner/package.json ./package.json

ENTRYPOINT ["node", "/opt/agent-runner/dist/main.js"]
