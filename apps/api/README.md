# Control Plane API

`apps/api` là NestJS/Fastify Control Plane. Foundation hiện tại chỉ cung cấp
HTTP platform và health probes; không kết nối database, queue, object storage,
worker hay provider nào.

## Yêu cầu và cấu hình

- Node.js 24 và pnpm 10.28.0 theo cấu hình workspace.
- Sao chép `.env.example` thành `.env` trước khi chạy local.
- Development chỉ chấp nhận `CORS_ORIGINS=http://localhost:5173`.
- Production yêu cầu allowlist origin tường minh, không rỗng và không dùng `*`.
- `TRUST_PROXY=false` khi chạy trực tiếp; chỉ cấu hình IP/CIDR proxy thực sự tin cậy.

Không thêm credential vào `.env.example`. Cấu hình được kiểm tra trước khi server
mở port; thông báo startup không in lại giá trị cấu hình lỗi.

```bash
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
```

## Chạy và build

```bash
pnpm --filter @reup-dubbing-studio/api dev
pnpm --filter @reup-dubbing-studio/api build
pnpm --filter @reup-dubbing-studio/api start
```

`dev` chạy watch mode. `start` chạy artifact `dist/main.js`, vì vậy phải build
trước. Production log là JSON trên stdout; development dùng định dạng dễ đọc.

## Health probes

```bash
curl -i http://localhost:3000/v1/health/live
curl -i http://localhost:3000/v1/health/ready
```

Cả hai trả `200`, payload `{ data: { status: "ok" }, meta: { requestId } }` và
`X-Request-Id` trùng `meta.requestId`. Readiness chỉ xác nhận bootstrap/config;
nó không mô phỏng trạng thái dependency chưa tồn tại.

## Quality gates

Từ gốc repository:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm depcruise
pnpm contract:lint
```

Rate limit hiện lưu trong bộ nhớ của từng API instance. Giới hạn phân tán hoặc
gateway là công việc hạ tầng riêng. API không chạy FFmpeg, media/GPU hay tác vụ
dài hạn trong HTTP request.
