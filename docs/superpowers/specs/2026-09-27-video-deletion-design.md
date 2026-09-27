# Xóa video (hard delete hai pha)

- **Trạng thái:** `DRAFT`, chờ duyệt.
- **Ngày:** 2026-09-27.
- **Liên quan:** [`docs/architecture/video-library.md`](../../architecture/video-library.md),
  [`database-design.md`](../../architecture/database-design.md) §4.4, §8.6, §15.6, §17;
  [`queue-lifecycle.md`](../../architecture/queue-lifecycle.md);
  [`manual-publishing.md`](../../architecture/manual-publishing.md);
  [`presigned-asset-flow.md`](../../architecture/presigned-asset-flow.md).
- **Ngoài phạm vi:** archive/restore video; dọn file nặng tự động theo số ngày trong
  Settings (retention runner); xóa hồ sơ kênh, series hay giọng.

## 1. Mục tiêu

App cho phép thêm video nhưng không cho xóa, nên video test và video bỏ dở cứ tích tụ
trong Thư viện và trên R2. Sau thay đổi này, người vận hành có thể:

1. xóa hẳn một video từ trang Chi tiết video;
2. chọn nhiều video trong Thư viện rồi xóa cùng lúc;
3. thấy video biến mất khỏi Thư viện ngay khi bấm xóa, còn file trên R2 được dọn ở
   nền, kể cả khi R2 tạm lỗi.

Các quyết định đã chốt với chủ dự án:

- **Xóa hẳn**: bỏ mọi dòng DB và mọi object R2 thuộc video. Không giữ lại metadata
  hay SRT.
- Video **đang có job chạy** (`QUEUED`, `RUNNING`, `WAITING_FOR_GPU`,
  `WAITING_FOR_REVIEW`) sẽ **tự động bị hủy job** rồi mới xóa. Hộp xác nhận nói rõ
  điều này.
- Có nút xóa ở trang Chi tiết, và chọn nhiều để xóa ở trang Thư viện.

## 2. Ràng buộc từ hiện trạng

- Mọi khóa ngoại trong `schema.prisma` đều là `onDelete: Restrict`. Một video kéo
  theo cả một cây bảng con:
  - `VideoAsset`, `RenderOutput`;
  - `PublishPackage` → `PublicationTask` → field, revision, checklist, proof;
  - `TranscriptRun` → `TranscriptSegment`, `VideoSegment` → `SegmentRevision` →
    `SegmentAudioRevision`;
  - `ReviewDecision`;
  - `PipelineJob` → `PipelineTask` → `PipelineTaskDependency`, `TaskAttempt` →
    `TaskLease`;
  - `WorkflowEvent`.

  Việc xóa phải đi theo đúng thứ tự khóa ngoại và nằm trong một transaction.
- Nguyên tắc của tài liệu kiến trúc được giữ:
  - không xóa object R2 trong HTTP request (§8.6);
  - asset đi theo `AVAILABLE/PENDING → DELETING → DELETED` (§15.6);
  - không xóa theo prefix mù (§17): mọi object chỉ bị xóa theo đúng `bucket` và
    `objectKey` của từng dòng `Asset`.
- `PublicationProof` là audit trail, chỉ thêm, không xóa. Vì vậy **video đã có ít
  nhất một `PublicationProof` thì không được xóa**, và API trả
  `409 VIDEO_HAS_PUBLICATION_HISTORY`. Package, task và field nháp chưa có proof thì
  được xóa theo video.
- Bảng `Asset` còn chứa file thuộc aggregate khác: `VoiceProfileSample`,
  `ChannelProfileAsset`, `SeriesProfileAsset`. Một asset được tham chiếu từ các bảng
  đó **không bao giờ** bị xóa object hay xóa dòng, dù có một đường nào đó nối nó với
  video.
- Hủy job hiện được viết thẳng trong
  `PrismaQueueRepository.cancel(...)`
  (`apps/api/src/modules/queue/infrastructure/prisma-queue-repository.ts`): kết thúc
  task, nhả lease, chuyển attempt sang `CANCELLED`, ghi workflow event. Sau khi hủy,
  worker nhận `409 STALE_TASK_ATTEMPT` và không commit output nữa.
- URL upload được cấp trước lúc hủy vẫn có thể được dùng muộn:
  - URL upload của worker hết hạn cùng lease;
  - URL upload của import local sống `UPLOAD_TTL_SECONDS = 600`.

  Dòng `Asset` đã được tạo ở trạng thái `PENDING` ngay lúc cấp URL, nên đã biết trước
  `objectKey`.

## 3. Kiến trúc

```text
Web ──DELETE /v1/videos/{id}──────────► API (transaction)
    ──POST /v1/videos/deletions──────►   · chặn nếu có PublicationProof
                                         · hủy job active (hàm dùng chung với Queue)
                                         · video.status = DELETING, asset liên quan = DELETING
                                         · AuditEvent VIDEO_DELETION_REQUESTED
                                         → 202
VideoDeletionRunner (poll 2 s, trong process API)
    · claim 1 video DELETING (FOR UPDATE SKIP LOCKED, next_attempt_at <= now)
    · pha 1: xóa object R2 của asset DELETING đã từng AVAILABLE → asset DELETED
    · chờ hết grace nếu còn asset từng PENDING (upload đến muộn)
    · pha 2: xóa lại object của asset từng PENDING (idempotent)
    · pha 3: transaction xóa dòng DB theo thứ tự khóa ngoại + AuditEvent VIDEO_DELETED
    · lỗi → attempts+1, backoff; quá số lần → DELETE_FAILED
```

### 3.1 Schema (một migration)

- `VideoStatus` thêm `DELETING` và `DELETE_FAILED`.
- `videos` thêm các cột sau, đều `NULL`:
  - `deletion_requested_at timestamptz`;
  - `deletion_attempts int NOT NULL DEFAULT 0`;
  - `deletion_next_attempt_at timestamptz`;
  - `deletion_error_code text`;
  - `deletion_grace_until timestamptz`: thời điểm được phép quét lần cuối các asset từng
    `PENDING`.
- Index `videos (status, deletion_next_attempt_at)` để claim.

### 3.2 Xác định asset thuộc video

Tập asset của video `V` là hợp của:

1. `VideoAsset.assetId` với `VideoAsset.videoId = V`;
2. `SegmentAudioRevision.assetId` của các segment thuộc `V`;
3. `TranscriptRun.rawAssetId` của các run thuộc `V`;
4. `Asset.createdByAttemptId` thuộc attempt của các job thuộc `V`. Nhóm này gồm cả
   output `PENDING` chưa được link.

Trừ đi mọi asset được tham chiếu bởi `VoiceProfileSample`, `ChannelProfileAsset` hoặc
`SeriesProfileAsset`. Hàm `collectVideoAssetIds(tx, videoId)` được đặt trong
repository, và là **nguồn duy nhất** của tập này cho cả API lẫn runner.

### 3.3 API

- **`DELETE /v1/videos/{videoId}`**, bắt buộc `If-Match` (version của video) và
  `Idempotency-Key`.
  - Chạy trong transaction:
    1. Kiểm tra version. Sai thì trả `412 VIDEO_VERSION_CONFLICT`.
    2. Video đã `DELETING` thì trả lại kết quả cũ (idempotent). Video `DELETE_FAILED`
       thì cho yêu cầu lại: reset `attempts`, lên lịch ngay.
    3. Có `PublicationProof` thì trả `409 VIDEO_HAS_PUBLICATION_HISTORY`.
    4. Hủy mọi `PipelineJob` active của video bằng hàm dùng chung
       `cancelJobInTransaction(tx, jobId, reason: 'VIDEO_DELETED')`. Hàm này được tách
       từ `PrismaQueueRepository.cancel`, export qua `modules/queue/index.ts` (không
       import sâu vào infrastructure của Queue), và Queue dùng lại đúng hàm đó.
    5. Asset trong tập ở §3.2 đang `AVAILABLE`, `PENDING` hoặc `FAILED` chuyển sang
       `DELETING`. Metadata ghi lại trạng thái trước đó
       (`metadata.deletion.previousStatus`).
    6. Cập nhật video:
       - `status = DELETING`;
       - `deletion_requested_at = now`;
       - `deletion_next_attempt_at = now`;
       - nếu có asset từng `PENDING` hoặc vừa hủy job active:
         `deletion_grace_until = now + 15 phút`; nếu không: `deletion_grace_until = now`;
       - `version + 1`.
    7. Ghi `AuditEvent` `VIDEO_DELETION_REQUESTED`, kèm `metadataSafe` gồm tiêu đề,
       nguồn, số asset và danh sách job đã hủy.
  - Trả **`202`** với `VideoDeletionEnvelope`:
    `{ videoId, status: 'DELETING' | 'DELETE_FAILED', cancelledJobIds: string[] }`.
- **`POST /v1/videos/deletions`**, bắt buộc `Idempotency-Key`, body
  `{ items: [{ videoId, version }] }` với 1–100 item.
  - Mỗi item được xử lý như `DELETE` ở trên, trong transaction riêng, nên một item
    lỗi không làm hỏng item khác.
  - Trả `200` với `{ items: [{ videoId, result: 'ACCEPTED' | 'ALREADY_DELETING' |
    'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND', cancelledJobIds }] }`,
    theo đúng thứ tự request.
- **Đọc:**
  - `GET /v1/videos` loại video `DELETING` khỏi mặc định (như `ARCHIVED`). Video
    `DELETE_FAILED` **vẫn hiện**, kèm badge, để người vận hành thử lại.
  - `GET /v1/videos/{id}` trả video `DELETING` hoặc `DELETE_FAILED` bình thường cho
    tới khi dòng bị xóa; sau đó trả `404`.
  - `capabilities` thêm `canDelete`: `false` khi có `PublicationProof` hoặc video đang
    `DELETING`.
  - Grant tải hay xem trước của video `DELETING` trả `409 VIDEO_DELETING`.
- Contract: thêm path, schema `VideoDeletionEnvelope`, `VideoBulkDeletionRequest` và
  `VideoBulkDeletionResult`, problem code mới, `capabilities.canDelete`, các giá trị
  mới của `status` và field `deletion: { requestedAt, errorCode } | null` trong
  `Video`. Chạy `pnpm contract:generate`.

### 3.4 `VideoDeletionRunner`

- Nằm trong module mới `apps/api/src/modules/video-deletion` (controller cho hai
  endpoint ở §3.3, repository, runner, object store), và chạy cùng kiểu
  `ControlPlaneRunner`: `setInterval` 2 s, mỗi tick tối đa một video,
  không chạy khi `nodeEnv === 'test'`, test gọi `tick()` trực tiếp. `onModuleDestroy`
  chờ tick đang chạy xong.
- **Claim:**
  `SELECT … FROM videos WHERE status = 'DELETING' AND deletion_next_attempt_at <= now()
  ORDER BY deletion_requested_at LIMIT 1 FOR UPDATE SKIP LOCKED`, rồi đẩy
  `deletion_next_attempt_at` lên `now + 5 phút` như một lease mềm để không bị claim
  trùng.
- **Pha 1:** với mỗi asset `DELETING` có `previousStatus` là `AVAILABLE` hoặc
  `FAILED`, gọi `DeleteObject(bucket, objectKey)`. R2 trả 204 hoặc 404 đều coi là
  xong. Xong thì asset chuyển `DELETED`, `deletedAt = now`.
- **Pha 2:** chỉ chạy khi `now >= deletion_grace_until`. Xóa object của các asset từng
  `PENDING` (idempotent). Nếu chưa tới giờ thì trả video về `DELETING` với
  `deletion_next_attempt_at = deletion_grace_until`, rồi dừng tick.
- **Pha 3:** trong transaction, tính lại tập ở §3.2 để bắt asset phát sinh muộn (có
  thì quay lại pha 1 ở tick sau), rồi xóa dòng theo thứ tự:
  1. `TaskLease`, `TaskAttempt` (sau khi gỡ `Asset.createdByAttemptId` của asset
     không thuộc video, nếu có);
  2. `PipelineTaskDependency`, `PipelineTask`, `PipelineJob`, `WorkflowEvent`;
  3. publication nháp (checklist, field revision, field, task, package);
  4. `ReviewDecision`;
  5. `SegmentAudioRevision`, `SegmentRevision`, `VideoSegment`, `TranscriptSegment`,
     `TranscriptRun`;
  6. `RenderOutput`, `VideoAsset`;
  7. các dòng `Asset` thuộc tập;
  8. `Video`.

  Sau đó ghi `AuditEvent` `VIDEO_DELETED`, kèm `metadataSafe` gồm tiêu đề, số object
  đã xóa và tổng dung lượng.
- **Lỗi:** R2, mạng hoặc DB lỗi thì `deletion_attempts + 1`,
  `deletion_error_code = <mã an toàn>`, và `deletion_next_attempt_at = now + backoff`
  (1, 5, 15, 60 phút). Tới lần thứ 6 thì `status = DELETE_FAILED`. Log chỉ có id và
  mã lỗi, không có URL hay credential.
- R2 client dùng credential trong Settings giống các `R2*ObjectStore` khác. Thêm class
  `R2VideoDeletionObjectStore.deleteObject(bucket, key)`; đây là nơi duy nhất trong
  code gọi `DeleteObjectCommand` cho asset. Nếu Settings chưa cấu hình R2 thì lỗi
  `STORAGE_NOT_CONFIGURED` và backoff như trên.

### 3.5 Web

- **Trang Chi tiết video:**
  - Header có nút `destructive` **"Xóa video"**, chỉ hiện khi `capabilities.canDelete`.
  - Bấm thì mở `AlertDialog` theo mẫu hủy job ở Queue:
    - tiêu đề "Xóa video này?";
    - mô tả liệt kê: "Xóa vĩnh viễn video gốc, audio, video kết quả, SRT và transcript.
      Không thể khôi phục.";
    - nếu có job active: thêm "Job đang chạy sẽ bị hủy.";
    - nút xác nhận "Xóa vĩnh viễn".
  - Thành công thì hiện toast "Đã xóa video. File sẽ được dọn trong nền." và điều
    hướng về `/library`.
  - Video đã có bằng chứng đăng bài: nút bị khóa, kèm tooltip "Video đã có bằng chứng
    đăng bài nên không thể xóa."
- **Trang Thư viện:**
  - Mỗi dòng có checkbox và có "Chọn tất cả trang này". Khi chọn thì hiện thanh hành
    động "Đã chọn N video" với nút **"Xóa N video"**.
  - Hộp xác nhận nói rõ số video, số video có job sẽ bị hủy, và cảnh báo không khôi
    phục được.
  - Gọi `POST /v1/videos/deletions`. Kết quả hiện theo nhóm, ví dụ toast "Đã xóa 3
    video. 1 video có lịch sử đăng bài nên được giữ lại."
  - Video `DELETE_FAILED` hiện badge **"Xóa thất bại"**, kèm nút "Thử xóa lại" (gọi lại
    `DELETE`).
- Copy tiếng Việt, sentence case, động từ đứng đầu; dùng lại shadcn `AlertDialog`,
  `Checkbox` và `Button variant="destructive"` đang có.

## 4. Lỗi và mã lỗi

| Tình huống | HTTP / code | Ghi chú |
| --- | --- | --- |
| Không có video | `404 VIDEO_NOT_FOUND` | |
| Sai version | `412 VIDEO_VERSION_CONFLICT` | UI refetch rồi cho bấm lại |
| Có `PublicationProof` | `409 VIDEO_HAS_PUBLICATION_HISTORY` | |
| Đã `DELETING` | `202` (idempotent) | |
| Grant khi đang `DELETING` | `409 VIDEO_DELETING` | |
| Runner hết lượt thử | video `DELETE_FAILED` + `deletion_error_code` | UI "Thử xóa lại" |

## 5. Bảo mật và an toàn dữ liệu

- Không bao giờ xóa theo prefix; chỉ xóa theo `bucket` và `objectKey` của từng dòng
  asset trong tập ở §3.2.
- Không đụng asset của giọng mẫu, kênh hay series. Test phải có một asset dùng chung
  (cố ý link tới cả video và `ChannelProfileAsset`) để khẳng định nó được giữ.
- `AuditEvent` giữ vết cho cả yêu cầu xóa lẫn xóa xong, vì không còn dòng video nào
  để tra.
- Không có đường nào xóa `PublicationProof`.

## 6. Kiểm thử

- **Unit:**
  - `collectVideoAssetIds` đủ 4 nguồn và trừ đúng asset của profile;
  - backoff và ngưỡng chuyển `DELETE_FAILED`;
  - mapping kết quả của bulk.
- **Integration với PostgreSQL** (`TEST_DATABASE_URL`), dùng R2 fake qua interface
  object store:
  1. video có đủ cây con (job đã chạy, attempt, lease, transcript, segment, audio
     revision, render output, publication nháp) → `DELETE` → `202`, video biến khỏi
     list → `tick()` → mọi dòng biến mất, fake R2 nhận đúng danh sách key, có
     `AuditEvent` `VIDEO_DELETED`;
  2. video có job `WAITING_FOR_GPU` → job `CANCELLED`, lease nhả, worker gọi
     progress/complete thì bị `409 STALE_TASK_ATTEMPT`;
  3. video có `PublicationProof` → `409`, không đổi gì;
  4. asset `PENDING`: `tick()` trước grace thì chưa xóa dòng, còn sau grace (giả thời
     gian) thì xóa;
  5. R2 lỗi 3 lần rồi thành công → xóa xong; lỗi 6 lần → `DELETE_FAILED`, rồi
     `DELETE` lại thì chạy tiếp;
  6. asset dùng chung với `ChannelProfileAsset` → giữ nguyên dòng và object;
  7. bulk với item hỗn hợp → kết quả đúng thứ tự, mỗi item độc lập;
  8. idempotency: cùng key thì trả cùng kết quả; khác version thì `412`.
- **Web (Vitest):**
  - nút xóa và hộp xác nhận, gồm câu "Job đang chạy sẽ bị hủy";
  - chuyển trang sau khi xóa;
  - nút bị khóa khi có lịch sử đăng bài;
  - chọn nhiều và thông báo kết quả theo nhóm;
  - badge và "Thử xóa lại".
- **Contract:** `pnpm contract:verify`.
- **Thủ công:** xóa video test thật trên stack compose, rồi kiểm tra bucket R2 không
  còn object dưới `local-imports/<id>/` và các key output của video đó.

## 7. Tiêu chí hoàn thành

1. Xóa một video từ Chi tiết: video biến khỏi Thư viện ngay; trong vòng một phút (không
   có grace) mọi object R2 và mọi dòng DB của video không còn.
2. Video đang chạy job thì job bị hủy, worker không commit được output.
3. Video có bằng chứng đăng bài thì không thể xóa, cả qua UI lẫn API.
4. Chọn nhiều ở Thư viện xóa được nhiều video, và báo kết quả riêng từng video.
5. Asset của giọng, kênh và series không bao giờ bị xóa.
6. `pnpm lint`, `typecheck`, `test`, `contract:verify`, và e2e API với
   `TEST_DATABASE_URL` đều pass.

## 8. Rủi ro

- **Xóa nhầm vĩnh viễn:** giảm thiểu bằng hộp xác nhận nêu rõ hệ quả, bắt buộc
  `If-Match`, và `AuditEvent`. Không có thùng rác. Nếu sau này cần khôi phục thì làm
  archive riêng.
- **Upload muộn tạo object mồ côi:** giảm thiểu bằng grace 15 phút và việc quét lại
  asset từng `PENDING` theo đúng key.
- **Runner và job hủy chạy đua:** hàm hủy dùng chung, fencing token và
  `STALE_TASK_ATTEMPT` chặn việc commit muộn. Pha 3 tính lại tập asset trước khi xóa
  dòng.
