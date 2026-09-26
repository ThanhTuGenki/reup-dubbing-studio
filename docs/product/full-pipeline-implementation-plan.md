# Kế hoạch triển khai full pipeline MVP

- **Trạng thái:** `ACTIVE`.
- **Cập nhật:** 2026-09-25.
- **Mục tiêu:** hoàn thiện toàn bộ luồng local và Control Plane trước khi thuê
  GPU; lúc thuê GPU chỉ thay fake executor bằng hai image thật và nghiệm thu.
- **Nguồn chuẩn liên quan:** hành vi sản phẩm ở `design.md`, task ownership ở
  `../architecture/worker-task-execution.md`, wire model ở `../../contracts/openapi/`,
  và schema runtime ở `../../apps/api/prisma/schema.prisma`.

## 1. Trạng thái hiện tại

Phần nền đã có:

- API, Web, PostgreSQL và R2 chạy được trên local;
- Voice Profile có sample thật và Channel Profile đã `READY`;
- Worker protocol đã có enroll, session, claim, lease, progress, asset transfer,
  output commit, retry và cancel;
- Batch Worker đã có faster-whisper, Demucs và FFmpeg; Interactive TTS Worker đã
  có OmniVoice;
- Queue, Library và Studio đã có projection/API nền.

Các khoảng trống ngăn full pipeline chạy thật:

1. Web/API chưa có flow import MP4 local thành `Video` + `RAW` asset.
2. Ingest hiện chỉ tạo một task `DOWNLOAD`; không có runner thực thi task này.
3. Schema chưa biểu diễn dependency giữa các task trong DAG.
4. Chưa có scheduler/runner cho `IO`, `CPU` và `CONTROL_PLANE`.
5. Worker complete mới đóng attempt/task; chưa materialize ASR, TTS, Demucs và
   render output vào các bảng domain tương ứng.
6. Chưa có orchestration mở task kế tiếp, dừng ở review và tiếp tục sau approve.
7. Studio tạo `REGENERATE_SEGMENT`/`RENDER` với manifest rút gọn, chưa phải typed
   Worker payload có input/output grant hợp lệ.
8. Chưa có integration test chạy một Video xuyên Queue → Studio → Library.

## 2. Luồng đích

```text
IMPORT_LOCAL hoặc DOWNLOAD
  -> RAW available
  -> TRANSCRIBE_ASR
  -> MERGE_TRANSCRIPT
  -> TRANSLATE
  -> ASSIGN_CAST
  -> GENERATE_INITIAL_TTS
  -> WAIT_FOR_REVIEW
  -> APPROVE
  -> SEPARATE_AUDIO + EXPORT_SRT
  -> RENDER
  -> MP4 + SRT available trong Library
```

`removeHardSubEnabled=false` không tạo `DESUB`. `GENERATE_PUBLISH_PACKAGE` và
Content Agent nằm ngoài tiêu chí hoàn tất của pipeline MVP này.

## 3. Thứ tự triển khai

### P0 — Chốt contract import và orchestration

Thay đổi OpenAPI trước consumer:

- thêm endpoint xin upload, refresh grant và commit MP4 local;
- request import nhận `channelProfileId`, tùy chọn `seriesProfileId`, tên video,
  metadata file, checksum và ngôn ngữ nguồn;
- commit trả `videoId`, `jobId`, `RAW` asset và Queue location;
- bổ sung response/action cần thiết để bắt đầu hoặc tiếp tục full pipeline;
- giữ Worker contract hiện tại nếu typed task configuration đã đủ; chỉ mở rộng
  khi output materialization cần metadata chưa có;
- regenerate generated contract và chỉ dùng type/client sinh ra.

**Hoàn tất khi:** contract verify pass và Web/API không có wire type viết tay mới.

### P1 — Schema DAG và tính toàn vẹn

- thêm `PipelineTaskDependency` với khóa `(taskId, dependsOnTaskId)`, loại dependency
  `SUCCESS`, index cho scheduler và constraint cấm self dependency;
- thêm nguồn local cho Video mà không giả một Discovery item từ mạng. Ưu tiên
  cho phép `sourceContentId` nullable kèm `sourceKind=LOCAL_UPLOAD` và metadata
  local typed; cập nhật Library projection tương ứng;
- thêm metadata/lineage cần để materialize output theo attempt và chống gắn một
  asset vào hai kết quả;
- migration phải giữ tương thích dữ liệu hiện có và có backfill rõ ràng;
- loại bỏ enum OCR legacy bằng migration riêng chỉ sau khi xác nhận không còn dữ
  liệu tham chiếu; việc này không chặn pipeline.

**Hoàn tất khi:** migration chạy được trên database mới và database hiện tại;
constraint chặn dependency vòng trực tiếp, output trùng và lineage sai.

### P2 — Import MP4 local qua R2

- triển khai module import với presigned `PUT`, giới hạn dung lượng/MIME, checksum,
  idempotency và commit bằng HEAD verify;
- khi commit, tạo `Video`, link `RAW`, snapshot profile và job `FULL_PIPELINE`;
- không tạo `DOWNLOAD` cho local upload; task đầu tiên là `TRANSCRIBE_ASR`;
- Web thêm hành động “Nhập video” dùng generated API client, hiển thị upload
  progress, retry grant hết hạn và chuyển sang Queue sau commit;
- video đã stage thủ công ở `_acceptance/...` chỉ là fixture; bài E2E phải đi qua
  API import chính thức.

**Hoàn tất khi:** upload `/Users/genkisystem/Downloads/video.mp4` từ Web/local API
tạo một Video có `RAW` available và job xuất hiện ở Queue.

### P3 — DAG builder và scheduler

- tạo một DAG builder thuần, sinh task/config/manifest/dependency từ immutable
  profile snapshot;
- với cấu hình hiện tại tạo đúng 9 task: `TRANSCRIBE_ASR`, `MERGE_TRANSCRIPT`,
  `TRANSLATE`, `ASSIGN_CAST`, `GENERATE_INITIAL_TTS`, `WAIT_FOR_REVIEW`,
  `SEPARATE_AUDIO`, `EXPORT_SRT`, `RENDER`; `SEPARATE_AUDIO` và `EXPORT_SRT` có
  thể chạy song song sau review;
- task gốc `READY`; task còn lại `BLOCKED`; scheduler chỉ mở task khi mọi
  dependency `SUCCESS` đã đạt;
- job status được suy từ task: `RUNNING`, `WAITING_FOR_GPU`,
  `WAITING_FOR_REVIEW`, terminal success/failure/cancel;
- dùng transaction + row locking để nhiều API instance không mở task hai lần;
- mọi transition ghi workflow event và outbox invalidate.

**Hoàn tất khi:** cùng một event chạy lặp không tạo task/output trùng và Queue
hiển thị đúng current task/progress.

### P4 — Control Plane runner

Tạo runner riêng trong API process hoặc process entrypoint dùng chung module,
claim bằng PostgreSQL `FOR UPDATE SKIP LOCKED` cho các resource class không thuộc
GPU:

- `MERGE_TRANSCRIPT`: validate ASR JSON, tạo `TranscriptRun`,
  `TranscriptSegment`, `VideoSegment` và chọn transcript;
- `TRANSLATE`: gọi provider/model đã cấu hình, batch segment, lưu checkpoint và
  chỉ retry phần chưa hoàn tất;
- `ASSIGN_CAST`: MVP single voice tạo `SegmentRevision` trực tiếp từ default
  Voice Profile; không cần LLM để gán nhân vật;
- `EXPORT_SRT`: sinh SRT từ revision đã duyệt, upload/commit thành
  `OUTPUT_SUBTITLE`;
- `WAIT_FOR_REVIEW`: chuyển job/video sang trạng thái chờ và không được runner
  tự complete;
- `DOWNLOAD` runner để lại cho URL ingest; nó không chặn local-import E2E nhưng
  phải hoàn tất trước khi tuyên bố ingest URL hoạt động.

Translation cần một API key/provider thật để dịch video thật. Test local dùng
adapter deterministic; khóa thật chỉ cần trước bài acceptance nội dung, không
cần cho việc xây và kiểm tra orchestration.

**Hoàn tất khi:** runner restart giữa task tiếp tục từ state bền vững, retry không
trả tiền lại cho batch đã lưu và cancel dừng công việc.

### P5 — Materialize output GPU

Trong transaction complete task:

- `TRANSCRIBE_ASR`: link `ASR_JSON`, sau đó mở `MERGE_TRANSCRIPT`;
- `GENERATE_INITIAL_TTS`/`REGENERATE_SEGMENT`: tạo hoặc cập nhật đúng
  `SegmentAudioRevision`, giữ revision cũ và chọn output mới theo policy;
- `SEPARATE_AUDIO`: link `BACKGROUND_AUDIO`;
- `RENDER`: link `OUTPUT_VIDEO`, tạo/update `RenderOutput` đúng variant/revision;
- validate output cardinality, segment revision, variant, checksum, attempt và
  fencing trước khi materialize;
- complete replay với cùng idempotency key trả cùng kết quả; stale attempt không
  thể thay domain state.

**Hoàn tất khi:** fake hoặc fixture executor tạo đủ domain data để Studio preview
và Library cấp download grant.

### P6 — Review, regenerate và render lại

- approve TTS complete `WAIT_FOR_REVIEW` và mở `SEPARATE_AUDIO`, `EXPORT_SRT`;
- `RENDER` chỉ mở khi background audio và mọi audio revision được chọn đã sẵn sàng;
- sửa segment tạo immutable revision; regenerate tạo typed manifest cho đúng một
  segment và sample/prompt đúng Voice Profile;
- render request tạo typed manifest gồm `RAW`, `BACKGROUND_AUDIO`, các
  `DUB_AUDIO` đã chọn và output variant;
- approval/retry/restart không tạo thêm render revision nếu request được replay.

**Hoàn tất khi:** sửa một câu, regenerate câu đó, nghe preview và render lại mà
không chạy lại ASR/Demucs không cần thiết.

### P7 — Local end-to-end không cần GPU

Dùng hai Worker Agent với fake/fixture executor nhưng giữ nguyên HTTP protocol,
presigned R2 transfer và database thật:

1. import video local;
2. fake ASR trả transcript fixture hợp lệ;
3. runner merge/translate/single-cast;
4. fake TTS tạo WAV hợp lệ cho từng segment;
5. approve review;
6. fixture Demucs/FFmpeg tạo background và MP4 hợp lệ;
7. kiểm tra MP4/SRT tải được từ Library.

Bài test phải bao phủ:

- retry sau lỗi tạm thời;
- cancel trong GPU task và Control Plane task;
- restart API/runner/Worker;
- grant hết hạn và refresh;
- complete/output commit replay;
- stale attempt bị từ chối;
- không có asset, segment, task hoặc render output trùng;
- Queue, Studio, Library phản ánh cùng trạng thái.

**Gate thuê GPU:** chỉ thuê khi P0–P7 pass trên PostgreSQL và R2 thật.

### P8 — GPU integration

- đăng ký hai approved image digest và hai Worker role;
- chạy cùng job/contract đã pass local, thay executor fixture bằng Batch Media và
  Interactive TTS thật;
- xác nhận ASR, OmniVoice, Demucs và render materialize đúng domain state;
- lỗi CUDA/model chỉ được sửa trong adapter/image, không bypass orchestration;
- lưu timing, VRAM, digest và output vào acceptance log.

### P9 — Nghiệm thu Milestone 10

- chạy toàn bộ `/Users/genkisystem/Downloads/video.mp4` tới MP4/SRT;
- kiểm tra transcript, bản dịch, timing, giọng, nhạc nền và file tải xuống;
- lặp retry/cancel/restart trên job thật;
- xác nhận Queue, Studio, Library và runbook drain/terminate;
- cập nhật roadmap và acceptance log bằng evidence thật.

## 4. Chiến lược test và quality gate

Mỗi phase phải có integration test ở boundary mang rủi ro, không chỉ unit test
mirror implementation. Gate local cuối cùng:

```bash
pnpm contract:verify
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgresql://... pnpm --filter @reup-dubbing-studio/api test:e2e
pnpm --filter @reup-dubbing-studio/api build
pnpm web:build
cd workers/gpu && make check
```

Thêm một smoke script/runbook chạy E2E thật với PostgreSQL + R2, in ID của Video,
Job, output MP4/SRT và trạng thái cuối, nhưng không in credential/presigned URL.

## 5. Ranh giới hoàn tất trước khi thuê GPU

Được coi là sẵn sàng thuê GPU khi:

- video local đi qua API chính thức và xuất hiện ở Queue/Library;
- full DAG tồn tại, dependency và status transition đúng;
- fake/fixture Worker chạy job tới MP4/SRT qua R2 thật;
- review/regenerate/render, retry/cancel/restart đều pass;
- không còn thao tác chèn dữ liệu trực tiếp vào PostgreSQL để bài test chạy;
- chỉ còn các biến chưa thể kiểm chứng local: CUDA, model weights, latency, VRAM
  và chất lượng âm thanh thật.
