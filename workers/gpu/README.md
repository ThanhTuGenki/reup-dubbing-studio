# GPU Workers

## Trách nhiệm

Khu vực này chứa các worker cần tài nguyên GPU để thực hiện xử lý nền chuyên sâu,
chẳng hạn xử lý âm thanh, hình ảnh hoặc suy luận mô hình. Mỗi worker phải giữ
phạm vi xử lý của mình trong một đơn vị công việc bất đồng bộ và giao tiếp với
các khu vực khác qua contract được chấp nhận.

## Ngoài phạm vi

Không đặt ứng dụng web, API của sản phẩm, worker chỉ dùng CPU, thư viện dùng lại,
business contract, mã CI hoặc cấu hình cấp phát và triển khai hạ tầng trực tiếp
trong thư mục này.

## Ranh giới

Đây là phần chuyên biệt của `workers/`: `workers/` định nghĩa ranh giới chung và
luồng xử lý nền, còn thư mục này chỉ sở hữu các worker có phụ thuộc GPU. `apps/`
sở hữu điểm vào sản phẩm; `packages/` sở hữu thành phần dùng lại; `infra/` sở hữu
cấu hình vận hành và hạ tầng để chạy worker.
