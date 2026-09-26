# Runbook Control Plane bằng Docker Compose + Tailscale

## Phạm vi

Chạy PostgreSQL, API và Web bằng `compose.yaml` trên máy cá nhân, rồi cho GPU
Worker thuê ngoài gọi về API qua Tailscale. Cách chạy bằng pnpm trên host vẫn
dùng được cho phát triển; xem `control-plane-web-api.md`.

```text
Browser (máy này) ─┐
GPU Worker ────────┴─► https://<PUBLIC_HOST>        tailscale serve (TLS của tailnet)
                         └─► 127.0.0.1:8080  web    nginx: SPA tĩnh
                               ├─ /v1/*         → api:3000  (SSE không buffer)
                               └─ /worker/v1/*  → api:3000
                                     api ─► postgres (volume postgres-data)
Browser / GPU Worker ─► Cloudflare R2 trực tiếp qua signed URL
```

Chỉ có một origin HTTPS. Web build ở chế độ production, nên bắt buộc
`https://…/v1`. API chạy `NODE_ENV=production` với `CORS_ORIGINS` đúng bằng origin
đó. Không có service nào publish port ra ngoài loopback.

## 1. Chuẩn bị Tailscale (một lần)

1. Cài Tailscale trên máy chạy compose rồi đăng nhập.
2. Trong admin console của tailnet, mục **DNS**, bật **MagicDNS** và
   **HTTPS Certificates**.
3. Lấy tên máy:

   ```bash
   tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'
   # ví dụ: my-mac.tail1234.ts.net
   ```

## 2. Khởi động stack

```bash
cp compose.env.example .env
# Điền PUBLIC_HOST (tên ở bước 1.3), POSTGRES_PASSWORD, và
# SETTINGS_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose up -d --build --wait
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

Thứ tự khởi động: `postgres` healthy, rồi `migrate` chạy `prisma migrate deploy`
và thoát 0, rồi `api` healthy (`/v1/health/ready`), cuối cùng `web`.

Kiểm tra:

```bash
docker compose ps -a                        # migrate: Exited (0); còn lại healthy
curl -fsS https://<PUBLIC_HOST>/v1/health/ready
```

Sau đó mở `https://<PUBLIC_HOST>` trong browser. **Không dùng
`http://localhost:8080`**, vì Web gọi API bằng URL đã nhúng lúc build và CORS chỉ
cho phép origin HTTPS này.

Ghi chú vận hành:

- `PUBLIC_HOST` được nhúng vào image Web. Đổi tên máy hoặc tailnet thì chạy lại
  `docker compose up -d --build web api`.
- Sửa code thì chạy lại `docker compose up -d --build`. Migration mới sẽ tự áp
  khi `migrate` chạy lại.
- `SETTINGS_ENCRYPTION_KEY` mã hóa credential lưu qua Settings. Mất hoặc đổi key
  thì phải nhập lại mọi credential.
- DB nằm trong volume `postgres-data`. `docker compose down` vẫn giữ dữ liệu;
  `docker compose down -v` sẽ **xóa** toàn bộ DB.
- Log: `docker compose logs -f api`. Dùng `X-Request-Id` để đối chiếu log.

## 3. Cấu hình trên UI trước khi thuê GPU

1. **Settings → Cloudflare R2**: nhập bucket và credential rồi bấm test. CORS của
   bucket phải cho phép origin `https://<PUBLIC_HOST>` (method `PUT`, `GET`,
   `HEAD`), vì browser upload video thẳng lên R2.
2. **Settings → Content Agent**: chọn provider, model và API key. Bắt buộc có khi
   dịch zh → vi.
3. Upload video. Job sẽ dừng ở `WAITING_FOR_GPU` cho tới khi có Worker phù hợp.

## 4. Duyệt image và tạo Worker

DB mới chưa có image nào được duyệt, và UI mới chỉ liệt kê image. Lấy digest từ
artifact `*.digest.txt` của workflow `GPU Worker images` (xem
`gpu-worker-images.md`), rồi duyệt image qua API. Ví dụ cho image Batch:

```bash
curl -fsS -X POST "https://<PUBLIC_HOST>/v1/worker-images" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "role": "BATCH_MEDIA",
    "semanticVersion": "0.1.0",
    "imageDigest": "sha256:<digest>",
    "registryRef": "ghcr.io/thanhtugenki/gpu-worker-batch@sha256:<digest>",
    "contractVersion": 2,
    "capabilities": ["transcript.asr.v1", "audio.separate.demucs.v1", "media.render.ffmpeg.v1"]
  }'
```

- Image TTS dùng `"role": "INTERACTIVE_TTS"`, repository
  `gpu-worker-interactive-tts` và `"capabilities": ["tts.omnivoice.v1"]`.
- `contractVersion` phải khớp label `io.reup.worker.contract-version` của image
  (hiện tại là `2`).
- **Lệch capability đã biết:** image Batch hiện khai báo
  `media.asr.faster-whisper.v1` và `media.separate.demucs.v1` trong
  `REUP_WORKER_CAPABILITIES`. API (`ROLE_CAPABILITIES` trong
  `workers.service.ts`) và pipeline DAG lại dùng `transcript.asr.v1` và
  `audio.separate.demucs.v1`. Hãy duyệt image bằng tên của API như ví dụ trên, và
  override `REUP_WORKER_CAPABILITIES` khi chạy Worker ở bước 5. Worker chọn
  adapter theo `task_type`, nên override không làm thay đổi cách chạy task.

Tiếp theo vào **Workers → Thêm worker**, chọn image vừa duyệt và nhập provider
cùng giá theo giờ. **Enrollment token chỉ hiện một lần**, cần chép lại ngay.

## 5. Chạy GPU Worker trên máy thuê

Máy thuê phải join cùng tailnet. Trên VM có Docker và NVIDIA Container Toolkit:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=<tskey-auth-…>   # nên dùng key ephemeral
curl -fsS https://<PUBLIC_HOST>/worker/v1/sessions -X POST -o /dev/null -w '%{http_code}\n'
# 401 là đúng: đã tới được API, chỉ thiếu credential.

docker run -d --name reup-worker-batch --gpus all --restart unless-stopped \
  -e REUP_WORKER_CONTROL_PLANE_URL=https://<PUBLIC_HOST>/worker/v1 \
  -e REUP_WORKER_IMAGE_DIGEST=sha256:<digest> \
  -e REUP_WORKER_ENROLLMENT_TOKEN=<token> \
  -e REUP_WORKER_CAPABILITIES=transcript.asr.v1,audio.separate.demucs.v1,media.render.ffmpeg.v1 \
  -v reup-worker:/var/lib/reup-worker \
  ghcr.io/thanhtugenki/gpu-worker-batch@sha256:<digest>
```

Worker TTS chạy tương tự với image `gpu-worker-interactive-tts`, digest và token
riêng, không cần override capability.

- Sau lần enroll đầu, credential được ghi vào
  `/var/lib/reup-worker/state/credential`. Giữ nguyên volume khi restart và không
  cần token nữa.
- Nếu provider chỉ cấp container, không có TUN hay Docker daemon (như EzyCloudX
  trong `gpu-worker-acceptance.md`), cần chạy `tailscaled --tun=userspace-networking`
  và cho Worker đi qua proxy của tailscaled. Cách này **chưa được nghiệm thu**
  trong repository; ghi kết quả vào `acceptance-log.md` nếu dùng.
- Worker chuyển sang `READY` trên màn Workers. Job `WAITING_FOR_GPU` sẽ được claim.

## 6. Hoàn tất pipeline

1. Sau bước TTS, mở **Studio** của video, nghe bản dựng, rồi chọn **Approve** và
   **Lưu review**. Pipeline chỉ render tiếp sau khi được duyệt.
2. Xong việc: vào **Workers**, drain worker, đợi `SAFE_TO_TERMINATE`, xóa máy tại
   provider, rồi bấm xác nhận termination. Control Plane không tự xóa máy thuê.
3. `tailscale serve --https=443 off` khi không muốn mở entrypoint nữa.

## Xử lý sự cố

- `migrate` thoát khác 0: `docker compose logs migrate`. Kiểm tra
  `POSTGRES_PASSWORD`. Nếu đổi password sau khi volume đã tạo, Postgres vẫn giữ
  password cũ.
- `api` không healthy: config sai sẽ chỉ in `API startup failed`. Kiểm tra
  `PUBLIC_HOST` không có scheme và `SETTINGS_ENCRYPTION_KEY` là base64 của đúng
  32 byte.
- Browser báo lỗi CORS hoặc cấu hình Control Plane: đang mở sai origin, hoặc
  `PUBLIC_HOST` đổi mà chưa rebuild `web`.
- Upload lên R2 lỗi CORS: thêm `https://<PUBLIC_HOST>` vào CORS của bucket.
- Worker không kết nối: trên máy GPU chạy `tailscale status` và
  `curl https://<PUBLIC_HOST>/v1/health/live`.
