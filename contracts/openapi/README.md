# OpenAPI

## Trách nhiệm

`contracts/openapi` sở hữu các tài liệu OpenAPI mô tả giao tiếp HTTP giữa các
thành phần của Reup Dubbing Studio, chẳng hạn giao tiếp giữa web app và Control
Plane hoặc giữa Control Plane và GPU Worker. Đây là nguồn chuẩn của request,
response, lỗi và quy tắc tương thích cho từng API khi vertical slice tương ứng
được triển khai.

## Ngoài phạm vi

- Mã endpoint, controller, HTTP client và kiểu dữ liệu sinh ra từ OpenAPI.
- Thiết kế database, event schema không phải HTTP và logic nghiệp vụ.
- Cấu hình máy chủ, reverse proxy, CI hoặc deployment.
- Worker API, endpoint nghiệp vụ, client/type được generate hoặc inventory API
  chưa có vertical slice triển khai.

## Ranh giới

Đây là thư mục con chuyên trách HTTP của `contracts`: `contracts/README.md`
định nghĩa phạm vi giao diện liên ranh giới rộng hơn, còn README này chỉ dẫn
phạm vi OpenAPI. `apps` và `workers` triển khai các phía của API; chúng không
được biến thành nguồn chuẩn bằng cách định nghĩa lại contract trong mã nguồn.
`packages` có thể dùng artifact được sinh từ OpenAPI, nhưng không sở hữu tài liệu
OpenAPI gốc.

Contract OpenAPI thực tế được phát triển theo vòng đời
`DRAFT → IMPLEMENTING → VERIFIED → STABLE`. Ở trạng thái `DRAFT`, contract chỉ
cần đủ example tối thiểu để generate client/mock và bắt đầu implementation; chưa
cần chốt hoàn chỉnh producer, consumer, version hoặc compatibility. Ở trạng thái
`IMPLEMENTING`, các bên cập nhật contract cùng những consumer trong cùng
vertical slice và kiểm chứng sớm bằng integration/E2E.

Chỉ đánh dấu `VERIFIED` sau khi provider, consumer và E2E của slice đã pass.
Contract trở thành `STABLE` khi đã release hoặc có consumer độc lập. Từ
`STABLE`, tức sau release hoặc khi xuất hiện consumer độc lập, versioning và
compatibility phải được quản lý nghiêm ngặt; breaking change trước `STABLE` có
thể phối hợp trong cùng slice và pull request.

## Contract của API foundation

- `web.openapi.yaml` chỉ mô tả `GET /health/live`, `GET /health/ready`, success
  envelope, Problem Details và `X-Request-Id` dưới server `/v1`.
- `error-codes.yaml` chỉ catalog `VALIDATION_ERROR`, `ROUTE_NOT_FOUND`,
  `RATE_LIMITED` và `INTERNAL_ERROR`.

Hai file đang ở giai đoạn `IMPLEMENTING` cho đến khi integration test và contract
lint cùng pass; sau đó được coi là `VERIFIED`. Không mở rộng chúng sang worker,
business API hay generated client trong feature này.
