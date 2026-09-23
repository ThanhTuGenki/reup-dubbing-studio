# Web Dashboard

React + TypeScript + Vite dashboard cho toàn bộ flow vận hành Reup Dubbing
Studio. UI dùng shadcn-first, TanStack Query, React Router và generated client từ
OpenAPI; OpenDesign chỉ là visual contract.

## Chạy local

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
pnpm web:dev
```

`VITE_CONTROL_PLANE_URL` phải kết thúc bằng `/v1`. Production bắt buộc HTTPS;
URL không được có user info, query hoặc fragment. Không đặt secret/token vào bất
kỳ biến `VITE_*` nào.

Để chạy cùng API, khởi động PostgreSQL/API theo
[runbook](../../docs/operations/control-plane-web-api.md), rồi mở
`http://localhost:5173`.

## Quality gates

```bash
pnpm --filter @reup-dubbing-studio/web lint
pnpm --filter @reup-dubbing-studio/web typecheck
pnpm web:test
pnpm web:build
pnpm web:test:e2e
```

Playwright bao phủ flow chính, axe accessibility và chín viewport từ 360 đến
1920 px. Feature route được lazy-load; shared shell hiển thị ngay với loading
state có live region.

## Quy ước runtime

- REST là nguồn chuẩn; SSE chỉ invalidate cache và refetch sau reconnect.
- Toast là transient; MVP không có notification center/read-unread persistent.
- Signed URL chỉ xin khi người dùng thao tác, dùng ngay và không persist.
- Response/error thô không được render; UI chỉ dùng message đã normalize.
- Mọi wire type/client phải generate từ `contracts/openapi/`, không tự viết lại
  schema response trong feature.
