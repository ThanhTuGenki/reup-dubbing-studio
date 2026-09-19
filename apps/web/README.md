# Web Dashboard

Ứng dụng React + TypeScript + Vite này cung cấp app shell, route foundation và
trạng thái kết nối tới Control Plane. Phạm vi hiện tại chỉ đọc health readiness;
không có màn hình hoặc dữ liệu nghiệp vụ.

## Yêu cầu và cài đặt

- Node 24 và pnpm 10.28.
- Từ thư mục gốc chạy `pnpm install --frozen-lockfile`.
- Sao chép `.env.example` thành `.env`. Đây chỉ là cấu hình public, không đặt
  secret, token hoặc credential vào biến `VITE_*`.

```dotenv
VITE_CONTROL_PLANE_URL=http://localhost:3000/v1
```

Development chỉ chấp nhận HTTP ở loopback; production bắt buộc HTTPS. URL phải
có đúng base path `/v1`, không được chứa user info, query hoặc fragment.

## Chạy cục bộ cùng API

Tạo `apps/api/.env` từ `apps/api/.env.example`; cấu hình mẫu đã cho phép origin
`http://localhost:5173` qua `CORS_ORIGINS`. Mở hai terminal tại root:

```bash
pnpm --filter @reup-dubbing-studio/api dev
pnpm web:dev
```

Mở `http://localhost:5173`. Khi API sẵn sàng, trang foundation hiển thị “Sẵn
sàng” và mã request do API cung cấp. Nếu API dừng hoặc phản hồi lỗi, UI chỉ hiện
thông báo an toàn và nút “Thử lại”; nó không hiển thị raw response hay stack.

## Lệnh phát triển và kiểm tra

```bash
pnpm web:dev
pnpm web:build
pnpm --filter @reup-dubbing-studio/web preview
pnpm --filter @reup-dubbing-studio/web lint
pnpm --filter @reup-dubbing-studio/web typecheck
pnpm web:test
pnpm web:test:e2e
```

Kiểm tra `/` ở viewport 375px, 768px và 1440px; xác nhận không cuộn ngang. Dùng
Tab/Enter/Escape để kiểm tra focus và drawer mobile, sau đó bật reduced motion.
Route dành trước như `/discovery` chỉ hiện trạng thái chưa khả dụng; URL lạ giữ
app shell và cung cấp đường về `/`.

## Nền tảng danh sách

Các màn hình danh sách dùng chung:

- `shared/lib/list-query.ts` để chuẩn hóa page, page size `20/50/100`, filter
  rỗng và query key phân cấp;
- `shared/ui/list-filter-bar.tsx` cho khung filter và hành động đặt lại;
- `shared/ui/list-pagination.tsx` cho range, page size và điều hướng trang;
- `shared/ui/list-state.tsx` cho loading, empty và error state có live-region phù
  hợp.

Filter mới phải đưa về page 1. Cursor hoặc schema filter của provider không được
đoán ở shared layer; chúng được chốt trong contract của vertical slice tương ứng.

## Chẩn đoán readiness

1. Xác nhận `VITE_CONTROL_PLANE_URL` trỏ tới public base URL kết thúc bằng `/v1`.
2. Xác nhận API đang chạy và `CORS_ORIGINS` có origin của Web.
3. Bấm “Thử lại” sau khi API hoạt động. Nếu lỗi còn tiếp diễn, cung cấp “Mã hỗ
   trợ” trên UI cho người vận hành; không sao chép body/header nhạy cảm.

## Ranh giới kiến trúc

Web chỉ tiêu thụ contract health được generate từ OpenAPI qua public API của
`@reup-dubbing-studio/api-client`. Không sửa generated code và không import
source `apps/api`.

- [Kiến trúc ứng dụng](../../docs/architecture/application.md)
- [Quy ước OpenAPI](../../contracts/openapi/README.md)
- [Quickstart của spec](../../../agent-team/projects/reup-dubbing-studio/specs/003-web-foundation/quickstart.md)

Ngoài phạm vi: authentication/authorization, SSE/WebSocket, database, worker,
object store, presigned URL, upload/download, mutation, workflow state, mock KPI,
domain entity và màn hình nghiệp vụ hoàn chỉnh.
