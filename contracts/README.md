# Contracts

## Trách nhiệm

`contracts` là khu vực sở hữu các mô tả giao diện được chia sẻ giữa những thành
phần hoặc dịch vụ độc lập của Reup Dubbing Studio. Các tài liệu tại đây giúp các
bên thống nhất hình dạng dữ liệu, phiên bản và cách tương thích khi giao tiếp qua
ranh giới.

`contracts/openapi` là khu vực con dành riêng cho các contract HTTP được mô tả
bằng OpenAPI. Những contract khác (nếu một vertical slice sau này cần) có thể
được đặt trong khu vực con phù hợp và phải có đặc tả riêng.

## Ngoài phạm vi

- Mã runtime, adapter, client sinh mã hoặc logic nghiệp vụ.
- Schema cơ sở dữ liệu, cấu hình hạ tầng, CI và cấu hình triển khai.
- Contract ngoài hai health endpoint của API foundation; contract nghiệp vụ chỉ
  được thêm bởi vertical slice có producer/consumer và đặc tả tương ứng.

## Ranh giới

`contracts` sở hữu định dạng giao tiếp tại integration boundary; `apps` và
`workers` sở hữu việc triển khai các phía sử dụng contract. `packages` có thể
chứa kiểu hoặc client được sinh từ contract khi một feature sau này yêu cầu,
nhưng không trở thành nguồn chuẩn thay cho tài liệu trong `contracts`.

`openapi/web.openapi.yaml` và `openapi/error-codes.yaml` là contract JIT tối thiểu
của API foundation. Chúng chỉ mô tả health, envelope, Problem Details và mã lỗi
nền tảng; không phải inventory endpoint của toàn sản phẩm.
