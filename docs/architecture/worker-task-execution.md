# Worker task execution — baseline MVP

- **Trạng thái:** `ACCEPTED`
- **Cập nhật:** 2026-09-23
- **Nguồn chuẩn cho:** ranh giới thực thi task, eligibility của GPU Worker,
  lifecycle attempt/lease, input/output asset của GPU task và hành vi skip DESUB.
- **Không phải nguồn chuẩn cho:** path/schema HTTP chi tiết, implementation scheduler,
  lệnh CLI của model, image dependency hoặc kết quả benchmark GPU.
- **Tài liệu liên quan:**
  [`queue-lifecycle.md`](queue-lifecycle.md),
  [`gpu-worker-control-plane.md`](gpu-worker-control-plane.md),
  [`presigned-asset-flow.md`](presigned-asset-flow.md) và
  [`database-design.md`](database-design.md).

## 1. Quyết định chính

1. Control Plane và GPU Worker cùng dùng PostgreSQL task queue làm nguồn chuẩn,
   nhưng Worker chỉ truy cập qua HTTPS Worker API; Worker không nhận database
   credential.
2. GPU Worker chỉ được claim `GPU_BATCH` hoặc `GPU_TTS_INTERACTIVE`. Task `IO`,
   `CPU`, `CONTROL_PLANE` và `HUMAN_REVIEW` do runner/use case phía VPS sở hữu.
3. Có hai role/image độc lập. `BATCH_MEDIA` không chạy OmniVoice;
   `INTERACTIVE_TTS` không chạy OCR, ASR, DESUB, Demucs hoặc render.
4. Eligibility cần đồng thời khớp resource class, Worker role, capability version,
   contract version, session hiện hành, trạng thái worker và capacity còn trống.
5. Mỗi claim tạo attempt và lease mới trong cùng transaction. Fencing token là
   thẩm quyền ghi kết quả; worker/session ID không thay thế fencing token.
6. Binary đi thẳng Worker ↔ object store bằng presigned URL. Output phải upload,
   HEAD/checksum verify và commit thành asset `AVAILABLE` trước khi task complete.
7. `removeHardSubEnabled=false` không tạo task `DESUB`, không yêu cầu mask và
   không tạo artifact `DESUBBED`. Đây là flow mặc định của MVP.
8. OCR và ASR luôn đọc `RAW`: OCR cần nhìn hard-sub gốc, ASR cần audio gốc. Khi
   bật DESUB, chỉ bước render đổi visual input từ `RAW` sang `DESUBBED`.

## 2. Ownership của từng task type

| Task type | Resource class | Executor/role | Capability Worker | Quyết định MVP |
| --- | --- | --- | --- | --- |
| `DOWNLOAD` | `IO` | Control Plane runner | — | yt-dlp và source credential ở VPS |
| `DESUB` | `GPU_BATCH` | `BATCH_MEDIA` | `media.desub.v1` | Chỉ tạo khi effective flag bật |
| `TRANSCRIBE_OCR` | `GPU_BATCH` | `BATCH_MEDIA` | `transcript.ocr.v1` | Đọc `RAW`, chưa chốt làm nguồn chính sau benchmark |
| `TRANSCRIBE_ASR` | `GPU_BATCH` | `BATCH_MEDIA` | `transcript.asr.v1` | Đọc `RAW`, chạy cùng OCR trong MVP để so sánh |
| `MERGE_TRANSCRIPT` | `CPU` | Control Plane runner | — | Chọn/hợp nhất transcript, không cần GPU |
| `TRANSLATE` | `CONTROL_PLANE` | Control Plane use case | — | LLM secret chỉ ở VPS |
| `ASSIGN_CAST` | `CONTROL_PLANE` | Control Plane use case | — | LLM/domain mutation ở VPS |
| `GENERATE_INITIAL_TTS` | `GPU_TTS_INTERACTIVE` | `INTERACTIVE_TTS` | `tts.omnivoice.v1` | Batch nhỏ, output vẫn tách từng segment |
| `WAIT_FOR_REVIEW` | `HUMAN_REVIEW` | Web/Control Plane | — | Không có executor lease |
| `REGENERATE_SEGMENT` | `GPU_TTS_INTERACTIVE` | `INTERACTIVE_TTS` | `tts.omnivoice.v1` | Chính xác một immutable segment revision |
| `SEPARATE_AUDIO` | `GPU_BATCH` | `BATCH_MEDIA` | `audio.separate.demucs.v1` | Chạy sau review trước final render |
| `RENDER` | `GPU_BATCH` | `BATCH_MEDIA` | `media.render.ffmpeg.v1` | MP4 không burn-in phụ đề Việt |
| `EXPORT_SRT` | `CPU` | Control Plane runner | — | Sinh SRT rời từ revision đã duyệt |
| `UPLOAD_OUTPUTS` | `CONTROL_PLANE` | Không schedule trong DAG mới | — | Upload/commit là protocol của task tạo output, không phải một lần copy thứ hai |
| `GENERATE_PUBLISH_PACKAGE` | `CONTROL_PLANE` | Control Plane use case | — | Content Agent/LLM ở VPS |

`UPLOAD_OUTPUTS` tạm còn trong enum để không tạo migration cleanup lẫn vào task
execution slice. Job mới không tạo task này. Sau khi Worker flow ổn định mới xóa
enum value bằng migration riêng nếu không còn dữ liệu lịch sử phụ thuộc.

## 3. DAG MVP

```text
DOWNLOAD
  ├── TRANSCRIBE_OCR ─┐
  ├── TRANSCRIBE_ASR ─┴─> MERGE_TRANSCRIPT -> TRANSLATE -> ASSIGN_CAST
  │                                                       |
  │                                  GENERATE_INITIAL_TTS <-+
  │                                           |
  │                                    WAIT_FOR_REVIEW
  │                                           |
  ├── DESUB (chỉ khi flag bật)                ├── SEPARATE_AUDIO
  │                                           ├── EXPORT_SRT
  └───────────────────────────────────────────┴── RENDER
                                                       |
                                      GENERATE_PUBLISH_PACKAGE
```

Các dependency thực tế phải bảo đảm:

- `TRANSCRIBE_OCR`, `TRANSCRIBE_ASR` và `DESUB` đều nhận `RAW`; chúng có thể chạy
  độc lập sau `DOWNLOAD` nếu có capacity.
- `DESUB` không nằm trên đường tới transcript. Khi bật, `RENDER` mới phụ thuộc
  `DESUB`; khi tắt, dependency và task đó không tồn tại.
- `SEPARATE_AUDIO` chạy sau điểm review trong MVP để không tốn GPU cho video chưa
  được chấp nhận. Nó vẫn đọc `RAW`, không đọc `DESUBBED`.
- `RENDER` phụ thuộc audio nền, các audio revision đã chọn, quyết định review và
  visual input phù hợp. Nó không phụ thuộc SRT vì phụ đề không được burn-in.
- `EXPORT_SRT` và `RENDER` có thể chạy song song sau review nếu highlight/timestamp
  đã chốt. Publish package chỉ sẵn sàng khi các output bắt buộc đã commit.

## 4. Capability và điều kiện claim

### 4.1 Capability vocabulary MVP

Capability là identifier có version, do image khai báo và Control Plane kiểm tra
khi mở session:

```text
media.desub.v1
transcript.ocr.v1
transcript.asr.v1
audio.separate.demucs.v1
media.render.ffmpeg.v1
tts.omnivoice.v1
```

Không suy capability chỉ từ GPU model hoặc package được cài trong container.
Approved image phải có manifest capability tương ứng role. Session chỉ được báo
tập con của approved manifest; báo capability lạ hoặc sai role là lỗi tương thích.

### 4.2 Requirements gắn với task

Control Plane tạo immutable execution requirements cùng configuration snapshot:

```text
resourceClass          GPU_BATCH | GPU_TTS_INTERACTIVE
requiredCapabilities   string[] không rỗng
minimumVramMb          integer nullable
minimumScratchBytes    integer nullable
expectedRuntimeSeconds integer nullable, chỉ là scheduling hint
```

`resourceClass` và `requiredCapabilities` là hard gate. Các minimum khác chỉ là
hard gate khi task đã khai báo; không tự từ chối một GPU chỉ vì model name khác
chuỗi cấu hình. Benchmark sau này có thể thay requirements của job mới, không làm
đổi snapshot của job đang chạy.

### 4.3 Claim eligibility

Một session chỉ claim được task khi toàn bộ điều kiện sau đúng tại transaction:

- worker `desired_status=ACTIVE`, credential chưa revoke và heartbeat còn fresh;
- session là session hiện hành, image digest đang approved và contract compatible;
- role khớp resource class (`BATCH_MEDIA ↔ GPU_BATCH`,
  `INTERACTIVE_TTS ↔ GPU_TTS_INTERACTIVE`);
- session có đủ mọi required capability và capacity/concurrency slot;
- task `READY`, `ready_at <= server_now`, dependency đạt và job chưa cancel;
- task chưa có lease active.

MVP đặt tối đa một active GPU task trên mỗi session. Heartbeat capacity dùng để
đối chiếu và quan sát, không được dùng để vượt concurrency limit đã cấu hình.

## 5. Lifecycle attempt và lease

### 5.1 Claim và start

1. Claim chọn một task eligible theo priority/ready time bằng
   `FOR UPDATE SKIP LOCKED`.
2. Trong một transaction: tăng `attempt_count`, tạo `task_attempts`, tạo
   `task_leases` với fencing token tăng đơn điệu và đổi task `READY → LEASED`.
3. Response claim chứa snapshot thực thi, không yêu cầu Worker đọc thêm mutable
   profile hoặc segment hiện hành để hiểu task.
4. Worker chuẩn bị workspace/download input rồi gọi start trong start deadline.
   Start hợp lệ đổi task `LEASED → RUNNING`; gọi lại cùng attempt là idempotent.
5. Lease không được start đúng hạn được reaper timeout như lease hết hạn.

### 5.2 Renew, progress và cancel

- Renew chỉ thành công cho active lease/fencing token hiện hành và dùng server
  time để kéo dài deadline. Client time không quyết định lease validity.
- Progress chỉ nhận khi task đang `RUNNING`, cùng attempt/token và không giảm so
  với giá trị đã ghi. Replay cùng giá trị được phép.
- Worker tiếp tục heartbeat độc lập với renew. Heartbeat không tự gia hạn task.
- Cancel Job atomically terminalize task/release lease theo Queue contract. Worker
  quan sát cancel qua heartbeat/renew/progress response và dừng subprocess sớm.
- Sau cancel hoặc expiry, mọi progress/complete/fail từ attempt cũ trả
  `409 STALE_TASK_ATTEMPT`; Worker chỉ cleanup workspace, không retry commit.
- Drain ngăn claim mới nhưng cho lease hiện hành renew, upload và commit xong.

### 5.3 Expiry và retry

Reaper dùng server time để release lease hết hạn, đặt attempt `TIMED_OUT` và ghi
`LEASE_EXPIRED`/`WORKER_LOST`. Nếu còn retry budget và error retryable, task trở
lại `READY` với backoff và attempt sau nhận fencing token mới; nếu không, task và
job thất bại theo Queue contract.

Worker restart không được tự tiếp tục attempt chỉ từ file local. Nó mở session
mới và claim task do Control Plane cấp; output chưa commit của attempt cũ được
retention cleanup xử lý.

### 5.4 Complete và fail

- Fail/complete bắt buộc gửi attempt ID, lease ID và fencing token.
- Fail chỉ nhận error code allowlist, safe detail bị giới hạn và metrics an toàn;
  không nhận traceback, environment hoặc log thô làm domain state.
- Complete chỉ nhận reference tới output asset đã commit, metrics và result
  metadata đúng schema của task kind.
- Cùng idempotency key + cùng body trả lại kết quả trước. Đổi body với cùng key bị
  từ chối. Complete/fail đối nghịch sau terminal state không được đổi kết quả.
- Transaction complete kiểm tra fencing lần cuối, gắn domain lineage/output,
  terminalize attempt/task, release lease và mở dependency kế tiếp.

## 6. Task manifest và asset boundary

Wire schema chi tiết được chốt ở contract slice kế tiếp. Baseline yêu cầu claim
payload có tối thiểu:

```text
task/attempt/lease IDs + fencing token
task type + payload version
lease expiry + heartbeat/renew hint
execution requirements
configuration snapshot cần thiết cho đúng task
input manifest: logical slot, asset ID, metadata và download grant
output specification: logical slot, purpose, cardinality, MIME/size limit
```

Không gửi bucket, object key, storage credential, source cookie, LLM key hoặc
mutable profile object đầy đủ cho Worker.

### 6.1 Input/output theo GPU task

| Task | Input bắt buộc | Output bắt buộc |
| --- | --- | --- |
| `DESUB` | `RAW`, normalized mask, model/config snapshot | một `DESUBBED` video |
| `TRANSCRIBE_OCR` | `RAW`, OCR language/config | một `OCR_JSON` |
| `TRANSCRIBE_ASR` | `RAW`, ASR language/config | một `ASR_JSON` |
| `GENERATE_INITIAL_TTS` | immutable segment revisions, voice sample/prompt asset và timing config | một `DUB_AUDIO` cho mỗi segment input |
| `REGENERATE_SEGMENT` | đúng một immutable segment revision, voice sample/prompt asset và timing config | đúng một `DUB_AUDIO` revision |
| `SEPARATE_AUDIO` | `RAW`, Demucs config | một `BACKGROUND_AUDIO`; vocal stem chỉ là optional diagnostic |
| `RENDER` | visual input, `BACKGROUND_AUDIO`, selected `DUB_AUDIO`, intro/outro/logo nếu cấu hình và render snapshot | một `OUTPUT_VIDEO` cho mỗi requested variant |

Visual input của `RENDER`:

- flag tắt: đúng một `RAW`;
- flag bật: đúng một `DESUBBED`, có lineage về `RAW` của cùng video/job.

Worker tính SHA-256 trong lúc stream. Mỗi output dùng grant riêng gắn với
attempt + logical slot; PUT xong phải commit để Control Plane HEAD/verify. Task
chỉ complete khi:

- đủ mọi slot/cardinality bắt buộc;
- mọi asset ở trạng thái `AVAILABLE`, checksum/size/type hợp lệ;
- asset do attempt hiện hành tạo và chưa gắn cho output khác;
- domain metadata như segment revision hoặc render variant khớp snapshot.

Presigned grant hết hạn có thể xin lại cho cùng pending asset khi lease còn hiệu
lực. Grant TTL không vượt lease còn lại. URL và signed header không persist hoặc
ghi log.

### 6.2 Chuẩn adapter Batch Media v1

`ASR_JSON` và `OCR_JSON` dùng cùng envelope chuẩn hóa để Control Plane có thể so
sánh/hợp nhất mà không phụ thuộc output riêng của model:

```json
{
  "version": 1,
  "source": "ASR",
  "language": "zh",
  "segments": [
    { "startMs": 0, "endMs": 1250, "text": "...", "confidence": 0.98 }
  ]
}
```

Timestamp phải tăng đơn điệu, dùng millisecond và segment không rỗng. OCR vẫn
đọc `RAW`; ASR dùng faster-whisper và OCR dùng PaddleOCR trong subprocess để lỗi
model không làm chết Agent. Dependency model/CUDA được pin ở image Batch Media,
không đưa vào môi trường local nền tảng.

`SEPARATE_AUDIO` chạy Demucs `htdemucs --two-stems vocals`; output chuẩn của task
là `BACKGROUND_AUDIO` WAV. Vocal stem chỉ là diagnostic cục bộ và không upload
trong MVP.

`RENDER` dùng các logical input sau:

- đúng một visual `RAW` khi hard-sub removal tắt, hoặc `DESUBBED` khi bật;
- đúng một `BACKGROUND_AUDIO`;
- một hoặc nhiều `DUB_AUDIO`, metadata gồm `ordinal`, `targetStartMs` và tùy chọn
  `gainDb`;
- variant `FULL_16X9` hoặc `VERTICAL_9X16` từ configuration snapshot.

FFmpeg delay/mix dub theo timestamp, scale + pad giữ aspect ratio, encode H.264
và AAC. `subtitleMode=EXTERNAL_ONLY` cấm burn-in; task CPU `EXPORT_SRT` vẫn sở
hữu file SRT rời. Batch executor không đăng ký adapter/capability `DESUB` trong
image MVP, vì vậy khi flag mặc định tắt không tải model, validate mask hay tạo
artifact `DESUBBED`.

## 7. Hard-sub optional/default off

### 7.1 Khi tắt — flow mặc định MVP

- DAG không có `DESUB` và không có dependency ảo thay thế.
- Profile/job creation không yêu cầu series mask hoặc mask reference frame.
- OCR/ASR nhận `RAW`; `RENDER` cũng nhận `RAW` làm visual input.
- Không load/download model DESUB, không cấp output slot `DESUBBED` và không xem
  thiếu asset đó là lỗi readiness.

### 7.2 Khi bật

- Effective profile snapshot phải có normalized mask hợp lệ trước khi tạo job;
  thiếu mask làm request bị từ chối, không tạo job nửa vời.
- DAG tạo `DESUB` sau `DOWNLOAD`; `RENDER` có success dependency tới `DESUB`.
- OCR vẫn đọc `RAW`, tuyệt đối không OCR file đã xóa chữ.
- `DESUBBED` chỉ trở thành visual input cho render sau khi output đã commit.
- DESUB failure tuân theo retry budget; không âm thầm fallback về `RAW` vì sẽ
  làm output khác cấu hình người dùng đã chọn.

## 8. Acceptance baseline

- [x] Mỗi task type có executor/resource class rõ ràng.
- [x] Mỗi GPU task map tới đúng Worker role và capability version.
- [x] Claim eligibility không dựa riêng vào role hoặc GPU model string.
- [x] Claim/start/renew/progress/complete/fail/cancel có lifecycle và fencing rõ.
- [x] Output chỉ được complete sau upload, checksum verification và asset commit.
- [x] GPU task có input/output slot tối thiểu để thiết kế contract tiếp theo.
- [x] `removeHardSubEnabled=false` loại bỏ hoàn toàn DESUB khỏi DAG/readiness.
- [x] OCR luôn đọc RAW; render chỉ dùng DESUBBED khi feature được bật.
- [x] GPU model thuê chưa bị khóa trước giai đoạn acceptance.

## 9. Contract task đã chốt và policy còn JIT

Wire contract được chốt tại
[`contracts/openapi/worker.openapi.yaml`](../../contracts/openapi/worker.openapi.yaml):

- claim/start/renew/progress/complete/fail và asset grant/refresh/commit là các
  operation riêng, mọi mutation sau enroll yêu cầu `Idempotency-Key`;
- claim long-poll tối đa 25 giây và trả explicit `task: null` khi chưa có việc;
- claim payload có payload version, requirements, typed task configuration,
  input download grant và output specifications;
- download/upload grant được refresh bằng operation riêng cho đúng attempt/asset;
- heartbeat và task action response đều mang drain/cancel signal;
- worker output luôn có SHA-256; input checksum là nullable có chủ đích vì browser
  asset cũ có thể chưa có checksum, Worker vẫn phải kiểm tra size/type.

Các giá trị vận hành sau thuộc server policy/configuration của implementation,
không hard-code vào wire contract:

- lease duration, start deadline, renew interval và retry backoff;
- MIME/size limit cụ thể theo output purpose;
- ngưỡng batch initial TTS, minimum VRAM và scratch disk;
- model profile và runtime timeout đã benchmark cho từng adapter.
