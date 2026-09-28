# Image worker cho RunPod (một pod, hai worker)

- **Trạng thái:** `IMPLEMENTED` (chờ chạy thử trên RunPod).
- **Ngày:** 2026-09-28.
- **Liên quan:**
  - [`docs/architecture/application.md`](../../architecture/application.md) §9;
  - [`gpu-worker-control-plane.md`](../../architecture/gpu-worker-control-plane.md);
  - [`docs/operations/gpu-worker-images.md`](../../operations/gpu-worker-images.md);
  - `workers/gpu/containers/Dockerfile`;
  - `workers/gpu/rental/*`.
- **Ngoài phạm vi:**
  - Control Plane tự thuê và trả pod qua RunPod API (spec tiếp theo);
  - cache runtime/model trên R2;
  - khái niệm "một máy thuê chứa nhiều worker" trong DB;
  - multi-GPU;
  - chạy nhiều task GPU đồng thời.

## 1. Mục tiêu

Dự án chuẩn hóa dùng RunPod (Secure Cloud, on-demand) để thuê GPU. RunPod chạy
thẳng một Docker image cho mỗi pod, nên ta cần **một image** chứa đủ cả hai worker
đang chạy chung một GPU. Sau thay đổi này:

1. Người vận hành tạo một pod RunPod từ template gồm image `gpu-worker-runpod`
   theo digest, biến môi trường và disk. Pod tự nối Tailscale, tự khởi động
   worker `BATCH_MEDIA` và worker `INTERACTIVE_TTS`, rồi enroll với Control Plane.
   Không SSH, không chạy `bootstrap.sh` hay `pull_image.py`.
2. Cập nhật worker nghĩa là build image mới, đổi digest trong template, rồi tạo pod
   mới.
3. Image này là nền cho spec sau: Control Plane gọi RunPod API tạo và dừng pod, với
   đúng các biến môi trường mô tả ở đây.

## 2. Quyết định đã chốt

- **Giữ tách hai role, hai agent, hai venv** như thiết kế (`application.md` §9).
  Chỉ gộp phần đóng gói.
- **Thêm target `runpod`** vào cùng `workers/gpu/containers/Dockerfile`. Hai
  target `batch` và `interactive-tts` giữ nguyên, dùng cho EzyCloudX hoặc máy có
  Docker thật.
- **Control Plane không đổi schema.** `approved_worker_images` là unique theo
  `(role, image_digest)`, nên cùng một digest `gpu-worker-runpod` được duyệt hai
  lần, mỗi role một lần. Một pod vẫn là hai `Worker`, dùng hai enrollment token.
- **Chi phí trùng:** worker `BATCH_MEDIA` mang đúng giá thuê của pod, còn worker
  `INTERACTIVE_TTS` đặt `hourlyRateCp = "0"` (API cho phép, validate `>= 0`). Cả
  hai đặt `provider = "RunPod"` và `providerInstanceId = <RunPod pod id>`. Khái
  niệm máy thuê dùng chung sẽ làm ở spec provisioning.
- **Pod dùng xong thì bỏ.** Dừng hoặc terminate pod thì container disk mất, kéo
  theo credential. Mỗi pod mới cần enrollment token mới. Không hỗ trợ "stop rồi
  resume pod cũ" để giữ credential.

## 3. Ràng buộc từ hiện trạng

- **Hai image hiện tại đều đặt venv ở `/opt/reup-worker`.** `bootstrap.sh` phải
  đổi tên venv TTS thành `/opt/reup-worker-tts` khi giải nén. Image mới phải
  **build** venv TTS thẳng tại `/opt/reup-worker-tts`, không copy rồi đổi tên
  venv, vì venv Python chứa đường dẫn tuyệt đối.
- **Capability trong `Dockerfile` đang lệch với Control Plane.** Dockerfile có
  `media.asr.faster-whisper.v1` dạng phân tách bằng dấu phẩy. DAG của Control Plane
  đòi `transcript.asr.v1`, `audio.separate.demucs.v1`, `media.render.ffmpeg.v1`.
  Ngoài ra pydantic-settings đọc tuple dạng JSON trước khi chạy validator, nên chuỗi
  có dấu phẩy làm agent crash (`start-workers.sh` đã ghi chú điều này). Target
  `runpod` dùng đúng tên và dạng JSON như `start-workers.sh`:
  - Batch: `["transcript.asr.v1","audio.separate.demucs.v1","media.render.ffmpeg.v1"]`;
  - TTS: `["tts.omnivoice.v1"]`.
- **Agent tự bắt `SIGTERM`/`SIGINT` để dừng** (`reup_worker/main.py`). Enrollment
  token chỉ dùng được một lần. Credential lưu ở `REUP_WORKER_CREDENTIAL_FILE`.
- **`image_smoke` từ chối chạy bằng root.** Image chạy UID/GID `10001`.
- **RunPod không cấp `/dev/net/tun`.** Tailscale chạy userspace và mở HTTP proxy
  outbound, giống `bootstrap.sh`. Chỉ lưu lượng tới Control Plane đi qua proxy;
  R2, HuggingFace và PyTorch đi thẳng.
- **Agent phải biết digest của image đang chạy** (`REUP_WORKER_IMAGE_DIGEST`),
  nhưng image không tự biết digest của mình. Digest được truyền qua biến môi
  trường của template.

## 4. Kiến trúc image

```text
foundation (CUDA 12.8 + uv + Python 3.11 + reup_worker, như hiện nay)
├── batch            (giữ nguyên)
├── interactive-tts  (giữ nguyên)
├── runpod-tts-venv  (build venv TTS tại /opt/reup-worker-tts từ tts/requirements.lock)
└── runpod           FROM foundation
                     COPY --from=batch           /opt/reup-worker  /opt/reup-demucs
                     COPY --from=runpod-tts-venv /opt/reup-worker-tts
                     + tailscale, tailscaled (tarball tĩnh khóa phiên bản + sha256)
                     USER 10001, ENTRYPOINT ["reup-pod-supervisor"]
```

- Các venv được copy sang vẫn giữ **nguyên đường dẫn** như lúc build. Riêng venv
  TTS được build ngay tại `/opt/reup-worker-tts`.
- Base CUDA/cuDNN là của chính `foundation`, nên **không cần** thủ thuật
  `LD_LIBRARY_PATH=/opt/reup/cuda-lib` như `bootstrap.sh`.
- Tailscale được tải bằng bản tĩnh `tailscale_<ver>_amd64.tgz` từ
  `pkgs.tailscale.com`. Phiên bản và sha256 khóa bằng `ARG`, không `curl | sh`.
- Không đóng model vào image. Model tải về `HF_HOME` và
  `REUP_WORKER_TTS_MODEL_CACHE_ROOT` trên container disk lúc chạy. Cache R2 là
  spec riêng.
- Registry: `ghcr.io/thanhtugenki/gpu-worker-runpod`, chỉ `linux/amd64`.

## 5. `reup-pod-supervisor`

Là module Python `reup_worker.pod_supervisor`, có entry point
`reup-pod-supervisor`, chạy bằng `/opt/reup-worker/bin/python`. Module thuần, có
unit test. Không dùng bash, không dùng supervisord.

### 5.1 Biến môi trường (template RunPod)

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `REUP_CONTROL_PLANE_HOST` | Có, nếu không có `REUP_CONTROL_PLANE_URL` | Tên máy trong tailnet, ví dụ `tyziiu.tail54f4f6.ts.net`. URL tính ra là `https://<host>/worker/v1`, đi qua proxy Tailscale. |
| `REUP_CONTROL_PLANE_URL` | Tuỳ | URL trực tiếp (không Tailscale), dùng cho debug hoặc tunnel. Nếu có thì bỏ qua Tailscale. |
| `TS_AUTHKEY` | Có khi dùng Tailscale | Auth key loại **ephemeral, pre-approved**. |
| `REUP_WORKER_IMAGE_DIGEST` | Có | `sha256:…` của chính image `gpu-worker-runpod`. |
| `REUP_BATCH_ENROLLMENT_TOKEN` | Tuỳ | Token của worker `BATCH_MEDIA`. |
| `REUP_TTS_ENROLLMENT_TOKEN` | Tuỳ | Token của worker `INTERACTIVE_TTS`. |
| `REUP_POD_ROLES` | Không (mặc định `batch,tts`) | Chọn role chạy trong pod, để sau này tách pod. |

Role được bật mà không có token lẫn credential thì supervisor ghi lỗi rõ ràng rồi
**thoát khác 0**. Không chạy nửa vời.

### 5.2 Hành vi

1. **Kiểm tra đầu vào.** Thiếu biến bắt buộc thì in tên biến, không in giá trị,
   rồi thoát `2`.
2. **Tailscale.** Nếu dùng host:
   - chạy `tailscaled --tun=userspace-networking --state=/var/lib/reup-worker/tailscale/state --socket=/var/lib/reup-worker/tailscale/sock --outbound-http-proxy-listen=127.0.0.1:1055`;
   - rồi `tailscale up --auth-key=$TS_AUTHKEY --hostname=reup-runpod-<RUNPOD_POD_ID|hostname>`.

   Quá 60 giây mà chưa lên thì thoát khác 0. RunPod sẽ báo pod lỗi.
3. **Chờ Control Plane.** Gọi `GET <base>/v1/health/ready` qua proxy, retry với
   backoff tới 5 phút. Hết thời gian thì thoát khác 0.
4. **Khởi động agent.** Mỗi role được bật chạy một process
   `<python> -m reup_worker.main` với env riêng:
   - chung: `REUP_WORKER_CONTROL_PLANE_URL`, `REUP_WORKER_CONTRACT_VERSION=2`,
     `REUP_WORKER_IMAGE_DIGEST`, `HTTPS_PROXY`/`HTTP_PROXY` (chỉ khi có
     Tailscale), và
     `NO_PROXY=localhost,127.0.0.1,.r2.cloudflarestorage.com,huggingface.co,.huggingface.co,.hf.co,download.pytorch.org,dl.fbaipublicfiles.com`;
   - Batch: role, executor, capability JSON (§3), `ASR_PYTHON`, `DEMUCS_PYTHON`,
     credential và workspace dưới `/var/lib/reup-worker/batch/`;
   - TTS: role, executor, capability JSON, python `/opt/reup-worker-tts/bin/python`,
     credential, workspace, prompt cache và model cache dưới
     `/var/lib/reup-worker/tts/`.

   Enrollment token chỉ được truyền ở lần chạy đầu. Khi file credential đã có thì
   bỏ token khỏi env.
5. **Giám sát.** Agent thoát thì khởi động lại sau 5 giây. Nếu lỗi liên tục, tăng
   dần tối đa 60 giây. Lỗi enrollment (token sai, đã dùng, hết hạn) không làm
   supervisor thoát, vì người vận hành có thể thay token bằng cách tạo pod mới.
   Nó chỉ được log với mã lỗi an toàn.
6. **Tắt pod.** Nhận `SIGTERM` thì chuyển `SIGTERM` cho các agent (agent tự dừng
   an toàn), chờ tối đa 30 giây, rồi `SIGKILL`. Sau đó dừng `tailscaled` và thoát
   `0`. Key ephemeral tự gỡ node khỏi tailnet.
7. **Log.** Mọi dòng log ra stdout (RunPod hiện trong mục Logs), có tiền tố
   `[supervisor]`, `[batch]`, `[tts]`, `[tailscale]`. Không bao giờ in token, auth
   key, credential hay URL có chữ ký.

## 6. CI và phát hành

- Thêm `runpod` vào matrix của `.github/workflows/gpu-worker-images.yml`, với
  repository `gpu-worker-runpod`. Các bước giữ như hai image kia: build, smoke,
  SBOM, scan chặn HIGH/CRITICAL đã có bản vá, push tag `0.1.0` và `sha-<sha>`,
  artifact `*.digest.txt`.
- Smoke của target `runpod`: `python -m reup_worker.image_smoke runpod` kiểm tra
  - ba interpreter import được: faster-whisper, demucs/torch và omnivoice/torch;
  - có `ffmpeg`, `tailscale`, `tailscaled`;
  - `reup-pod-supervisor --check` thoát `0`: nó xác thực cấu hình với env mẫu mà
    không chạy mạng.
- `docs/operations/gpu-worker-images.md` thêm runbook RunPod: tạo 2 approved image
  cùng digest, tạo 2 Worker (giá TTS bằng 0), tạo auth key Tailscale ephemeral,
  lưu template RunPod, tạo pod, xác nhận hai worker `ACTIVE` trên UI.

## 7. Lỗi và xử lý

| Tình huống | Hành vi |
|---|---|
| Thiếu biến bắt buộc | Thoát `2`, log tên biến |
| Tailscale không lên trong 60 s | Thoát khác 0, log `TAILSCALE_UNAVAILABLE` |
| Control Plane không `ready` sau 5 phút | Thoát khác 0, log `CONTROL_PLANE_UNREACHABLE` |
| Enrollment bị từ chối | Log mã lỗi agent, retry có backoff, không thoát |
| Agent crash lặp lại | Backoff tối đa 60 s, không thoát |
| GPU không có hoặc `nvidia-smi` lỗi | Agent tự báo trong heartbeat như hiện nay, supervisor không chặn |

## 8. Bảo mật

- Token, auth key và credential chỉ nằm trong env của pod và file mode `0600` dưới
  `/var/lib/reup-worker`. Supervisor không log chúng. Env truyền cho agent con
  không lẫn auth key Tailscale.
- Auth key Tailscale phải là loại **ephemeral**, gắn tag riêng (ví dụ `tag:gpu`).
  ACL tailnet chỉ cho `tag:gpu` gọi tới Control Plane ở cổng HTTPS.
- Chạy UID `10001`. Tailscale userspace không cần root.

## 9. Kiểm thử

- **Unit (pytest, `workers/gpu`):**
  - tính URL và proxy theo host hoặc URL;
  - build env cho từng role: capability JSON đúng, không lẫn `TS_AUTHKEY`, bỏ token
    khi đã có credential;
  - `REUP_POD_ROLES`;
  - kiểm tra thiếu biến;
  - backoff khởi động lại;
  - chuyển tiếp `SIGTERM` và timeout.

  Test không gọi mạng hay Tailscale thật; tầng chạy process được thay bằng fake.
- **Image:** smoke ở CI (§6).
- **Thủ công, trên RunPod:**
  - tạo pod từ template;
  - hai worker lên `ACTIVE`;
  - chạy một video từ đầu đến cuối (ASR → TTS → render);
  - terminate pod, hai worker chuyển `OFFLINE`, không còn node trong tailnet.

## 10. Tiêu chí hoàn thành

1. CI build và push `gpu-worker-runpod` theo digest, smoke pass.
2. Một pod RunPod chỉ cần template và env (§5.1) là có hai worker enroll `ACTIVE`,
   không cần SSH.
3. Một video chạy trọn pipeline trên pod đó và có output trong Thư viện.
4. Hai image `batch` và `interactive-tts` build như cũ. EzyCloudX với `bootstrap.sh`
   vẫn dùng được.
5. `pytest`, `ruff` và `mypy` của `workers/gpu` pass.

## 11. Rủi ro

- **Image lớn** (khoảng tổng hai image hiện tại), nên pod mới bật chậm ở lần kéo
  đầu. Giảm bằng cách không nhét model vào image, sau đó thêm cache R2.
- **Tranh VRAM giữa TTS giữ model nóng và ASR/Demucs.** Đã chạy ổn trên 24 GB ở
  EzyCloudX. GPU 12 GB chưa được kiểm chứng.
- **Build lại khi một bên đổi:** đổi batch hay TTS đều phải build lại `runpod`. CI
  dùng cache layer theo target để giảm thời gian.
