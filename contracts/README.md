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
- File OpenAPI, event schema hoặc business contract cụ thể trong foundation này;
  các file đó chỉ được thêm bởi feature có yêu cầu và đặc tả tương ứng.

## Ranh giới

`contracts` sở hữu định dạng giao tiếp tại integration boundary; `apps` và
`workers` sở hữu việc triển khai các phía sử dụng contract. `packages` có thể
chứa kiểu hoặc client được sinh từ contract khi một feature sau này yêu cầu,
nhưng không trở thành nguồn chuẩn thay cho tài liệu trong `contracts`.

README này chỉ mô tả vùng sở hữu. Contract thực tế không được đặt ở đây cho đến
khi có feature xác định rõ producer, consumer và quy tắc tương thích.
