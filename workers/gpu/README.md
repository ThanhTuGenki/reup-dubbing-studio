# GPU Workers

## Trách nhiệm

Khu vực này chứa các worker cần tài nguyên GPU để thực hiện xử lý nền chuyên sâu,
chẳng hạn xử lý âm thanh, hình ảnh hoặc suy luận mô hình. Mỗi worker phải giữ
phạm vi xử lý của mình trong một đơn vị công việc bất đồng bộ và giao tiếp với
các khu vực khác qua contract được chấp nhận.

## Ngoài phạm vi

Không đặt ứng dụng web, API của sản phẩm, worker chỉ dùng CPU, thư viện dùng lại,
business contract, mã CI hoặc cấu hình cấp phát và triển khai hạ tầng trực tiếp
trong thư mục này.

## Ranh giới

Đây là phần chuyên biệt của `workers/`: `workers/` định nghĩa ranh giới chung và
luồng xử lý nền, còn thư mục này chỉ sở hữu các worker có phụ thuộc GPU. `apps/`
sở hữu điểm vào sản phẩm; `packages/` sở hữu thành phần dùng lại; `infra/` sở hữu
cấu hình vận hành và hạ tầng để chạy worker.

## Worker Agent foundation

Runtime dùng Python 3.11 và `uv`. Tất cả model/request/response HTTP trong
`src/reup_worker_contract/` được sinh trực tiếp từ
`contracts/openapi/worker.openapi.yaml`; không sửa các file sinh bằng tay.

```bash
cd workers/gpu
uv sync
make contract
make check
cp .env.example .env
uv run reup-gpu-worker
```

Agent giữ tối đa một task GPU đang chạy, heartbeat độc lập với lease renewal,
ngừng claim khi Control Plane yêu cầu drain và dùng fencing token từ claim cho
mọi mutation. Credential sau enroll được ghi atomically với permission `0600`;
`.state/`, `.work/`, `.env` và virtual environment đều không được commit.

`TaskExecutor` là boundary cho adapter. Foundation hiện cố ý không chứa model
ASR/OCR/Demucs/FFmpeg/OmniVoice. Fake executor có thể chạy toàn bộ lifecycle mà
không cần GPU và được bật bằng `REUP_WORKER_EXECUTOR=fake`. Có thể đặt
`REUP_WORKER_FAKE_BEHAVIOR` thành `success`, `fail`, `timeout` hoặc
`wait-for-cancel` để kiểm thử Control Plane; adapter thật được thêm ở các
milestone kế tiếp mà không thay wire model hoặc vòng đời Agent.

Luồng fake được nghiệm thu qua hai lớp: pytest chạy Agent với Control Plane giả
để ép từng behavior, còn integration test PostgreSQL chạy lifecycle HTTP thật,
restart/lease fencing, workflow event và projection Queue. `queue.invalidate`
chỉ mang định danh/version an toàn; Queue và Studio luôn refetch REST thay vì
dùng payload SSE làm nguồn dữ liệu.

## Asset transfer và workspace

`AssetTransfer` chỉ dùng grant ngắn hạn trong contract: input được tải streaming
vào workspace của attempt, giới hạn byte và kiểm tra SHA-256 trước khi atomic
rename. Output phải nằm trong `outputs/`, đúng content type/giới hạn slot, được
PUT streaming rồi mới gọi commit; Control Plane xác minh lại HEAD, kích thước,
content type và checksum. Commit dùng idempotency key ổn định. Nếu PUT đứt hoặc
grant hết hạn, Worker xin grant mới và gửi lại nguyên object an toàn.

MVP dùng single PUT cho output dưới giới hạn S3 5 GiB; manifest hiện tại giới hạn
video ở 1 GB nên chưa cần multipart. Worker từ chối rõ ràng file lớn hơn 5 GiB;
khi product cho phép output lớn hơn ngưỡng này phải mở rộng OpenAPI bằng
multipart grant trước, không tự giữ S3 credential dài hạn trong Worker.

Workspace thành công mặc định xóa ngay. Workspace lỗi giữ một giờ để chẩn đoán,
sau đó reaper xóa; diagnostic JSON tách riêng, bị giới hạn kích thước và redact
secret. Có thể đổi retention bằng biến môi trường trong `.env.example`.

Test S3-compatible được chạy với endpoint riêng qua `make test-s3`. Ví dụ dùng
MinIO tạm ở `127.0.0.1:59000` và đặt các biến
`REUP_WORKER_TEST_S3_ENDPOINT`, `REUP_WORKER_TEST_S3_ACCESS_KEY`,
`REUP_WORKER_TEST_S3_SECRET_KEY`; suite mặc định skip test này nếu endpoint không
được cấu hình.

## Batch Media executor

Đặt `REUP_WORKER_EXECUTOR=batch` cho image `BATCH_MEDIA`. Executor tải input qua
`AssetTransfer`, dispatch theo `taskType`, sau đó upload và commit đúng output
slot. Bốn adapter MVP được đăng ký:

- `TRANSCRIBE_ASR`: faster-whisper, output transcript JSON v1;
- `TRANSCRIBE_OCR`: PaddleOCR/OpenCV, output cùng transcript JSON v1;
- `SEPARATE_AUDIO`: Demucs `htdemucs`, output background WAV;
- `RENDER`: FFmpeg H.264/AAC 16:9 hoặc 9:16, delay/mix dub theo metadata và
  tuyệt đối không burn-in subtitle.

Local foundation không cài model nặng. ASR/OCR/Demucs được import/chạy trong
subprocess và sẽ được pin trong Batch Media container; local test dùng fake
process, riêng FFmpeg chạy một fixture media ngắn thật. `DESUB` không được đăng
ký và image MVP không quảng bá `media.desub.v1`, nên hard-sub mặc định tắt không
load model hay tạo artifact. SRT rời thuộc task CPU `EXPORT_SRT` ở Control Plane.

## Interactive TTS executor

Image Interactive TTS dùng `REUP_WORKER_EXECUTOR=interactive-tts`, role
`INTERACTIVE_TTS` và capability `tts.omnivoice.v1`. Agent tải `VOICE_SAMPLE`
hoặc `VOICE_PROMPT`, cache prompt theo voice/language/checksum/model revision,
giữ OmniVoice trong subprocess chạy nóng và upload WAV 24 kHz riêng cho từng
segment. Regenerate chỉ chấp nhận đúng một segment. Subprocess tự restart sau số
request cấu hình, khi VRAM vượt ngưỡng, timeout hoặc inference lỗi; GPU
concurrency của Agent vẫn là 1.

CUDA dependencies được pin riêng tại `tts/requirements.lock`, không cài vào môi
trường M1. Model chính thức được khóa theo Hugging Face revision
`c5fdb5ccb189668d56333f77ba2629f4cd7535f4`; source OmniVoice đã kiểm tra tại Git
commit `08be0b4ccbac3e13e374e86fbfead4b4cac343e2`. Audio tokenizer phụ thuộc cũng
được khóa ở revision `528e871c2a26c4f0f7773b9754e2e1acae20899d`. Code là Apache-2.0 nhưng pretrained
weights là CC-BY-NC. `REUP_WORKER_TTS_USAGE_MODE=production-commercial` vì vậy
bị chặn khi license vẫn là `CC_BY_NC`; chỉ đổi gate sau khi có weights/quyền sử
dụng thương mại được xác minh, không suy diễn từ license của code.
