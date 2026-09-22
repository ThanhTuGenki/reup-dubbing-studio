# Manual Publishing — package, task, content, checklist và proof

- **Trạng thái:** `ACCEPTED` cho MVP Web + API.
- **Nguồn chuẩn cho:** aggregate Publishing, lifecycle task, schema MVP, API
  boundary và điều kiện hoàn tất việc đăng thủ công.
- **Không phải nguồn chuẩn cho:** OpenAPI đã generate, Prisma migration đã chạy,
  automated uploader, OAuth/token, Worker implementation hoặc cleanup executor.
- **Thay thế:** chi tiết Publishing ở `database-design.md` §12 khi có khác biệt;
  giữ `product/design.md` làm nguồn chuẩn cho mục tiêu sản phẩm.
- **Được thay thế bởi:** —

## 1. Phạm vi và quyết định

Publishing trong MVP là workspace bàn giao và theo dõi thao tác thủ công:

- app chuẩn bị metadata, file tải xuống, checklist, lịch và proof;
- người vận hành tự upload bằng tài khoản YouTube/Facebook của họ;
- app không giữ OAuth/token, không gọi API publish và không dùng Postiz;
- mỗi destination là một task độc lập; hoàn tất YouTube không tự hoàn tất
  Facebook;
- Web dùng shadcn-first; prototype archived chỉ tham khảo hierarchy và hành vi;
- OpenAPI là nguồn chuẩn duy nhất của wire contract. Web dùng client/type generate,
  không định nghĩa lại response model theo feature.

Hệ thống đang single-workspace, không login và chỉ có một owner/operator. Vì vậy
MVP không hiển thị directory nhiều assignee như prototype cũ. `assignedTo` được
API gán owner hệ thống hiện tại; schema giữ nullable FK để không khóa đường nâng
cấp multi-user sau này.

## 2. Aggregate và ownership

```text
Video ──1:N── PublishPackage revision
                    │
                    └──1:N── PublicationTask (destination + render output)
                                  ├──1:N── PublicationField ──1:N── FieldRevision
                                  ├──1:N── ChecklistItem
                                  └──1:N── PublicationProof
```

- `PublishPackage` chụp context dùng để sinh nội dung cho một Video. Một Video chỉ
  có tối đa một package chưa `SUPERSEDED`.
- `PublicationTask` chụp destination, output và required flag tại lúc tạo. Đổi
  tên/archive destination sau đó không sửa lịch sử task.
- `PublicationField` là identity ổn định của một field; mọi giá trị nằm trong
  revision append-only. Sửa/tạo lại không ghi đè revision cũ.
- `ChecklistItem` là snapshot từ catalogue trong code có version, không đọc live
  template mutable.
- `PublicationProof` append-only; submit hoặc verify lại không ghi đè proof cũ.

Package và task không chứa signed URL, object key, bucket, credential hoặc token.
Asset download luôn dùng grant ngắn hạn theo resource cụ thể.

## 3. Catalogue MVP

Field bắt buộc theo platform:

| Platform | Field keys |
| --- | --- |
| YouTube | `title`, `description`, `keywords`, `hashtags`, `thumbnailText`, `thumbnailPrompt` |
| Facebook | `caption`, `hashtags`, `thumbnailText`, `thumbnailPrompt` |

Checklist được snapshot với `itemKey`, label, ordinal và `isRequired`. Catalogue
ban đầu gồm `uploadVideo`, `uploadSubtitle`, `attachThumbnail`, `copyMetadata`,
`configurePlatform`, `setVisibilityOrSchedule`, `previewBeforePublish`.
Application có thể đánh dấu item không áp dụng là optional; item required không
được chuyển sang `SKIPPED`.

Rules dùng identifier version trong code/config, ví dụ
`manual-publishing-rules-v1`. Không tạo `checklist_templates` hoặc
`platform_rule_versions` trong MVP.

## 4. Lifecycle

Canonical task status:

```text
READY_FOR_CONTENT
  → CONTENT_GENERATED
  → CONTENT_APPROVED
  → READY_TO_PUBLISH
  → POSTING_MANUAL
  → PUBLISHED
  → VERIFIED

CONTENT_GENERATED | CONTENT_APPROVED | READY_TO_PUBLISH | POSTING_MANUAL
  → NEEDS_REVISION → CONTENT_GENERATED

mọi trạng thái chưa publish → CANCELLED
```

`scheduledAt` là dữ liệu lập kế hoạch, không phải status. Không thêm
`SCHEDULED_MANUAL` chỉ để phục vụ filter UI.

- `CONTENT_GENERATED`: mọi field bắt buộc có current revision.
- `CONTENT_APPROVED`: gate `PUBLISH_CONTENT` đã thỏa cho subject version hiện tại.
- `READY_TO_PUBLISH`: content approved, output/asset cần thiết còn `AVAILABLE` và
  checklist đã được tạo đầy đủ.
- `POSTING_MANUAL`: operator chủ động đánh dấu đã bắt đầu thao tác ngoài hệ thống.
- `PUBLISHED`: checklist required hoàn tất và có proof hợp lệ.
- `VERIFIED`: operator xác minh proof hiện hành. MVP là xác minh tay; read-only
  platform verification có thể bổ sung sau.
- `NEEDS_REVISION`: giữ lịch sử nhưng làm approval cũ stale; sửa xong phải duyệt
  lại trước khi publish.

Task `PUBLISHED`/`VERIFIED` bị freeze. Muốn sửa content phải chuyển
`NEEDS_REVISION`, tạo field revision mới và đi lại gate; proof cũ vẫn được giữ.

Package status là projection:

- `DRAFT`: chưa đủ field của các task active;
- `GENERATED`: các task active đã sinh đủ content;
- `APPROVED`: mọi task required đã thỏa `PUBLISH_CONTENT` gate;
- `SUPERSEDED`: một package revision mới đã thay package này.

## 5. Review gate và subject version

Gate được đánh giá theo từng task vì YouTube và Facebook có bộ field độc lập.
Subject version không dùng timestamp hoặc task version đơn lẻ mà dùng chuỗi ổn
định từ task ID, package revision và current field revision IDs:

```text
publication-task:{taskId}:package:{packageRevision}:fields:{sha256}
```

- `MANUAL_REQUIRED`: cần `APPROVED` decision scope `PUBLISH_CONTENT` khớp subject.
- `NOT_REQUIRED`: API chuyển qua approval gate mà không tạo decision giả.
- thêm/sửa/regenerate field hoặc đổi render output làm subject mới và decision cũ
  stale;
- thay lịch, deadline, note hoặc checklist progress không làm content approval
  stale;
- lock field chỉ chặn edit/regenerate, không đồng nghĩa approve.

## 6. Schema MVP

```text
publish_packages
  id, video_id, channel_profile_id, status, context_snapshot,
  rules_version, revision, created_by, created_at, updated_at, version
  UNIQUE(video_id, revision)
  UNIQUE(video_id) WHERE status <> 'SUPERSEDED'

publication_tasks
  id, publish_package_id, destination_id, render_output_id,
  destination_snapshot, status, is_required, scheduled_at, deadline_at,
  assigned_to, notes, published_at, created_at, updated_at, version
  UNIQUE(publish_package_id, destination_id, render_output_id)

publication_fields
  id, publication_task_id, field_key, is_locked, current_revision_id, version
  UNIQUE(publication_task_id, field_key)

publication_field_revisions
  id, publication_field_id, revision, value_text,
  origin (GENERATED | USER_EDITED | REGENERATED), generation_run_id,
  created_by, created_at
  UNIQUE(publication_field_id, revision)

publication_checklist_items
  id, publication_task_id, item_key, label_snapshot, is_required,
  status (PENDING | COMPLETED | SKIPPED), completed_by, completed_at, ordinal
  UNIQUE(publication_task_id, item_key)

publication_proofs
  id, publication_task_id, attempt_number, platform_post_id, public_url,
  content_snapshot, submitted_by, submitted_at,
  verification_status (PENDING | VERIFIED | FAILED),
  verified_at, verification_detail_safe
  UNIQUE(publication_task_id, attempt_number)
```

`destinationSnapshot` chỉ chứa platform, external ID nullable và display name.
`contextSnapshot` chứa source metadata an toàn, profile/policy version, selected
render output revisions, SRT/thumbnail checksum và rules version; không chứa
binary hoặc storage identity. `contentSnapshot` chụp final field values/revision
IDs tại lần submit để proof vẫn tự mô tả khi task được đưa qua revision mới.

FK delete dùng `RESTRICT` cho package/task/proof history. Child field revision và
checklist chỉ cascade nếu task chưa từng publish và aggregate được xóa trong cùng
transaction; API MVP không cung cấp hard-delete.

## 7. API boundary dự kiến

```text
GET    /v1/publication-tasks
POST   /v1/videos/{videoId}/publish-packages
GET    /v1/publish-packages/{publishPackageId}
GET    /v1/publication-tasks/{publicationTaskId}

POST   /v1/publication-tasks/{publicationTaskId}/generate-content
PATCH  /v1/publication-tasks/{publicationTaskId}/fields/{fieldKey}
POST   /v1/publication-tasks/{publicationTaskId}/fields/{fieldKey}/regenerate
PATCH  /v1/publication-tasks/{publicationTaskId}/fields/{fieldKey}/lock
POST   /v1/publication-tasks/{publicationTaskId}/approve-content

PATCH  /v1/publication-tasks/{publicationTaskId}/plan
PATCH  /v1/publication-tasks/{publicationTaskId}/checklist/{itemKey}
POST   /v1/publication-tasks/{publicationTaskId}/start-manual-posting
POST   /v1/publication-tasks/{publicationTaskId}/proofs
POST   /v1/publication-tasks/{publicationTaskId}/proofs/{proofId}/verify
POST   /v1/publication-tasks/{publicationTaskId}/request-revision

POST   /v1/publication-tasks/{publicationTaskId}/assets/{assetRole}/download-grant
```

Create package nhận danh sách `{ destinationId, renderOutputId }`; API không tự
đoán aspect ratio theo platform. Nó xác minh destination active/thuộc Channel và
render output approved/thuộc Video, rồi snapshot `isRequired` từ destination.

List hỗ trợ cursor và filter `status`, `platform`, `destinationId`, `scheduled`,
`overdue`, `videoId`. Detail trả package, task, fields/current revisions,
checklist, latest proof, sibling tasks của cùng package và asset availability.

Mọi mutation aggregate dùng strong `If-Match`; thay đổi child increment task
version trong cùng transaction. Create/generate/regenerate/approve/transition/
proof/verify dùng `Idempotency-Key`. Lỗi ổn định tối thiểu:

- `PUBLICATION_TASK_NOT_FOUND`
- `PUBLICATION_VERSION_CONFLICT`
- `PUBLICATION_INVALID_TRANSITION`
- `PUBLICATION_CONTENT_INCOMPLETE`
- `PUBLICATION_CONTENT_APPROVAL_REQUIRED`
- `PUBLICATION_CHECKLIST_INCOMPLETE`
- `PUBLICATION_PROOF_REQUIRED`
- `PUBLICATION_ASSET_UNAVAILABLE`
- `PUBLICATION_DESTINATION_INACTIVE`
- `PUBLICATION_FIELD_LOCKED`

Content generation/regeneration là tác vụ ngắn do Control Plane gọi Content Agent
đã cấu hình; không thêm GPU Worker. Giá trị secret không vào job payload, log,
response hoặc generation history.

REST/DB là nguồn chuẩn. SSE chỉ phát invalidation event theo task/package ID; Web
refetch query sau event và polling là fallback.

## 8. Validation và transaction boundary

- Package chỉ tạo cho Video có ít nhất một approved render output và Channel còn
  active; mỗi task phải trỏ đúng Video/Channel.
- Field key phải thuộc catalogue platform; field required không được rỗng.
- Save/regenerate content luôn tạo revision mới, cập nhật pointer và làm stale
  approval trong cùng transaction.
- `PUBLISHED` cần content gate hợp lệ, mọi checklist required `COMPLETED`, ít nhất
  một trong `publicUrl`/`platformPostId`, và output asset vẫn available.
- URL nếu có phải `https`; platform post ID được trim, giới hạn độ dài và không
  được chứa credential/query secret. API không fetch URL trong MVP.
- Verify chỉ áp dụng latest `PENDING` proof và ghi audit event. Muốn verify lại
  sau `FAILED`, operator submit một proof attempt mới; attempt trước không bị ghi
  đè. `FAILED` đưa task về `NEEDS_REVISION` hoặc giữ `PUBLISHED` với lỗi an toàn
  theo action người vận hành.
- Chỉ khi mọi task required của active package `VERIFIED` thì publication
  projection của Video là `FULLY_PUBLISHED`; một phần là `PARTIALLY_PUBLISHED`.
  Khi đầy đủ, Video có thể chuyển `PUBLISHED` trong cùng transaction.
- Cleanup chỉ đọc projection này; không xóa asset trong HTTP transaction.

## 9. Acceptance boundary

- tạo package/task idempotently và reject destination/output lệch aggregate;
- field revision/lock/regenerate không ghi đè history và làm approval stale;
- `PUBLISH_CONTENT` gate được áp theo effective Review Policy snapshot;
- list/calendar filter đúng timezone `Asia/Ho_Chi_Minh`, nhưng DB/API dùng UTC;
- không thể publish khi thiếu field, checklist, proof hoặc asset;
- nhiều proof attempt được giữ; verify task này không hoàn tất sibling task;
- detail/download không rò object key, bucket, signed URL dài hạn hoặc credential;
- Web có dirty-state guard, copy field, accessible keyboard flow và không tràn
  ngang ở mobile;
- không triển khai Worker hoặc automated social uploader trong feature này.
