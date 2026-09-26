# syntax=docker/dockerfile:1.7
# Web SPA image. Build context is the repository root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_CONTROL_PLANE_URL=https://<host>/v1 .
# VITE_CONTROL_PLANE_URL is embedded at build time; a production build only accepts https.

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @reup-dubbing-studio/web...
ARG VITE_CONTROL_PLANE_URL
RUN test -n "$VITE_CONTROL_PLANE_URL" || (echo 'VITE_CONTROL_PLANE_URL build arg is required' >&2; exit 1)
ENV VITE_CONTROL_PLANE_URL=$VITE_CONTROL_PLANE_URL
RUN pnpm --filter @reup-dubbing-studio/web build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
