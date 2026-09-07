# ADR: API wire conventions

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: wire format dùng chung giữa web API, control plane và worker API.
- Không phải nguồn chuẩn cho: endpoint nghiệp vụ, implementation NestJS, hoặc code sinh tự động.
- Thay thế: —
- Được thay thế bởi: —

## Bối cảnh

Ba consumer dùng các ngôn ngữ và vòng đời khác nhau. Nếu mỗi endpoint tự chọn
error envelope, ID, pagination hoặc locking, contract-first sẽ không ngăn được
chi phí tích hợp. Quyết định này được áp dụng trước các slice phụ thuộc Issue #8.

## Quyết định

- Lỗi dùng RFC 9457 Problem Details với `code` và `requestId` bắt buộc, media type
  `application/problem+json`; mã lỗi được quản lý trong `error-codes.yaml`.
- ID là chuỗi UUID v7 do server sinh, **không dùng prefix theo loại** (`vid_`,
  `job_`, `tsk_`, `wrk_`). UUID v7 đã có tính duy nhất, sort theo thời gian và
  được hiểu nhất quán giữa các consumer; prefix sẽ làm mỗi consumer phải duy trì
  thêm parser/validation riêng.
- Field dùng `camelCase`; enum dùng `UPPER_SNAKE_CASE`; timestamp là ISO 8601 UTC
  `date-time` kết thúc bằng `Z`.
- Collection dùng cursor pagination với `cursor`, `limit` (1–100, mặc định 50),
  và `{items, nextCursor}`.
- Web API dùng `/v1`; worker API dùng `/worker/v1`. Breaking wire changes tăng
  major URL version; additive compatible changes giữ version hiện tại.
- Tạo job từ web và mọi mutation từ worker phải có `Idempotency-Key`, với scope
  là logical operation + authenticated caller và retention tối thiểu 24 giờ.
- Optimistic locking dùng resource `version` và bắt buộc `If-Match`; mismatch là
  HTTP 409 với `VERSION_CONFLICT`.

## Lựa chọn đã cân nhắc

- Prefix ID theo resource: không chọn vì UUID v7 đã cung cấp uniqueness và
  ordering, còn prefix tăng coupling giữa producer và parser.
- Offset pagination: không chọn vì insert/delete trong queue dễ gây trùng hoặc
  bỏ sót; cursor ổn định hơn cho worker polling.
- `expectedVersion` trong JSON: không chọn làm wire mặc định vì locking là
  precondition của request và `If-Match` tương thích HTTP; implementation có thể
  map field nội bộ nếu cần.

## Hệ quả

Consumer có một error contract và catalogue để generate type/client. Server phải
  sinh UUID v7, giữ timestamp UTC, lưu idempotency result tối thiểu 24 giờ và
  kiểm tra precondition trước mutation. Endpoint cụ thể và exception mapping
  thuộc các Issue #12/#14; generation/toolchain thuộc #9 và chưa được thay đổi.

## Cách kiểm chứng

- Redocly lint cả web và worker spec.
- Kiểm tra mọi `$ref` và media type `application/problem+json`.
- Kiểm tra catalogue có `httpStatus` và `description` cho từng mã.
- Kiểm tra ADR được thêm vào index cùng PR.
- Khi #9 hoàn tất, chạy generate/check để xác nhận generated artifacts không lệch.
