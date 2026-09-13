# Apps

## Trách nhiệm

`apps/` chứa các ứng dụng có thể triển khai của Reup Dubbing Studio. Mỗi ứng dụng
được đặt trong một thư mục con và sở hữu mã nguồn, cấu hình build ở mức ứng dụng
và điểm vào riêng của mình.

## Ngoài phạm vi

Thư mục này không chứa package dùng chung, worker xử lý nền, contract giao tiếp
độc lập hoặc cấu hình hạ tầng/vận hành. `apps/` cũng không tự định nghĩa một
runtime chung thay cho các ứng dụng con.

## Ranh giới

`apps/web/` dành cho giao diện React chạy trên trình duyệt; `apps/api/` dành cho
NestJS Control Plane và API của sản phẩm. Hai ứng dụng giữ ranh giới triển khai
riêng và không import trực tiếp mã nội bộ của nhau; code dùng chung thuộc
`packages/`, còn contract tại ranh giới thuộc `contracts/`.
