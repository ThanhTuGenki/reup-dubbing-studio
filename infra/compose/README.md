# Local Compose

`local.yml` starts PostgreSQL 16 and MinIO for local development. The default
credentials are development-only and can be overridden with a `.env` file in
this directory (copy `.env.example`).

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose -f infra/compose/local.yml up -d
```

PostgreSQL is available at `localhost:5432`; MinIO is available at
`localhost:9000`, with its console at `localhost:9001`. The `reup-dev` bucket
is created by `minio-init` and can be checked with the MinIO console or `mc`.

The API is opt-in because normal development runs `pnpm --filter api start:dev`:

```bash
docker compose -f infra/compose/local.yml --profile api up -d --build
```

The API profile waits for PostgreSQL and exposes readiness at
`http://localhost:3000/ready`; the readiness endpoint is supplied by the API
health lifecycle change in PR #55.

To discard all local database and object data, use the explicitly destructive
volume reset:

```bash
docker compose -f infra/compose/local.yml down -v
```
