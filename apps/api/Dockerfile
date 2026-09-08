FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/*/package.json packages/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm --filter @reup-dubbing-studio/api exec prisma generate
RUN pnpm --filter @reup-dubbing-studio/api build
RUN pnpm --filter @reup-dubbing-studio/api deploy --prod --legacy --ignore-scripts /app
COPY apps/api/prisma /app/prisma
RUN node /app/node_modules/prisma/build/index.js generate --schema=/app/prisma/schema.prisma

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
COPY --from=build /workspace/apps/api/dist ./dist
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
  && addgroup -S app \
  && adduser -S -G app app \
  && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget --spider --quiet http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
