# API

## Trách nhiệm

`apps/api/` chứa NestJS Control Plane của Reup Dubbing Studio. Ứng dụng này sở
hữu API, xác thực, workflow, đăng ký worker, nội dung và publishing; đồng thời
điều phối task bền vững cùng trạng thái domain của hệ thống.

## Ngoài phạm vi

Thư mục này không chứa giao diện trình duyệt, xử lý media nặng hoặc mô hình GPU,
package dùng chung, định nghĩa contract độc lập hay cấu hình triển khai hạ tầng.
API không chuyển dữ liệu media lớn xuyên qua server thay cho asset store và không
để worker truy cập trực tiếp credential database.

## Ranh giới

`apps/api/` là ứng dụng con của `apps/`, đối tác backend của `apps/web/` và là
Control Plane giao tiếp với `workers/` qua contract tại `contracts/`. Mã dùng
chung thuộc `packages/`; cấu hình vận hành thuộc `infra/`. API sở hữu điều phối
và trạng thái chuẩn, còn giao diện web chỉ hiển thị và gửi yêu cầu qua boundary
này.
