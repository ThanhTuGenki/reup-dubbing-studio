# Runbook Control Plane Web/API

## Phạm vi

Runbook này vận hành `apps/api` và `apps/web` cho MVP single-workspace. Worker GPU,
model media và automated publishing nằm ngoài phạm vi; xem
`manual-checklist.md` cho acceptance thủ công liên quan.

## Khởi động

Để chạy cả stack bằng Docker và cho GPU Worker thuê ngoài kết nối về, xem
`control-plane-compose.md`. Các bước dưới đây dùng cho phát triển bằng pnpm trên
host.

1. Cài Node.js 24 và pnpm 10.28; chuẩn bị PostgreSQL riêng.
2. Tạo `apps/api/.env` và `apps/web/.env` từ hai file example.
3. Sinh Prisma client, áp migration rồi chạy API/Web:

```bash
pnpm install --frozen-lockfile
pnpm --filter @reup-dubbing-studio/api prisma:generate
pnpm --filter @reup-dubbing-studio/api prisma:migrate:deploy
pnpm --filter @reup-dubbing-studio/api dev
pnpm web:dev
```

Không commit `.env`, cookie, API key, R2 key hoặc enrollment token. Backup
PostgreSQL trước migration production và kiểm tra restore định kỳ theo chính sách
hạ tầng của môi trường triển khai.

## Kiểm tra sau deploy

```bash
curl -fsS http://localhost:3000/v1/health/live
curl -fsS http://localhost:3000/v1/health/ready
```

Sau đó mở Dashboard và xác nhận:

- dữ liệu Dashboard tải được và deep-link mở đúng entity;
- Queue/Worker/Studio hiện trạng thái cập nhật trực tiếp hoặc fallback an toàn;
- Settings chỉ hiện hint credential, không hiện lại secret;
- download/preview chỉ tạo signed grant sau thao tác người dùng;
- browser console/network không có loop request hoặc lỗi CORS.

## Quality gate phát hành

```bash
pnpm lint
pnpm typecheck
pnpm contract:verify
pnpm test
TEST_DATABASE_URL=postgresql://... pnpm --filter @reup-dubbing-studio/api test:e2e
pnpm depcruise
pnpm --filter @reup-dubbing-studio/api build
pnpm web:build
pnpm web:test:e2e
```

`TEST_DATABASE_URL` phải là database dùng riêng cho test. Suite hiện có 14 nhóm
integration PostgreSQL và Playwright bao phủ flow chính cùng 9 viewport chuẩn.

## Xử lý sự cố

- API không ready: kiểm tra config validation, kết nối PostgreSQL và migration;
  dùng `X-Request-Id` để đối chiếu log, không chia sẻ body/header chứa secret.
- Web không gọi được API: kiểm tra `VITE_CONTROL_PLANE_URL`, HTTPS production và
  `CORS_ORIGINS` chính xác.
- SSE mất kết nối: browser tự reconnect; Web báo toast transient và refetch REST.
  Không coi event stream là nguồn dữ liệu duy nhất.
- Credential lỗi: rotate qua Settings/Discovery; không đọc ciphertext trực tiếp
  và không ghi raw credential vào issue/log.
- Signed grant hết hạn: xin grant mới; không cache URL, bucket hay object key.
- Worker lỗi/offline: Control Plane chỉ drain/revoke/ghi nhận. Thuê hoặc xóa máy
  vẫn là thao tác thủ công tại provider.

## Quyết định MVP cần giữ

- PostgreSQL, single workspace, chưa có login.
- Không notification table/center; chỉ toast/SSE transient.
- Manual publishing, không lưu OAuth publishing token.
- Không Worker/GPU implementation trong repository slice Web/API này.
