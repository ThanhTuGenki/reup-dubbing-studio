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
