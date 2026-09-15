# ADR: API success envelope và correlation

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: success response, response không có body và correlation ID của HTTP API.
- Không phải nguồn chuẩn cho: endpoint nghiệp vụ, error catalogue, implementation framework hoặc client generation.
- Thay thế: —
- Được thay thế bởi: —

Quyết định này bổ sung cho [ADR API wire conventions](2026-09-07-api-wire-conventions.md),
vốn vẫn là nguồn chuẩn cho error contract, versioning, pagination, idempotency và optimistic
locking. ADR cũ không bị thay đổi bởi quyết định này.

## Bối cảnh

Control Plane cần một success contract có thể dùng thống nhất giữa các endpoint và các consumer
khác nhau, đồng thời phải phân biệt rõ dữ liệu thành công với lỗi HTTP chuẩn. Mỗi request cũng cần
một correlation ID do server sở hữu để đối chiếu header, response và log. Quyết định này chỉ chốt
wire behavior cho nền tảng API; chi tiết triển khai và endpoint cụ thể thuộc codebase tương ứng.

## Quyết định

- Mọi JSON success response có body dùng đúng envelope `{ data, meta: { requestId } }`.
- Payload nghiệp vụ nằm trong `data`; `meta.requestId` là UUID v7 do server sinh cho request hiện
  tại. API không tin cậy, không phản chiếu và không dùng giá trị `X-Request-Id` do client gửi.
- API trả cùng request ID trong header `X-Request-Id` và trong `meta.requestId` của JSON success.
  Với response lỗi, request ID xuất hiện trong header và trường `requestId` của RFC 9457 Problem
  Details; lỗi không được bọc trong success envelope.
- Response `204 No Content` không có body và không được bọc envelope; chỉ trả `X-Request-Id`
  cùng các header HTTP phù hợp.
- Stream, file download và response không phải JSON không bị ép vào success envelope. Các response
  JSON thành công khác phải tuân theo envelope này.
- Lỗi HTTP giữ media type `application/problem+json` và cấu trúc Problem Details theo
  [ADR API wire conventions](2026-09-07-api-wire-conventions.md), bao gồm `code` và `requestId`.

## Lựa chọn đã cân nhắc

- Trả payload thành công trực tiếp ở top-level: không chọn vì mỗi endpoint có thể tạo shape và
  metadata khác nhau, làm consumer phải xử lý nhiều quy ước.
- Bọc cả lỗi và `204`: không chọn vì lỗi cần media type/semantics của Problem Details, còn `204`
  bị cấm có response body theo HTTP.
- Chấp nhận request ID từ client: không chọn vì client có thể gây collision hoặc giả mạo correlation
  context; server-owned UUID v7 vẫn giữ tính duy nhất và thứ tự thời gian.
- Dùng một envelope cho stream/file: không chọn vì các response này có semantics truyền tải riêng
  và có thể không có JSON body.

## Hệ quả

Consumer có một điểm đọc ổn định cho JSON success và một quy tắc correlation nhất quán giữa header,
body lỗi và log. HTTP adapter phải phân loại response trước khi wrap, sinh request ID trước khi
ghi log hoặc trả response, và bảo đảm exception mapping không làm lộ stack trace hay dữ liệu nhạy
cảm. Endpoint `204`, stream và file cần được kiểm thử như ngoại lệ có chủ đích.

Quyết định này không thay đổi error code, version URL, pagination, idempotency hoặc locking đã
được chốt trong [ADR API wire conventions](2026-09-07-api-wire-conventions.md).

## Cách kiểm chứng

- Integration test xác nhận mọi JSON success có `data` và `meta.requestId`, đồng thời header và
  body dùng cùng UUID v7.
- Integration test xác nhận `204` không có body nhưng vẫn có `X-Request-Id`.
- Integration test xác nhận lỗi dùng `application/problem+json`, có `code`/`requestId` và không
  xuất hiện success envelope.
- Unit/integration test gửi `X-Request-Id` tùy ý và xác nhận giá trị đó không được phản chiếu vào
  response hoặc log.
- Contract lint kiểm tra schema envelope, Problem Details và header `X-Request-Id` trong
  `contracts/openapi/`.
