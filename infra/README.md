# Infra

## Trách nhiệm

`infra` chứa cấu hình và tài sản phục vụ việc cung cấp, triển khai, bảo mật,
giám sát và vận hành hạ tầng của Reup Dubbing Studio. Các thay đổi tại đây phải
phản ánh một nhu cầu hạ tầng đã được đặc tả rõ.

## Ngoài phạm vi

Thư mục này không chứa mã runtime của web, API hoặc worker, thư viện dùng lại,
hay định nghĩa business contract và OpenAPI. Foundation này cũng không tạo file
triển khai, công cụ bootstrap hoặc dependency.

## Ranh giới

`apps` và `workers` sở hữu mã ứng dụng và xử lý; `infra` chỉ sở hữu cách các
thành phần đó được cung cấp và vận hành. `contracts` mô tả interface giữa các
thành phần, không mô tả tài nguyên hạ tầng; cấu hình môi trường cụ thể chỉ thuộc
`infra` khi một feature hạ tầng tương ứng được phê duyệt.
