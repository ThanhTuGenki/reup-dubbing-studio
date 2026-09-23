# Contract tạo Ingest Job

- **Trạng thái:** Accepted cho vertical slice Tạo job ingest
- **Ngày chốt:** 2026-09-20
- **Nguồn chuẩn liên quan:**
  [`database-design.md`](./database-design.md),
  [`channel-series-profiles.md`](./channel-series-profiles.md),
  [`douyin-discovery.md`](./douyin-discovery.md)

## 1. Mục tiêu và phạm vi

Slice này nối dữ liệu đã persist trong Discovery với Video Library và Queue:

1. người dùng chọn một hoặc nhiều `source_contents` trong Discovery;
2. chọn một Channel Profile và, nếu cần, một Series Profile thuộc Channel đó;
3. API preflight từng item để Web hiển thị item nào có thể tạo, item nào bị bỏ qua;
4. người dùng xác nhận;
5. API tạo hoặc dùng lại Video aggregate, tạo Ingest Job và task `DOWNLOAD`;
6. Web điều hướng sang Queue ngay sau khi Control Plane đã ghi transaction.

HTTP request không tải media, không gọi GPU và không đợi Worker. `QUEUED` chỉ có
nghĩa Control Plane đã ghi job/task bền vững; không có nghĩa xử lý đã bắt đầu.

Ngoài phạm vi của slice:

- claim/lease, retry và thực thi task bởi Worker;
- các task desub, transcript, translate, TTS, render và publish;
- ước lượng chi phí hoặc thời gian xử lý có tính cam kết;
- override profile riêng cho từng video trong cùng một bulk request;
- tạo source content trực tiếp từ URL chưa qua Discovery.

## 2. Quyết định sản phẩm

### 2.1 Một cấu hình cho một bulk request

Mỗi request dùng đúng một `sourceAccountId`, một `channelProfileId` và tối đa một
`seriesProfileId` cho toàn bộ danh sách. Nếu cần cấu hình khác, Web gửi request
khác. Giới hạn này giữ màn hình xác nhận rõ ràng và tránh contract override chưa
có semantics ổn định.

`sourceAccountId` là bắt buộc. `source_contents` được dedupe giữa nhiều discovery
run và không sở hữu credential, nên chỉ `sourceContentIds` không đủ xác định
account sẽ được dùng khi download. Task chỉ lưu ID account, tuyệt đối không snapshot
cookie, ciphertext hoặc signed URL.

### 2.2 Ranh giới của Ingest Job

Job có `kind = INGEST`. Khi tạo, DAG chỉ có một node `DOWNLOAD`,
`resource_class = IO`, `status = READY`. Thành công của task này đưa video tới
`INGESTED`. Pipeline media đầy đủ sẽ là `FULL_PIPELINE` và được thiết kế trong
slice riêng; không tạo task GPU giả hoặc task không thể chạy trong slice này.

### 2.3 Duplicate và reprocess

Một Video aggregate được định danh bởi:

```text
UNIQUE(source_content_id, channel_profile_id)
```

Cùng source có thể tạo Video cho Channel khác. Series không nằm trong identity;
không được đổi Series của Video đã tồn tại thông qua màn hình tạo mới.

- Có active Ingest Job: trả job hiện tại, không tạo trùng.
- Video đã `INGESTED` hoặc đã đi xa hơn: báo đã ingest, không tạo job mới.
- Video `FAILED` và không có active Ingest Job: cho phép tạo Ingest Job mới trên
  chính Video đó, đồng thời snapshot lại cấu hình được xác nhận.

Active gồm `QUEUED | RUNNING | WAITING_FOR_GPU | WAITING_FOR_REVIEW`. Dù Ingest
MVP không chủ động đi vào hai trạng thái waiting, index dùng tập trạng thái chung
để bảo vệ dữ liệu khi workflow được mở rộng.

## 3. Flow Web và API

```text
Discovery selection
  -> POST /v1/ingest/preflight
  -> Web hiển thị READY / duplicate / lý do bị chặn
  -> người dùng xác nhận các item READY
  -> POST /v1/ingest/jobs + Idempotency-Key
  -> API validate lại và commit
  -> Web hiển thị kết quả từng item rồi chuyển sang /queue
```

Preflight chỉ là projection hỗ trợ UX, không phải reservation. Create luôn đọc và
validate lại trong transaction; kết quả create có thể khác preflight nếu profile,
credential hoặc job đã thay đổi trong lúc dialog đang mở.

Web không tự suy luận readiness từ field profile, không gửi cookie, và không coi
cost/time mock trong prototype là dữ liệu nghiệp vụ.

## 4. REST contract

### 4.1 Request chung

```json
{
  "sourceAccountId": "0199...",
  "sourceContentIds": ["0199...", "0199..."],
  "channelProfileId": "0199...",
  "seriesProfileId": null
}
```

Quy tắc shape:

- tất cả ID là UUIDv7;
- `sourceContentIds` có từ 1 đến 100 phần tử và không được trùng;
- `seriesProfileId` được bỏ qua hoặc gửi `null` khi không dùng Series;
- API giữ thứ tự item giống request để Web ghép selection ổn định.

### 4.2 `POST /v1/ingest/preflight`

Read-only, không yêu cầu idempotency key. Response `200`:

```json
{
  "summary": { "total": 2, "ready": 1, "blocked": 1 },
  "items": [
    {
      "sourceContentId": "0199...",
      "disposition": "READY",
      "existingVideoId": null,
      "existingJobId": null,
      "issues": []
    },
    {
      "sourceContentId": "0199...",
      "disposition": "ALREADY_INGESTED",
      "existingVideoId": "0199...",
      "existingJobId": null,
      "issues": []
    }
  ]
}
```

`disposition` là một trong:

```text
READY
READY_RETRY
ALREADY_QUEUED
ALREADY_INGESTED
SOURCE_NOT_FOUND
SOURCE_UNAVAILABLE
SOURCE_NOT_INGEST_ELIGIBLE
SOURCE_ACCOUNT_UNAVAILABLE
SOURCE_CREDENTIAL_REQUIRED
PROFILE_NOT_READY
SERIES_NOT_READY
SERIES_CHANNEL_MISMATCH
VIDEO_PROFILE_CONFLICT
```

`issues` là code ổn định để giải thích readiness chi tiết, ví dụ
`DEFAULT_VOICE_REQUIRED`; không chứa exception, cookie, URL media hoặc secret.
Các disposition ngoài `READY | READY_RETRY` không được gửi sang create.

### 4.3 `POST /v1/ingest/jobs`

Yêu cầu header:

```http
Idempotency-Key: <opaque 8..128 chars>
```

Body dùng request chung và chỉ chứa các item người dùng đã xác nhận. Response
`201` khi có ít nhất một job mới, hoặc `200` khi tất cả kết quả đều được dùng lại/
bỏ qua:

```json
{
  "items": [
    {
      "sourceContentId": "0199...",
      "result": "CREATED",
      "videoId": "0199...",
      "jobId": "0199...",
      "taskId": "0199...",
      "jobStatus": "QUEUED",
      "videoStatus": "INGEST_QUEUED",
      "issues": []
    }
  ],
  "summary": { "total": 1, "created": 1, "reused": 0, "skipped": 0 }
}
```

`result` là:

```text
CREATED | ALREADY_QUEUED | ALREADY_INGESTED | SKIPPED_INVALID
```

Business validation là per-item để bulk request có partial success. Lỗi shape,
idempotency hoặc giới hạn request áp dụng cho toàn request theo problem response
chung:

- `400 INGEST_VALIDATION_FAILED`;
- `409 IDEMPOTENCY_KEY_REUSED` nếu cùng key nhưng request hash khác;
- `422 INGEST_NO_CREATABLE_ITEMS` chỉ khi request create không chứa item hợp lệ
  và cũng không có resource hiện hữu để trả về.

Không trả raw Prisma error hoặc thông tin credential trong response.

## 5. Ma trận validation

Validation thực hiện theo thứ tự ổn định để cùng dữ liệu luôn cho cùng disposition:

| Điều kiện | Disposition | Có thể create |
| --- | --- | --- |
| Source content không tồn tại | `SOURCE_NOT_FOUND` | Không |
| Source platform khác account platform | `SOURCE_ACCOUNT_UNAVAILABLE` | Không |
| Source không được quan sát qua account đã chọn | `SOURCE_ACCOUNT_UNAVAILABLE` | Không |
| Source availability khác `AVAILABLE` | `SOURCE_UNAVAILABLE` | Không |
| `is_ingest_eligible = false` | `SOURCE_NOT_INGEST_ELIGIBLE` | Không |
| Account không `ACTIVE` hoặc đang cooldown | `SOURCE_ACCOUNT_UNAVAILABLE` | Không |
| Không có credential active, chưa revoke và chưa expire | `SOURCE_CREDENTIAL_REQUIRED` | Không |
| Channel không `ACTIVE/READY` | `PROFILE_NOT_READY` | Không |
| Series không thuộc Channel | `SERIES_CHANNEL_MISMATCH` | Không |
| Series không `ACTIVE/READY` | `SERIES_NOT_READY` | Không |
| Video tồn tại nhưng Series khác request | `VIDEO_PROFILE_CONFLICT` | Không |
| Active Ingest Job tồn tại | `ALREADY_QUEUED` | Dùng lại |
| Video đã ingest hoặc đã đi xa hơn | `ALREADY_INGESTED` | Dùng lại Video |
| Video `FAILED`, không active job | `READY_RETRY` | Có |
| Không vướng điều kiện trên | `READY` | Có |

“Được quan sát qua account” được chứng minh bằng
`discovery_items -> discovery_runs.source_account_id`; không dựa vào URL hay
metadata JSON. Với source cũ không còn discovery item phù hợp, người dùng phải
scan lại bằng account muốn sử dụng.

## 6. Schema PostgreSQL của slice

### 6.1 `videos`

Tạo bảng theo thiết kế DB đã chốt. Slice này cần tối thiểu các field:

```text
id, source_content_id, channel_profile_id, series_profile_id,
status, source_language, target_language, display_title,
ingested_at, archived_at, created_by, created_at, updated_at, version
```

`display_title` snapshot từ title tại thời điểm tạo để Library vẫn có nhãn ổn
định. `source_language` dùng code `und` cho tới khi Discovery có field ngôn ngữ
typed; không suy đoán từ UI hoặc metadata thô. `target_language` lấy từ profile
snapshot.

### 6.2 `pipeline_jobs`

Tạo các field đã chốt trong `database-design.md`. Với Ingest Job:

```text
kind              = INGEST
status            = QUEUED
pipeline_version  = ingest-v1
profile_snapshot  = ProfileJobSnapshot schemaVersion 2
requested_outputs = snapshot typed từ pipeline.output16x9Enabled/output9x16Enabled
priority          = 0 (MVP)
```

Partial unique index:

```sql
CREATE UNIQUE INDEX pipeline_jobs_one_active_ingest_per_video
ON pipeline_jobs (video_id)
WHERE kind = 'INGEST'
  AND status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW');
```

### 6.3 `pipeline_tasks`

Mỗi Ingest Job mới có đúng một task ban đầu:

```text
task_type       = DOWNLOAD
resource_class  = IO
status          = READY
ready_at        = transaction timestamp
attempt_count   = 0
max_attempts    = 3
priority        = job priority
```

`input_manifest` chỉ chứa ID và định danh ổn định:

```json
{
  "schemaVersion": 1,
  "sourceAccountId": "0199...",
  "sourceContentId": "0199...",
  "platform": "DOUYIN",
  "externalId": "stable external id",
  "canonicalUrl": "public canonical page URL or null"
}
```

Không lưu cookie, credential ciphertext, playback URL, signed URL hoặc secret.
Worker sau này resolve credential theo `sourceAccountId` qua boundary riêng và
refresh media candidate ngay trước khi download.

### 6.4 `idempotency_records` và audit

Create dùng:

```text
caller_key     = SYSTEM
operation_scope = INGEST_CREATE_JOBS_V1
```

Chỉ lưu SHA-256 của key và canonical request. Response body an toàn được cache tối
thiểu 24 giờ để retry trả nguyên kết quả và cùng HTTP status. Không lưu raw key.

Một audit event `INGEST_JOBS_CREATED` ghi các ID, counts và disposition; không ghi
toàn bộ input manifest, profile snapshot hoặc credential data.

## 7. Snapshot và transaction

Create chạy trong một PostgreSQL transaction `REPEATABLE READ`:

1. claim hoặc đọc idempotency record;
2. đọc account, credential, source items và quan hệ discovery;
3. resolve `ProfilesService.snapshotForJob(...)` trong cùng transaction;
4. validate từng item và khóa các Video row hiện hữu;
5. upsert Video theo `(source_content_id, channel_profile_id)`;
6. tìm active Ingest Job; nếu chưa có thì tạo Job và task `DOWNLOAD`;
7. ghi audit và response vào idempotency record;
8. commit rồi mới trả HTTP response.

Nếu hai transaction khác key cùng tạo một item, partial unique index là hàng rào
cuối. Transaction thua unique race phải đọc resource thắng cuộc và trả
`ALREADY_QUEUED`, không biến thành lỗi 500.

Profile snapshot dùng contract `schemaVersion: 2` hiện có và được lưu nguyên vẹn.
Job retry/task execution chỉ đọc snapshot đã lưu. Create không giữ transaction
trong lúc gọi mạng hoặc tải media.

Snapshot luôn có `pipeline.removeHardSubEnabled`; mặc định là `false`. Việc lập
lịch stage `DESUB` về sau chỉ được thực hiện khi cờ này là `true`. Trong MVP Web +
API hiện tại, cờ được snapshot nhưng không triển khai Worker/GPU stage.

## 8. Acceptance criteria

- Preflight một và nhiều item trả disposition theo đúng thứ tự request.
- Create một item tạo một Video, một `INGEST` Job và một `DOWNLOAD` task.
- Bulk create có thể vừa tạo item hợp lệ vừa trả `SKIPPED_INVALID` cho item khác.
- Retry cùng idempotency key/body trả cùng status/body và không tạo thêm row.
- Cùng key khác body trả `409`; DB không lưu raw key.
- Hai request concurrent cho cùng source/channel chỉ tạo một active Ingest Job.
- Active job và video đã ingest được trả như duplicate có resource ID rõ ràng.
- Video `FAILED` tạo job mới trên cùng Video row.
- Profile/Series/account/credential đổi giữa preflight và create được phát hiện.
- Task manifest, logs, audit và API response không chứa cookie, ciphertext hoặc
  signed/playback URL.
- API trả ngay sau commit; test không cần Worker hay GPU.

## 9. Deferred

- per-video profile/Series override trong một bulk request;
- chỉnh priority từ UI;
- estimator chi phí/thời gian;
- chọn credential cụ thể khi một account có nhiều credential active;
- tự động tạo `FULL_PIPELINE` sau khi download thành công;
- retry/cancel/reprocess UX và lifecycle đầy đủ (thuộc Queue/Video detail);
- source URL chưa qua Discovery.
