# Architecture Decision Records

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: chỉ mục và quy trình của các Architecture Decision Record (ADR).
- Không phải nguồn chuẩn cho: nội dung quyết định cụ thể; nội dung đó nằm trong từng ADR.

## Chỉ mục

| Ngày | Slug | Trạng thái | Thay thế bởi |
|---|---|---|---|
| 2026-09-07 | [`monorepo-tooling`](2026-09-07-monorepo-tooling.md) | `ACCEPTED` | — |
| 2026-09-07 | [`api-module-layout`](2026-09-07-api-module-layout.md) | `ACCEPTED` | — |
| 2026-09-07 | [`api-wire-conventions`](2026-09-07-api-wire-conventions.md) | `ACCEPTED` | — |

Mỗi ADR mới phải được thêm vào bảng này cùng pull request. ADR được đặt tên
`YYYY-MM-DD-<slug>.md`; slug ngắn, ổn định và mô tả quyết định, không mô tả công cụ
dùng để tạo tài liệu.

## Khi nào cần ADR

Cần viết ADR khi thay đổi hướng kỹ thuật ảnh hưởng từ hai trong ba khối `web`,
`api`, `worker` trở lên, hoặc khi quyết định khó đảo ngược / có trade-off dài hạn.
Ví dụ: thay đổi boundary module, giao tiếp giữa service, lựa chọn persistence,
hoặc cơ chế xử lý ảnh hưởng tới nhiều owner.

Không cần ADR cho bug fix cục bộ, refactor không đổi boundary hay hành vi, đổi tên
không đổi nghĩa, hoặc chi tiết triển khai đã được quyết định trong một ADR còn hiệu
lực. Nếu thay đổi làm một ADR cũ không còn đúng, tạo ADR mới thay thế thay vì sửa
ADR cũ.

## Vòng đời và quy tắc

Vòng đời chuẩn là `DRAFT → ACCEPTED → SUPERSEDED | DEPRECATED`.

- `DRAFT`: đang thảo luận; không dùng làm nguồn chuẩn cuối cùng.
- `ACCEPTED`: quyết định đã chốt và là nguồn chuẩn trong phạm vi ADR.
- `SUPERSEDED`: bị thay bởi ADR mới; phải link tới ADR thay thế.
- `DEPRECATED`: không còn áp dụng và không có quyết định thay thế trực tiếp.
- ADR sau khi `ACCEPTED` không được sửa nội dung quyết định. Chỉ thêm ADR mới,
  đánh dấu ADR cũ `SUPERSEDED`, và link hai chiều ở cả hai ADR.
- ADR nên gói trong khoảng một trang; nếu cần viết spec dài, đặt spec ở tài liệu
  phù hợp và để ADR chỉ ghi quyết định, trade-off, hệ quả và cách kiểm chứng.

## Tạo ADR mới

1. Copy [`_template.md`](_template.md) thành
   `YYYY-MM-DD-<slug>.md`.
2. Điền status block và đủ năm mục; giữ nội dung ngắn, có link tới nguồn liên quan.
3. Cập nhật bảng chỉ mục trong file này.
4. Nếu thay thế ADR cũ, cập nhật trạng thái và link ở cả hai đầu trong cùng pull
   request.
