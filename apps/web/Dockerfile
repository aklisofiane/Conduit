# Conduit Web — React/Vite SPA served by nginx.
# Built from the monorepo root: docker build -f apps/web/Dockerfile .
#
# Build-time args: pass VITE_API_URL so Vite bakes the correct API origin
# into the static bundle. Example:
#   docker build --build-arg VITE_API_URL=https://api.conduit.example.com ...

# ---- builder ---------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /build

ARG VITE_API_URL=http://localhost:3000

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN npm ci --include=dev --ignore-scripts \
      --workspace=@conduit/web \
      --workspace=@conduit/shared \
      --include-workspace-root

COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

RUN npm run build --workspace @conduit/shared \
 && npm run build --workspace @conduit/web

# ---- runtime ---------------------------------------------------------------
FROM nginx:alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /build/apps/web/dist /usr/share/nginx/html

EXPOSE 80
