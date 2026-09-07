# ADR: API module layout

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: module boundaries, dependency direction và controller layout của NestJS Control Plane scaffold.
- Không phải nguồn chuẩn cho: endpoint inventory, database schema chi tiết, event bus implementation hay deployment configuration.
- Thay thế: —
- Được thay thế bởi: —

## Bối cảnh

Issue #7 dựng sườn Control Plane để vertical slice đầu tiên có vị trí đặt code rõ
ràng. Application architecture đã chọn modular monolith nhưng chưa chốt hướng
dependency, consumer boundary và vị trí của Translation/Content.

## Quyết định

1. Control Plane có 14 module: auth, discovery, videos, workflow, tasks, workers,
   voice-profiles, review, publishing, storage, notifications, audit, translation
   và content.
2. Runner nội bộ cho task `CONTROL_PLANE` và `IO` nằm trong `modules/tasks`, dùng
   chung đường lease với GPU worker; không tạo module runner riêng.
3. Mỗi module dùng bốn tên tầng cố định `http/`, `application/`, `domain/` và
   `infrastructure/`, nhưng chỉ tạo tầng khi slice có file thật.
4. Controller được tách theo consumer trong module: `http/web/` phục vụ
   `web.openapi.yaml`, còn `http/worker/` phục vụ `worker.openapi.yaml`. Module
   chỉ có một consumer thì chỉ tạo một nhánh.
5. Workflow và Tasks không import vòng nhau. Tasks phát domain event in-process
   qua `infra/events`; Workflow lắng nghe `TaskCompleted`.
6. SSE thuộc Notifications; module khác chỉ phát domain event.
7. Prisma schema đặt tại `apps/api/prisma/` và thuộc Control Plane.

### Hướng dependency

| Lớp | Module | Được import bởi |
|---|---|---|
| Nền | auth, storage, audit, notifications | lớp trên |
| Lõi | videos, workflow, tasks, workers | lớp sản phẩm |
| Sản phẩm | discovery, voice-profiles, review, publishing, translation, content | không ai |

Module không import ngược lên lớp trên; domain/application code không phụ thuộc
controller hoặc adapter hạ tầng ngoài qua abstraction phù hợp.

## Lựa chọn đã cân nhắc

- Một module runner riêng cho task `CONTROL_PLANE`/`IO`: không chọn, vì sẽ tách
  đường lease khỏi `modules/tasks` và tạo thêm boundary chưa cần thiết.
- Trộn controller web và worker trong cùng một nhánh: không chọn, vì hai consumer
  có contract và auth boundary khác nhau.
- Ép mọi module tạo đủ bốn tầng ngay từ scaffold: không chọn, vì tạo thư mục rỗng
  và không giúp vertical slice đầu tiên rõ hơn.
- Cho Workflow và Tasks import vòng nhau: không chọn, vì domain event in-process
  giữ dependency một chiều và vẫn cho phép Workflow nhận `TaskCompleted`.

## Hệ quả

- Vertical slice có thể thêm đúng các tầng cần thiết mà không tạo thư mục rỗng.
- Web và worker controller không trộn contract hoặc auth boundary của nhau.
- Scheduler chạy nhiều instance cần lock phân tán, chưa xử lý.
- `apps/api/src/modules/**` hiện chỉ là module class rỗng; runner, event bus, SSE
  và endpoint nghiệp vụ được defer tới các issue/slice sau.

## Cách kiểm chứng

- `apps/api` build thành công và test e2e `/health` pass theo bằng chứng trong
  [PR #51](https://github.com/ThanhTuGenki/reup-dubbing-studio/pull/51).
- Kiểm tra cấu trúc xác nhận có đủ 14 module rỗng, `prisma validate` pass và
  `apps/api/src/modules/**` không có file ngoài các module class theo [PR #51](https://github.com/ThanhTuGenki/reup-dubbing-studio/pull/51).
- Khi thêm vertical slice, kiểm tra controller nằm đúng consumer branch và dependency
  không đi ngược các lớp trong bảng ở trên.
