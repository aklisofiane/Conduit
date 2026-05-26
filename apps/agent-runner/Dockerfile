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
# Scoped to just the workspaces the runner needs. Without `--workspace` filters
# `npm ci` would resolve the whole workspace (api, web, worker, database) from
# the root lockfile and drag their prod deps (React, Vite, Fastify, Temporal,
# Prisma, etc.) into the runtime image — easily hundreds of MB of dead weight.
RUN npm ci --include=dev --ignore-scripts \
      --workspace=@conduit/agent-runner \
      --workspace=@conduit/agent \
      --workspace=@conduit/shared \
      --include-workspace-root

COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/
COPY apps/agent-runner/ apps/agent-runner/

# Build only what the runner needs — shared, agent, runner. Avoids dragging in
# api/web/worker tsconfigs and Prisma codegen.
RUN npm run build --workspace @conduit/shared \
 && npm run build --workspace @conduit/agent \
 && npm run build --workspace @conduit/agent-runner

# Drop devDependencies for the runtime image.
# `npm prune` reconciles `node_modules` against the lockfile, so the rm of
# the musl native binaries has to happen *after* prune — otherwise prune
# re-installs them from the lockfile's optional-deps list. `claude-agent-sdk`
# ships glibc and musl variants as `optionalDependencies`; the lockfile
# lacks `libc` selectors so npm installs both. The SDK tries musl first on
# Linux — a musl ELF on glibc ENOENT's looking for the musl dynamic linker.
# Drop all musl variants (x64 and arm64) since we run on debian-slim/glibc.
RUN npm prune --omit=dev \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

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
 && git config --system user.email conduit@local \
 && git config --system user.name Conduit \
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

# `@anthropic-ai/claude-agent-sdk` and `zod@4` refuse to hoist to the root
# `node_modules` — claude-agent-sdk's platform-binary `optionalDependencies`
# (`-linux-x64`, `-linux-x64-musl`) block dedupe, and zod conflicts with
# `@anthropic-ai/sdk`'s zod@3 already at root. npm installs both per-workspace.
#
# `claude-provider.js` (the only consumer) lives at
# `packages/agent/dist/provider/`, so dropping the SDK and a v4 zod into
# `packages/agent/node_modules/` is enough — Node walks up from the consumer.
# Bulk-copying the workspace `node_modules` would also drag the platform
# binaries (~470 MB) that are *already hoisted to the root* — paying twice
# in image layers.
COPY --from=builder /build/packages/agent/node_modules/@anthropic-ai/claude-agent-sdk \
     ./node_modules/@conduit/agent/node_modules/@anthropic-ai/claude-agent-sdk
COPY --from=builder /build/packages/agent/node_modules/zod \
     ./node_modules/@conduit/agent/node_modules/zod

# A writable HOME for the runner. The container runs as the host worker UID
# (set per-spawn, not at image build time), so we cannot pre-chown to a
# specific user — instead the directory is mode 0777 sticky so any UID can
# write here. Pre-creating `.codex/` keeps codex's auth.json bind mount
# (`oauth-mount` auth) from materialising a root-owned parent directory that
# would block sibling writes (session log, telemetry, refreshed tokens).
RUN mkdir -p /home/runner/.codex \
 && chmod 1777 /home/runner /home/runner/.codex
ENV HOME=/home/runner

ENTRYPOINT ["node", "/opt/agent-runner/dist/main.js"]
