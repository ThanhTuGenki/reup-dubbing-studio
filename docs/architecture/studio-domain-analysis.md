# Studio Editor — domain analysis and API boundary

- **Trạng thái:** `ACCEPTED` cho bước phân tích Studio Web + API.
- **Phạm vi:** đọc/sửa transcript canonical, gán cast/voice, preview TTS,
  regenerate segment, review decision và yêu cầu render. Không triển khai Worker.
- **Nguồn chuẩn:** `database-design.md` mục 7.5 và 10, `product/design.md` mục
  5.3–5.8; OpenDesign chỉ tham khảo bố cục/interaction.

## Flow chuẩn

```text
Video detail → chọn transcript run → canonical segments → edit revision
  → preview/re-generate audio → review CAST/SCRIPT/TTS
  → approve → render request → Queue/Library output
```

OCR và ASR là candidate provenance (`transcript_runs`/`transcript_segments`),
không ghi đè trực tiếp canonical. Mỗi edit thêm `segment_revision`; revision cũ
immutable. Audio TTS gắn với revision và asset registry, chỉ một audio `SELECTED`
trên canonical segment. Mọi approval tham chiếu `subject_version`; edit sau
approval làm decision stale và buộc review lại.

## Aggregate/schema cần dùng

- `cast_sheets`, `cast_sheet_entries`: cast mutable theo Series, version + audit;
  không tạo cast-sheet revision trong MVP.
- `transcript_runs`, `transcript_segments`: OCR/ASR/MERGED/MANUAL provenance,
  timestamp sentence-level.
- `video_segments`, `segment_revisions`: timeline ổn định, translated text,
  cast entry, voice, target timing, immutable revision.
- `segment_audio_revisions`: TTS model/version, target/actual duration,
  atempo, lifecycle `GENERATING → READY → SELECTED/REJECTED/FAILED`.
- `review_decisions`: scope `CAST | SCRIPT | TTS | RENDER`, decision, note,
  actor và subject version.
- Existing `PipelineJob/Task` nhận request render/re-generate; không đọc live
  profile sau khi job đã snapshot.

## API slice kế tiếp

```text
GET   /v1/videos/{videoId}/studio
PATCH /v1/videos/{videoId}/segments/{segmentId}
POST  /v1/videos/{videoId}/segments/{segmentId}/preview
POST  /v1/videos/{videoId}/segments/{segmentId}/regenerate
POST  /v1/videos/{videoId}/review-decisions
POST  /v1/videos/{videoId}/render-requests
```

Read response gồm source timeline, current revision, cast/voice summary, selected
audio metadata, review facets và capability. Mutations dùng `If-Match` video/studio
version + `Idempotency-Key`; stale subject version trả `412 VERSION_CONFLICT`.
Preview chỉ cấp grant khi user bấm nghe; URL không persist/log/cache. Regenerate
chỉ tạo task request, không chạy TTS trong API.

## Web acceptance boundary

- desktop: player + transcript table; mobile: stacked segment cards;
- dirty state hiển thị field-level; rời trang cần confirm;
- sửa text/cast/voice tách riêng, preview audio không tự động gọi URL;
- disabled action nếu capability/review state không cho phép;
- SSE/polling invalidates studio/query khi preview hoặc render đổi trạng thái.

## Deferred / cần quyết định khi implement

- waveform/word-level alignment và bbox OCR chưa cần cho sentence-level MVP;
- preview audio grant có disposition inline, TTL ngắn và resource scope;
- highlight 9:16 editor thuộc Studio nhưng FK `video_highlights` chỉ thêm khi
  task highlight được triển khai;
- chưa tạo schema publication/content package trong Studio slice.
