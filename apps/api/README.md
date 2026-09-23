# Control Plane API

NestJS/Fastify Control Plane cho Reup Dubbing Studio. API quản lý Settings,
Profiles, Voices, Discovery, Ingest/Queue, Workers, Library, Studio, Review
Policy, Publishing và Dashboard. PostgreSQL là nguồn chuẩn; API không chạy tác
vụ media/GPU nặng trong HTTP request.

## Chạy local

Yêu cầu Node.js 24, pnpm 10.28 và PostgreSQL. Từ repository root:

```bash
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
pnpm --filter @reup-dubbing-studio/api prisma:generate
pnpm --filter @reup-dubbing-studio/api prisma:migrate:deploy
pnpm --filter @reup-dubbing-studio/api dev
```

`SETTINGS_ENCRYPTION_KEY` phải là 32 byte base64 và nằm ngoài Git. Không dùng
credential production trong local/test. Health probes:

```bash
curl -i http://localhost:3000/v1/health/live
curl -i http://localhost:3000/v1/health/ready
```

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm contract:verify
pnpm --filter @reup-dubbing-studio/api test
TEST_DATABASE_URL=postgresql://... pnpm --filter @reup-dubbing-studio/api test:e2e
pnpm depcruise
pnpm --filter @reup-dubbing-studio/api build
```

Integration test PostgreSQL tự dọn fixture nhưng phải dùng database test riêng.
Không trỏ `TEST_DATABASE_URL` vào database development hoặc production.

## Ranh giới an toàn

- Single workspace, chưa có login; không public API trực tiếp ra Internet.
- Input ngoài DTO contract bị từ chối; lỗi 5xx không trả stack/raw detail.
- Cookie/API key/R2 key lưu mã hóa; enrollment credential chỉ lưu hash và raw
  secret chỉ trả đúng một lần.
- Resource response không chứa bucket, object key hoặc signed URL lâu dài.
- SSE chỉ báo invalidation; Web refetch REST sau event/reconnect.
- OpenAPI trong `contracts/openapi/` là nguồn chuẩn duy nhất cho wire model.

Runbook đầy đủ: [Control Plane Web/API](../../docs/operations/control-plane-web-api.md).
