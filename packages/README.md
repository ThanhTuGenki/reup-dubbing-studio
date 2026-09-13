# Packages

## Trách nhiệm

`packages` chứa các thư viện, module và tài sản mã nguồn dùng lại giữa nhiều
ứng dụng hoặc worker trong codebase. Mỗi gói nên có API và vòng đời riêng khi
được tạo bởi một vertical slice phù hợp.

## Ngoài phạm vi

Thư mục này không chứa ứng dụng có thể triển khai, mã riêng của một ứng dụng,
worker chạy nền, contract liên ranh giới, hay cấu hình hạ tầng và vận hành.
Không thêm dependency hoặc bootstrap chỉ để giữ skeleton này tồn tại.

## Ranh giới

`apps` và `workers` sở hữu mã chạy theo từng loại workload; `packages` chỉ sở
hữu thành phần được chia sẻ và không thay thế chúng. Interface giao tiếp qua
ranh giới hệ thống thuộc `contracts`, còn cấu hình tài nguyên và vận hành thuộc
`infra`.
