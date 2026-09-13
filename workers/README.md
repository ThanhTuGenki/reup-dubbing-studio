# Workers

## Trách nhiệm

Khu vực này chứa các worker thực hiện tác vụ nền hoặc xử lý bất đồng bộ bên ngoài
luồng request của ứng dụng. Mỗi worker chịu trách nhiệm nhận đầu vào theo hợp đồng
được công bố, thực hiện một đơn vị xử lý có thể theo dõi và phát hành kết quả hoặc
trạng thái xử lý phù hợp.

## Ngoài phạm vi

Không đặt giao diện người dùng, API đồng bộ, thư viện dùng lại, mô tả contract,
cấu hình hạ tầng, mã CI hay logic điều phối thuộc Control Plane trực tiếp trong
thư mục này.

## Ranh giới

`workers/gpu/` là khu vực con dành riêng cho worker cần GPU; worker không cần GPU
thuộc các khu vực worker phù hợp khác trong tương lai. `apps/` sở hữu các ứng dụng
và điểm vào request, còn `packages/` sở hữu thành phần dùng lại. README này xác
định ranh giới chung của worker và không thay thế trách nhiệm riêng của
`workers/gpu/`.
