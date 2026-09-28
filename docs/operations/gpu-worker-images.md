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

## RunPod (một pod, hai worker)

Target `runpod` đóng cả hai agent (`BATCH_MEDIA` và `INTERACTIVE_TTS`) vào chung
một image `ghcr.io/ThanhTuGenki/gpu-worker-runpod`, chạy `reup-pod-supervisor` làm
entrypoint. Chi tiết thiết kế ở
[`docs/superpowers/specs/2026-09-28-runpod-worker-image-design.md`](../superpowers/specs/2026-09-28-runpod-worker-image-design.md).
Không SSH vào pod, không chạy `bootstrap.sh` hay `pull_image.py` như hai image
kia.

1. Tải artifact `gpu-worker-runpod-supply-chain` của workflow
   `.github/workflows/gpu-worker-images.yml` chạy thành công, mở file
   `gpu-worker-runpod.digest.txt` bên trong, giữ lại `registry@sha256:<digest>`.
2. Duyệt image hai lần bằng `POST /worker-images`, cùng `imageDigest` (từ digest ở
   bước 1) và `contractVersion=2`, khác nhau ở `role` và `capabilities`:
   - `role=BATCH_MEDIA`, capabilities `transcript.asr.v1`,
     `audio.separate.demucs.v1`, `media.render.ffmpeg.v1`;
   - `role=INTERACTIVE_TTS`, capability `tts.omnivoice.v1`.
3. Tạo hai Worker bằng `POST /workers` từ hai approved image trên, cùng đặt
   `provider=RunPod`:
   - Worker Batch (`approvedImageId` của image `BATCH_MEDIA`) đặt `hourlyRateCp`
     bằng đúng giá thuê theo giờ của pod;
   - Worker TTS (`approvedImageId` của image `INTERACTIVE_TTS`) đặt
     `hourlyRateCp="0"`, để không đếm trùng chi phí pod.

   Mỗi lần tạo Worker trả về một enrollment token dùng một lần; giữ lại cả hai
   (`REUP_BATCH_ENROLLMENT_TOKEN`, `REUP_TTS_ENROLLMENT_TOKEN`).
4. Tạo Tailscale auth key loại **ephemeral, pre-approved** và **dùng một lần
   (không bật reusable)**, gắn `tag:gpu`. Mỗi pod cần một key mới. ACL tailnet
   chỉ cho `tag:gpu` gọi tới Control Plane qua HTTPS.
5. Tạo template RunPod:
   - image `ghcr.io/thanhtugenki/gpu-worker-runpod@sha256:<digest>` (immutable
     reference, không dùng tag);
   - Secure Cloud, GPU 24 GB, container disk ít nhất 60 GB; **không cần volume
     disk** (credential, model cache và state Tailscale nằm trên container disk,
     pod dùng xong thì bỏ);
   - để **trống "Container Start Command"**: image đã có entrypoint
     `reup-pod-supervisor`, mọi tham số thêm vào đều làm supervisor thoát `2`;
   - biến môi trường theo bảng §5.1 của spec: `REUP_CONTROL_PLANE_HOST` (hoặc
     `REUP_CONTROL_PLANE_URL` khi debug/tunnel), `TS_AUTHKEY`,
     `REUP_WORKER_IMAGE_DIGEST` là cùng digest ở bước 1 nhưng chỉ phần
     `sha256:<64 ký tự hex>`, **không gồm repository**,
     `REUP_BATCH_ENROLLMENT_TOKEN`, `REUP_TTS_ENROLLMENT_TOKEN`, và tuỳ chọn
     `REUP_POD_ROLES` (mặc định `batch,tts`). `REUP_CONTROL_PLANE_URL` phải kết
     thúc bằng `/worker/v1`;
   - biến tinh chỉnh agent `REUP_WORKER_*` đặt trên template **bị bỏ qua có chủ
     đích**: supervisor tự đặt các biến này cho từng role.
6. Tạo pod từ template. Xem Logs có dòng
   `[supervisor] starting agents: batch,tts`, rồi xác nhận hai Worker chuyển
   `ACTIVE` trên UI. Điền `providerInstanceId` bằng RunPod pod ID nếu muốn đối
   chiếu.
7. Khi xong việc, **terminate** pod — không stop rồi resume, vì credential nằm
   trên container disk và sẽ mất. Muốn dùng lại thì tạo Worker (hoặc token) mới
   và tạo pod mới từ đầu. Đừng dùng việc đổi trạng thái Worker để "tắt" pod: Worker
   không còn `ACTIVE` thì agent của nó thoát `0`, supervisor khởi động lại agent
   và pod vẫn tính tiền. Muốn ngừng pod thì terminate nó.
8. Xử lý lỗi theo mã thoát của `reup-pod-supervisor` và tiền tố log
   `[supervisor]` / `[batch]` / `[tts]` / `[tailscale]`:

   | Exit code | Mã log | Nguyên nhân | Xử lý |
   |---|---|---|---|
   | `2` | (tên biến thiếu, không kèm giá trị) | Thiếu biến môi trường bắt buộc | Bổ sung biến còn thiếu trong template rồi tạo pod lại |
   | `3` | `TAILSCALE_UNAVAILABLE` | `tailscaled`/`tailscale up` không lên tailnet trong 60 giây, hoặc `tailscaled` chết giữa chừng (log `tailscaled exited: TAILSCALE_UNAVAILABLE`; supervisor dừng hai agent trước khi thoát) | Kiểm tra `TS_AUTHKEY` còn hiệu lực và chưa bị dùng (key dùng một lần, ephemeral hết hạn nhanh), kiểm tra ACL `tag:gpu`, xem log `[tailscale]` |
   | `4` | `CONTROL_PLANE_UNREACHABLE` | Control Plane không trả `ready` qua proxy Tailscale sau 5 phút | Kiểm tra `REUP_CONTROL_PLANE_HOST`/`_URL`, tình trạng Control Plane, ACL tailnet |

   Enrollment bị từ chối (token sai, đã dùng, hết hạn) không làm supervisor
   thoát; nó chỉ log mã lỗi và retry có backoff — tạo Worker hoặc token mới rồi
   tạo pod mới.
