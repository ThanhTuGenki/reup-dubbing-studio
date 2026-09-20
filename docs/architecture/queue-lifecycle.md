# Queue lifecycle và contract

Trạng thái: accepted cho slice Queue Web + API  
Ngày chốt: 2026-09-20  
Phạm vi: Control Plane và Web; không triển khai Worker/GPU

## 1. Mục tiêu và ranh giới

Queue là projection vận hành của `pipeline_jobs`, `pipeline_tasks` và lịch sử attempt.
REST/PostgreSQL là nguồn chuẩn; SSE chỉ báo invalidation để Web refetch. Slice này:

- list, filter và xem chi tiết Job/Task;
- hiển thị progress, attempt và nhật ký sự kiện an toàn;
- retry bước lỗi và cancel Job có concurrency/idempotency;
- phát cập nhật trạng thái qua SSE;
- không claim/execute task, không điều khiển process và không thêm code Worker/GPU.

Prototype `docs/reference/ui-prototype/queue.html` chỉ là tham chiếu bố cục. Các field
worker cost, ETA, assignee, bulk priority và raw console log chưa có contract tin cậy,
nên không thuộc slice này.

## 2. Aggregate và nguyên tắc sở hữu state

`PipelineJob` là aggregate root. Task, attempt, workflow event và outbox mutation của
một Job phải được cập nhật trong cùng transaction. Client không gửi status đích tùy ý;
chỉ gọi action hợp lệ, Control Plane quyết định transition.

- Job status là projection bền vững của các Task và action người dùng.
- Task status là state schedulable, không suy diễn từ UI.
- Attempt là append-only; retry không sửa hoặc xóa attempt cũ.
- `profile_snapshot`, `input_manifest` và pipeline version của Job cũ là bất biến.
- Mọi mutation kiểm tra `version` bằng `If-Match` và ghi `audit_events`,
  `workflow_events`, `outbox_messages` trong cùng transaction.

## 3. Lifecycle Job

```text
QUEUED ────────────────┐
  │ task bắt đầu       │ cancel
  ▼                    ▼
RUNNING ───────────► CANCELLED
  │  │  │
  │  │  ├─ cần GPU ─────────► WAITING_FOR_GPU ── task bắt đầu ──► RUNNING
  │  ├──── cần duyệt ────────► WAITING_FOR_REVIEW ─ tiếp tục ───► RUNNING
  │  ├──── task lỗi hết retry ► FAILED ─ manual retry hợp lệ ───► QUEUED
  │  └──── mọi task hoàn tất ─► SUCCEEDED
  └──────────────── cancel ───► CANCELLED
```

Quy tắc projection, theo thứ tự ưu tiên:

1. Action cancel đã commit → `CANCELLED`.
2. Mọi Task bắt buộc `SUCCEEDED` → `SUCCEEDED`.
3. Có Task `FAILED` không còn automatic retry → `FAILED`.
4. Có Task `LEASED` hoặc `RUNNING` → `RUNNING`.
5. Task sẵn sàng kế tiếp thuộc `HUMAN_REVIEW` hoặc đang `WAITING` vì review →
   `WAITING_FOR_REVIEW`.
6. Task sẵn sàng kế tiếp thuộc `GPU_BATCH | GPU_TTS_INTERACTIVE` nhưng chưa được
   claim → `WAITING_FOR_GPU`.
7. Còn Task `READY | BLOCKED | WAITING` → `QUEUED` nếu chưa từng bắt đầu, ngược lại
   `RUNNING`.

`started_at` được set một lần khi attempt đầu tiên bắt đầu. `finished_at` chỉ có ở
`SUCCEEDED | FAILED | CANCELLED`; retry từ `FAILED` xóa `finished_at`,
`failure_code` và `failure_detail_safe` của Job.

## 4. Lifecycle Task và attempt

```text
BLOCKED ─ dependencies đạt ─► READY ─ claim ─► LEASED ─ start ─► RUNNING
                                   │                         │  │
                                   │                         │  ├─ thành công ─► SUCCEEDED
                                   │                         │  ├─ chờ ngoài ──► WAITING
                                   │                         │  └─ lỗi ────────► READY | FAILED
                                   └──────── cancel Job ─────┴───────────────► CANCELLED
```

- Claim tạo `task_attempts` và `task_leases`, tăng `attempt_count` trong một
  transaction dùng row lock.
- Lỗi retryable và `attempt_count < max_attempts` đặt Task lại `READY` với
  `ready_at` theo backoff; lỗi permanent hoặc hết budget đặt `FAILED`.
- Complete/fail/cancel từ executor phải khớp attempt hiện hành và fencing token.
  Attempt cũ hoặc lease hết hạn nhận `409 STALE_TASK_ATTEMPT` và không được commit
  output/progress.
- `WAITING` luôn có reason code có allowlist; không dùng như trạng thái lỗi chung.
- `CANCELLED` và `SUCCEEDED` là terminal. Task `FAILED` chỉ rời terminal qua action
  retry của Control Plane.

### Progress

Thêm `progress_bps integer` (`0..10000`) và `progress_detail_safe text nullable`
trên Task. Update progress chỉ tăng trong cùng attempt; reset về `0` khi manual retry.
Job progress là trung bình `progress_bps` của Task bắt buộc, trong đó `SUCCEEDED =
10000`; Task human review không làm progress giảm trong lúc chờ. API trả percent
đã làm tròn cùng `completedTasks/totalTasks`, không lưu counter riêng trên Job.

## 5. Action matrix

| Job status | Cancel | Retry bước lỗi |
|---|---:|---:|
| `QUEUED` | Có | Không |
| `RUNNING` | Có | Không |
| `WAITING_FOR_GPU` | Có | Không |
| `WAITING_FOR_REVIEW` | Có | Không |
| `FAILED` | Không | Có, nếu có Task lỗi retryable |
| `SUCCEEDED` | Không | Không |
| `CANCELLED` | Replay cancel trả cùng resource | Không |

### Cancel

`POST /v1/queue/jobs/{jobId}/cancel`

- Header bắt buộc: `If-Match`, `Idempotency-Key`.
- Body: `{ reason?: string }`, tối đa 500 ký tự, chỉ lưu bản safe.
- Transaction đặt Job `CANCELLED`, terminalize mọi Task chưa terminal, release lease
  hiện hành và đánh dấu attempt đang chạy `CANCELLED`. Fencing token khiến executor
  muộn không thể ghi kết quả.
- Cancel lại Job đã `CANCELLED` là idempotent. Terminal khác trả
  `409 JOB_NOT_CANCELLABLE`; version cũ trả `412 VERSION_CONFLICT`.

### Retry bước lỗi

`POST /v1/queue/jobs/{jobId}/retry`

- Header bắt buộc: `If-Match`, `Idempotency-Key`.
- Body: `{ taskId?: uuid, reason?: string }`. Nếu không có `taskId`, chọn Task
  `FAILED` gần nhất theo DAG; không retry hàng loạt ngầm.
- Chỉ retry failure code nằm trong allowlist retryable. Task được reset `READY`,
  `ready_at = now`, `progress_bps = 0`; attempt cũ giữ nguyên.
- Allowlist Control Plane ban đầu gồm `DOWNLOAD_TIMEOUT`, `RENDER_OOM`,
  `PROVIDER_TIMEOUT`, `WORKER_LOST`, `LEASE_EXPIRED`, `TRANSIENT_STORAGE_ERROR`
  và `TRANSIENT_NETWORK_ERROR`; code khác mặc định không retry.
- Mỗi manual retry cấp đúng một attempt mới bằng cách bảo đảm
  `max_attempts >= attempt_count + 1`. Audit phân biệt automatic và manual retry.
- Successor chưa chạy giữ `BLOCKED`; successor đã terminal làm request bị từ chối
  `409 JOB_RETRY_CONFLICT` để tránh ghi đè output đã chấp nhận.

## 6. Schema cần cho API Queue

Giữ các bảng `pipeline_jobs`, `pipeline_tasks` hiện có và bổ sung:

```text
pipeline_tasks
  progress_bps          integer not null default 0 check (0..10000)
  progress_detail_safe  text nullable

task_attempts
  id, pipeline_task_id, attempt_number
  executor_kind, executor_instance_id, worker_session_id nullable
  status, started_at, finished_at
  queue_wait_ms, execution_ms, gpu_active_ms nullable
  input_bytes, output_bytes nullable
  exit_code, error_code, error_detail_safe nullable
  metrics_safe jsonb
  unique(pipeline_task_id, attempt_number)

task_leases
  id, pipeline_task_id, task_attempt_id
  executor_kind, executor_instance_id, worker_session_id nullable
  fencing_token, leased_at, renewed_at, expires_at
  released_at, release_reason nullable
  unique(pipeline_task_id, fencing_token)
  unique active lease per task where released_at is null

workflow_events
  id, video_id, pipeline_job_id, pipeline_task_id, task_attempt_id nullable
  event_type, from_status, to_status, actor_type, actor_id nullable
  message_safe nullable, payload_safe jsonb, occurred_at

outbox_messages
  id, aggregate_type, aggregate_id, event_type, payload_safe
  occurred_at, available_at, attempt_count
  locked_by, locked_until, published_at, last_error_safe nullable
```

`worker_session_id` chưa có FK cho tới slice Worker tạo registry/session; vẫn nullable
và không nhận từ browser. Không tạo `task_logs` trong MVP. Detail timeline được dựng
từ `workflow_events` và error/metrics safe của attempt. Raw stdout/stderr đi qua hệ
thống log vận hành có redaction/retention riêng, không qua Queue API.

## 7. REST contract

```text
GET  /v1/queue/jobs
GET  /v1/queue/jobs/{jobId}
GET  /v1/queue/jobs/{jobId}/attempts?cursor=&limit=
POST /v1/queue/jobs/{jobId}/retry
POST /v1/queue/jobs/{jobId}/cancel
GET  /v1/queue/events                 text/event-stream
```

List filters:

```text
status[], kind[], resourceClass[], channelProfileId, query,
createdFrom, createdTo, cursor, limit (default 50, max 100)
```

Cursor key là `(created_at DESC, id DESC)`. `query` chỉ tìm title/external ID đã
lưu, không tìm trong JSON manifest/log. List item gồm Job identity/version, Video
title, profile names từ snapshot, status, current Task, progress aggregate, failure
safe summary và timestamps. Detail bổ sung ordered Tasks, action capabilities và
timeline gần nhất. Attempts phân trang riêng để detail không phình vô hạn.

Response mutation trả Job detail mới và ETag version mới. Mọi error theo
Problem Details, không trả stack, manifest, object key, credential, signed URL,
provider response hay raw exception.

## 8. SSE

Event name: `queue.invalidate`.

```json
{
  "entity": "JOB",
  "jobId": "uuid",
  "jobVersion": 4,
  "reason": "STATUS_CHANGED"
}
```

Payload chỉ đủ để invalidate query list/detail. Web không patch domain state từ
event. Khi connect/reconnect/error recovery, Web refetch REST active queries. Outbox
bảo đảm mutation đã commit không mất notification giữa process; SSE không cung cấp
notification inbox hay cam kết replay dài hạn.

## 9. Bảo mật và giới hạn dữ liệu

- Không persist/log/trả cookie, credential, playback URL, signed URL hoặc signature.
- Không trả `input_manifest`, `profile_snapshot` nguyên bản trong Queue list/detail.
- `message_safe`, `failure_detail_safe`, `progress_detail_safe` bị giới hạn độ dài,
  loại control character và redaction trước khi persist.
- Metrics API là allowlist số; không forward object metrics tùy ý từ executor.
- Audit lưu actor single-workspace đã seed, request ID, before/after safe và lý do.

## 10. Acceptance cho implementation tiếp theo

- Cursor/filter ổn định và không N+1 trên list.
- Job detail phản ánh đúng projection status/progress và chỉ trả dữ liệu safe.
- Retry/cancel idempotent, bảo vệ stale `If-Match`, giữ lịch sử attempt.
- Late attempt không thể commit sau cancel/retry.
- SSE làm invalidation; disconnect/reconnect vẫn phục hồi bằng REST refetch.
- Test PostgreSQL thật bao phủ transition matrix và transaction rollback.

## 11. Quyết định hoãn có chủ đích

- Không bulk retry/cancel/priority trong contract đầu; UI có thể chọn nhiều sau khi
  action đơn ổn định.
- Không ETA/cost/assignee cho tới khi Worker billing và ownership có nguồn dữ liệu.
- Không notification center persistent; chỉ toast/SSE transient.
- Không implement scheduler, task runner, lease reaper hoặc Worker/GPU trong slice
  Web + API này.
