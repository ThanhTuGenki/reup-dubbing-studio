# GPU Worker Control Plane — contract và schema

- **Trạng thái:** `ACCEPTED` cho slice GPU Workers Web + API
- **Cập nhật:** 2026-09-20
- **Nguồn chuẩn cho:** worker registry, approved image, enrollment/credential,
  runtime session, latest heartbeat, drain và billing session trong Control Plane.
- **Không phải nguồn chuẩn cho:** implementation Python trong `workers/gpu`, task
  claim/renew/complete, provider provisioning API, metrics time-series hoặc UI chi
  tiết.
- **Tài liệu liên quan:** [`application.md`](application.md),
  [`database-design.md`](database-design.md),
  [`queue-lifecycle.md`](queue-lifecycle.md),
  [`presigned-asset-flow.md`](presigned-asset-flow.md) và
  [`product/design.md`](../product/design.md).

## 1. Phạm vi đã chốt

Slice này chỉ xây control surface Web + API. Không thêm hoặc sửa implementation
trong `workers/gpu`.

- Hệ thống single-workspace, không login; actor mutation phía Web là `SYSTEM`.
- Một worker có đúng một role: `BATCH_MEDIA` hoặc `INTERACTIVE_TTS`.
- EzyCloudX dùng `MANUAL_REGISTERED`: người dùng tự thuê và tự xóa rental. App
  không browser-automate dashboard, không gọi endpoint nội bộ của provider.
- Worker chỉ kết nối outbound HTTPS tới `/worker/v1`; không nhận PostgreSQL, R2
  hoặc provider credential.
- PostgreSQL chỉ giữ heartbeat/capacity mới nhất. Time-series thuộc metrics system
  bên ngoài và `worker_metric_samples` tiếp tục ở mức `HOLD`.
- Task lease vẫn thuộc Queue/Task aggregate. Worker registry không tự claim hoặc
  release lease trong các action Web.
- Token, credential, bootstrap command và signed URL không được log hoặc persist
  plaintext. API Web không bao giờ trả credential đã enroll.

## 2. Aggregate và trạng thái

`Worker` là aggregate root cho cấu hình do người vận hành quản lý. Approved image
là registry độc lập. Enrollment token và worker credential là secret lifecycle;
runtime session và billing session là lịch sử append-mostly.

### 2.1 Desired status

```text
ACTIVE ── drain ──► DRAINING
   │                    │
   └──── revoke ────────┴──► REVOKED
```

- `ACTIVE`: được phép bắt đầu session và nhận lease phù hợp.
- `DRAINING`: không cấp lease mới; attempt hiện hành được phép kết thúc, upload và
  commit output.
- `REVOKED`: emergency stop ở Control Plane. Thu hồi mọi credential/token, không
  cấp hoặc renew lease. Attempt hiện hành chỉ được retry sau khi lease hết hạn và
  fencing bảo vệ late commit.
- MVP không có action “undrain”. Muốn dùng lại rental đã drain thì tạo worker
  record/enrollment mới, tránh làm sống lại billing/session lịch sử đã đóng.

### 2.2 Observed status

```text
PENDING ─ heartbeat hợp lệ ─► READY ◄──────────────┐
   │                            │ có active task    │ hết active task
   │ token hết hạn              ▼                  │
   │                          BUSY ────────────────┘
   │
   └─ vẫn PENDING; người dùng có thể phát token mới

READY | BUSY ─ drain ─► DRAINING ─ hết active lease ─► SAFE_TO_TERMINATE
SAFE_TO_TERMINATE ─ xác nhận đã xóa rental ─► TERMINATED

session active ─ heartbeat quá hạn ─► OFFLINE
enroll/heartbeat không tương thích ─► ERROR
```

Thứ tự projection:

1. Đã xác nhận xóa rental hoặc billing đã đóng → `TERMINATED`.
2. Session active có `last_heartbeat_at < now - offline_timeout` → `OFFLINE`.
3. Validation image/hardware/agent bị khóa → `ERROR`.
4. Chưa có session active → `PENDING`.
5. `desired_status=DRAINING` và còn active lease → `DRAINING`.
6. `desired_status=DRAINING` và active lease bằng 0 → `SAFE_TO_TERMINATE`.
7. Có active lease/task → `BUSY`; còn lại → `READY`.

`observed_status` được materialize để query UI nhanh nhưng chỉ enrollment,
heartbeat, monitor/reaper và termination use case được cập nhật. Web không gửi
observed status tùy ý.

`REVOKED` là desired status, không giả là worker đã tắt. Rental vẫn có thể tính
phí và UI phải tiếp tục hướng dẫn người dùng xóa thủ công.

## 3. Enrollment và credential

### 3.1 Tạo registry và phát bootstrap token

Web tạo worker với display name, role, provider, provider instance ID tùy chọn,
expected hardware, approved image và snapshot giá thuê. Transaction tạo worker,
billing session mở và một enrollment token.

Raw token có ít nhất 256 bit entropy và chỉ xuất hiện một lần trong response để
ghép bootstrap command. PostgreSQL chỉ lưu `token_hash` bằng keyed hash có
constant-time compare cùng prefix không bí mật để hỗ trợ tra cứu. Token:

- hết hạn sau 15 phút;
- chỉ dùng một lần;
- phát token mới sẽ revoke mọi token cũ chưa dùng của worker;
- không được đặt trong URL/query string;
- không được lưu trong idempotency response, audit payload, analytics hoặc log.

Nếu client mất response chứa token, không có API đọc lại. Người dùng chọn “Tạo
token mới”; API revoke token cũ và trả bootstrap command mới. Create replay với
cùng `Idempotency-Key` trả worker đã tạo nhưng `enrollment.secretAvailable=false`,
không phát thêm secret ngầm.

### 3.2 Exchange và session đầu tiên

`POST /worker/v1/enroll` dùng bootstrap token trong `Authorization: Bearer`, nhận:

```text
sessionNonce       UUID v7 sinh mới cho mỗi lần boot
role               role mà image tuyên bố
imageDigest        OCI digest sha256 bất biến
agentVersion       SemVer
contractVersion    major contract worker hỗ trợ
gpuInventory       danh sách GPU/index/model/VRAM/driver đã sanitize
cpuInventory       CPU/RAM/OS đã sanitize
capacity           slot theo resource class, số nguyên không âm
```

Control Plane atomically:

1. khóa token và worker;
2. kiểm tra token chưa consumed/revoked/expired và worker đang `ACTIVE`;
3. role khớp worker, digest khớp approved image `ACTIVE`, contract major được hỗ
   trợ, hardware đạt expected minimum;
4. consume token;
5. tạo worker credential mới chỉ lưu hash và scope;
6. tạo session + heartbeat đầu tiên, gắn billing session đang mở;
7. chuyển observed status thành `READY` và ghi audit/outbox an toàn.

Response trả access token đúng một lần. Mất response thì operator revoke/reissue
enrollment; không có endpoint đọc lại credential. Enrollment lặp cùng token sau
khi consume trả `409 ENROLLMENT_TOKEN_CONSUMED` và không tạo session thứ hai.

Credential có scope đúng worker và contract worker, không dùng cho Web API. Mỗi
worker chỉ có một credential active trong MVP; enroll mới hoặc revoke làm token
cũ mất hiệu lực ngay. DB lưu `last_used_at`, `expires_at` tùy chọn và `revoked_at`.

### 3.3 Boot tiếp theo

Một container đã có credential gọi `POST /worker/v1/sessions` với session nonce và
cùng identity/image payload. Tối đa một session chưa kết thúc trên mỗi worker.
Session cũ được đóng `REPLACED` chỉ khi không còn active lease; nếu còn lease,
request trả `409 WORKER_SESSION_CONFLICT` để không tạo hai executor cùng identity.

## 4. Heartbeat và offline

`POST /worker/v1/sessions/{sessionId}/heartbeat` yêu cầu worker credential,
`Idempotency-Key` và payload:

```text
sequence             bigint tăng đơn điệu trong session
sentAt               timestamp quan sát; server time vẫn là nguồn chuẩn
capacity             total/available slot theo resource class
currentTaskCount     integer không âm
activeLeaseIds       UUID[] chỉ để đối chiếu, lease DB là nguồn chuẩn
telemetry            GPU util/temp/VRAM + CPU/RAM/disk đã sanitize
agentVersion
contractVersion
```

- Nhịp mặc định 15 giây; `offline_timeout=45 giây` (ba nhịp), cấu hình phía
  Control Plane và trả trong enroll/session response.
- Chỉ update row session hiện hành; không insert sample mỗi heartbeat.
- `sequence <= last_heartbeat_sequence` là replay/out-of-order: trả success hiện
  hành nhưng không ghi đè snapshot mới hơn.
- `sentAt` không quyết định offline vì clock worker có thể lệch.
- Heartbeat không thể tự đổi desired status, approved image hoặc billing rate.
- Worker dùng image/contract bị revoke hoặc sai major nhận
  `409 WORKER_VERSION_MISMATCH`; session chuyển `ERROR`, không nhận lease mới.
- Monitor đánh dấu `OFFLINE` sau timeout. Việc xử lý lease hết hạn tuân theo Queue
  fencing; heartbeat trở lại có thể phục hồi session chỉ khi credential, image,
  contract và session vẫn hợp lệ.

Telemetry API/Web chỉ trả field allowlist. Không nhận raw log, environment,
command line, hostname secret-bearing hoặc provider credential.

## 5. Drain, revoke và xác nhận termination

### 5.1 Drain an toàn

`POST /v1/workers/{workerId}/drain` yêu cầu `If-Match` và `Idempotency-Key`.
Transaction đặt desired status `DRAINING`, tăng version, ghi audit/outbox. Từ thời
điểm commit, scheduler không cấp lease mới cho mọi session của worker.

Worker tiếp tục heartbeat, renew lease đang chạy và commit output. API projection
trả blocker:

```text
activeLeaseCount
safeToTerminate
```

Chỉ khi `activeLeaseCount=0`, monitor chuyển `SAFE_TO_TERMINATE`. Invariant của
Task API là lease chỉ được release thành công sau khi output bắt buộc đã upload,
HEAD/checksum và commit; vì vậy một output đang commit vẫn nằm trong active lease.
Upload `PENDING` của attempt đã hết hạn là orphan chờ cleanup, không giữ rental.
Heartbeat tự báo `currentTaskCount=0` không đủ để kết luận an toàn.

### 5.2 Revoke khẩn cấp

`POST /v1/workers/{workerId}/revoke` cũng dùng concurrency/idempotency. Action:

- desired status → `REVOKED`;
- revoke credential và enrollment token chưa dùng;
- từ chối heartbeat/session/lease/renew tiếp theo;
- không tự đánh dấu rental đã xóa và không đóng billing;
- lease hiện hành được Queue reaper xử lý khi hết hạn; fencing chặn late result.

### 5.3 Người dùng xác nhận đã xóa rental

`POST /v1/workers/{workerId}/confirm-termination` chỉ hợp lệ khi observed status
`SAFE_TO_TERMINATE`, hoặc sau revoke khi không còn active lease.
Action đóng session và billing session bằng server time, lưu confirmation time,
đặt `TERMINATED` và giữ record để xem lịch sử chi phí. Không hard-delete worker.

Với manual provider, đây là xác nhận vận hành, không phải bằng chứng provider đã
ngừng tính phí. UI phải nói rõ người dùng cần xóa rental trên dashboard trước.

## 6. Billing session

Billing bắt đầu từ thời điểm người dùng khai báo rental đã chạy khi tạo worker,
không phải từ heartbeat đầu tiên. Mỗi worker tối đa một billing session mở.

- `hourly_rate_cp` là snapshot `numeric`, không hard-code bảng giá provider.
- `paid_vnd_per_cp` nullable là snapshot tỷ giá lần mua CP; không coi CP là VND.
- Estimated cost dùng server-side decimal:
  `hourly_rate_cp × elapsed_seconds / 3600`, chỉ để ước tính.
- Session runtime có thể thay đổi/restart nhưng cùng một rental vẫn dùng một
  billing session cho tới khi operator xác nhận termination.
- API trả `estimatedCostCp` và `estimatedCostVnd` nullable; không trả float làm
  nguồn chuẩn thanh toán.

## 7. Schema được chốt cho migration slice

### 7.1 Enum

```text
WorkerRole             BATCH_MEDIA | INTERACTIVE_TTS
WorkerMode             MANUAL_REGISTERED | API_PROVISIONED
WorkerDesiredStatus    ACTIVE | DRAINING | REVOKED
WorkerObservedStatus   PENDING | READY | BUSY | DRAINING |
                       SAFE_TO_TERMINATE | OFFLINE | TERMINATED | ERROR
WorkerImageStatus      ACTIVE | REVOKED
WorkerSessionEndReason DRAINED | TERMINATED | REPLACED | CREDENTIAL_REVOKED |
                       HEARTBEAT_TIMEOUT | VERSION_MISMATCH | ERROR
```

`API_PROVISIONED` chỉ là shape tương lai; API Web MVP chỉ chấp nhận
`MANUAL_REGISTERED`.

### 7.2 Bảng

```text
approved_worker_images
  id uuid v7 PK
  role WorkerRole
  semantic_version text
  image_digest text
  registry_ref text
  contract_version integer
  status WorkerImageStatus
  approved_at timestamptz
  revoked_at timestamptz nullable
  created_at timestamptz
  updated_at timestamptz
  version integer
  UNIQUE(role, image_digest)

workers
  id uuid v7 PK
  display_name text
  role WorkerRole
  provider text
  provider_instance_id text nullable
  mode WorkerMode
  desired_status WorkerDesiredStatus
  observed_status WorkerObservedStatus
  expected_gpu_model text nullable
  expected_vram_mb integer nullable
  approved_image_id uuid FK approved_worker_images
  last_error_code text nullable
  last_error_detail_safe text nullable
  created_at timestamptz
  updated_at timestamptz
  version integer

worker_enrollment_tokens
  id uuid v7 PK
  worker_id uuid FK workers
  token_prefix text
  token_hash text
  expires_at timestamptz
  consumed_at timestamptz nullable
  revoked_at timestamptz nullable
  created_at timestamptz

worker_credentials
  id uuid v7 PK
  worker_id uuid FK workers
  credential_prefix text
  credential_hash text
  scopes text[]
  issued_at timestamptz
  expires_at timestamptz nullable
  last_used_at timestamptz nullable
  revoked_at timestamptz nullable
  created_at timestamptz

worker_sessions
  id uuid v7 PK
  worker_id uuid FK workers
  credential_id uuid FK worker_credentials
  billing_session_id uuid FK worker_billing_sessions
  session_nonce uuid
  image_id uuid FK approved_worker_images
  image_digest text
  agent_version text
  contract_version integer
  gpu_inventory jsonb
  cpu_inventory jsonb
  capacity jsonb
  telemetry_safe jsonb
  current_task_count integer
  last_heartbeat_sequence bigint
  started_at timestamptz
  last_heartbeat_at timestamptz
  draining_at timestamptz nullable
  ended_at timestamptz nullable
  end_reason WorkerSessionEndReason nullable
  UNIQUE(worker_id, session_nonce)

worker_billing_sessions
  id uuid v7 PK
  worker_id uuid FK workers
  provider text
  provider_instance_id text nullable
  hourly_rate_cp numeric(20,6)
  paid_vnd_per_cp numeric(20,8) nullable
  billing_started_at timestamptz
  billing_ended_at timestamptz nullable
  termination_confirmed_at timestamptz nullable
  estimated_cost_cp numeric(24,6) nullable
  created_at timestamptz
```

Không tạo `worker_metric_samples`, `worker_cost_allocations` hoặc provider API
credential trong migration này.

### 7.3 Constraint/index bắt buộc

- FK `TaskAttempt.worker_session_id` và `TaskLease.worker_session_id` tới
  `worker_sessions.id` được bổ sung với `ON DELETE RESTRICT`.
- Partial unique: một credential active/worker (`revoked_at IS NULL`).
- Partial unique: một enrollment token chưa dùng/worker
  (`consumed_at IS NULL AND revoked_at IS NULL`).
- Partial unique: một session active/worker (`ended_at IS NULL`).
- Partial unique: một billing session mở/worker (`billing_ended_at IS NULL`).
- Một billing session có thể chứa nhiều runtime session khi container restart;
  `worker_sessions.billing_session_id` giữ lineage này.
- Index `workers(observed_status, role, updated_at DESC, id)` cho list/filter.
- Index `worker_sessions(last_heartbeat_at)` với `ended_at IS NULL` cho monitor.
- Index enrollment theo `token_prefix`; hash compare vẫn bắt buộc.
- Check non-negative cho VRAM, current task, capacity slot và rate; billing end
  không trước billing start; heartbeat sequence không âm.
- JSON inventory/capacity/telemetry phải qua schema validation ở application
  boundary và size limit; JSONB không chứa secret/raw log.

## 8. Contract inventory

### 8.1 Web API `/v1`

```text
GET    /workers
GET    /workers/{workerId}
POST   /workers
POST   /workers/{workerId}/enrollment-token
POST   /workers/{workerId}/drain
POST   /workers/{workerId}/revoke
POST   /workers/{workerId}/confirm-termination
GET    /worker-images
POST   /worker-images
POST   /worker-images/{imageId}/revoke
GET    /worker-events                  SSE invalidation only
```

List dùng cursor và filter `role`, `observedStatus`, `desiredStatus`, `provider`,
`query`. Detail trả current session, approved image, blocker và billing projection;
không trả token hash, credential hash, bootstrap secret hoặc raw telemetry.

Mutation resource hiện hữu yêu cầu strong `If-Match`; mutation tạo/action yêu cầu
`Idempotency-Key`, ngoại trừ response secret một lần tuân theo quy tắc mất response
ở §3.1. SSE chỉ mang worker ID/version/event type an toàn; REST là nguồn chuẩn.

### 8.2 Worker API `/worker/v1`

```text
POST   /enroll
POST   /sessions
POST   /sessions/{sessionId}/heartbeat
```

Task claim/lease/renew/complete/fail không thuộc checkbox phân tích này và chỉ
được thêm Just-in-Time trong Task execution slice. Không tạo endpoint giả trả
task chưa thể thực thi.

Ranh giới executor, capability, lifecycle lease và asset manifest cho slice đó
đã được chốt tại
[`worker-task-execution.md`](worker-task-execution.md). Tài liệu hiện tại vẫn là
nguồn chuẩn cho registry/session/heartbeat/drain, không override task baseline.

Mọi response dùng envelope/Problem Details chung, request ID, UUID v7, UTC và
camelCase. Contract Web đi vào `web.openapi.yaml`; worker boundary đi vào
`worker.openapi.yaml` trong task API kế tiếp rồi mới generate/verify consumer.

## 9. Error code cần cho implementation

```text
WORKER_NOT_FOUND
WORKER_NOT_ACTIVE
WORKER_NOT_DRAINABLE
WORKER_NOT_SAFE_TO_TERMINATE
WORKER_SESSION_CONFLICT
WORKER_OFFLINE
WORKER_VERSION_MISMATCH
WORKER_IMAGE_NOT_APPROVED
WORKER_HARDWARE_MISMATCH
ENROLLMENT_TOKEN_INVALID
ENROLLMENT_TOKEN_EXPIRED
ENROLLMENT_TOKEN_CONSUMED
WORKER_CREDENTIAL_REVOKED
```

Secret/auth error phía Worker không phân biệt hash/prefix có tồn tại cho caller;
wire dùng title/detail chung để tránh oracle. Log chỉ giữ worker/token ID và code
an toàn, không giữ bearer value.

## 10. Acceptance cho các task kế tiếp

1. Fresh migration tạo đúng constraint/index và nối FK lease/attempt.
2. Enroll atomically consume token, validate approved digest/role/contract và chỉ
   trả credential một lần.
3. Heartbeat out-of-order không ghi đè snapshot; timeout chuyển offline theo
   server time.
4. Drain ngăn lease mới và chỉ safe khi không còn active lease; lease chỉ release
   sau khi output bắt buộc đã commit.
5. Revoke làm credential mất hiệu lực ngay; late attempt bị fencing từ chối.
6. Confirmation đóng billing bằng server time nhưng UI vẫn nói đây là xác nhận
   thủ công, không phải provider automation.
7. Web/API không trả hoặc log token hash, bearer token, environment, raw log,
   provider cookie hay signed URL.
8. Không có diff implementation dưới `workers/gpu`.
