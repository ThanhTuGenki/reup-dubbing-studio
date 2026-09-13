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
- OpenAPI YAML/JSON cụ thể trong foundation này; thư mục chỉ được tạo khung,
  chưa cung cấp contract nghiệp vụ nào.

## Ranh giới

Đây là thư mục con chuyên trách HTTP của `contracts`: `contracts/README.md`
định nghĩa phạm vi giao diện liên ranh giới rộng hơn, còn README này chỉ dẫn
phạm vi OpenAPI. `apps` và `workers` triển khai các phía của API; chúng không
được biến thành nguồn chuẩn bằng cách định nghĩa lại contract trong mã nguồn.
`packages` có thể dùng artifact được sinh từ OpenAPI, nhưng không sở hữu tài liệu
OpenAPI gốc.

Mỗi API thực tế phải được bổ sung bởi feature riêng, có producer, consumer,
version và quy tắc tương thích được xác định trước khi thêm file vào thư mục này.
