# Video Library — aggregate, trạng thái và read model

- **Trạng thái:** `ACCEPTED` cho slice Library Web + API
- **Cập nhật:** 2026-09-21
- **Nguồn chuẩn cho:** Video aggregate, output/asset projection, filter Library,
  detail response và download grant.
- **Ngoài phạm vi:** Studio segment/editor, tạo publish content, publication task,
  cleanup executor và implementation trong `workers/gpu`.
- **Tài liệu liên quan:** [`database-design.md`](database-design.md),
  [`queue-lifecycle.md`](queue-lifecycle.md),
  [`presigned-asset-flow.md`](presigned-asset-flow.md) và
  [`../product/design.md`](../product/design.md).

## 1. Quyết định chính

1. `Video` là aggregate nội bộ được tạo từ một `SourceContent` đã chọn. Cùng
   source có thể vào nhiều Channel Profile; unique hiện tại
   `(source_content_id, channel_profile_id)` tiếp tục được giữ.
2. Reprocess/rerender tạo `PipelineJob` mới trên cùng Video, không tạo Library
   row mới.
3. `Video.status` chỉ mô tả lifecycle kỹ thuật tổng quát. Review, output và
   publishing là các projection độc lập; không nhét “đã đăng một phần” hoặc
   “cần sửa nội dung” vào `VideoStatus`.
4. List/detail chỉ trả metadata asset an toàn. Object key, bucket, signed URL và
   storage credential không xuất hiện trong Library response.
5. Download/preview dùng grant ngắn hạn theo resource cụ thể. URL chỉ tồn tại
   trong response của request grant, không persist hoặc đưa vào cache dài hạn.
6. Library chỉ đọc publication projection khi feature Publishing tồn tại. Slice
   này không tạo bảng publication tạm hoặc suy đoán trạng thái đăng từ Video.

## 2. Aggregate và ownership

```text
SourceContent ──1:N── Video ──1:N── PipelineJob
                         │
                         ├──1:N── VideoAsset ──N:1── Asset
                         └──1:N── RenderOutput ──► video/subtitle/thumbnail Asset
```

### `Video` sở hữu

- source/profile identity;
- source/target language và display title;
- lifecycle status, archive state và optimistic `version`;
- liên kết tới jobs, typed assets và render outputs.

### `Asset` sở hữu

- immutable storage identity và checksum;
- metadata file: tên, MIME, byte size, duration, dimensions;
- availability/cleanup lifecycle.

### `VideoAsset` sở hữu

- ý nghĩa của asset trong một Video: kind, variant, revision, current flag;
- không sở hữu binary và không thay đổi object key.

### `RenderOutput` sở hữu

- một output nghiệp vụ có thể bàn giao: variant + revision;
- cặp video/subtitle bắt buộc và thumbnail tùy chọn;
- trạng thái duyệt của revision.

Không ghép MP4 và SRT ở Web bằng basename hoặc convention. API trả
`RenderOutput` đã ghép bằng FK.

## 3. Lifecycle và projection

### 3.1 Canonical `VideoStatus`

```text
INGEST_QUEUED → INGESTING → INGESTED → PROCESSING → AWAITING_REVIEW
                                      └────────────→ FAILED
AWAITING_REVIEW → PROCESSING | READY_TO_PUBLISH
READY_TO_PUBLISH → PROCESSING | PUBLISHED
PUBLISHED → PROCESSING
mọi trạng thái terminal/không active → ARCHIVED
```

Ý nghĩa:

| Status | Ý nghĩa |
| --- | --- |
| `INGEST_QUEUED` | Video record đã có, download job chưa bắt đầu |
| `INGESTING` | Đang lấy/verify source asset |
| `INGESTED` | Source asset đã sẵn sàng, chưa chạy full pipeline |
| `PROCESSING` | Có pipeline/rerender job đang chạy |
| `AWAITING_REVIEW` | Pipeline đang chờ quyết định của người dùng |
| `READY_TO_PUBLISH` | Có output đã duyệt và đủ điều kiện bàn giao |
| `PUBLISHED` | Publication projection xác nhận mọi task bắt buộc đã hoàn tất |
| `FAILED` | Latest blocking job thất bại và chưa có job active thay thế |
| `ARCHIVED` | Ẩn khỏi vận hành mặc định; metadata vẫn được giữ |

Queue/orchestrator cập nhật Video và ghi workflow event trong cùng transaction với
terminal transition có liên quan. Web không gửi status tùy ý. Archive là mutation
riêng dùng `If-Match` và chỉ được phép khi không có job active.

### 3.2 Facet hiển thị, không phải VideoStatus

Library trả các facet độc lập:

```text
processing: latestJob status/progress/currentTask/failure
review:     NOT_REQUIRED | PENDING | CHANGES_REQUESTED | APPROVED
output:     NONE | PARTIAL | READY | CLEANED
publishing: NOT_AVAILABLE trong slice này; feature Publishing bổ sung projection
```

Mapping prototype:

| Prototype | Projection chuẩn |
| --- | --- |
| `WAITING_FOR_REVIEW` | `video.status=AWAITING_REVIEW`, `review=PENDING` |
| `NEEDS_REVISION` | `video.status=AWAITING_REVIEW`, `review=CHANGES_REQUESTED` |
| `READY_FOR_MANUAL_PUBLISHING` | `video.status=READY_TO_PUBLISH`, output `READY` |
| `PARTIALLY_PUBLISHED` | publication aggregate về sau; không thêm vào VideoStatus |
| `FULLY_PUBLISHED` | `video.status=PUBLISHED` sau khi mọi task bắt buộc verified |

### 3.3 Output readiness

- `NONE`: chưa có current `RenderOutput` hay current output asset.
- `PARTIAL`: có asset/output revision nhưng thiếu required variant, asset chưa
  `AVAILABLE`, hoặc validation chưa đạt.
- `READY`: mọi required variant trong snapshot job có current approved output;
  video/subtitle bắt buộc đều `AVAILABLE`.
- `CLEANED`: output metadata vẫn còn nhưng heavy video asset đã `DELETED` theo
  cleanup policy; SRT/text metadata vẫn truy vấn được.

`requiredVariants` lấy từ requested output snapshot của job thắng gần nhất,
không đọc live Profile để tránh Profile đổi làm Video cũ bỗng thiếu output.

## 4. Schema cần hoàn thiện trong slice API

Schema hiện tại đã có `videos` và `assets`, nhưng chưa có typed link/output tables
và một số metadata retention. Migration Library bổ sung:

```text
video_assets
  id, video_id, asset_id
  kind: RAW | DESUBBED | OCR_JSON | ASR_JSON | TRANSCRIPT_JSON |
        BACKGROUND_AUDIO | VOCALS | DUB_AUDIO | PREVIEW |
        OUTPUT_VIDEO | OUTPUT_SUBTITLE | THUMBNAIL | LOG | OTHER
  variant_key, revision, is_current, created_at
  UNIQUE(video_id, kind, variant_key, revision)
  partial UNIQUE(video_id, kind, variant_key) WHERE is_current

render_outputs
  id, video_id, pipeline_job_id
  variant: FULL_16X9 | HIGHLIGHT_9X16 | CUSTOM
  revision
  video_asset_id, subtitle_asset_id, thumbnail_asset_id nullable
  status: DRAFT | READY | APPROVED | SUPERSEDED
  approved_by nullable, approved_at nullable, created_at
  UNIQUE(video_id, variant, revision)
  partial UNIQUE(video_id, variant) WHERE status = 'APPROVED'
```

`assets` bổ sung `duration_ms`, `created_by_attempt_id`, `delete_after` và
`deleted_at`. Không xóa row/link khi object được cleanup; chuyển asset sang
`DELETED` để giữ lineage, file metadata và lịch sử revision.

`video_highlights`, review tables và publication tables chỉ thêm trong feature sở
hữu tương ứng. `HIGHLIGHT_9X16` có thể tồn tại chưa gắn highlight trong Library
MVP; Studio sẽ bổ sung FK khi triển khai editor.

## 5. Read model API

### 5.1 List

```text
GET /v1/videos
  cursor, limit
  status[]
  platform
  channelProfileId
  seriesProfileId
  outputReadiness
  updatedFrom, updatedTo
  query
  includeArchived=false
```

- Sort ổn định: `updated_at DESC, id DESC`; cursor ký/encode cả hai field.
- `query` tìm `display_title`, source external ID và video UUID; trim, giới hạn
  120 ký tự, dùng index/search phù hợp thay vì load rồi lọc ở Web.
- Platform lấy từ `source_contents.platform`, không duplicate vào `videos`.
- Filter Profile dùng ID, không dùng tên/slug có thể đổi.
- MVP không có filter publication cho tới khi publication aggregate tồn tại.
- `limit` mặc định 20, tối đa 100.

List item gồm:

```text
id, version, displayTitle, status, sourceLanguage, targetLanguage
source { platform, externalId, canonicalUrl, durationMs, creatorName }
profile { channelProfileId/name, seriesProfileId/name }
latestJob { id, kind, status, progress, currentTask, failure, updatedAt } nullable
reviewStatus
outputSummary { readiness, requiredVariants, availableVariants, warnings }
thumbnail { assetId, status, contentType, width, height } nullable
createdAt, updatedAt, ingestedAt, archivedAt
```

List không trả mọi revision, object key, checksum đầy đủ hoặc download URL.

### 5.2 Detail

```text
GET /v1/videos/{videoId}
```

Ngoài list fields, detail trả:

- source metadata an toàn;
- job summary gần nhất và link điều hướng Queue;
- current render outputs, validation/status và revision;
- typed current assets và retention metadata;
- workflow timeline an toàn;
- action capability: `canOpenStudio`, `canOpenPublishing`, `canArchive`.

Detail trả strong numeric `ETag` từ `video.version`. Timeline phân trang riêng nếu
vượt giới hạn; MVP detail lấy tối đa 50 event mới nhất.

### 5.3 Download/preview grant

```text
POST /v1/videos/{videoId}/assets/{videoAssetId}/grant
POST /v1/videos/{videoId}/outputs/{renderOutputId}/{part}/grant
part = video | subtitle | thumbnail
```

Request cần `Idempotency-Key` nhưng không cần `If-Match` vì không đổi aggregate.
Server kiểm tra link thật sự thuộc Video, asset `AVAILABLE`, chưa `DELETING` /
`DELETED`, rồi trả `method`, signed URL, expiry, file name, MIME và byte size.
Preview và download cùng capability; disposition có thể khác theo purpose.

Không có endpoint nhận asset ID tùy ý. Không log/persist URL hoặc response header
có credential. Web chỉ xin grant khi người dùng bấm xem/tải, mở ngay, rồi bỏ URL.

## 6. States và cảnh báo Web cần hỗ trợ

- loading, empty toàn thư viện, empty do filter và error/retry;
- desktop table, mobile card; không có horizontal page overflow;
- status luôn có text, không chỉ dùng màu;
- output warning do API trả code an toàn, ví dụ
  `MISSING_REQUIRED_VARIANT`, `SUBTITLE_UNAVAILABLE`, `HEAVY_ASSET_CLEANED`;
- asset `PENDING/FAILED/DELETING/DELETED` không có nút tải;
- route detail `/library/:videoId` deep-link được, không phụ thuộc row đã có trong
  cache;
- chỉ hiện “Mở Studio” hoặc “Mở Bàn đăng bài” từ capability API; các route chưa
  triển khai có thể disabled kèm giải thích, không giả action thành công.

Prototype có bulk assign, content package, publication state và cleanup action.
Các action đó thuộc Profile/Publishing/Cleanup feature sau; Library slice hiện tại
chỉ browse/detail/download và điều hướng.

## 7. Concurrency, pagination và security

- List là snapshot cursor, chấp nhận item đổi thứ tự giữa các page; client
  deduplicate theo Video ID.
- Archive/restore về sau dùng `If-Match` + idempotency; stale version trả
  `412 VERSION_CONFLICT`, Web refetch detail/list.
- API không trả raw task log, exception, environment, object key, bucket hoặc
  signed URL trong list/detail.
- Source canonical URL là metadata public; cover/source signed URL nếu có vẫn
  phải sanitize và refresh theo source policy.
- `byteSize` dùng string trong JSON để không mất chính xác bigint.
- Error theo Problem Details và request ID an toàn.

## 8. Kiểm thử bắt buộc cho các checkbox sau

- cursor ổn định, filter kết hợp, archived mặc định bị loại;
- empty/error recovery và detail deep-link;
- output readiness cho none/partial/ready/cleaned;
- asset ownership, unavailable asset và grant hết hạn;
- không có object key/signed URL trong list/detail/log;
- mobile 375px không tràn ngang và accessibility không có lỗi serious/critical.
