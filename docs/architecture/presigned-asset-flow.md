# Quy ước presigned URL cho asset

- **Trạng thái:** `ACCEPTED`
- **Cập nhật:** 2026-09-19
- **Nguồn chuẩn cho:** flow upload/download trực tiếp giữa browser hoặc worker và
  object store; trách nhiệm của Control Plane; giới hạn bảo mật và contract chung.
- **Không phải nguồn chuẩn cho:** endpoint cụ thể, asset purpose, MIME allowlist,
  giới hạn dung lượng hoặc retention của từng vertical slice.

## 1. Quyết định

Binary không đi xuyên qua NestJS. Control Plane xác thực quyền, tạo asset record
và cấp presigned URL ngắn hạn; browser/worker truyền binary trực tiếp với R2 rồi
gọi Control Plane để commit. PostgreSQL giữ metadata và object key, không giữ URL
đã ký hoặc credential R2.

```text
Upload
Client ── request grant ──> Control Plane ── create PENDING asset
Client <─ PUT grant ─────── Control Plane
Client ───── PUT binary trực tiếp tới R2 ───────────────────>
Client ── commit asset ───> Control Plane ── HEAD/verify R2
Client <─ AVAILABLE asset ─ Control Plane

Download
Client ── request grant ──> Control Plane ── authorize AVAILABLE asset
Client <─ GET grant ─────── Control Plane
Client ───── GET binary trực tiếp từ R2 ────────────────────>
```

Không trả bucket, object key hoặc storage credential để client tự ghép URL.
Presigned URL là bearer capability và chỉ được dùng cho đúng object, HTTP method
và thời hạn đã cấp.

## 2. Upload protocol

Upload luôn có ba bước; không coi PUT thành công là asset đã dùng được.

### 2.1 Request grant

Vertical slice định nghĩa endpoint và `purpose`, nhưng request tối thiểu phải có:

```text
fileName            tên hiển thị đã bỏ path, không dùng làm object key
contentType         MIME đã canonicalize và thuộc allowlist của purpose
byteSize            số byte dự kiến, integer dương trong limit của purpose
checksumSha256      lowercase hex SHA-256 khi client có thể tính trước
```

Control Plane:

1. xác thực quyền và purpose;
2. kiểm tra MIME, size và checksum format;
3. sinh asset ID UUID v7 và object key bất biến từ ID + extension do server suy
   ra, không dùng trực tiếp tên file người dùng;
4. tạo row `assets` trạng thái `PENDING`;
5. cấp presigned `PUT` chỉ cho object đó.

Response grant dùng envelope chuẩn và tối thiểu gồm:

```text
assetId
method              PUT
url                 HTTPS presigned URL, opaque với client
headers             record header bắt buộc phải gửi nguyên vẹn
expiresAt           RFC 3339 UTC
maxByteSize         giới hạn đã được authorize
```

Client không thêm, bỏ hoặc đổi signed header. `Content-Type` phải được ký. Nếu
checksum/metadata header được provider xác minh là tương thích thì nó cũng phải
được ký và trả trong `headers`; không tự hard-code header R2 trong Web.

### 2.2 PUT trực tiếp

- Dùng đúng `method`, `url`, `headers` từ grant và binary làm body.
- Không gửi cookie, bearer token của Control Plane hoặc header ứng dụng tới R2.
- Không retry vô hạn. Khi URL hết hạn hoặc nhận 401/403, xin grant mới cho chính
  asset đang `PENDING`; không tạo asset mới chỉ vì grant hết hạn.
- Abort phía client không đổi trạng thái DB; asset `PENDING` hết hạn được cleanup
  theo retention job.
- R2 CORS chỉ cho phép origin Web đã cấu hình, method `PUT/GET/HEAD` cần thiết và
  signed request headers; không dùng wildcard origin trong production.

### 2.3 Commit

Commit request tham chiếu `assetId` và metadata client đã biết; mutation phải hỗ
trợ `Idempotency-Key`. Control Plane thực hiện `HEAD` bằng credential server và
chỉ chuyển `PENDING → AVAILABLE` khi:

- object tồn tại đúng bucket/key do server sở hữu;
- content length bằng `byteSize` đã authorize;
- content type khớp allowlist/purpose;
- checksum khớp khi flow đó yêu cầu checksum;
- asset chưa bị xóa, thay thế hoặc commit cho owner khác.

Commit lặp lại với cùng idempotency key trả cùng kết quả. Object thiếu hoặc lệch
metadata giữ asset ngoài `AVAILABLE`, trả Problem Details an toàn và lên lịch dọn
object sai; không tin metadata commit để bỏ qua HEAD.

Checksum SHA-256 là bắt buộc với output do worker tạo và các artifact cần lineage.
Với browser upload lớn, cách tính checksum streaming còn phải được kiểm chứng theo
slice; không giả dùng ETag S3/R2 làm SHA-256. Slice chưa hỗ trợ checksum phía
browser vẫn phải xác minh size/type và ghi rõ checksum đang chờ verification.

## 3. Download protocol

Download grant chỉ cấp cho asset `AVAILABLE` sau khi Control Plane kiểm tra quyền
truy cập hiện tại. Response tối thiểu gồm:

```text
assetId
method              GET
url                 HTTPS presigned URL, opaque với client
expiresAt           RFC 3339 UTC
fileName            tên tải xuống an toàn để hiển thị
contentType
byteSize
```

Quy ước:

- tên file tải xuống do server sanitize và đặt qua signed response disposition;
- Web dùng URL ngay sau khi xin grant, không cache trong TanStack Query quá thời
  hạn và không lưu localStorage/sessionStorage;
- preview và download là purpose riêng nếu policy/response disposition khác nhau;
- range request cho media preview chỉ bật khi slice player cần và đã test CORS;
- grant hết hạn thì xin grant mới, không biến URL thành permanent asset URL.

## 4. Thời hạn và giới hạn

- Upload grant mặc định: **10 phút**.
- Download/preview grant mặc định: **5 phút**.
- Không cấp quá **15 phút** cho browser trong MVP.
- Worker grant có thể dài hơn theo lease nhưng không vượt thời hạn lease còn lại.
- API từ chối `expiresAt` do client tự chọn; TTL là policy phía server.
- Size/MIME limit thuộc purpose và được chốt JIT trong OpenAPI của feature.

TTL chỉ là thời gian bắt đầu request theo semantics của provider; client phải xử
lý lỗi hết hạn kể cả khi đồng hồ cục bộ lệch. UI không hiển thị query string của
URL đã ký.

## 5. Security và observability

- Không log full presigned URL, query string, signed headers hoặc R2 credential.
- Redaction phải áp dụng cho field `url`, `presignedUrl`, `signedUrl` và query
  parameters của request ra object store.
- Không persist grant vào PostgreSQL. `asset_access_grants` tiếp tục ở mức `HOLD`;
  chỉ tạo nếu sau này có yêu cầu audit download chi tiết.
- Audit hành vi cấp quyền bằng actor, asset ID, purpose và expiry; không audit URL.
- Object key là immutable và không được client điều khiển.
- Grant upload không cho `DELETE`, overwrite hoặc prefix access.
- Error trả Problem Details + request ID; không trả raw XML/body từ R2.
- Browser chỉ chấp nhận HTTPS presigned URL. HTTP chỉ được phép cho emulator
  loopback trong development và phải qua cấu hình explicit.

## 6. Trách nhiệm theo layer

### Control Plane

- sở hữu storage credential, key generation, authorization, TTL và verification;
- expose port object-store trong infrastructure, không để domain/application
  import SDK S3/R2;
- map provider error sang error code của slice và redact trước khi log;
- không proxy binary qua controller.

### Web

- lấy grant qua generated typed API client;
- upload/download trực tiếp theo grant và hỗ trợ abort/progress phù hợp;
- commit upload sau PUT; refetch asset metadata từ REST;
- không định nghĩa lại wire type, không parse object key, không log URL.

### Worker

- nhận grant gắn với task lease và asset purpose;
- tính SHA-256 trong lúc stream, upload rồi commit trước khi complete task;
- không nhận R2 credential dài hạn.

## 7. Contract JIT cho vertical slice

Feature đầu tiên cần asset phải bổ sung OpenAPI operation cho request grant và
commit ngay trong pull request của slice. Contract cụ thể phải quyết định:

- purpose và quan hệ owner;
- MIME allowlist, extension canonical và max size;
- checksum bắt buộc hay đang chờ verification;
- download so với preview disposition;
- idempotency và error codes;
- CORS/range behavior cần integration test.

Không tạo endpoint `POST /assets` tổng quát cho mọi purpose. Một capability chung
có thể dùng implementation nội bộ, còn HTTP route phải thể hiện use case của
slice để tránh client tự gắn asset vào owner tùy ý.

## 8. Acceptance checklist

- [ ] Binary không đi qua NestJS.
- [ ] URL chỉ có một method/object và TTL đúng policy.
- [ ] Signed headers được client gửi nguyên vẹn.
- [ ] PUT chưa làm asset `AVAILABLE`; commit có HEAD verification.
- [ ] Commit idempotent và không cho đổi object key/owner.
- [ ] URL/query/credential bị redact và không persist.
- [ ] R2 CORS production không dùng wildcard origin.
- [ ] Expired grant, abort, size/type mismatch và duplicate commit có test.
- [ ] Web refetch REST metadata sau commit; URL không trở thành server state.
- [ ] Worker output có SHA-256 và commit trước khi complete task.

## 9. Điểm cần kiểm chứng khi triển khai

Các điểm sau chưa chặn convention nhưng phải được test bằng R2 fixture thật trong
slice đầu tiên:

1. R2 có chấp nhận và phản hồi checksum header/metadata nào trong presigned PUT
   ở SDK/version đang pin; không suy từ behavior của AWS S3.
2. CORS/range request cho media preview trên domain production.
3. Giới hạn file browser thực tế để chọn checksum streaming hoặc deferred server
   verification.
