# Review policy — inheritance, approval gates và workflow snapshot

- **Trạng thái:** `ACCEPTED` cho MVP Web + API.
- **Nguồn chuẩn cho:** ownership/inheritance của review policy, gate semantics,
  validation dependency và thời điểm snapshot policy vào workflow.
- **Không phải nguồn chuẩn cho:** OpenAPI đã generate, Prisma migration đã chạy,
  Worker implementation hoặc Publishing feature.
- **Thay thế:** —
- **Được thay thế bởi:** —

## Quyết định

Review policy là cấu hình riêng có version, không gộp vào `review_decisions` và
không đọc live từ profile khi một job đang chạy. Channel sở hữu policy nền;
Series chỉ lưu override nullable từng field. Policy effective được resolve theo
từng field, tương tự pipeline config hiện tại:

```text
Channel policy (đầy đủ) + Series overrides (nullable) → Effective policy
                                                   ↓
                                  immutable workflow snapshot
```

MVP dùng hai mode gate:

- `MANUAL_REQUIRED`: phải có `APPROVED` decision đúng scope và đúng
  `subjectVersion` hiện tại;
- `NOT_REQUIRED`: workflow bỏ qua approval gate nhưng vẫn phải thỏa invariant
  kỹ thuật, readiness và license.

Không tạo `AUTO_APPROVED` giả danh người dùng. Tự động hóa trong MVP chỉ là
`autoRequestRender`: sau khi toàn bộ pre-render gate cần thiết đã được approve và
không còn decision stale/blocking, Control Plane có thể tạo render request
idempotently. API chỉ tạo job/task; không triển khai Worker.

## Các gate

| Scope | Bảo vệ | Mặc định khuyến nghị | Khi stale/blocking |
| --- | --- | --- | --- |
| `CAST` | character → voice mapping/cast sheet | `MANUAL_REQUIRED` với `multi-auto`, còn lại `NOT_REQUIRED` | đổi cast/voice hoặc cast-sheet version |
| `SCRIPT` | canonical translated segments | `MANUAL_REQUIRED` | sửa text/timing/revision |
| `TTS` | audio được chọn cho mọi segment | `MANUAL_REQUIRED` | đổi revision, voice, selected audio hoặc TTS output |
| `RENDER` | output render cụ thể | `MANUAL_REQUIRED` | render revision/output mới |
| `PUBLISH_CONTENT` | title/caption/checklist của publish package | `MANUAL_REQUIRED` | deferred đến Publishing; enum/schema được chuẩn bị ở API slice |

`CHANGES_REQUESTED` và `REJECTED` luôn chặn gate cùng scope và mọi action downstream
phụ thuộc vào scope đó. `APPROVED` chỉ hợp lệ khi `subjectVersion` khớp subject
hiện tại; decision cũ được giữ audit nhưng không còn thỏa gate.

## Model persistence đề xuất

Tạo resource `review_policies` riêng để policy có optimistic concurrency độc lập
với các field profile khác:

```text
id                       uuid v7 PK
channel_profile_id       uuid nullable unique FK
series_profile_id        uuid nullable unique FK
cast_gate                 MANUAL_REQUIRED | NOT_REQUIRED | null
script_gate               MANUAL_REQUIRED | NOT_REQUIRED | null
tts_gate                  MANUAL_REQUIRED | NOT_REQUIRED | null
render_gate               MANUAL_REQUIRED | NOT_REQUIRED | null
publish_content_gate      MANUAL_REQUIRED | NOT_REQUIRED | null
auto_request_render       boolean nullable
version                   integer >= 1
created_at, updated_at    timestamptz
```

Database check bắt buộc đúng một owner. Policy Channel phải có đủ field;
policy Series cho phép `null` để inherit. Series không có row vẫn inherit toàn bộ
Channel. Xóa/archive profile không xóa policy/audit đang được snapshot trong job.

Policy snapshot lưu trong `pipeline_jobs.profile_snapshot.reviewPolicy`:

```json
{
  "schemaVersion": 1,
  "channelPolicyVersion": 3,
  "seriesPolicyVersion": 2,
  "effective": {
    "castGate": "MANUAL_REQUIRED",
    "scriptGate": "MANUAL_REQUIRED",
    "ttsGate": "MANUAL_REQUIRED",
    "renderGate": "MANUAL_REQUIRED",
    "publishContentGate": "MANUAL_REQUIRED",
    "autoRequestRender": false
  }
}
```

Snapshot được tạo cùng transaction khi tạo pipeline job. Update policy không
rewrite job, task, video hoặc snapshot đang tồn tại. Job mới sau update dùng
effective policy mới.

## API boundary cho slice kế tiếp

```text
GET   /v1/channel-profiles/{channelProfileId}/review-policy
PATCH /v1/channel-profiles/{channelProfileId}/review-policy
GET   /v1/series-profiles/{seriesProfileId}/review-policy
PATCH /v1/series-profiles/{seriesProfileId}/review-policy
```

GET trả `stored`, `effective`, nguồn inheritance từng field, version của policy
owner và parent Channel version. PATCH chỉ nhận field thuộc owner; dùng strong
`If-Match` và `Idempotency-Key`. Series dùng `null` để quay về inherit. Stale
owner/parent version trả `412 VERSION_CONFLICT`; validation dependency trả problem
code ổn định, không để Prisma error lọt ra wire contract.

API đọc Studio/Queue có thể trả gate projection từ snapshot để Web giải thích vì
sao action đang bị khóa. REST/DB là nguồn chuẩn; SSE chỉ invalidate query.

## Validation và dependency

- Channel policy không được có field nullable.
- Series override phải resolve cùng Channel đang active; parent version là một
  phần của concurrency token.
- `CAST=NOT_REQUIRED` không bỏ qua kiểm tra voice readiness/license. Với
  `multi-auto`, UI/API cảnh báo mạnh và mặc định giữ `MANUAL_REQUIRED`; cho phép
  bỏ gate chỉ bằng thay đổi policy có chủ đích.
- `TTS=NOT_REQUIRED` không cho render nếu thiếu selected/ready audio.
- `autoRequestRender=true` chỉ enqueue khi mọi pre-render gate effective đã
  pass, không có decision blocking, video version còn khớp và chưa có active
  render job. Idempotency scope gồm video ID + subject version + policy snapshot.
- `RENDER` là hậu kiểm output; không được dùng để quyết định có tạo render job
  hay không.
- `PUBLISH_CONTENT` chưa kích hoạt action cho tới khi Publishing contract được
  triển khai.

## Acceptance boundary

- Web hiển thị stored/effective value và nguồn `CHANNEL`/`SERIES` cho từng field;
- mô tả tác động trước khi bật auto render hoặc bỏ gate;
- unsaved state, version conflict và reset-to-inherit không làm mất draft;
- integration test chứng minh update policy không đổi snapshot/job đang chạy,
  còn job tạo sau update nhận snapshot mới;
- không cần và không được thêm Worker code trong feature này.
