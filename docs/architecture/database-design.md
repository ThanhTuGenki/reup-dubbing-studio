# Database Design — Reup Dubbing Studio

- **Trạng thái:** `DRAFT` — thiết kế logic để review trước khi tạo Prisma schema
  và migration.
- **Cập nhật:** 2026-09-18.
- **Nguồn chuẩn cho:** ranh giới aggregate, inventory bảng, quan hệ, constraint,
  index, transaction boundary và các câu hỏi cần chốt trước khi triển khai DB.
- **Không phải nguồn chuẩn cho:** Prisma schema đã migrate, OpenAPI contract,
  state machine chi tiết chưa được acceptance-test, hoặc retention production đã
  đo bằng dữ liệu thật.
- **Tài liệu liên quan:**
  [`product/design.md`](../product/design.md),
  [`application.md`](application.md),
  [`douyin-discovery.md`](douyin-discovery.md),
  [`api-wire-conventions`](decisions/2026-09-07-api-wire-conventions.md),
  [`api-hexagonal-slices`](decisions/2026-09-14-api-hexagonal-slices.md).

## 1. Kết luận ngắn

PostgreSQL là nguồn chuẩn cho domain state, workflow state, worker lease, lịch sử
review và publishing. R2 lưu binary; DB chỉ lưu metadata, checksum, object key và
quan hệ sở hữu.

Không tạo toàn bộ schema trong một migration nền móng. Mỗi nhóm bảng chỉ được tạo
khi vertical slice đầu tiên dùng nó. Tuy nhiên inventory và ranh giới dưới đây
được thiết kế cùng nhau để tránh các slice tạo model mâu thuẫn.

Ba quyết định quan trọng nhất:

1. `source_contents` là item được khám phá; `videos` chỉ xuất hiện sau khi người
   dùng chọn ingest. Không gộp hai khái niệm.
2. `pipeline_jobs`, `pipeline_tasks`, `task_attempts` và `task_leases` tách riêng.
   Job không phải đơn vị worker lease.
3. Binary dùng registry `assets` dùng chung, sau đó liên kết bằng bảng có FK thật
   như `video_assets`, `channel_profile_assets`; không dùng `owner_type/owner_id`
   polymorphic.

## 2. Mức độ chắc chắn

Mọi bảng trong tài liệu có một trong ba nhãn:

| Nhãn | Ý nghĩa | Hành động |
| --- | --- | --- |
| `CORE` | Hành vi đã được tài liệu sản phẩm/kiến trúc chốt | Tạo khi slice sử dụng |
| `LIKELY` | Hành vi cần có nhưng shape/versioning còn cần review | Có thể prototype, chưa freeze migration |
| `HOLD` | Ngoài MVP hoặc phụ thuộc bằng chứng kỹ thuật tương lai | Không tạo table cho tới khi capability được đưa vào scope |

`HOLD` không có nghĩa là không cần; nó ngăn việc khóa schema quá sớm.

## 3. Bản đồ domain

```text
Source account ── Discovery run ── Source content
                                      │ selected for ingest
                                      ▼
Channel/Series profile ──────────── Video ── Pipeline job
       │                              │          │
       ├── Voices/Cast                │          ├── Tasks ─ Attempts ─ Leases
       └── Profile assets             │          └── Workflow events
                                      │
                                      ├── Transcript runs ─ Raw segments
                                      ├── Canonical segments ─ Revisions ─ TTS audio
                                      ├── Render outputs ─ Assets
                                      └── Publish package ─ Publication tasks
                                                              ├── Field revisions
                                                              ├── Checklist
                                                              └── Publication proof

Worker ── Worker session ── Task attempt
   ├── Enrollment/auth
   ├── Billing session
   └── Performance profile
```

## 4. Quy ước database

### 4.1 ID, thời gian và số

- Primary key dùng UUID v7 do application sinh, wire format là string.
- External ID của Douyin/Bilibili/YouTube luôn là `text`, không dùng `bigint`.
- Timestamp dùng `timestamptz`, ghi UTC.
- Duration/timeline dùng integer milliseconds, tên field kết thúc `_ms`.
- File size, counter và token count dùng `bigint`.
- Tiền/Computing Point dùng `numeric`, không dùng float.
- `created_at`, `updated_at`; resource mutable có `version integer` để hỗ trợ
  `If-Match` theo API convention.

### 4.2 Naming

- PostgreSQL table/column dùng `snake_case` số nhiều.
- Prisma model dùng PascalCase và map bằng `@@map`/`@map`.
- Enum do ứng dụng sở hữu dùng `UPPER_SNAKE_CASE`.
- Giá trị do provider bên ngoài sở hữu lưu `text` + raw code; không biến thành DB
  enum nếu provider có thể thêm giá trị.

### 4.3 JSONB

JSONB chỉ dùng cho:

- raw/sanitized provider payload có retention;
- configuration snapshot để tái lập một pipeline run;
- provider cursor opaque;
- hardware/model metrics có shape mở;
- metadata phụ chưa có query/index nghiệp vụ.

Không dùng JSONB thay cho segment, task dependency, checklist, field history,
asset ownership hoặc quan hệ creator/content.

### 4.4 Delete

- Aggregate/domain record mặc định `RESTRICT`; không cascade qua ranh giới domain.
- Child thuần như checklist item, discovery item có thể `ON DELETE CASCADE` với
  parent khi retention job chủ động purge.
- User-facing profile/content dùng archive/status, không hard delete tùy tiện.
- Xóa row asset không đồng nghĩa đã xóa object R2; cleanup dùng state machine và
  audit riêng.

### 4.5 Secrets

- Không lưu plaintext cookie, API key, worker token hoặc R2 credential.
- Source cookie lưu ciphertext AEAD; encryption key nằm ngoài PostgreSQL.
- Enrollment/access token chỉ lưu hash và metadata.
- Signed URL không lưu lâu dài và không ghi audit/log.

## 5. Inventory bảng

### 5.1 Identity, concurrency và audit

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `users` | `CORE` | Actor cho review, assignee, audit và publishing |
| `idempotency_records` | `CORE` | Giữ kết quả mutation tối thiểu 24 giờ |
| `audit_events` | `CORE` | Audit mutation người/worker, append-only |
| `workflow_events` | `CORE` | Lịch sử transition của video/job/task |
| `outbox_messages` | `CORE` | Durable event giao cho SSE/scheduler/background consumer |
| `auth_identities` | `HOLD` | Ngoài MVP; chỉ tạo nếu sau này bổ sung login |
| `user_sessions` | `HOLD` | Ngoài MVP; chỉ tạo nếu sau này bổ sung login |
| `workspaces`, `workspace_members` | `HOLD` | Ngoài thiết kế hiện tại; chỉ xét lại nếu sản phẩm chuyển sang multi-tenant |

### 5.2 Discovery và nguồn

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `source_accounts` | `CORE` | Cấu hình truy cập từng platform/account |
| `source_credentials` | `CORE` | Cookie ciphertext và rotation |
| `source_creators` | `CORE` | Tác giả/kênh nguồn |
| `source_categories` | `CORE` | Category/course tag/hashtag động |
| `source_contents` | `CORE` | Catalog item đã khám phá |
| `source_media_candidates` | `CORE` | Remote cover/playback URL có tuổi thọ ngắn |
| `content_metric_snapshots` | `CORE` | View/like/comment theo thời gian |
| `source_content_categories` | `CORE` | Content ↔ category/tag |
| `source_collections` | `LIKELY` | Mix/series/course/playlist nguồn |
| `source_collection_items` | `LIKELY` | Thứ tự content trong collection |
| `discovery_runs` | `CORE` | Một lần scan provider |
| `discovery_items` | `CORE` | Rank/content trong run |
| `watchlists` | `CORE` | Lịch scan creator/mix |
| `source_raw_events` | `LIKELY` | Payload provider đã sanitize, retention ngắn |

Chi tiết field/provider nằm tại
[`douyin-discovery.md`](douyin-discovery.md). Tài liệu này sở hữu quan hệ của
nhóm Discovery với `videos`, assets và workflow.

### 5.3 Profile, voice và cast

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `channel_profiles` | `CORE` | Default dub/output/content/retention của một kênh |
| `publishing_destinations` | `CORE` | YouTube channel/Facebook Page đích, không chứa token trực tiếp |
| `publishing_credentials` | `HOLD` | OAuth token mã hóa khi automated publishing được đưa vào scope |
| `series_profiles` | `CORE` | Mask, voice mode và override theo bộ |
| `channel_profile_assets` | `CORE` | Intro/outro/logo/watermark |
| `voice_profiles` | `CORE` | Voice identity và license gate |
| `voice_profile_assets` | `CORE` | Reference audio/text, prepared voice prompt |
| `cast_sheets` | `CORE` | Cast aggregate theo series |
| `cast_sheet_entries` | `CORE` | Character/alias → voice profile |
| `cast_sheet_revisions` | `HOLD` | Chỉ cần nếu phải rollback/branch cả cast sheet |

### 5.4 Video, asset và retention

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `videos` | `CORE` | Aggregate video nội bộ sau selection/ingest |
| `assets` | `CORE` | Registry object local/R2 đã thuộc hệ thống |
| `video_assets` | `CORE` | Video ↔ asset theo kind/variant/revision |
| `render_outputs` | `CORE` | Cặp MP4/SRT/thumbnail có nghĩa nghiệp vụ |
| `video_highlights` | `CORE` | Nhiều khoảng cắt/crop 9:16 hoặc custom trên một video |
| `asset_cleanup_runs` | `LIKELY` | Một lần cleanup sau publishing |
| `asset_cleanup_items` | `LIKELY` | Quyết định/xác nhận xóa từng asset |
| `asset_access_grants` | `HOLD` | Chỉ cần nếu presigned grant phải audit chi tiết |

### 5.5 Pipeline queue

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `pipeline_jobs` | `CORE` | Một pipeline execution của video |
| `pipeline_tasks` | `CORE` | Đơn vị schedulable |
| `task_segment_inputs` | `CORE` | Segment revision bất biến thuộc một TTS task/batch |
| `task_dependencies` | `CORE` | DAG dependency |
| `task_attempts` | `CORE` | Một lần thực thi/retry |
| `task_leases` | `CORE` | Lease deadline, fencing và renew history |
| `task_asset_links` | `LIKELY` | Lineage input/output giữa task và asset |
| `task_logs` | `HOLD` | Chỉ tạo nếu một attempt có nhiều log assets cần query |

### 5.6 Transcript, Studio và review

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `transcript_runs` | `CORE` | OCR, ASR hoặc merged candidate run |
| `transcript_segments` | `CORE` | Segment thô của từng transcript run |
| `video_segments` | `CORE` | Timeline canonical và identity ổn định |
| `segment_revisions` | `CORE` | Text dịch, character, voice, timing edit history |
| `segment_audio_revisions` | `CORE` | Các lần TTS/re-gen và asset WAV |
| `review_decisions` | `CORE` | Approve/request changes theo scope/version |
| `studio_sessions` | `HOLD` | Persist warm TTS session nếu runtime cần recovery |
| `segment_alignment_details` | `HOLD` | Word-level timing/bbox nếu Studio thật sự cần |

### 5.7 Worker và chi phí

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `workers` | `CORE` | Worker config/role/provider và lifecycle |
| `worker_sessions` | `CORE` | Một runtime boot/session và latest heartbeat |
| `worker_enrollment_tokens` | `CORE` | Token một lần, chỉ lưu hash |
| `worker_credentials` | `LIKELY` | Credential sau enrollment, hash/revoke |
| `approved_worker_images` | `CORE` | Version/digest được phép nhận task |
| `worker_billing_sessions` | `CORE` | Snapshot CP/giờ và thời gian thuê |
| `performance_profiles` | `LIKELY` | Benchmark đã duyệt theo GPU/stage/model |
| `worker_metric_samples` | `HOLD` | Time-series heartbeat/GPU metric nếu latest snapshot không đủ |
| `worker_cost_allocations` | `HOLD` | Chi phí phân bổ video/task sau khi chốt công thức |
| `provider_rentals` | `HOLD` | Chỉ khi có official provisioning/billing API |

### 5.8 Content Agent và publishing

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `publish_packages` | `CORE` | Context/content bundle của một video |
| `publication_tasks` | `CORE` | Một video × destination/platform |
| `publication_fields` | `CORE` | Field ổn định: title, description, caption... |
| `publication_field_revisions` | `CORE` | History generate/edit từng field |
| `publication_checklist_items` | `CORE` | Checklist snapshot của task |
| `publication_proofs` | `CORE` | URL/post ID và lịch sử verification attempt |
| `ai_generation_runs` | `LIKELY` | Model/token/cost/prompt hash cho LLM calls |
| `checklist_templates` | `HOLD` | Chỉ khi checklist trở thành cấu hình user-editable |
| `platform_rule_versions` | `HOLD` | Chỉ khi platform rules không còn nằm trong code/config |

### 5.9 Notification và settings

| Bảng | Mức | Trách nhiệm |
| --- | --- | --- |
| `notifications` | `HOLD` | Ngoài MVP; chỉ tạo nếu có notification center read/unread |
| `notification_deliveries` | `HOLD` | Email/webhook delivery attempts tương lai |
| `app_settings` | `HOLD` | Tránh generic key/value cho tới khi có setting không thuộc aggregate |

## 6. Identity, idempotency và audit

### 6.1 `users` (`CORE`)

```text
id                    uuid v7 PK
display_name          text
email                 text nullable
status                ACTIVE | DISABLED
created_at            timestamptz
updated_at            timestamptz
version               integer
```

MVP không có login và chỉ có một owner/operator. Migration/seed tạo actor này để
dùng cho `assigned_to`, review và audit; API không cho tạo thêm user ở slice đầu.
Email dùng unique expression index
`UNIQUE(lower(email)) WHERE email IS NOT NULL`; không phụ thuộc extension
`citext` ở migration đầu. `auth_identities`, session và role chỉ được thiết kế lại
khi phạm vi người dùng thay đổi.

### 6.2 `idempotency_records` (`CORE`)

```text
id                    uuid v7 PK
caller_key            text
operation_scope       text
idempotency_key_hash  text
request_hash          text
response_status       integer
response_body         jsonb nullable
resource_id           uuid nullable
created_at            timestamptz
expires_at            timestamptz
```

Constraint:

```text
UNIQUE(caller_key, operation_scope, idempotency_key_hash)
INDEX(expires_at)
```

`caller_key` có dạng `USER:<uuid>`, `WORKER:<uuid>` hoặc `SYSTEM`, tránh semantic
`NULL` không mong muốn cho system caller. Không lưu raw idempotency key. Cùng key
nhưng request hash khác trả conflict.

### 6.3 `audit_events` (`CORE`)

```text
id                    uuid v7 PK
actor_type            USER | WORKER | SYSTEM
actor_id              uuid nullable
action                text
entity_type           text
entity_id             uuid nullable
request_id            uuid nullable
before_safe           jsonb nullable
after_safe            jsonb nullable
metadata_safe         jsonb
occurred_at           timestamptz
```

Append-only. Sanitizer phải loại secret/signed URL. `entity_type/entity_id` là
audit index có chủ đích; không dùng cặp này làm FK nghiệp vụ.

## 7. Profiles, destinations, voices và cast

### 7.1 `channel_profiles` (`CORE`)

```text
id                         uuid v7 PK
name                       text
status                     ACTIVE | ARCHIVED
target_language            text              -- BCP 47, ví dụ vi
default_voice_profile_id   uuid nullable FK
subtitle_language          text
subtitle_filename_rule     text
subtitle_max_line_length   integer nullable
tts_speed                  numeric(5,3)
timing_policy              text
output_16x9_enabled        boolean
output_9x16_enabled        boolean
retain_heavy_days          integer
retain_text_days           integer nullable
content_voice_rules        jsonb
content_cta_template       text nullable
content_base_keywords      text[]
created_by                 uuid FK users
created_at                 timestamptz
updated_at                 timestamptz
version                    integer
```

Nested rules ít query có thể JSONB, nhưng các field ảnh hưởng scheduling/cleanup
phải typed. Job lưu snapshot profile để thay đổi sau này không làm biến đổi run cũ.

### 7.2 Destination (`CORE`) và credential publishing (`HOLD`)

```text
id                    uuid v7 PK
channel_profile_id    uuid FK
platform              YOUTUBE | FACEBOOK
external_id           text nullable
display_name          text
is_required           boolean
is_active             boolean
platform_config       jsonb
created_at            timestamptz
updated_at            timestamptz
version               integer

publishing_credentials
  id                  uuid v7 PK
  destination_id      uuid FK
  kind                OAUTH2
  ciphertext          bytea
  encryption_key_id   text
  granted_scopes      text[]
  access_expires_at   timestamptz nullable
  last_refreshed_at   timestamptz nullable
  status              ACTIVE | EXPIRED | INVALID | REVOKED
  revoked_at          timestamptz nullable
  created_at          timestamptz
  updated_at          timestamptz
```

MVP publishing thủ công nên chưa migrate `publishing_credentials`. Khi automated
publishing được đưa vào scope, access token và refresh token nằm trong một
AEAD-encrypted envelope; master key ở ngoài PostgreSQL. Không trả ciphertext qua
API hoặc ghi vào log/audit. Partial unique index bảo đảm tối đa một credential
`ACTIVE` cho mỗi destination/kind.

### 7.3 `series_profiles` (`CORE`)

```text
id                    uuid v7 PK
channel_profile_id    uuid FK
name                  text
voice_mode            SINGLE | DUAL | MULTI_AUTO
mask_x                numeric nullable
mask_y                numeric nullable
mask_width            numeric nullable
mask_height           numeric nullable
mask_coordinate_space NORMALIZED_0_1 | PIXELS
status                ACTIVE | ARCHIVED
created_by            uuid FK users
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Mask của MVP là một rectangle cố định theo series. Giá trị dùng tọa độ normalized
`0..1`; polygon/keyframe không thuộc schema hiện tại.

### 7.4 `voice_profiles` (`CORE`)

```text
id                    uuid v7 PK
name                  text
language              text
status                DRAFT | READY | BLOCKED_LICENSE | ARCHIVED
license_kind          text nullable
commercial_use_allowed boolean
notes                 text nullable
created_by            uuid FK users
created_at            timestamptz
updated_at            timestamptz
version               integer
```

License gate là field nghiệp vụ, không chỉ note. Worker chỉ nhận voice `READY` và
phù hợp policy môi trường.

### 7.5 `cast_sheets`, `cast_sheet_entries` (`CORE`)

```text
cast_sheets
  id                  uuid v7 PK
  series_profile_id   uuid FK UNIQUE
  status              DRAFT | APPROVED | NEEDS_REVIEW
  approved_by         uuid nullable FK users
  approved_at         timestamptz nullable
  version             integer
  created_at          timestamptz
  updated_at          timestamptz

cast_sheet_entries
  id                  uuid v7 PK
  cast_sheet_id       uuid FK
  character_key       text
  display_name        text
  aliases             text[]
  role_kind           NARRATOR | CHARACTER | OTHER
  voice_profile_id    uuid FK
  notes               text nullable
  created_at          timestamptz
  updated_at          timestamptz
  version             integer
  UNIQUE(cast_sheet_id, character_key)
```

Segment revision lưu trực tiếp `cast_sheet_entry_id` và `voice_profile_id` để lịch
sử không thay đổi khi cast sheet được sửa. Không tạo `cast_sheet_revisions` trong
MVP; audit event và snapshot của pipeline job là lịch sử cần giữ.

## 8. Asset registry và video library

### 8.1 `assets` (`CORE`)

```text
id                    uuid v7 PK
storage_backend       LOCAL | R2 | S3
bucket                text nullable
object_key            text
status                PENDING | AVAILABLE | DELETING | DELETED | FAILED
checksum_sha256       text nullable
byte_size             bigint nullable
content_type          text nullable
duration_ms           integer nullable
width                 integer nullable
height                integer nullable
created_by_attempt_id uuid nullable FK task_attempts
uploaded_at           timestamptz nullable
verified_at           timestamptz nullable
delete_after          timestamptz nullable
deleted_at            timestamptz nullable
metadata              jsonb
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Constraint:

```text
UNIQUE(storage_backend, bucket, object_key)
INDEX(status, delete_after)
```

Object key là immutable. Ghi đè cùng key bị cấm; revision tạo key mới. Asset chỉ
`AVAILABLE` sau HEAD/checksum verification.

### 8.2 Asset link tables (`CORE`)

```text
video_assets
  id                  uuid v7 PK
  video_id            uuid FK
  asset_id            uuid FK
  kind                RAW | DESUBBED | OCR_JSON | ASR_JSON | TRANSCRIPT_JSON |
                      BACKGROUND_AUDIO | VOCALS | PREVIEW | OUTPUT_VIDEO |
                      OUTPUT_SUBTITLE | THUMBNAIL | LOG | OTHER
  variant_key         text             -- source, 16x9, 9x16, segment:42...
  revision            integer
  is_current          boolean
  created_at          timestamptz
  UNIQUE(video_id, kind, variant_key, revision)

channel_profile_assets
  channel_profile_id  uuid FK
  asset_id            uuid FK
  role                INTRO | OUTRO | LOGO | WATERMARK
  revision            integer
  is_current          boolean

voice_profile_assets
  voice_profile_id    uuid FK
  asset_id            uuid FK
  role                REFERENCE_AUDIO | REFERENCE_TEXT | VOICE_PROMPT
  language            text nullable
  revision            integer
  is_current          boolean
```

Partial unique index bảo đảm tối đa một `is_current=true` cho mỗi owner/role/
variant. Prisma migration cần raw SQL cho các partial index này.

### 8.3 `videos` (`CORE`)

```text
id                    uuid v7 PK
source_content_id     uuid FK source_contents
channel_profile_id    uuid FK
series_profile_id     uuid nullable FK
status                INGEST_QUEUED | INGESTING | INGESTED | PROCESSING |
                      AWAITING_REVIEW | READY_TO_PUBLISH | PUBLISHED |
                      FAILED | ARCHIVED
source_language       text
target_language       text
display_title         text nullable
ingested_at           timestamptz nullable
archived_at           timestamptz nullable
created_by            uuid FK users
created_at            timestamptz
updated_at            timestamptz
version               integer
UNIQUE(source_content_id, channel_profile_id)
```

Cùng nguồn có thể được dùng cho nhiều channel profile, nhưng trong một channel chỉ
có một Video aggregate. Reprocess tạo `pipeline_job` mới trên cùng `videos` row,
không nhân đôi Library item. Nếu sau này sản phẩm cần nhiều edition độc lập cho
cùng source/channel, bổ sung `edition_key` vào unique key sau khi chốt semantics.

### 8.4 `video_highlights` (`CORE`)

```text
id                    uuid v7 PK
video_id              uuid FK
label                 text nullable
start_ms              integer
end_ms                integer
output_aspect_ratio   text             -- 9:16 hoặc custom ratio
crop_configuration    jsonb
status                DRAFT | APPROVED | ARCHIVED
created_by            uuid FK users
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Một video có nhiều highlight. UI MVP có thể chỉ tạo một highlight 9:16, nhưng DB
không áp unique theo `video_id`. Có check `start_ms >= 0` và `end_ms > start_ms`.
Crop configuration được snapshot tiếp vào render job để sửa highlight không làm
thay đổi job cũ.

### 8.5 `render_outputs` (`CORE`)

```text
id                    uuid v7 PK
video_id              uuid FK
pipeline_job_id       uuid FK
variant               FULL_16X9 | HIGHLIGHT_9X16 | CUSTOM
revision              integer
video_asset_id        uuid FK assets
subtitle_asset_id     uuid FK assets
thumbnail_asset_id    uuid nullable FK assets
highlight_id          uuid nullable FK video_highlights
status                DRAFT | READY | APPROVED | SUPERSEDED
approved_by           uuid nullable FK users
approved_at           timestamptz nullable
created_at            timestamptz
UNIQUE(video_id, variant, revision)
```

Table này giữ cặp MP4/SRT đúng basename và cho publishing task tham chiếu một
output có nghĩa nghiệp vụ, thay vì tự ghép hai `video_assets` bằng convention.

### 8.6 Cleanup (`LIKELY`)

```text
asset_cleanup_runs
  id, video_id, status, policy_snapshot, requested_by,
  started_at, finished_at, error_safe

asset_cleanup_items
  cleanup_run_id, asset_id, decision, reason,
  object_deleted_at, verified_at
```

Cleanup chỉ được tạo khi mọi publication task bắt buộc đạt điều kiện. SRT và text
asset được exclude theo policy snapshot. Không xóa trực tiếp từ HTTP request.

## 9. Pipeline queue và transaction lease

### 9.1 `pipeline_jobs` (`CORE`)

```text
id                    uuid v7 PK
video_id              uuid FK
kind                  INGEST | FULL_PIPELINE | RERENDER | REGENERATE_CONTENT
status                QUEUED | RUNNING | WAITING_FOR_GPU | WAITING_FOR_REVIEW |
                      SUCCEEDED | FAILED | CANCELLED
pipeline_version      text
profile_snapshot      jsonb
requested_outputs     jsonb
priority              integer
created_by            uuid nullable FK users
started_at            timestamptz nullable
finished_at           timestamptz nullable
failure_code          text nullable
failure_detail_safe   text nullable
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Một job snapshot profile/series/cast/pipeline configuration lúc tạo. Không đọc
profile mutable để quyết định retry của job cũ.

### 9.2 `pipeline_tasks` (`CORE`)

```text
id                    uuid v7 PK
pipeline_job_id       uuid FK
task_type             DOWNLOAD | DESUB | TRANSCRIBE_OCR | TRANSCRIBE_ASR |
                      MERGE_TRANSCRIPT | TRANSLATE | ASSIGN_CAST |
                      GENERATE_INITIAL_TTS | WAIT_FOR_REVIEW |
                      REGENERATE_SEGMENT | SEPARATE_AUDIO | RENDER |
                      EXPORT_SRT | UPLOAD_OUTPUTS | GENERATE_PUBLISH_PACKAGE
resource_class        IO | CPU | GPU_BATCH | GPU_TTS_INTERACTIVE |
                      CONTROL_PLANE | HUMAN_REVIEW
status                BLOCKED | READY | LEASED | RUNNING | WAITING |
                      SUCCEEDED | FAILED | CANCELLED
priority              integer
ready_at              timestamptz nullable
attempt_count         integer
max_attempts          integer
input_manifest        jsonb
configuration         jsonb
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Queue index:

```text
INDEX(status, resource_class, priority DESC, ready_at, id)
INDEX(pipeline_job_id, status)
```

TTS dùng granularity hybrid:

```text
task_segment_inputs
  pipeline_task_id      uuid FK
  segment_revision_id   uuid FK
  ordinal               integer
  PK(pipeline_task_id, segment_revision_id)
  UNIQUE(pipeline_task_id, ordinal)
```

- `GENERATE_INITIAL_TTS` chia các segment revision thành batch nhỏ theo giới hạn
  số segment và tổng thời lượng dự kiến trong configuration snapshot.
- `REGENERATE_SEGMENT` có đúng một `task_segment_inputs` row và dùng resource
  class `GPU_TTS_INTERACTIVE`.
- Input luôn trỏ tới revision bất biến, không đọc `current_revision_id` lại khi
  retry. Repository kiểm tra mọi input thuộc cùng video/job.
- Task batch chỉ `SUCCEEDED` khi có output hợp lệ cho mọi input. Output vẫn là
  từng `segment_audio_revisions`, không tạo audio blob chung cho cả batch.

Không lưu danh sách segment chỉ trong JSONB vì đây là quan hệ cần FK, retry và
lineage. Ngưỡng batch là cấu hình vận hành, không hard-code thành constraint DB.

### 9.3 Dependencies (`CORE`)

```text
task_dependencies
  predecessor_task_id uuid FK
  successor_task_id   uuid FK
  dependency_kind     SUCCESS_REQUIRED | TERMINAL_REQUIRED
  PK(predecessor_task_id, successor_task_id)
```

Không cho self-edge. Cycle được chặn trong application khi tạo DAG. Có thể bổ sung
`remaining_dependencies` denormalized sau benchmark; chưa tạo ở migration đầu.

### 9.4 Attempts và leases (`CORE`)

```text
task_attempts
  id                    uuid v7 PK
  pipeline_task_id      uuid FK
  attempt_number        integer
  executor_kind         CONTROL_PLANE | WORKER
  executor_instance_id  text
  worker_session_id     uuid nullable FK
  status                STARTED | SUCCEEDED | FAILED | TIMED_OUT | CANCELLED
  started_at            timestamptz
  finished_at           timestamptz nullable
  queue_wait_ms         bigint nullable
  download_ms           bigint nullable
  model_load_ms         bigint nullable
  execution_ms          bigint nullable
  upload_ms             bigint nullable
  gpu_active_ms         bigint nullable
  peak_vram_mb          integer nullable
  input_bytes           bigint nullable
  output_bytes          bigint nullable
  exit_code             integer nullable
  error_code            text nullable
  error_detail_safe     text nullable
  metrics               jsonb
  UNIQUE(pipeline_task_id, attempt_number)

task_leases
  id                    uuid v7 PK
  pipeline_task_id      uuid FK
  task_attempt_id       uuid FK
  executor_kind         CONTROL_PLANE | WORKER
  executor_instance_id  text
  worker_session_id     uuid nullable FK
  fencing_token         bigint
  leased_at             timestamptz
  renewed_at            timestamptz
  expires_at            timestamptz
  released_at           timestamptz nullable
  release_reason        text nullable
  UNIQUE(pipeline_task_id, fencing_token)
```

`worker_session_id` bắt buộc khi `executor_kind=WORKER` và phải `NULL` với internal
runner; `executor_instance_id` định danh process/container thực thi. Lưu trực tiếp
`pipeline_task_id` trên lease để partial unique index bảo đảm tối đa một lease chưa
release cho mỗi task mà không cần join. Claim task dùng transaction +
`FOR UPDATE SKIP LOCKED`. Complete/fail bắt buộc gửi fencing token hiện hành;
attempt cũ không được commit output sau retry.

### 9.5 `workflow_events` (`CORE`)

```text
id                    uuid v7 PK
video_id              uuid nullable FK
pipeline_job_id       uuid nullable FK
pipeline_task_id      uuid nullable FK
event_type            text
from_status           text nullable
to_status             text nullable
actor_type            text
actor_id              uuid nullable
payload_safe          jsonb
occurred_at           timestamptz
```

Đây là state-transition history, khác `audit_events` là security/user audit.

## 10. Transcript, segment và Studio

### 10.1 Hai tầng segment

OCR và ASR phải được so sánh, nên không ghi trực tiếp output đầu tiên vào canonical
segment. Dùng hai tầng:

```text
transcript_runs -> transcript_segments     # candidate/provenance
video_segments -> segment_revisions        # canonical editable script
```

### 10.2 `transcript_runs`, `transcript_segments` (`CORE`)

```text
transcript_runs
  id                    uuid v7 PK
  video_id              uuid FK
  method                OCR | ASR | MERGED | MANUAL_IMPORT
  status                RUNNING | SUCCEEDED | FAILED | SELECTED
  language              text
  model_name            text nullable
  model_version         text nullable
  task_attempt_id       uuid nullable FK
  average_confidence    numeric nullable
  raw_asset_id          uuid nullable FK assets
  selected_at           timestamptz nullable
  created_at            timestamptz

transcript_segments
  id                    uuid v7 PK
  transcript_run_id     uuid FK
  ordinal               integer
  start_ms              integer
  end_ms                integer
  text                  text
  confidence            numeric nullable
  bbox                   jsonb nullable
  metadata              jsonb
  UNIQUE(transcript_run_id, ordinal)
```

Check `start_ms >= 0`, `end_ms > start_ms`. Overlap có thể hợp lệ, không chặn bằng
constraint trước khi so sánh OCR/ASR.

### 10.3 `video_segments`, `segment_revisions` (`CORE`)

```text
video_segments
  id                    uuid v7 PK
  video_id              uuid FK
  ordinal               integer
  source_start_ms       integer
  source_end_ms         integer
  source_segment_id     uuid nullable FK transcript_segments
  current_revision_id   uuid nullable
  created_at            timestamptz
  UNIQUE(video_id, ordinal)

segment_revisions
  id                    uuid v7 PK
  video_segment_id      uuid FK
  revision              integer
  source_text           text
  translated_text       text
  cast_sheet_entry_id   uuid nullable FK
  voice_profile_id      uuid FK
  target_start_ms       integer
  target_end_ms         integer
  speech_rate           numeric(5,3)
  status                DRAFT | APPROVED | SUPERSEDED
  edit_reason           text nullable
  created_by            uuid nullable FK users
  created_at            timestamptz
  UNIQUE(video_segment_id, revision)
```

`current_revision_id` phải trỏ về revision cùng segment; application/repository
kiểm tra trong transaction. Không update text revision cũ.

### 10.4 `segment_audio_revisions` (`CORE`)

```text
id                    uuid v7 PK
video_segment_id      uuid FK
segment_revision_id   uuid FK
asset_id              uuid FK assets
task_attempt_id       uuid nullable FK
revision              integer
model_name            text
model_version         text
target_duration_ms    integer
actual_duration_ms    integer nullable
atempo_factor         numeric(6,4) nullable
status                GENERATING | READY | SELECTED | REJECTED | FAILED
created_at            timestamptz
UNIQUE(segment_revision_id, revision)
```

Partial unique index cho tối đa một audio `SELECTED` trên mỗi canonical segment,
không chỉ trên mỗi text revision: `UNIQUE(video_segment_id) WHERE
status='SELECTED'`. Repository phải kiểm tra `segment_revision_id` thuộc đúng
`video_segment_id` trong cùng transaction.

### 10.5 `review_decisions` (`CORE`)

```text
id                    uuid v7 PK
video_id              uuid FK
pipeline_job_id       uuid nullable FK
scope                 CAST | SCRIPT | TTS | RENDER | PUBLISH_CONTENT
subject_version       text
decision              APPROVED | CHANGES_REQUESTED | REJECTED
note                  text nullable
decided_by            uuid FK users
decided_at            timestamptz
```

Approval luôn gắn version/snapshot. Sửa segment sau approval làm review tương ứng
stale và workflow quay lại review.

## 11. Workers, image và billing

### 11.1 `workers` (`CORE`)

```text
id                    uuid v7 PK
display_name          text
role                  BATCH_MEDIA | INTERACTIVE_TTS
provider              text
provider_instance_id  text nullable
mode                  MANUAL_REGISTERED | API_PROVISIONED
desired_status        ACTIVE | DRAINING | REVOKED
observed_status       PENDING | READY | BUSY | DRAINING | SAFE_TO_TERMINATE |
                      OFFLINE | TERMINATED | ERROR
expected_gpu_model    text nullable
expected_vram_mb      integer nullable
approved_image_id     uuid nullable FK
created_by            uuid FK users
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Observed status có thể materialize để UI nhanh nhưng chỉ Worker Agent/monitor use
case được cập nhật.

### 11.2 `worker_sessions` (`CORE`)

```text
id                    uuid v7 PK
worker_id             uuid FK
session_nonce         text UNIQUE
image_id              uuid FK approved_worker_images
image_digest          text
agent_version         text
gpu_inventory         jsonb
cpu_inventory         jsonb
capacity              jsonb
started_at            timestamptz
last_heartbeat_at     timestamptz
draining_at           timestamptz nullable
ended_at              timestamptz nullable
end_reason            text nullable
current_task_count    integer
```

Heartbeat update row này. Không insert một row mỗi 30 giây ở MVP.

### 11.3 Enrollment và image (`CORE`)

```text
worker_enrollment_tokens
  id, worker_id, token_hash, expires_at, consumed_at, revoked_at, created_at

approved_worker_images
  id, role, semantic_version, image_digest, registry_ref,
  status, approved_by, approved_at, created_at
  UNIQUE(role, image_digest)
```

### 11.4 `worker_billing_sessions` (`CORE`)

```text
id                    uuid v7 PK
worker_id             uuid FK
worker_session_id     uuid nullable FK
provider              text
provider_instance_id  text nullable
hourly_rate_cp        numeric(20,6)
paid_vnd_per_cp       numeric(20,8) nullable
billing_started_at    timestamptz
billing_ended_at      timestamptz nullable
termination_confirmed_by uuid nullable FK users
termination_confirmed_at timestamptz nullable
estimated_cost_cp     numeric(24,6) nullable
created_at            timestamptz
```

Đơn giá là snapshot; sửa worker không đổi lịch sử. CP là đơn vị riêng, không đặt
currency `VND` nếu chưa có `paid_vnd_per_cp`.

### 11.5 `performance_profiles` (`LIKELY`)

Key theo provider, GPU model/count, role, image digest, stage, model version,
resolution bucket, batch/concurrency. Value gồm peak VRAM, wall/GPU time,
throughput, failure rate, sample count, approved status. Chỉ tạo sau benchmark
schema đầu tiên để không đo sai đơn vị.

## 12. Content Agent và publishing

### 12.1 `publish_packages` (`CORE`)

```text
id                    uuid v7 PK
video_id              uuid FK
channel_profile_id    uuid FK
status                DRAFT | GENERATED | APPROVED | SUPERSEDED
context_snapshot      jsonb
revision              integer
created_by            uuid nullable FK users
created_at            timestamptz
updated_at            timestamptz
version               integer
UNIQUE(video_id, revision)
```

Context snapshot chứa source metadata, SRT/checksum, thumbnail asset, profile
version và platform rules version đã dùng; không chứa binary.

### 12.2 `publication_tasks` (`CORE`)

```text
id                    uuid v7 PK
publish_package_id    uuid FK
destination_id        uuid FK publishing_destinations
render_output_id      uuid FK
status                READY_FOR_CONTENT | CONTENT_GENERATED |
                      CONTENT_APPROVED | READY_TO_PUBLISH |
                      POSTING_MANUAL | PUBLISHED | VERIFIED |
                      NEEDS_REVISION | CANCELLED
is_required           boolean
scheduled_at          timestamptz nullable
deadline_at           timestamptz nullable
assigned_to           uuid nullable FK users
notes                 text nullable
published_at          timestamptz nullable
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Một YouTube task thành công không đổi Facebook task. Unique active task theo
package + destination + render output. Video được xác định qua `publish_packages`;
không lặp `video_id` trên task để tránh hai FK bị lệch nhau.

### 12.3 Field history (`CORE`)

```text
publication_fields
  id                    uuid v7 PK
  publication_task_id   uuid FK
  field_key             text
  is_locked             boolean
  current_revision_id   uuid nullable
  version               integer
  UNIQUE(publication_task_id, field_key)

publication_field_revisions
  id                    uuid v7 PK
  publication_field_id  uuid FK
  revision              integer
  value_text             text
  origin                 GENERATED | USER_EDITED | REGENERATED
  generation_run_id      uuid nullable FK ai_generation_runs
  created_by             uuid nullable FK users
  created_at             timestamptz
  UNIQUE(publication_field_id, revision)
```

`field_key` là application-managed catalogue theo platform. Tách field/revision để
lock, regenerate và history từng trường; không lưu toàn bộ package trong một JSONB
mutable.

### 12.4 Checklist và proof

```text
publication_checklist_items
  id                    uuid v7 PK
  publication_task_id   uuid FK
  item_key              text
  label_snapshot        text
  is_required           boolean
  status                PENDING | COMPLETED | SKIPPED
  completed_by          uuid nullable FK users
  completed_at          timestamptz nullable
  ordinal               integer
  UNIQUE(publication_task_id, item_key)

publication_proofs
  id                    uuid v7 PK
  publication_task_id   uuid FK
  attempt_number        integer
  platform_post_id      text nullable
  public_url            text nullable
  submitted_by          uuid nullable FK users
  submitted_at          timestamptz
  verification_status   PENDING | VERIFIED | FAILED
  verified_at           timestamptz nullable
  verification_detail_safe text nullable
  UNIQUE(publication_task_id, attempt_number)
```

Mỗi lần submit hoặc verify lại tạo một proof attempt; không ghi đè bằng chứng cũ.
Repository kiểm tra ít nhất một trong `platform_post_id`, `public_url` có giá trị
và chỉ proof `VERIFIED` mới được dùng để hoàn tất publication task.

### 12.5 `ai_generation_runs` (`LIKELY`)

```text
id                    uuid v7 PK
purpose               TRANSLATION | CAST_ASSIGNMENT | HIGHLIGHT |
                      PUBLISH_CONTENT | FIELD_REGENERATION
video_id              uuid nullable FK
pipeline_task_id      uuid nullable FK
provider              text
model                 text
prompt_template_version text
prompt_hash           text
input_tokens          bigint nullable
output_tokens         bigint nullable
estimated_cost        numeric nullable
latency_ms            bigint nullable
status                SUCCEEDED | FAILED
error_code            text nullable
created_at            timestamptz
```

Không lưu API key. Raw prompt/response chỉ lưu khi policy riêng cho phép; mặc định
lưu hash + structured output đã thuộc domain.

## 13. Notifications và durable events

`outbox_messages` là `CORE` từ Workflow slice vì scheduler, worker và SSE có thể
chạy khác process:

```text
id                    uuid v7 PK
aggregate_type        text
aggregate_id          uuid
event_type            text
payload_safe          jsonb
occurred_at           timestamptz
available_at          timestamptz
attempt_count         integer
locked_by             text nullable
locked_until          timestamptz nullable
published_at          timestamptz nullable
last_error_safe       text nullable
created_at            timestamptz
```

Domain mutation và outbox insert nằm trong cùng transaction. Consumer claim bằng
lease ngắn, retry idempotent và chỉ đặt `published_at` sau khi giao thành công.
Index chính: `(published_at, available_at, id)` cho row chưa publish và
`(locked_until)` cho recovery.

MVP chỉ dùng toast/SSE transient; REST/DB vẫn là nguồn chuẩn. Không tạo
`notifications` hoặc read/unread state cho tới khi sản phẩm bổ sung notification
center thật.

## 14. Constraint và index quan trọng

### 14.1 Unique/idempotency

- `(platform, external_id)` trên source creator/content.
- `(discovery_run_id, source_content_id)` trên discovery item.
- `(source_content_id, channel_profile_id)` trên video.
- một active ingest job/video bằng partial index.
- một current asset/owner/kind/variant bằng partial index.
- một active task lease/task bằng partial index.
- một selected TTS audio/canonical segment bằng partial index.
- một active publication task/package/destination/output.
- idempotency scope/caller/key hash.

### 14.2 Queue

```text
pipeline_tasks(status, resource_class, priority DESC, ready_at, id)
task_leases(expires_at) WHERE released_at IS NULL
worker_sessions(last_heartbeat_at) WHERE ended_at IS NULL
pipeline_jobs(status, priority DESC, created_at)
```

### 14.3 UI/query

```text
videos(status, updated_at DESC, id)
video_segments(video_id, ordinal)
publication_tasks(status, scheduled_at, deadline_at)
watchlists(status, next_run_at)
assets(status, delete_after)
```

### 14.4 Append-only/time series

`audit_events`, `workflow_events`, `content_metric_snapshots`, `source_raw_events`
có index timestamp và FK lookup. Chưa partition ở ngày đầu. Chỉ partition sau khi
đo volume/retention và có query plan chứng minh cần thiết.

## 15. Transaction boundaries

### 15.1 Discovery page

Một page network đã tải xong mới mở transaction: raw event → creator/content →
metrics/media relations → discovery items → run cursor/count. Không giữ transaction
trong lúc browser chờ mạng.

### 15.2 Chọn ingest

Upsert `videos` theo `(source_content_id, channel_profile_id)`, sau đó tạo
idempotency record + ingest job/task DAG trong một transaction. Partial unique
index trên `pipeline_jobs(video_id)` chặn nhiều ingest job active; nếu đã có một
job như vậy, trả resource hiện tại thay vì tạo trùng.

### 15.3 Claim lease

Chọn READY task, kiểm tra dependency/capability, tạo attempt + lease, đổi status
trong một transaction với row lock. Worker complete phải xác nhận fencing token và
asset checksum trước khi task thành công.

### 15.4 Edit segment

Insert `segment_revision`, update `current_revision_id`, đánh dấu audio/review cũ
stale và enqueue re-gen trong một transaction. Không update revision cũ.

### 15.5 Approve render/publish

Review decision luôn tham chiếu subject version. Nếu version đã đổi, transaction
fail `VERSION_CONFLICT`.

### 15.6 Cleanup

Transaction DB chỉ lập kế hoạch và mark assets `DELETING`. Object deletion xảy ra
ngoài transaction; runner verify rồi mark `DELETED`. Retry phải idempotent.

## 16. Projection và dữ liệu dẫn xuất

Không tạo table chỉ để cache UI trước khi có vấn đề đo được.

- Video list status có thể materialize ở `videos.status` vì đó là aggregate state.
- “Đã ingest” không lưu ở `source_contents`; join/projection từ video/job/assets.
- Worker cost estimate tính từ billing session; snapshot/allocation chỉ lưu khi
  công thức đã chốt.
- Latest metrics dùng lateral query/index hoặc view; materialized view chỉ sau khi
  volume lớn.
- Queue counts/dashboard KPI dùng query/cache, không tạo counter table ban đầu.

## 17. Retention và backup

| Dữ liệu | Chính sách khởi điểm |
| --- | --- |
| Domain text/profile/segments/cast/publishing | Giữ dài hạn |
| PostgreSQL backup | Hằng ngày lên R2, restore drill định kỳ |
| Raw source events | 14 ngày |
| Metrics snapshots | Raw 90 ngày, sau đó cân nhắc rollup |
| Workflow/audit events | Tối thiểu 1 năm hoặc theo policy vận hành |
| Task logs | Theo debug retention; log asset không giữ vĩnh viễn mặc định |
| Heavy media | Xóa sau khi mọi publication task bắt buộc đủ điều kiện |
| SRT/text outputs | Giữ dài hạn |
| Revoked credentials | Purge theo security policy |

Retention cuối cùng phải thuộc profile/policy snapshot và cleanup audit, không dựa
vào cron xóa object theo prefix mù.

## 18. Thứ tự migration theo vertical slice

### Slice DB-1 — Discovery

`users` tối thiểu, source account/credential, creator/content/category, run/item,
watchlist, idempotency và audit. Không tạo workflow/media tables chưa dùng.

### Slice DB-2 — Ingest và library

Profiles tối thiểu, `assets`, `videos`, `video_assets`, ingest job/task/attempt/
lease/dependency, workflow events và durable outbox.

### Slice DB-3 — Worker runtime

Workers, sessions, enrollment, approved images, billing sessions và worker API
idempotency.

### Slice DB-4 — Transcript/Studio

Transcript runs/segments, canonical segments/revisions, voice/cast, segment audio
và review decisions.

### Slice DB-5 — Render/output

Highlights, render outputs, asset lineage và render approvals.

### Slice DB-6 — Publishing/retention

Destinations, publish packages/tasks/fields/checklist/proof và cleanup run/items.
Không tạo publishing credential hoặc notification center trong MVP.

Mỗi slice có migration, repository integration test, seed fixture nhỏ và rollback
strategy riêng. Không tạo một “initial schema” chứa mọi bảng trống.

## 19. Decision log và những điểm cần kiểm chứng

### 19.1 Quyết định đã chốt

| Gate | Quyết định | Ngày chốt | Hệ quả schema |
| --- | --- | --- | --- |
| `DB-01` | Hệ thống `single-workspace` | 2026-09-19 | Không tạo `workspaces`, `workspace_members` hoặc `workspace_id` trên mọi aggregate |
| `DB-02` | MVP không có login | 2026-09-19 | Seed một owner/operator; hoãn `auth_identities`, `user_sessions` |
| `DB-03` | Mask là rectangle cố định theo series | 2026-09-19 | Dùng bốn tọa độ normalized; không tạo polygon/keyframe tables |
| `DB-04` | Không rollback toàn bộ cast sheet | 2026-09-19 | Mutable entries + audit + job snapshot; không tạo `cast_sheet_revisions` |
| `DB-05` | TTS hybrid: initial chạy batch nhỏ, Studio re-gen chạy từng segment | 2026-09-19 | Tạo `task_segment_inputs`; batch policy nằm trong configuration snapshot, output vẫn tách theo segment |
| `DB-06` | DB chỉ lưu OCR/ASR ở sentence/segment level | 2026-09-19 | Word timing/bbox nằm trong raw artifact; hoãn `segment_alignment_details` |
| `DB-07` | Một video hỗ trợ nhiều highlight/output | 2026-09-19 | `video_highlights` và `render_outputs` là one-to-many; UI MVP có thể chỉ tạo một 9:16 |
| `DB-08` | Dùng durable outbox từ Workflow slice | 2026-09-19 | `outbox_messages` là `CORE`; insert cùng transaction domain |
| `DB-09` | MVP chỉ dùng toast/SSE transient | 2026-09-19 | Không tạo `notifications` hoặc read/unread state |
| `DB-10` | Giữ nhiều publication proof/verification attempt | 2026-09-19 | `publication_proofs` là `CORE`, append attempt thay vì ghi đè |
| `DB-11` | Lưu source cookie trong PostgreSQL dưới dạng AEAD ciphertext | 2026-09-19 | Tạo `source_credentials`; master key nằm ngoài PostgreSQL, không trả ciphertext qua API |
| `DB-12` | Chỉ lưu worker cost metrics thô, chưa phân bổ | 2026-09-19 | Hoãn `worker_cost_allocations`; không khóa công thức wall/GPU time |
| `DB-13` | PostgreSQL chỉ giữ latest heartbeat | 2026-09-19 | Time-series dùng external metrics; hoãn `worker_metric_samples` |
| `DB-14` | Platform/checklist rules nằm trong code/config có version | 2026-09-19 | Hoãn `platform_rule_versions`, `checklist_templates`; snapshot version vào package |
| `DB-15` | Douyin production gồm Jingxuan/category/course/creator | 2026-09-19 | Search/mix tiếp tục experimental; core schema chỉ giữ provider cursor/raw code opaque |
| `DB-16` | Cho phép asset dùng chung qua registry và typed links | 2026-09-19 | Một `assets` registry; không dùng polymorphic owner hoặc nhân bản binary |
| `DB-17` | OAuth publishing credential mã hóa trong PostgreSQL nếu tính năng được bổ sung | 2026-09-19 | Giữ `publishing_credentials` ở `HOLD`; khi triển khai dùng AEAD ciphertext và master key ngoài DB |
| `DB-18` | Single workspace chỉ có một owner/operator trong MVP | 2026-09-19 | Không tạo role/RBAC hoặc API quản trị user ở schema đầu |

### 19.2 Việc còn phải kiểm chứng kỹ thuật

Không còn product/DB gate nào đang chờ quyết định. Những việc sau vẫn phải đo hoặc
smoke-test trước slice tương ứng nhưng không khóa schema core:

- benchmark để đặt ngưỡng segment/thời lượng của TTS batch;
- live smoke test và captcha rate cho Douyin search/mix trước khi bỏ nhãn
  experimental;
- đo query volume trước khi partition metrics/audit hoặc tạo materialized view;
- xác nhận hệ thống metrics ngoài PostgreSQL trước khi vận hành worker production;
- restore drill và đo retention/object volume trước khi chốt policy production.

## 20. Acceptance criteria của thiết kế DB

1. Không có binary, plaintext credential hoặc signed URL bền vững trong DB.
2. Mỗi trạng thái mutable quan trọng có optimistic version hoặc transaction guard.
3. Job/task/attempt/lease tách riêng và có fencing chống late worker commit.
4. OCR/ASR candidate không ghi đè canonical script.
5. Segment edit và TTS audio có revision history, approval gắn version.
6. Asset chỉ usable sau checksum verification và cleanup có audit/idempotency.
7. Publishing tách task theo destination; field edit/regenerate có lịch sử riêng.
8. Worker price/image/hardware dùng snapshot để lịch sử không đổi.
9. Dedupe discovery và ingest có unique/partial index ở DB, không chỉ kiểm tra app.
10. Bảng `HOLD` không xuất hiện trong migration trước khi capability tương ứng
    được đưa vào scope và review lại thiết kế.
