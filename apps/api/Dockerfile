# Conduit API — NestJS server, Prisma client, Temporal client.
# Built from the monorepo root: docker build -f apps/api/Dockerfile .

# ---- builder ---------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /build

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Workspace manifests first for layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/agent/package.json packages/agent/
COPY apps/api/package.json apps/api/
COPY apps/api/nest-cli.json apps/api/

RUN npm ci --include=dev --ignore-scripts \
      --workspace=@conduit/api \
      --workspace=@conduit/database \
      --workspace=@conduit/shared \
      --workspace=@conduit/agent \
      --include-workspace-root

# Prisma generate needs the schema present before the build.
COPY packages/database/ packages/database/
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/
COPY apps/api/ apps/api/

RUN npm run build --workspace @conduit/shared \
 && npm run build --workspace @conduit/database \
 && npm run build --workspace @conduit/agent \
 && npm run build --workspace @conduit/api

RUN npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/api

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/shared/dist ./node_modules/@conduit/shared/dist
COPY --from=builder /build/packages/shared/package.json ./node_modules/@conduit/shared/package.json
COPY --from=builder /build/packages/database/dist ./node_modules/@conduit/database/dist
COPY --from=builder /build/packages/database/package.json ./node_modules/@conduit/database/package.json
COPY --from=builder /build/packages/agent/dist ./node_modules/@conduit/agent/dist
COPY --from=builder /build/packages/agent/package.json ./node_modules/@conduit/agent/package.json

# Prisma client + schema (needed by db push).
COPY --from=builder /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /build/packages/database/prisma ./prisma

# Deps npm didn't hoist to root (better-auth, set-cookie-parser).
COPY --from=builder /build/apps/api/node_modules ./api-deps
RUN cp -a api-deps/. node_modules/ && rm -rf api-deps

COPY --from=builder /build/apps/api/dist ./dist
COPY --from=builder /build/apps/api/package.json ./package.json

# Static data dirs read at boot by template-loader and agent-preset-loader.
# Both resolve to path.resolve(__dirname, '../../../../..', '<dir>'), which
# from /opt/api/dist/modules/<mod> lands at /opt/api/../../../<dir> = /<dir>.
COPY templates/ /templates/
COPY agent-presets/ /agent-presets/

EXPOSE 3000

COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
