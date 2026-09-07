# API app

NestJS + Fastify Control Plane scaffold. `GET /health` is liveness-only and
`GET /ready` checks Postgres.

Configuration is validated before Nest creates the application. Copy
`.env.example` to a local env file and provide `DATABASE_URL`; production startup
must run the migration step separately:

```bash
pnpm --filter api db:migrate:deploy
pnpm --filter api start
```

The API does not run migrations from `main.ts`. On `SIGTERM`, new requests are
rejected, in-flight requests drain, Prisma disconnects, and the process exits.
