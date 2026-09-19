# Channel và Series Profiles

- **Trạng thái:** `ACCEPTED` cho MVP Web + API.
- **Cập nhật:** 2026-09-19.
- **Nguồn chuẩn cho:** ownership, inheritance, schema logic, lifecycle, readiness,
  effective configuration và REST contract của Channel/Series Profile.
- **Không phải nguồn chuẩn cho:** OpenAPI đã generate, implementation Prisma,
  Voice Library chi tiết, GPU Worker hoặc automated publishing.
- **Thay thế:** phần profile sơ bộ trong
  [`database-design.md`](database-design.md) khi hai tài liệu khác nhau.

## 1. Phạm vi và ownership

Channel Profile là bộ cấu hình đầy đủ có thể dùng trực tiếp cho video lẻ. Series
Profile luôn thuộc đúng một Channel Profile và chỉ lưu những giá trị ghi đè. API
resolve cấu hình hiệu lực; Web không tự merge hai resource.

Profile slice sở hữu:

- cấu hình subtitle, TTS/timing, output và Content Agent của channel;
- metadata destination cho quy trình đăng bài thủ công;
- intro, outro, logo và watermark của channel;
- voice mode, các override và mask xóa subtitle của series;
- reference frame của series dùng cho mask editor;
- cast sheet thuộc series, nhưng việc chọn voice chỉ khả dụng sau Voice Library.

Profile slice không sở hữu:

- retention: dùng singleton System Settings; không nhân đôi vào profile;
- credential YouTube/Facebook hoặc tự động publish;
- binary: profile chỉ liên kết tới shared `assets` registry;
- worker/runtime implementation.

Hệ thống là single-workspace, không login. Các bảng profile không có
`workspace_id` hoặc FK `created_by`; audit mutation dùng actor `SYSTEM` cho tới
khi một identity slice thực sự được triển khai.

## 2. Inheritance

| Nhóm | Channel | Series | Cấu hình hiệu lực |
| --- | --- | --- | --- |
| Ngôn ngữ đích | Bắt buộc | Có thể override | Series nếu khác `null`, ngược lại Channel |
| Subtitle language/rule/max line | Bắt buộc hoặc default typed | Có thể override | Merge từng field |
| Default voice | Có thể `null` | Có thể override | Series override hoặc Channel |
| TTS speed/timing policy | Bắt buộc | Có thể override | Merge từng field |
| Output 16:9/9:16 | Bắt buộc | Có thể override | Merge từng field |
| Content voice/CTA/template/keywords | Channel sở hữu | Không override trong MVP | Channel |
| Destination | Channel sở hữu | Không override | Channel |
| Intro/outro/logo/watermark | Channel sở hữu | Không override trong MVP | Channel |
| Voice mode | Có default | Có thể override | Series override hoặc Channel |
| Subtitle removal mask | Không có | Series sở hữu | Series hoặc không có |
| Cast sheet | Không có | Series sở hữu | Series |

`null` trên field override nghĩa là **kế thừa**. API PATCH phải phân biệt field
không được gửi với field được gửi bằng `null`. Không copy giá trị Channel vào row
Series và không tự rewrite Series khi Channel thay đổi.

Response detail trả đồng thời:

- `overrides`: đúng dữ liệu Series đang lưu, có thể `null`;
- `effectiveConfig`: cấu hình đã resolve dùng để preview hoặc tạo job;
- `inheritance`: map field path thành `CHANNEL` hoặc `SERIES`, giúp Web hiển thị
  “Kế thừa”/“Ghi đè” mà không tự suy luận.

## 3. Lifecycle và readiness

Lifecycle lưu trong DB: `DRAFT | ACTIVE | ARCHIVED`.

- `DRAFT`: sửa được, chưa được chọn để tạo job mới.
- `ACTIVE`: được chọn để tạo job nếu readiness đạt yêu cầu.
- `ARCHIVED`: không xuất hiện mặc định và không được chọn cho job mới; có thể
  restore về `DRAFT`.

Readiness không lưu boolean. API tính projection:

```text
READY | NEEDS_CONFIGURATION
```

và trả `readinessIssues: string[]` bằng code ổn định. MVP dùng ít nhất:

- `DEFAULT_VOICE_REQUIRED`
- `DEFAULT_VOICE_NOT_READY`
- `OUTPUT_REQUIRED`
- `MASK_REQUIRED`
- `MASK_REFERENCE_ASSET_REQUIRED`
- `CAST_REQUIRED`
- `CAST_VOICE_NOT_READY`

Channel cần ngôn ngữ, pipeline settings hợp lệ, ít nhất một output và voice sẵn
sàng trước khi `ACTIVE`. Series thừa hưởng readiness của parent; `DUAL` hoặc
`MULTI_AUTO` còn cần cast hợp lệ. Nếu Series cấu hình mask thì phải có đủ rectangle
và reference frame. Lifecycle và readiness là hai khái niệm riêng.

Voice Profile chưa được triển khai trong slice này, nên FK voice được phép `null`.
Profile có thể lưu `DRAFT`; activation phải trả lỗi an toàn nếu voice bắt buộc
đang thiếu hoặc chưa `READY`, không tạo dữ liệu voice giả.

## 4. PostgreSQL schema logic

### 4.1 `channel_profiles`

```text
id                           uuid v7 PK
name                         text
status                       DRAFT | ACTIVE | ARCHIVED
target_language              text
default_voice_profile_id     uuid nullable FK voice_profiles
default_voice_mode           SINGLE | DUAL | MULTI_AUTO
subtitle_language            text
subtitle_filename_rule       text
subtitle_max_line_length     integer nullable
tts_speed                    numeric(5,3)
timing_policy                PRESERVE_SEGMENT | FIT_SEGMENT | ALLOW_DRIFT
output_16x9_enabled          boolean
output_9x16_enabled          boolean
content_voice_rules          jsonb
content_cta_template         text nullable
content_metadata_template    jsonb
content_base_keywords        text[]
created_at                   timestamptz
updated_at                   timestamptz
version                      integer
```

Constraints:

- normalized, case-insensitive unique name trong các row chưa archived;
- BCP 47 language tag hợp lệ ở application boundary;
- `subtitle_max_line_length` trong `1..500` nếu có;
- `tts_speed` trong `0.5..2.0`;
- ít nhất một output khi activate.

Không có `retain_heavy_days`/`retain_text_days`; System Settings sở hữu retention.

### 4.2 `publishing_destinations`

```text
id                    uuid v7 PK
channel_profile_id    uuid FK channel_profiles
platform              YOUTUBE | FACEBOOK
external_id           text nullable
display_name          text
is_required           boolean
is_active             boolean
platform_config       jsonb
created_at            timestamptz
updated_at            timestamptz
version               integer
```

Destination chỉ giữ metadata phục vụ manual publishing. Không lưu OAuth token.
Unique identity là `(channel_profile_id, platform, external_id)` khi
`external_id` khác `null`; application chặn destination trùng display identity
khi external ID chưa biết.

### 4.3 `series_profiles`

```text
id                              uuid v7 PK
channel_profile_id              uuid FK channel_profiles
name                            text
status                          DRAFT | ACTIVE | ARCHIVED
target_language_override        text nullable
default_voice_profile_override_id uuid nullable FK voice_profiles
voice_mode_override             SINGLE | DUAL | MULTI_AUTO nullable
subtitle_language_override      text nullable
subtitle_filename_rule_override text nullable
subtitle_max_line_length_override integer nullable
tts_speed_override              numeric(5,3) nullable
timing_policy_override          PRESERVE_SEGMENT | FIT_SEGMENT | ALLOW_DRIFT nullable
output_16x9_override            boolean nullable
output_9x16_override            boolean nullable
mask_x                          numeric(9,8) nullable
mask_y                          numeric(9,8) nullable
mask_width                      numeric(9,8) nullable
mask_height                     numeric(9,8) nullable
created_at                      timestamptz
updated_at                      timestamptz
version                         integer
```

Unique name theo parent: normalized `(channel_profile_id, name)` trong các row
chưa archived. Parent không đổi sau khi tạo; muốn chuyển series sang channel khác
phải tạo series mới để tránh đổi nghĩa của job/history.

### 4.4 Mask

Mask là một rectangle cố định theo series, trong coordinate space normalized
`0..1`. Không lưu `mask_coordinate_space`, pixel, polygon hoặc keyframe trong MVP.

Database/application cùng enforce:

- cả bốn field cùng `null` hoặc cùng có giá trị;
- `x >= 0`, `y >= 0`, `width > 0`, `height > 0`;
- `x + width <= 1`, `y + height <= 1`.

Web hiển thị pixel bằng kích thước natural của reference frame nhưng luôn gửi
normalized decimal. Việc đổi reference frame không làm đổi rectangle.

### 4.5 Asset links

```text
channel_profile_assets
  id                  uuid v7 PK
  channel_profile_id  uuid FK
  asset_id            uuid FK assets
  role                INTRO | OUTRO | LOGO | WATERMARK
  revision            integer
  is_current          boolean
  created_at          timestamptz

series_profile_assets
  id                  uuid v7 PK
  series_profile_id   uuid FK
  asset_id            uuid FK assets
  role                MASK_REFERENCE_FRAME
  revision            integer
  is_current          boolean
  created_at          timestamptz
```

Partial unique index cho phép tối đa một `is_current=true` mỗi owner/role. Upload
dùng presigned asset flow chung; attach chỉ nhận asset `AVAILABLE`. Detach tạo
revision/link state mới hoặc bỏ `is_current`, không xóa object ngay.

### 4.6 Cast sheet

Mỗi Series có tối đa một `cast_sheets`; entries map character/alias tới
`voice_profile_id`. Schema ownership giữ như inventory DB hiện tại. CRUD cast có
thể xuất hiện trong Profile API nhưng activation phụ thuộc Voice Library. Không
tạo `cast_sheet_revisions`; audit và job snapshot đủ cho MVP.

## 5. Effective configuration và version

API resolve Channel trực tiếp hoặc merge Series override lên Channel. Kết quả là
một object typed đầy đủ, không còn semantic `null = inherit`.

Mỗi resource mutable dùng integer `version` và strong ETag. Update/archive/restore
yêu cầu `If-Match`. ETag detail của Series đại diện cho effective view và thay đổi
khi một trong các dependency thay đổi. Token được tạo ổn định từ:

```text
series.version + channel.version + current asset link versions
+ referenced voice/cast versions
```

Response vẫn trả `resourceVersion` riêng để client PATCH Series. Parent thay đổi
có thể làm Series query stale ngay cả khi row Series không đổi.

Khi tạo ingest/job, API phải resolve và validate lại trong transaction, sau đó
lưu snapshot đầy đủ tối thiểu gồm:

- profile/series IDs và versions;
- effective pipeline/subtitle/output/content config;
- mask normalized và reference asset identity;
- current profile asset IDs + immutable object/checksum identity;
- destination metadata cần cho publish package;
- voice/cast IDs và versions;
- retention policy/version từ System Settings.

Job cũ không đọc profile mutable để retry hoặc render lại.

## 6. REST contract đề xuất

OpenAPI được thêm cùng implementation ở checkbox API kế tiếp. Resource shape theo
convention chung: camelCase, problem details, cursor pagination, ETag,
`If-Match` và `Idempotency-Key` cho create/mutation retryable.

```text
GET    /v1/channel-profiles
POST   /v1/channel-profiles
GET    /v1/channel-profiles/{channelProfileId}
PATCH  /v1/channel-profiles/{channelProfileId}
POST   /v1/channel-profiles/{channelProfileId}/archive
POST   /v1/channel-profiles/{channelProfileId}/restore

GET    /v1/series-profiles
POST   /v1/series-profiles
GET    /v1/series-profiles/{seriesProfileId}
PATCH  /v1/series-profiles/{seriesProfileId}
POST   /v1/series-profiles/{seriesProfileId}/archive
POST   /v1/series-profiles/{seriesProfileId}/restore

POST   /v1/channel-profiles/{channelProfileId}/assets
DELETE /v1/channel-profiles/{channelProfileId}/assets/{linkId}
POST   /v1/series-profiles/{seriesProfileId}/assets
DELETE /v1/series-profiles/{seriesProfileId}/assets/{linkId}

GET    /v1/series-profiles/{seriesProfileId}/cast
PUT    /v1/series-profiles/{seriesProfileId}/cast
```

List filters tối thiểu: `status`, `readiness`, `query`; Series thêm
`channelProfileId`. Mặc định loại `ARCHIVED`. Archive Channel bị từ chối nếu còn
Series không archived; không cascade ngầm.

Mutation errors dùng code ổn định:

- `PROFILE_NAME_CONFLICT`
- `PROFILE_NOT_FOUND`
- `PROFILE_ARCHIVED`
- `PROFILE_NOT_READY`
- `PROFILE_HAS_ACTIVE_SERIES`
- `PROFILE_PARENT_ARCHIVED`
- `PROFILE_VERSION_CONFLICT`
- `PROFILE_ASSET_NOT_AVAILABLE`
- `PROFILE_ASSET_ROLE_INVALID`
- `PROFILE_MASK_INVALID`
- `PROFILE_CAST_INVALID`
- `PROFILE_VOICE_NOT_READY`

## 7. Web composition

Màn Profile có hai tab Channel/Series, filter riêng, list và detail drawer. Form
Channel chỉnh defaults theo nhóm; form Series luôn hiển thị giá trị hiệu lực và
control “kế thừa/ghi đè” trên từng field. Mask editor đọc natural dimensions từ
reference frame, hỗ trợ nhập số và kéo/resize rectangle, rồi lưu normalized.

Web dùng generated client + TanStack Query, không gọi API thủ công hoặc tự merge
inheritance. Mọi mutation xử lý `VERSION_CONFLICT` bằng refetch và yêu cầu người
dùng xác nhận lại thay đổi.

## 8. Deferred/HOLD

- nhiều mask, polygon, keyframe hoặc tracking mask;
- per-profile retention override;
- Series override Content Agent/destination/profile assets;
- automated publishing credential;
- chuyển parent của Series;
- full cast-sheet revision/rollback;
- multi-workspace, login, RBAC và user administration.
