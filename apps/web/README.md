# Web

## Trách nhiệm

`apps/web/` chứa ứng dụng web React + TypeScript + Vite chạy trên trình duyệt.
Ứng dụng này chịu trách nhiệm trình bày dashboard, các luồng thao tác của người
dùng, trạng thái giao diện và gọi Control Plane qua boundary đã thống nhất.

## Ngoài phạm vi

Thư mục này không chứa API server, logic điều phối pipeline phía backend, worker
xử lý media/GPU, credential hạ tầng hoặc dữ liệu domain làm nguồn sự thật. Web
không truy cập trực tiếp database hay worker; asset store chỉ được truy cập bằng
presigned URL có thời hạn do Control Plane cấp, không dùng credential hoặc cơ chế
truy cập khác.

## Ranh giới

`apps/web/` là ứng dụng con của `apps/` và chỉ sở hữu trải nghiệm trình duyệt.
Nó giao tiếp với `apps/api/` qua API/SSE và dùng contract được định nghĩa tại
`contracts/` (cùng các package dùng chung phù hợp từ `packages/`). Các tác vụ
điều phối và trạng thái chuẩn thuộc `apps/api/`, không lặp lại trong web.
