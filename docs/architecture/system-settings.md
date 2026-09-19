# Thiết kế feature Cài đặt hệ thống

- **Trạng thái:** `ACCEPTED`
- **Cập nhật:** 2026-09-19
- **Nguồn chuẩn cho:** ownership các nhóm trên màn Cài đặt, schema PostgreSQL,
  secret handling và contract cần triển khai cho vertical slice Cài đặt.
- **Không phải nguồn chuẩn cho:** wire contract đã verified, cấu hình Discovery,
  Worker registry hoặc implementation provider cụ thể.

## 1. Kết luận

Màn OpenDesign có sáu card nhưng không tạo một bảng key/value và không để module
Settings sở hữu mọi dữ liệu trên màn hình. Settings chỉ sở hữu ba aggregate:

1. Content Agent;
2. Cloudflare R2;
3. chính sách lưu giữ.

Cookie nguồn thuộc Discovery. Trạng thái Interactive TTS pool, approved image và
default worker thuộc GPU Workers. Các phần đó có thể được compose vào màn Cài đặt
khi slice sở hữu đã tồn tại, nhưng Settings không nhân bản dữ liệu hoặc endpoint.

| Card OpenDesign | Nguồn sở hữu | Xử lý trong slice này |
| --- | --- | --- |
| Content Agent | Settings | Đọc/cập nhật/test kết nối |
| OmniVoice | GPU Workers + Profile | Chưa triển khai; không giả pool/model |
| Lưu trữ | Settings | Chỉ Cloudflare R2; đọc/cập nhật/test bucket |
| Cookie nguồn | Discovery | Chưa triển khai; route Settings không giữ cookie |
| GPU provider mặc định | GPU Workers | Chưa triển khai; EzyCloudX vẫn manual |
| Chính sách lưu giữ | Settings | Đọc/cập nhật typed policy |

Prototype là visual reference. `MinIO`, Ollama, model/image version và trạng thái
kết nối trong prototype là dữ liệu mẫu, không được hard-code vào production.

## 2. Phạm vi MVP của Settings

### 2.1 Content Agent

- Provider hỗ trợ ban đầu: `ANTHROPIC`, `OPENAI`.
- Lưu model dưới dạng string được validate chiều dài/ký tự; model catalogue thay
  đổi nhanh nên không dùng PostgreSQL enum.
- Base URL do adapter phía server sở hữu, client không được nhập URL tùy ý.
- `LOCAL_OLLAMA` để `HOLD` tới khi có deployment topology và allowlist chống SSRF.
- API key được mã hóa; response chỉ trả `configured`, hint bốn ký tự cuối và
  thời điểm rotate.

### 2.2 Cloudflare R2

- Production MVP chỉ hỗ trợ `R2`, đúng quyết định kiến trúc; MinIO chỉ là adapter
  local/test qua environment và không xuất hiện như lựa chọn production.
- Người dùng cấu hình `accountId`, `bucket`, access key ID và secret access key.
- Endpoint S3 được server dựng từ account ID; không nhận arbitrary endpoint từ UI.
- Test kết nối dùng object ngẫu nhiên dưới prefix `_healthchecks/`, kiểm tra
  write/HEAD/read/delete và luôn best-effort cleanup trong `finally`.
- Test thành công không tự lưu draft; Save và Test là hai hành động riêng.

### 2.3 Chính sách lưu giữ

```text
rawVideoDays        1..365
intermediateDays    1..90
taskLogDays         1..365
finalOutputDays     1..3650
```

Ngày giữ file chỉ quyết định thời điểm **đủ điều kiện** cleanup. Output cuối chỉ
bắt đầu đếm khi mọi publication task bắt buộc đã verified. Text/SRT/transcript,
script, cast sheet và publication content không thuộc cleanup policy này.

## 3. Schema PostgreSQL

Không dùng `app_settings(key, value)`. Hai bảng typed được tạo khi implementation
slice bắt đầu:

```text
system_settings
  id                            uuid v7 PK
  singleton_key                 text NOT NULL UNIQUE CHECK = 'DEFAULT'
  content_agent_provider        ANTHROPIC | OPENAI
  content_agent_model           text
  content_agent_credential_id   uuid nullable FK system_credentials
  storage_backend               R2 CHECK = 'R2'
  storage_account_id            text
  storage_bucket                text
  storage_credential_id         uuid nullable FK system_credentials
  raw_video_days                integer CHECK 1..365
  intermediate_days             integer CHECK 1..90
  task_log_days                 integer CHECK 1..365
  final_output_days             integer CHECK 1..3650
  version                       integer NOT NULL DEFAULT 1
  created_at                    timestamptz
  updated_at                    timestamptz

system_credentials
  id                            uuid v7 PK
  kind                          CONTENT_AGENT_API_KEY |
                                OBJECT_STORAGE_KEYPAIR
  encrypted_payload             bytea
  key_version                   integer
  hint                          text nullable
  rotated_at                    timestamptz
  created_at                    timestamptz
  updated_at                    timestamptz
  UNIQUE(kind)
```

Credential payload có schema nội bộ theo `kind` trước khi mã hóa:

```text
CONTENT_AGENT_API_KEY     { apiKey }
OBJECT_STORAGE_KEYPAIR    { accessKeyId, secretAccessKey }
```

`encrypted_payload` chứa envelope versioned của AES-256-GCM (nonce, ciphertext,
auth tag); master key base64 32 byte nằm trong environment/secret manager dưới
`SETTINGS_ENCRYPTION_KEY`, không nằm trong PostgreSQL. `key_version` cho phép
rotate key sau này. API fail-fast nếu key thiếu/sai khi capability credential
được bật.

Một row `DEFAULT` phù hợp quyết định single-workspace. `version` tăng trong cùng
transaction với settings và credential replacement. Credential cũ chỉ bị xóa
sau khi replacement được mã hóa và transaction commit.

## 4. HTTP contract cần triển khai

OpenAPI chỉ được thêm cùng code ở bước implementation tiếp theo. Shape dưới đây
là contract đã chốt để chuyển sang OpenAPI, chưa phải generated wire source.

### 4.1 Đọc cấu hình

```text
GET /v1/settings
```

`data`:

```json
{
  "version": 3,
  "contentAgent": {
    "provider": "ANTHROPIC",
    "model": "claude-sonnet-5",
    "credential": {
      "configured": true,
      "hint": "3f8a",
      "rotatedAt": "2026-09-19T10:00:00Z"
    }
  },
  "storage": {
    "backend": "R2",
    "accountId": "8f3c...a4b",
    "bucket": "reup-dubbing-media",
    "credential": {
      "configured": true,
      "hint": "K2M9",
      "rotatedAt": "2026-09-19T10:00:00Z"
    }
  },
  "retention": {
    "rawVideoDays": 7,
    "intermediateDays": 3,
    "taskLogDays": 30,
    "finalOutputDays": 90
  }
}
```

Secret plaintext, ciphertext, object-store endpoint và encryption metadata không
được trả ra. Response có `ETag: "3"` và success envelope chuẩn.

### 4.2 Cập nhật cấu hình

```text
PATCH /v1/settings
If-Match: "3"
Idempotency-Key: <uuid>
```

Body cho phép patch từng group. Secret dùng command tường minh:

```json
{
  "contentAgent": {
    "provider": "OPENAI",
    "model": "gpt-5.2",
    "credential": { "action": "REPLACE", "value": "secret" }
  },
  "retention": { "rawVideoDays": 14 }
}
```

- Bỏ `credential`: giữ secret hiện tại.
- `REPLACE`: mã hóa và rotate secret trong transaction.
- `CLEAR`: xóa credential có chủ đích; UI phải xác nhận vì integration sẽ thành
  chưa cấu hình.
- Không nhận masked placeholder hoặc empty string như secret.
- Response trả resource mới, `ETag` mới và không phản chiếu secret.
- Version mismatch trả `409 VERSION_CONFLICT`.

### 4.3 Kiểm tra Content Agent

```text
POST /v1/settings/tests/content-agent
```

Request có config draft và một trong:

```text
credential: { source: STORED }
credential: { source: PROVIDED, value: <secret> }
```

Response:

```text
status       CONNECTED | FAILED
latencyMs    integer nullable
checkedAt    UTC date-time
message      thông báo an toàn, không chứa provider body/secret
```

Test thực hiện request tối thiểu không sinh content nghiệp vụ. Secret `PROVIDED`
chỉ sống trong memory của request và không được persist/audit/log.

### 4.4 Kiểm tra R2

```text
POST /v1/settings/tests/storage
```

Request dùng draft account/bucket và credential `STORED | PROVIDED`. Test có
timeout, random key, payload nhỏ, verify rồi cleanup. Không reuse prefix asset
nghiệp vụ và không trả provider XML/raw error.

Hai test endpoint bị rate-limit riêng. Chúng không dùng `Idempotency-Key` vì là
diagnostic command và mỗi lần gọi phải chạy kiểm tra mới.

## 5. Error codes của slice

| Code | HTTP | Khi nào |
| --- | ---: | --- |
| `SETTINGS_NOT_CONFIGURED` | 409 | Test yêu cầu stored credential nhưng chưa có |
| `SETTINGS_VALIDATION_FAILED` | 422 | Group/provider/secret command không hợp lệ |
| `CONNECTION_TEST_FAILED` | 502 | Provider/bucket không kết nối hoặc thiếu quyền |
| `VERSION_CONFLICT` | 409 | `If-Match` không còn trùng version |

Validation framework vẫn có thể dùng `VALIDATION_ERROR` cho wire shape chung;
`SETTINGS_VALIDATION_FAILED` dành cho rule phụ thuộc nhiều field trong aggregate.
Provider timeout được normalize thành `CONNECTION_TEST_FAILED`, không lộ DNS,
credential hay raw upstream body.

## 6. Web composition

Route `/settings` dùng generated client và TanStack Query. Form có snapshot từ
REST, dirty tracking và một primary action “Lưu cài đặt”.

- Secret input luôn rỗng sau load/save; placeholder chỉ nói “Đã lưu · ••••3f8a”.
- “Hủy thay đổi” reset non-secret về query snapshot và xóa secret draft khỏi DOM.
- Test dùng draft hiện tại; nếu secret input rỗng thì dùng stored credential.
- Save conflict refetch settings và yêu cầu người dùng áp dụng lại draft; không
  tự overwrite version mới.
- Không hiển thị dữ liệu mẫu hoặc trạng thái kết nối giả.
- Loading/empty/error dùng shared list-state anatomy; mutation feedback dùng
  shadcn Sonner.
- Card liên feature chưa có owner API không xuất hiện dưới dạng fake control.

Layout tham chiếu OpenDesign: card 12px, gap 16px, padding 16–24px, control 44px,
hai cột desktop và một cột mobile. Production compose từ shadcn Card, Field,
Input, Select, Button, Alert và Sonner; không copy HTML/JSX prototype.

## 7. Security và audit

- Log redaction bao phủ request body keys `value`, `apiKey`, `accessKeyId`,
  `secretAccessKey` trong HTTP adapter trước khi provider call được triển khai.
- Validation error không echo secret value.
- Audit update chỉ ghi group/field đã đổi, version trước/sau, credential action và
  hint; không ghi plaintext/ciphertext.
- Connection test audit actor, target, status, latency bucket và request ID; không
  ghi draft config nhạy cảm.
- R2 account ID/bucket không phải secret nhưng vẫn không được dùng tạo endpoint
  tùy ý phía client.
- API không có endpoint đọc/decrypt credential.

## 8. Acceptance cho các bước implementation

- [ ] Migration tạo đúng hai bảng typed; không tạo generic key/value.
- [ ] Encryption fail-fast và secret không bao giờ xuất hiện trong response/log.
- [ ] GET/PATCH tuân thủ envelope, ETag, `If-Match` và idempotency.
- [ ] Connection test normalize timeout/upstream error và cleanup R2 probe.
- [ ] Web dirty/cancel/save/test flow accessible và responsive.
- [ ] Integration test xác nhận secret preserve/replace/clear và rollback.
- [ ] Contract lint/generate/check, API/Web test và Playwright pass.

## 9. Chưa chặn slice, cần kiểm chứng sau

1. Tên model/provider catalogue lấy động hay nhập tự do sau khi adapter thật có
   API list-model ổn định.
2. `LOCAL_OLLAMA` chỉ mở khi deployment allowlist chống SSRF được chốt.
3. Card TTS pool, cookie nguồn và GPU defaults chỉ compose sau khi owner slice có
   contract verified.
