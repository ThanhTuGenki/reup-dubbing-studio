# ADR: API module layout

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: module boundaries, dependency direction và controller layout của NestJS Control Plane scaffold.
- Không phải nguồn chuẩn cho: endpoint inventory, database schema chi tiết, event bus implementation hay deployment configuration.

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

## Hệ quả

- Vertical slice có thể thêm đúng các tầng cần thiết mà không tạo thư mục rỗng.
- Web và worker controller không trộn contract hoặc auth boundary của nhau.
- Scheduler chạy nhiều instance cần lock phân tán, chưa xử lý.
- `apps/api/src/modules/**` hiện chỉ là module class rỗng; runner, event bus, SSE
  và endpoint nghiệp vụ được defer tới các issue/slice sau.
