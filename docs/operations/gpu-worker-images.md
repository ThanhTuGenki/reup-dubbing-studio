# GPU Worker image runbook

Hai image production được build từ `workers/gpu/containers/Dockerfile` cho duy
nhất `linux/amd64`:

- target `batch` → `ghcr.io/ThanhTuGenki/gpu-worker-batch`;
- target `interactive-tts` → `ghcr.io/ThanhTuGenki/gpu-worker-interactive-tts`.

Base CUDA và công cụ `uv` đều khóa bằng OCI digest. Dependency model được tách
theo image; Batch tiếp tục tách ASR, OCR/Paddle và Demucs/PyTorch thành các venv
để tránh xung đột CUDA package. Container chạy UID/GID `10001`, chỉ thư mục
`/var/lib/reup-worker` cần volume ghi được.

Workflow `.github/workflows/gpu-worker-images.yml` chạy Worker check, build
linux/amd64, smoke test không inference, sinh SPDX SBOM và chặn vulnerability
HIGH/CRITICAL đã có bản sửa. Build trên `main` push hai tag `0.1.0` và
`sha-<git-sha>`; artifact `*.digest.txt` mới là định danh được phép dùng để duyệt
image. Tag không phải identity vận hành.

## Duyệt và bootstrap

1. Tải artifact supply-chain của workflow thành công và giữ `registry@sha256`.
2. Tạo image qua `POST /worker-images` với `imageDigest` đúng digest artifact,
   `contractVersion=1`, role và capability đúng image.
3. Tạo Worker từ approved image, mở billing session và lấy enrollment token một
   lần theo API/UI hiện có.
4. Pull bằng immutable reference, đặt `REUP_WORKER_IMAGE_DIGEST` bằng cùng digest
   (không gồm repository), cùng `REUP_WORKER_CONTRACT_VERSION=1`, Control Plane
   URL và enrollment token; mount volume riêng vào `/var/lib/reup-worker`.
5. Chạy bằng NVIDIA Container Toolkit. Enrollment bị từ chối nếu role, digest,
   contract version hoặc capability không khớp approved image; heartbeat cũng
   chuyển Worker sang lỗi nếu image bị revoke hoặc version lệch.

Không bake enrollment token, Control Plane credential, signed URL hoặc model
cache vào image/SBOM. Image TTS mặc định `prototype` và CC-BY-NC; production
thương mại vẫn bị license gate chặn cho tới khi approved weights đổi sang quyền
thương mại đã được xác minh.

Sau khi pull bằng digest, dùng
`docs/operations/gpu-worker-acceptance.md` để thu inventory, latency, peak VRAM
và stability evidence. Image build/smoke thành công không thay thế GPU acceptance.
