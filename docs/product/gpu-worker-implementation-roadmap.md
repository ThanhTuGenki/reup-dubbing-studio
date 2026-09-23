# Roadmap triển khai GPU Worker

- **Trạng thái:** `ACTIVE`
- **Nguồn chuẩn cho:** thứ tự triển khai và tiến độ cấp feature của giao thức
  thực thi task, Control Plane hỗ trợ Worker và Python GPU Worker.
- **Không phải nguồn chuẩn cho:** endpoint/schema chi tiết, thuật toán model,
  cấu hình GPU cuối cùng hoặc kết quả benchmark.
- **Phạm vi:** `contracts/openapi/worker.openapi.yaml`, phần task execution trong
  `apps/api`, `workers/gpu`, asset flow, container image và GPU acceptance.

## Quy ước

- Mỗi mục lớn là một mốc có thể triển khai, kiểm thử và merge độc lập.
- Phân tích và chốt contract/schema chi tiết Just-in-Time khi bắt đầu từng mục;
  roadmap này chỉ giữ phạm vi và thứ tự cấp cao.
- OpenAPI là nguồn chuẩn cho wire model. Không viết model request/response riêng
  rồi để Python Worker và Control Plane tự lệch nhau.
- Local M1 dùng để phát triển Agent, fake executor, asset flow và adapter không
  phụ thuộc CUDA. Nghiệm thu model thật phải chạy trên container NVIDIA.
- Python Worker dùng Python 3.11 và `uv`; không dùng Python 3.14 của máy làm
  baseline dependency.
- Hard-sub removal là tùy chọn và mặc định tắt. Nó không chặn MVP Worker.
- Loại GPU thuê được quyết định trước mốc nghiệm thu GPU dựa trên giá và khả
  dụng lúc đó. RTX 3060 12 GB là target ban đầu; GPU 24 GB như RTX 4090 được phép
  dùng để tích hợp hoặc điều tra OOM.
- Chỉ đánh dấu một mục hoàn tất khi code, test, tài liệu vận hành và acceptance
  của chính mục đó đều hoàn tất.

## 0. Chốt baseline và ranh giới thực thi

- [x] **Hoàn tất baseline Worker.**
  - [x] Chốt stage nào chạy trên Control Plane, Batch Media Worker và Interactive
    TTS Worker; không đưa toàn bộ pipeline lên GPU theo mặc định.
  - [x] Chốt capability/resource requirement cho từng task kind và quy tắc Worker
    role nào được claim task nào.
  - [x] Chốt lifecycle task/attempt/lease, fencing, retry, cancel và timeout dựa
    trên tài liệu Queue hiện có.
  - [x] Chốt input/output asset bắt buộc của từng task kind và điều kiện commit.
  - [x] Ghi rõ các stage bị skip khi `removeHardSubEnabled=false`.

## 1. Contract thực thi task cho Worker

- [x] **Hoàn tất Worker task contract.**
  - [x] Bổ sung contract claim, start, renew lease, progress, complete, fail và
    quan sát cancel/drain vào `worker.openapi.yaml`.
  - [x] Bổ sung task payload có version, attempt ID, lease ID, fencing token,
    deadline, capability requirement và input/output manifest.
  - [x] Bổ sung contract cấp quyền download/upload asset ngắn hạn; không truyền
    R2 credential dài hạn cho Worker.
  - [x] Chuẩn hóa error code cho stale attempt, lease hết hạn, task bị cancel,
    capability mismatch, asset/checksum và output commit.
  - [x] Generate lại contract artifact và thêm contract validation/test.

## 2. Control Plane task execution API

- [x] **Hoàn tất API cấp và quản lý task lease.**
  - [x] Hoàn thiện migration/index/constraint cần cho attempt, lease, fencing và
    progress dựa trên database design hiện có.
  - [x] Implement claim atomically bằng PostgreSQL row lock và
    `FOR UPDATE SKIP LOCKED`.
  - [x] Implement start, renew, progress, complete và fail với kiểm tra session,
    role, lease deadline và fencing token.
  - [x] Implement cancel propagation, lease expiry/reaper, retry/backoff và giải
    phóng task an toàn khi Worker mất kết nối.
  - [x] Chỉ complete task sau khi output bắt buộc đã upload, kiểm tra checksum và
    commit vào asset registry.
  - [x] Thêm integration test cho concurrent claim, duplicate request, stale
    completion, expired lease, cancel race và Worker offline.

## 3. Python Worker Agent foundation

- [x] **Hoàn tất Worker Agent chạy được trên local.**
  - [x] Scaffold `workers/gpu` bằng Python 3.11, `uv`, lint, typecheck, test và
    cấu hình theo environment.
  - [x] Dùng client/model sinh hoặc dẫn xuất trực tiếp từ OpenAPI; không duy trì
    một bộ wire model viết tay thứ hai.
  - [x] Implement enrollment, credential persistence an toàn, session và
    heartbeat có sequence.
  - [x] Implement claim loop, lease renewal, progress, completion/failure và
    graceful shutdown/drain.
  - [x] Implement subprocess isolation, timeout, cancellation, log redaction và
    workspace tạm theo từng attempt.
  - [x] Giới hạn concurrency theo role/capability; baseline GPU concurrency là 1.

## 4. Fake executor end-to-end

- [ ] **Hoàn tất một task giả chạy xuyên suốt Control Plane ↔ Worker.**
  - [ ] Tạo fake task adapter có thể success, fail, timeout, báo progress và nhận
    cancel mà không cần model/GPU.
  - [ ] Chạy xuyên suốt enroll → session → heartbeat → claim → renew → complete.
  - [ ] Kiểm thử Worker chết giữa task, restart Agent, lease hết hạn và attempt cũ
    không thể commit kết quả muộn.
  - [ ] Kiểm thử drain ngăn claim mới và chuyển `SAFE_TO_TERMINATE` khi không còn
    lease hoạt động.
  - [ ] Cập nhật Queue/Studio qua event hiện có và xác nhận UI phản ánh trạng thái
    task thật thay vì fixture.

## 5. Asset transfer và workspace lifecycle

- [ ] **Hoàn tất luồng asset thật không phụ thuộc GPU.**
  - [ ] Implement download input bằng presigned URL, streaming và checksum.
  - [ ] Implement multipart/resumable upload khi cần, HEAD/checksum verification
    và output commit idempotent.
  - [ ] Chống path traversal, giới hạn dung lượng, content type và thời hạn URL.
  - [ ] Dọn workspace theo retention sau success/failure nhưng giữ log chẩn đoán
    an toàn theo policy.
  - [ ] Integration test bằng S3-compatible test environment và fixture nhỏ.

## 6. Batch Media Worker adapters

- [ ] **Hoàn tất các adapter media không cần OmniVoice.**
  - [ ] Implement ASR adapter và chuẩn hóa transcript/timestamp output.
  - [ ] Implement OCR adapter nếu vẫn cần sau khi review chất lượng ASR/OCR.
  - [ ] Implement Demucs adapter để tách vocal/background.
  - [ ] Implement audio timing/mix, SRT rời và FFmpeg render cho output 16:9/9:16.
  - [ ] Giữ hard-sub adapter sau feature flag; khi flag tắt phải skip hoàn toàn
    model, mask validation và artifact của bước DESUB.
  - [ ] Unit/integration test local bằng fake process và media fixture ngắn; test
    CUDA/model thật được để dành cho mốc GPU acceptance.

## 7. Interactive TTS Worker adapters

- [ ] **Hoàn tất OmniVoice adapter.**
  - [ ] Pin phiên bản OmniVoice, PyTorch, CUDA và dependency tương thích trong
    image riêng của Interactive TTS Worker.
  - [ ] Implement initial TTS, regenerate một segment, target duration và WAV
    output theo contract.
  - [ ] Implement voice prompt/cache lifecycle mà không nhúng secret hoặc signed
    URL vào log.
  - [ ] Giữ model nóng trong session, concurrency 1 và restart subprocess có kiểm
    soát khi VRAM tăng hoặc inference lỗi.
  - [ ] Ghi rõ license gate: không dùng pretrained model cho production thương
    mại cho tới khi quyền sử dụng được giải quyết.

## 8. Container image và CI/CD

- [ ] **Hoàn tất image có thể pull lên máy thuê GPU.**
  - [ ] Tạo image tách biệt cho `BATCH_MEDIA` và `INTERACTIVE_TTS`.
  - [ ] Pin base CUDA/runtime, dependency và model compatibility; chạy bằng user
    không phải root khi khả thi.
  - [ ] Build `linux/amd64` qua GitHub Actions hoặc remote builder, không coi image
    build trên Apple Silicon là artifact production.
  - [ ] Thêm image smoke test, SBOM/security scan, version và immutable digest.
  - [ ] Verify image approval, enroll và contract-version compatibility với
    Control Plane.

## 9. Nghiệm thu trên GPU thuê

- [ ] **Hoàn tất GPU acceptance.**
  - [ ] Chọn GPU/region sau khi so sánh giá và khả dụng; ghi rõ model GPU, VRAM,
    driver, CUDA, image digest và chi phí phiên test.
  - [ ] Chạy smoke test riêng cho ASR/OCR, Demucs, FFmpeg và OmniVoice.
  - [ ] Đo cold/warm latency, p50/p95, peak VRAM và throughput với concurrency 1.
  - [ ] Chạy ít nhất 100 request OmniVoice để phát hiện VRAM growth/OOM và kiểm
    chứng controlled restart.
  - [ ] Nếu dùng GPU 24 GB để debug, chạy lại acceptance capacity trên RTX 3060
    12 GB trước khi tuyên bố 3060 là cấu hình supported.
  - [ ] Ghi kết quả, lỗi runtime thực tế và cấu hình đã pin vào acceptance log.

## 10. Full pipeline MVP và vận hành

- [ ] **Hoàn tất Worker MVP end-to-end.**
  - [ ] Chạy một video có quyền sử dụng qua ingest → transcript → dịch/cast → TTS
    → review → Demucs/mix/render → MP4 và SRT rời.
  - [ ] Xác nhận flow mặc định không chạy hard-sub removal; chạy riêng feature
    flag hard-sub sau MVP nếu cần.
  - [ ] Kiểm thử retry/cancel/restart tại từng boundary quan trọng mà không tạo
    output trùng hoặc ghi đè attempt mới.
  - [ ] Xác nhận Queue, Library và Studio nhận đúng progress/output thật.
  - [ ] Hoàn thiện runbook thuê, bootstrap, drain, kiểm tra output và xóa container
    để ngừng tính phí.
  - [ ] Cập nhật tài liệu acceptance/known follow-up và đánh dấu roadmap hoàn tất.

## Việc cố ý để sau MVP

- [ ] Nghiệm thu chất lượng hard-sub removal khi có nhu cầu bật feature flag.
- [ ] Tự động provision/terminate GPU qua provider API công khai.
- [ ] Chạy nhiều task đồng thời trên cùng GPU hoặc multi-GPU scheduling.
- [ ] Kubernetes, broker riêng hoặc autoscaling nhiều Worker.
