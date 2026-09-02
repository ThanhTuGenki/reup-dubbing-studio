# Reup Dubbing Studio — Thiết kế hệ thống

- **Ngày:** 2026-08-23
- **Cập nhật:** 2026-08-31 — phụ đề Việt xuất thành file `.srt` rời, không burn-in vào video
- **Cập nhật:** 2026-08-31 — bỏ Postiz; Content Agent chuẩn bị nội dung, người dùng đăng thủ công và app quản lý trạng thái
- **Cập nhật:** 2026-08-31 — EzyCloudX dùng manual registered worker cho tới khi có API công khai chính thức
- **Cập nhật:** 2026-08-31 — GPU Worker phát hành bằng Docker image có version; thêm máy thuê bằng cấu hình và bootstrap token, không sửa code
- **Cập nhật:** 2026-09-01 — chốt OmniVoice là TTS engine duy nhất; tách Batch Media Worker và Interactive TTS Worker trên Docker GPU EzyCloudX
- **Trạng thái:** Bản thiết kế chờ duyệt (design, pre-implementation)
- **Chủ dự án:** tu_dinh@lrm.jp
- **Artifact review duy nhất:** [Thiết kế hoàn chỉnh — kiến trúc, flow và GPU](../../reup-dubbing-complete-design.html)

---

## 0. Tóm tắt để review nhanh

1. App chính chạy 24/7 trên VPS: Web App, API/orchestrator, queue, PostgreSQL và
   Content Agent.
2. Người dùng chọn video nguồn; VPS tải raw và lưu vào R2.
3. Media job được đưa vào queue. Nếu chưa có GPU, EzyCloudX hiện yêu cầu người
   dùng thuê Docker GPU/VM thủ công và chạy bootstrap command của app.
4. Khi worker báo `READY`, app tự giao job theo vai trò: Batch Media Worker xử lý
   VSR/OCR/ASR/Demucs/render; Interactive TTS Worker chạy OmniVoice và được giữ
   nóng trong phiên Studio để nghe lại câu vừa sửa với độ trễ thấp.
5. Worker trả về video đã lồng tiếng Việt và file SRT rời, không burn-in sub Việt.
6. Content Agent dùng meta + toàn bộ SRT + thumbnail + Channel Profile để tạo gói
   YouTube/Facebook có cấu trúc, sửa/copy riêng từng trường.
7. Người dùng upload MP4/SRT/thumbnail và copy nội dung thủ công; app lưu lịch,
   checklist, assignee và URL/post ID.
8. App chỉ cleanup file nặng sau khi mọi publication task bắt buộc đã verified.
9. Với EzyCloudX hiện tại, app cảnh báo `SAFE_TO_TERMINATE` nhưng người dùng vẫn
   phải xóa worker trên dashboard để ngừng tính phí.
10. Khi EzyCloudX cấp official API, chỉ thay adapter để app tự provision/terminate;
    pipeline, queue, worker và UI không phải viết lại.

---

## 1. Mục tiêu

Xây một ứng dụng **tự chủ** để reup video: tải video nguồn
(chủ yếu Douyin/Bilibili — tiếng Trung), **xóa hard-sub gốc**, **dịch + lồng
tiếng Việt**, xuất **phụ đề Việt `.srt` rời** (không chèn phụ đề Việt vào hình),
thêm intro/outro, xuất bản 16:9 và 9:16, rồi **đăng và quản lý** trên nhiều
kênh Facebook + YouTube.

Nguyên tắc xuyên suốt: **giữ nguyên nội dung video gốc** (đây là reup, không
dựng lại từ đầu); **tự động là mặc định, con người chỉ can thiệp ở điểm đáng
giá**; phần nào cần control cao thì tự xây, phần bảo trì nhàm chán thì tái dùng
mã nguồn mở. **"Tự host" nghĩa là tối ưu chi phí và quyền kiểm soát** — chọn tự
host hay dịch vụ đám mây tùy cái nào rẻ/hợp lý hơn cho từng lớp (ví dụ: đã chọn
R2 thay MinIO, LLM qua API thay vì tự chạy), không phải cấm SaaS một cách cứng nhắc.

### Cảnh báo bản quyền (đã trao đổi với chủ dự án)
Giữ nguyên hình + audio gốc là trường hợp bị YouTube Content ID và Facebook
Rights Manager phát hiện gần như tuyệt đối. Công cụ này trung tính về mặt kỹ
thuật; **chủ dự án tự chịu trách nhiệm** đảm bảo nguồn đầu vào là nội dung được
phép dùng (mua bản quyền, được ủy quyền, CC, hoặc thỏa thuận chia sẻ với chủ
kênh gốc). Thiết kế không nhằm né tránh phát hiện bản quyền.

---

## 2. Phạm vi

**Trong phạm vi:**
- Tải video từ Douyin/Bilibili (và nguồn khác yt-dlp hỗ trợ) bằng cookie đăng nhập.
- Xóa hard-sub trong vùng chỉ định (mask), bằng inpainting AI.
- Bóc lời (ASR) → dịch sang tiếng Việt theo câu.
- Lồng tiếng Việt: 1 giọng / 2 giọng (người dẫn + nhân vật) / đa giọng tự động
  gán theo nhân vật — chọn theo hồ sơ.
- Ghép giọng lồng tiếng Việt với nhạc + hiệu ứng đã tách khỏi giọng gốc; ghép
  intro/outro + logo.
- Xuất video đã lồng tiếng ở định dạng 16:9 và 9:16, không burn-in phụ đề Việt.
- Xuất file phụ đề Việt `.srt` riêng, cùng tên và nằm cạnh từng video thành phẩm.
- Content Agent sinh title, description/caption, hashtag, thumbnail text/prompt
  theo từng nền tảng từ dữ liệu mà app đã có.
- Người dùng tự upload video, SRT, thumbnail và copy/paste nội dung; app quản lý
  lịch, checklist, người phụ trách, URL/post ID và trạng thái từng nền tảng.

**Ngoài phạm vi (chưa làm):**
- Dựng video sáng tạo phức tạp (chèn b-roll, hiệu ứng nâng cao).
- Phân tích view/analytics chuyên sâu (dựa vào dashboard sẵn có của nền tảng).
- Diarization audio đa diễn viên (Kịch bản B) — để giai đoạn sau.

**Khối lượng mục tiêu:** 5–10 video/ngày, 3–5 kênh.

---

## 3. Khái niệm cốt lõi: Profile (Hồ sơ)

Thay cho từ "template". Vì cấu hình **tích lũy theo thời gian** (cast sheet lớn
dần theo tập), "hồ sơ" sát nghĩa hơn "template/preset" tĩnh. Chia 2 cấp:

### 3.1 Channel Profile (Hồ sơ kênh)
Dùng chung cho cả kênh:
- Intro/outro, logo/watermark.
- Cấu hình phụ đề rời: ngôn ngữ, quy tắc đặt tên và giới hạn độ dài dòng SRT.
- Cấu hình OmniVoice mặc định: ngôn ngữ đích, voice profile, tốc độ và chính sách
  khớp thời lượng segment.
- Kênh đích: YouTube channel / Facebook Page; quy tắc giọng văn, CTA, template
  metadata và từ khóa nền cho Content Agent.
- Cấu hình xuất mặc định: 16:9 và/hoặc 9:16.
- Chính sách lưu giữ file (số ngày, xem mục 7).

### 3.2 Series Profile (Hồ sơ bộ) — kế thừa Channel Profile
Riêng cho từng bộ truyện/phim:
- **Mask vùng xóa sub:** tọa độ dải chứa hard-sub (thường cố định ở đáy). Model
  chỉ inpaint trong vùng này → nhanh và sạch hơn nhiều so với quét cả khung.
- **Chế độ giọng:** `single` / `dual` / `multi-auto`.
- **Cast sheet:** bản đồ `nhân vật → giọng`, lớn dần khi thêm tập; tập sau tự
  nhận lại nhân vật cũ.

Video lẻ (tin tức/trend) không cần Series Profile — chỉ Channel Profile là đủ.

---

## 4. Kiến trúc tổng thể

Ba khối tách rời, nối nhau qua hàng đợi job + storage chung:

> **Lưu ý:** ứng dụng không chạy toàn bộ trên máy thuê GPU. VPS là máy chủ chính
> chạy liên tục; GPU worker chỉ xử lý media nặng. Với EzyCloudX hiện tại, người
> dùng thuê/xóa worker thủ công; app chỉ có thể tự bật/tắt hoàn toàn sau khi nhà
> cung cấp xác nhận API công khai chính thức.

1. **Control plane** (VPS rẻ, chạy 24/7)
   - Web dashboard (quản lý video, hồ sơ, cast sheet, studio biên tập và bàn đăng bài).
   - Hàng đợi job (job queue) + database trạng thái.
   - Content Agent + Manual Publishing Workspace; không tích hợp uploader mạng xã hội.
   - Ingest điều phối tải (yt-dlp) — tác vụ nhẹ, chạy tại đây.

2. **GPU workers** (Docker GPU thuê theo giờ; khả năng tự bật/tắt phụ thuộc API provider)
   - **Batch Media Worker:** xóa hard-sub, OCR/ASR, Demucs và final render; ưu tiên
     GPU VRAM cao, chỉ bật khi có media job.
   - **Interactive TTS Worker:** chỉ chạy OmniVoice; ưu tiên RTX 3060 12 GB và giữ
     model nóng trong phiên Studio để sinh lại từng câu mà không chờ cold start.
   - Provider hiện dùng: **EzyCloudX**. Ở trạng thái thiết kế hiện tại, người dùng
     thuê/xóa từng container trên dashboard EzyCloudX; app tự giao đúng loại job
     sau khi worker đăng ký vai trò.

3. **Storage chung** (S3-compatible)
   - Kho tài sản (asset store) trao đổi file giữa 2 khối trên.
   - **Đã chốt: Cloudflare R2** — rẻ, egress miễn phí (app đẩy render ra liên tục),
     hạ tầng ổn định, gần như không phải bảo trì. Code giữ chuẩn S3-compatible để
     có thể đổi sang MinIO tự host bằng config nếu cần.
   - **MVP (GĐ1) chưa cần**: chạy 1 máy, dùng thư mục local; R2 vào từ GĐ2 khi
     GPU worker tách khỏi VPS.
   - Lưu ý riêng cho nội dung reup: file trên R2 chịu quy trình xử lý vi phạm của
     Cloudflare (giảm nhẹ vì sau khi đăng chỉ còn text, mọi file nặng đã xóa —
     kho chỉ là nơi xử lý tạm).

### 4.1 Thành phần chạy ở đâu

| Nơi chạy | Thành phần | Trạng thái hoạt động | Trách nhiệm |
|---|---|---|---|
| VPS | Web App, API/Pipeline Orchestrator, Job Queue, PostgreSQL, Content Agent | 24/7 | UI, điều phối, trạng thái, profile, nội dung SEO và bàn đăng bài |
| EzyCloudX Docker GPU | Batch Media Worker | Thuê/xóa thủ công; bật khi có media job | VSR inpainting, OCR/ASR, Demucs và final render |
| EzyCloudX Docker GPU | Interactive TTS Worker | Giữ nóng trong phiên Studio; tắt sau phiên edit | OmniVoice initial dub, re-gen câu, preview audio và timing fit |
| GitHub Actions + GHCR | CI/CD + Container Registry | Khi phát hành phiên bản worker | Build, kiểm tra và lưu Docker image GPU Worker theo version/digest để máy thuê pull |
| Cloudflare R2 | Asset Store | Dịch vụ ngoài, dùng chung | Chuyển raw/desub/audio/MP4/SRT giữa VPS và GPU; cấp file cho người dùng tải |
| LLM provider | LLM API | Gọi theo nhu cầu | Dịch, phân vai, chọn highlight và sinh nội dung có cấu trúc |
| Trình duyệt người dùng | Studio + Bàn đăng bài | Khi người dùng thao tác | Duyệt, sửa, copy nội dung, tải MP4/SRT/thumbnail và upload thủ công |
| YouTube/Facebook | Nền tảng đích | Ngoài hệ thống | Nhận upload thủ công; app chỉ lưu checklist và URL/post ID |

Vì GPU worker là stateless và có thể bị hủy bất kỳ lúc nào, PostgreSQL không đặt
trên GPU. Worker nhận job từ queue, đọc/ghi asset qua R2 và trả trạng thái về
control plane; không giữ bản dữ liệu duy nhất trên ổ đĩa cục bộ của máy GPU.

### 4.2 GPU Provider Adapter và kết luận về EzyCloudX

Kết quả kiểm tra ngày 2026-08-31 trên tài liệu công khai của EzyCloudX:

- EzyCloudX có **GPU VM** và **Docker GPU**, tính bằng Computing Point. Docker GPU
  tính theo giờ chạy thực tế; xóa container thì ngừng tính phí. VM tự gia hạn cho
  tới khi người dùng chủ động xóa.
- **Computing Point (CP) không phải VND** và EzyCloudX không công bố tỷ lệ quy đổi
  cố định. App lưu/hiển thị CP trước; chỉ quy đổi ra tiền từ tỷ lệ thực tế của lần
  mua CP do người dùng nhập.
- Hướng dẫn chính thức mô tả quy trình thuê qua dashboard: đăng nhập, chọn GPU,
  chọn gói/thời gian và xác nhận thanh toán.
- Frontend dashboard có gọi các endpoint nội bộ để tạo/kết thúc rental, nhưng
  không tìm thấy tài liệu developer, API key/service account, versioning hay SLA
  cho tích hợp bên ngoài. Endpoint nội bộ không được xem là API công khai và
  **không đưa vào production integration**.

Nguồn chính thức:
[Hướng dẫn bắt đầu](https://www.ezycloudx.com/blog/huong-dan-bat-dau-voi-dich-vu-thue-gpu),
[Computing Point & cơ chế tính sử dụng](https://www.ezycloudx.com/computing-point-system),
[GPU theo giờ](https://www.ezycloudx.com/gpu-hourly).

Thiết kế dùng interface `GPUProviderAdapter` để không khóa chặt vào một nhà cung
cấp:

```text
ensure_capacity(profile) -> WorkerLease
get_status(lease_id) -> PROVISIONING | READY | STOPPING | TERMINATED | ERROR
terminate(lease_id)
estimate_cost(profile, duration)
```

Hai mode triển khai:

| Mode | Ai tạo/xóa GPU? | App tự làm gì? | Dùng khi nào? |
|---|---|---|---|
| `MANUAL_REGISTERED_WORKER` — **đã chốt cho EzyCloudX hiện tại** | Người dùng thuê và xóa trên dashboard EzyCloudX | Sinh bootstrap token, nhận heartbeat, giao job, theo dõi idle/cost estimate và cảnh báo người dùng xóa máy | Chưa có API công khai chính thức |
| `API_PROVISIONED_WORKER` — tương lai | App gọi API provider để tạo và terminate | Chọn cấu hình, provision, bootstrap, drain, terminate và xác minh đã ngừng tính phí | Chỉ bật khi provider cấp API key + tài liệu + điều khoản automation |

Không dùng browser automation, cookie đăng nhập hay gọi endpoint dashboard nội bộ
để giả lập API. Các cách đó dễ hỏng, khó bảo mật tài khoản thanh toán và có thể
trái điều khoản nhà cung cấp.

#### Snapshot chi phí Docker GPU để lập ngân sách

Giá quan sát trên dashboard EzyCloudX ngày 2026-09-01, chỉ dùng làm snapshot và
không hard-code vào app:

| Docker GPU | Giá hiển thị | 4 giờ/ngày × 22 ngày | 8 giờ/ngày × 22 ngày | 24/7 × 30 ngày |
|---|---:|---:|---:|---:|
| 1× RTX 3060 12 GB `na-01` | 4.000 CP/giờ | 352.000 CP | 704.000 CP | 2.880.000 CP |
| 1× RTX 3060 12 GB `eu-01` | 7.500 CP/giờ | 660.000 CP | 1.320.000 CP | 5.400.000 CP |
| 2× RTX 3060 `eu-01` | 15.000 CP/giờ | 1.320.000 CP | 2.640.000 CP | 10.800.000 CP |

Không thuê 2× RTX 3060 trong cùng container chỉ để chạy hai vai trò. Hai container
1 GPU độc lập cho phép Batch Worker và TTS Worker có image, queue, vòng đời và
chi phí riêng. Region rẻ nhất chưa chắc cho UX tốt nhất; MVP phải đo latency thật
từ Studio tới `na-01` và `eu-01` trước khi chọn mặc định.

### 4.3 Luồng EzyCloudX hiện tại — manual registered worker

1. Khi queue có job GPU nhưng chưa có worker phù hợp, app đặt job ở
   `WAITING_FOR_GPU` và hiển thị cấu hình theo vai trò: Batch Worker ưu tiên VRAM
   cao; Interactive TTS Worker đề xuất 1× RTX 3060 12 GB.
2. Người dùng mở EzyCloudX, thuê cấu hình và tạo Docker GPU/VM thủ công. **Ưu tiên
   Docker GPU** cho pipeline Python/CUDA vì gần với worker container và cơ chế
   tính phí theo giờ chạy thực tế.
3. App sinh bootstrap command/token dùng một lần. Người dùng chạy command trên
   worker; worker kéo đúng image/version, kết nối queue/R2 và gửi heartbeat.
4. Khi worker `READY`, app giao job theo `worker_role`; người dùng không cần chạy
   từng lệnh VSR/OCR/OmniVoice/Demucs/render.
5. Worker upload kết quả lên R2, báo `SUCCEEDED`, sau đó chuyển sang `IDLE`.
6. Batch Worker có idle TTL 10–15 phút. TTS Worker không dùng TTL ngắn trong lúc
   Studio còn phiên edit; app giữ model nóng rồi mới đặt `SAFE_TO_TERMINATE` khi
   phiên edit kết thúc hoặc hết session timeout.
7. Người dùng xóa container trên EzyCloudX rồi bấm xác nhận; app lưu
   `terminated_at` và chi phí CP ước tính.

Điểm giới hạn: ở mode này app **không thể đảm bảo tự ngừng tính phí**, vì thao tác
xóa vẫn thuộc dashboard EzyCloudX. Cần cảnh báo nổi bật và nhắc lại cho tới khi
người dùng xác nhận đã xóa.

#### 4.3.1 Đóng gói và đưa code lên máy GPU thuê

Không clone repository và không sửa source trực tiếp trên từng máy thuê. Hai vai
trò dùng hai image nhỏ, độc lập để tránh xung đột dependency và cold start không
cần thiết:

```text
ghcr.io/<owner>/reup-dubbing-media-worker:<version>
ghcr.io/<owner>/reup-dubbing-tts-worker:<version>
```

Pipeline phát hành chuẩn:

```text
Git push/tag
  → GitHub Actions chạy test và build CUDA image
  → push image theo version + immutable digest lên GHCR
  → máy EzyCloudX pull đúng image/digest
  → container đăng ký với Control Plane
```

Hai image dùng chung Worker Agent base. Media image chứa FFmpeg, Video Subtitle
Remover, OCR/ASR và Demucs; TTS image chỉ chứa OmniVoice, FlashInfer/CUDA tương
thích và audio tooling tối thiểu. Model lớn, voice prompt và cache nằm trên volume
hoặc R2; image không chứa API key, token đăng nhập hay credential R2 dài hạn.

Control Plane luôn chạy trên VPS. Máy GPU chỉ chạy GPU Worker và có thể bị hủy mà
không làm mất database, queue hoặc bản duy nhất của asset.

#### 4.3.2 Thuê thêm GPU không yêu cầu sửa code

Mỗi máy thuê là một bản ghi worker động trong database, không phải một cấu hình
hard-code. Tại màn hình **GPU Workers**, người vận hành chọn **Thêm GPU Worker** và
nhập:

- tên hiển thị, ví dụ `worker-gpu-02`;
- vai trò `BATCH_MEDIA` hoặc `INTERACTIVE_TTS`;
- provider `EzyCloudX` và provider instance/container ID nếu có;
- đơn giá CP/giờ, tỷ lệ mua CP thực tế nếu muốn quy đổi VND và thời điểm bắt đầu tính phí;
- GPU/VRAM kỳ vọng và image version đã duyệt.

App sinh enrollment token dùng một lần và bootstrap command. Ví dụ minh họa:

```bash
docker run -d \
  --name reup-gpu-worker \
  --restart unless-stopped \
  --gpus all \
  -e WORKER_ROLE=INTERACTIVE_TTS \
  -e CONTROL_PLANE_URL=https://app.example.com \
  -e ENROLLMENT_TOKEN=<one-time-token> \
  -v /data/reup-worker:/workspace \
  -v /data/model-cache:/models \
  ghcr.io/<owner>/reup-dubbing-tts-worker:<version>
```

Người dùng SSH hoặc mở terminal của container/VM EzyCloudX và chạy command đó.
Token một lần chỉ dùng để enrollment; sau khi đăng ký, Control Plane cấp credential
riêng có phạm vi hẹp cho worker. Nếu GHCR để private, máy thuê dùng credential chỉ
có quyền `read:packages` để pull image.

#### 4.3.3 Nhận diện, heartbeat và trạng thái worker

Worker tự đọc model GPU, VRAM, nhiệt độ và mức sử dụng bằng `nvidia-smi`; tên hiển
thị và đơn giá lấy từ bản ghi do người dùng tạo. Agent gửi heartbeat định kỳ cùng
image version, job hiện tại và các metric vận hành. App suy ra trạng thái:

| Điều kiện | Trạng thái hiển thị |
|---|---|
| Có heartbeat, chưa nhận job | `READY` / Đang rảnh |
| Có heartbeat, đang giữ job lease | `BUSY` / Đang bận |
| Ngừng nhận job mới, chờ job cuối hoàn tất | `DRAINING` |
| Queue trống, artifact cuối đã upload/commit | `SAFE_TO_TERMINATE` |
| Mất heartbeat quá safety timeout | `OFFLINE` / cần kiểm tra |

Dashboard đang giám sát **GPU Worker Agent**, không giám sát trực tiếp tài khoản
EzyCloudX. Vì vậy nhãn UI dùng `GPU Worker online`; `EzyCloudX` được hiển thị ở
trường provider của worker.

#### 4.3.4 Phiên thuê và chi phí ước tính

Đơn giá không hard-code theo model GPU và không yêu cầu deploy lại app. Mỗi lần
thuê hoặc thay đổi giá tạo một `WorkerBillingSession` mới với snapshot:

```text
worker_id
provider
provider_instance_id
hourly_rate_cp
paid_vnd_per_cp_optional
billing_started_at
billing_ended_at
```

Chi phí gốc hiển thị là `thời gian phiên × hourly_rate_cp`, được ghi rõ **ước
tính**. Chỉ hiển thị VND khi có `paid_vnd_per_cp_optional` từ giao dịch mua CP
thực tế. Khi chưa có official billing API, số này có thể lệch hóa đơn do quy tắc
làm tròn, khuyến mãi hoặc thời điểm EzyCloudX bắt đầu tính. Thay đổi đơn giá hiện
tại không được làm thay đổi lịch sử các phiên trước.

#### 4.3.5 Cập nhật worker và tắt máy an toàn

Không hot-edit container đang chạy. Phiên bản mới được CI build thành image mới;
người vận hành drain worker, pull image đã duyệt rồi tạo lại container. Dashboard
hiển thị image version hiện tại và cảnh báo khi có bản mới.

Trước khi xóa máy thuê:

```text
BUSY → DRAINING → upload/commit artifact cuối → SAFE_TO_TERMINATE
     → người dùng xóa trên EzyCloudX → xác nhận TERMINATED trong app
```

Chỉ hiển thị `SAFE_TO_TERMINATE` khi worker không còn job lease, queue không còn
job dành riêng cho worker và mọi output cần thiết đã có trên R2. Việc dừng Docker
container không đồng nghĩa chắc chắn đã ngừng tính phí; người dùng vẫn phải xóa
rental trên EzyCloudX theo cơ chế hiện tại.

### 4.4 Luồng tự động khi EzyCloudX có API chính thức

`QUEUE_DEMAND → PROVISIONING → BOOTSTRAPPING → READY → BUSY → DRAINING →
TERMINATING → TERMINATED`.

- `PROVISIONING`: adapter chọn preset đã duyệt; không tự nâng cấu hình ngoài giới
  hạn chi phí của Channel/System Profile.
- `BOOTSTRAPPING`: cấp token ngắn hạn, R2 presigned URL và job lease; không đưa
  khóa R2 dài hạn vào máy thuê.
- `BUSY`: heartbeat 30 giây; job lease có timeout và idempotency key để tránh xử
  lý trùng khi worker mất kết nối.
- `DRAINING`: không nhận job mới; chờ upload/commit artifact cuối cùng.
- `TERMINATING`: gọi API xóa, sau đó poll tới `TERMINATED`; không coi HTTP 200 là
  đã ngừng tính phí nếu provider chưa xác nhận trạng thái cuối.
- Safety timeout: provision quá 10 phút hoặc mất heartbeat quá 2 phút thì dừng
  giao job, thu hồi token và cảnh báo vận hành.

```
[Nguồn Douyin/Bilibili]
        | (yt-dlp + cookie)
        v
   Ingest (VPS) ---> Asset Store (raw)
        |
        v
   Job Queue  <----------------------------+
        |                                   |
        v                                   |
   Batch Media Worker: desub -> OCR/ASR -> Demucs
        |
        v
   VPS: dịch -> gán nhân vật
        |
        v
   Interactive TTS Worker: OmniVoice initial dub
        v
   Studio (VPS web): xem/nghe preview -> sửa câu/cast/giọng
        |                              |
        |<-- OmniVoice re-gen câu -----+
        v
   Batch Media Worker: final render video lồng tiếng (16:9 + 9:16) + SRT rời
        |
        v
   Content Agent -> Bàn đăng bài -> người dùng upload thủ công
                                      |
                                      v
                         App lưu URL/post ID + trạng thái
```

---

## 5. Luồng xử lý một video (pipeline)

Đơn vị dữ liệu xuyên suốt là **segment (câu)**: ASR chia câu → dịch theo câu →
gán nhân vật theo câu → TTS theo câu → khớp lại timestamp gốc.

| # | Bước | Công cụ | Nơi chạy |
|---|------|---------|----------|
| 1 | Tải video gốc (kèm cookie auth) | yt-dlp | VPS |
| 2 | Xóa hard-sub trong vùng mask | video-subtitle-remover (STTN/LAMA/ProPainter) | GPU |
| 3 | Bóc lời: **OCR hard-sub** (chính) + ASR (đối chiếu) → transcript + timestamp câu | PaddleOCR / faster-whisper | GPU |
| 4 | Dịch transcript → kịch bản Việt theo câu | LLM (API) | VPS |
| 5 | Gán nhân vật (nếu chế độ `multi-auto`) + **LLM chọn đoạn highlight** cho bản 9:16 | LLM | VPS |
| 6 | OmniVoice tạo initial dub từng segment và preview có tiếng | OmniVoice | Interactive TTS Worker |
| 7 | Studio: xem/nghe preview; duyệt cast sheet; sửa câu/cast/giọng; re-gen đúng segment đã đổi | Web UI + OmniVoice | VPS + Interactive TTS Worker giữ nóng |
| 8 | **Tách audio (Demucs): bỏ giọng gốc, giữ nhạc + hiệu ứng** → ghép các WAV đã duyệt + intro/outro; final render 16:9 & 9:16, không burn-in phụ đề | Demucs + ffmpeg | Batch Media Worker |
| 8a | Xuất phụ đề Việt thành file `.srt` riêng, cùng basename và nằm cạnh từng video thành phẩm | Python | VPS/GPU worker |
| 8b | Content Agent nhận `meta` + toàn bộ SRT Việt + thumbnail + Channel Profile → sinh gói nội dung có cấu trúc riêng cho YouTube/Facebook | LLM API | VPS |
| 9 | Bàn đăng bài: duyệt/sửa/copy từng trường; tải MP4/SRT/thumbnail; người dùng upload thủ công rồi nhập URL/post ID | Web UI + người dùng | VPS/trình duyệt |

### 5.1 Xóa hard-sub (bước 2 — rủi ro nhất)
- Dùng [video-subtitle-remover](https://github.com/YaoFANGUK/video-subtitle-remover)
  (hỗ trợ CUDA + Apple Silicon).
- Đây là công cụ wrapper đã chọn cho pipeline; bên trong sẽ dùng model inpainting
  phù hợp trong nhóm **STTN/LAMA/ProPainter**. Model cụ thể chưa chốt: MVP phải
  chạy thử cùng một clip khoảng 30 giây và chọn theo chất lượng xóa, vệt mờ còn
  lại, thời gian chạy và bộ nhớ GPU.
- **Chỉ xử lý trong vùng mask** của Series Profile → nhanh và sạch hơn.
- **Giới hạn thực tế:** nền tĩnh xóa sạch; nền chuyển động phức tạp ngay sau chữ
  để lại vệt mờ. Không công cụ mã nguồn mở nào xóa hoàn hảo 100%.
- Đây là bước tốn GPU nhất → khoản chi phí lớn nhất.
- Trạng thái hiện tại: thiết kế và adapter command-template đã có, nhưng lệnh
  thực tế trong `config.toml [desub].cmd` chưa được cấu hình; chưa thể coi bước
  xóa sub là đã nghiệm thu.

### 5.2 Lồng tiếng (bước 6–7) — OmniVoice đã chốt

TTS engine duy nhất của thiết kế là
[OmniVoice (k2-fsa)](https://github.com/k2-fsa/OmniVoice). App vẫn giữ interface
nội bộ ổn định nhưng không xây màn hình chọn nhiều engine:

```text
prepare_voice(ref_audio, ref_text) -> voice_prompt
synthesize(text, language_id, voice_prompt, target_duration) -> WAV
```

- Tạo `voice_prompt` từ clip tham chiếu 3–10 giây một lần, lưu vào R2/cache và tái
  sử dụng; không chạy auto-transcription trong mỗi lần re-gen.
- `language_id` là dữ liệu của video/profile (`vi`, `en`, ...), nên luồng Trung →
  Anh về sau dùng cùng OmniVoice; bước dịch ngôn ngữ vẫn do LLM riêng thực hiện.
- Cross-lingual clone có thể mang accent của reference gốc sang ngôn ngữ đích;
  Channel/Series Profile cho phép lưu voice prompt riêng theo ngôn ngữ đích.
- Truyền `target_duration` theo slot timestamp của segment; chỉ dùng ffmpeg
  `atempo` để tinh chỉnh nhỏ sau TTS.
- Initial dub và re-gen đều do Interactive TTS Worker xử lý. Worker giữ model nóng
  trong phiên Studio; mỗi lần sửa chỉ sinh lại segment bị thay đổi.
- Cấu hình ban đầu: 1× RTX 3060 12 GB, concurrency 1, câu ngắn theo segment. MVP
  phải đo p50/p95 latency, peak VRAM và chạy lặp tối thiểu 100 request.
- Có báo cáo cộng đồng về VRAM tăng qua nhiều lần generate; Worker Agent phải giám
  sát VRAM và restart tiến trình OmniVoice an toàn khi vượt ngưỡng hoặc sau số
  request cấu hình được.
- Benchmark tốc độ chính thức của dự án chạy trên H100, không dùng để suy ra trực
  tiếp tốc độ RTX 3060; acceptance dựa trên phép đo của chính container EzyCloudX.

**Gate giấy phép:** code OmniVoice là Apache 2.0 nhưng
[pretrained model công bố CC-BY-NC](https://huggingface.co/k2-fsa/OmniVoice#license).
Thiết kế kỹ thuật chốt OmniVoice cho prototype/MVP; trước khi dùng cho kênh kiếm
tiền phải có quyền thương mại phù hợp hoặc trọng số được cấp phép khác. Không âm
thầm thay engine trong production.

### 5.3 Chế độ giọng (bước 5–7)
- `single`: 1 giọng đọc tất cả (video game, recap truyền thống). Rẻ nhất.
- `dual`: 1 giọng người dẫn + 1 giọng chung cho mọi lời thoại. Gần như không sai.
- `multi-auto`: LLM đánh nhãn mỗi câu là người dẫn / nhân vật nào →
  gán giọng theo cast sheet. Sinh động nhất; ~90% đúng, cần bước sửa ngoại lệ.
  Tham khảo: [audiobook-creator](https://github.com/prakharsr/audiobook-creator),
  [LLM quotation attribution](https://arxiv.org/pdf/2406.11380).

Con người chỉ can thiệp 2 chỗ: **duyệt cast sheet 1 lần/bộ** và **sửa vài câu
LLM gán sai**. Không chỉnh tuần tự từng câu.

### 5.4 Bóc lời: OCR trước, ASR đối chiếu
Hard-sub tiếng Trung = lời thoại đã có dạng chữ trên hình kèm timing chính xác.
**OCR chính sub gốc (PaddleOCR)** thường chính xác hơn và timestamp khớp hơn nghe
audio. Chiến lược: OCR làm nguồn chính, faster-whisper làm đối chiếu/dự phòng
(video không có sub hoặc OCR kém). **MVP chạy cả hai trên cùng video để so sánh
rồi chốt.** Bonus: vùng chữ OCR phát hiện được có thể dùng làm gợi ý mask xóa sub.

### 5.5 Audio: tách nhạc nền bằng Demucs (đã chốt)
Không ducking toàn bộ audio gốc (sẽ mất nhạc nền + hiệu ứng, video "chết").
**Demucs** (mã nguồn mở, GPU) tách audio gốc thành giọng nói vs phần còn lại →
vứt giọng gốc, **giữ nhạc + hiệu ứng**, đặt giọng Việt lên trên.

### 5.6 Khớp timing giọng Việt
Câu tiếng Việt thường dài hơn câu gốc → giọng lồng có thể tràn qua câu sau.
Chiến lược theo thứ tự: (1) prompt dịch yêu cầu độ dài tương đương; (2) tăng nhẹ
tốc độ đọc TTS; (3) co giãn audio (ffmpeg `atempo` ≤ ±15%); (4) cho phép lệch
nhẹ nếu khoảng lặng phía sau đủ rộng. Chi tiết chốt ở MVP.

### 5.7 Bản 9:16 = highlight (đã chốt)
LLM đọc script → chọn đoạn hay nhất 1–3 phút làm Shorts/Reels; đoạn chọn hiện
trong Studio để sửa tay nếu muốn. Render 9:16 crop/scale từ nguồn 16:9.

### 5.8 Đầu ra video lồng tiếng + phụ đề rời (đã chốt)
- Video thành phẩm đã có **giọng lồng tiếng Việt**, đồng thời giữ phần nhạc nền
  và hiệu ứng sau khi Demucs loại giọng nói gốc.
- Không burn-in phụ đề Việt vào khung hình video.
- Mỗi video có một file `.srt` tiếng Việt riêng, cùng basename và nằm trong cùng
  thư mục, ví dụ `out_16x9.mp4` + `out_16x9.srt`.
- Bản highlight 9:16 có cặp file riêng, ví dụ `out_9x16.mp4` + `out_9x16.srt`;
  timestamp trong SRT phải được cắt và đưa về mốc `00:00:00` theo đoạn highlight.
- File SRT là đầu ra thành phẩm và được giữ lâu dài vì dung lượng nhỏ. Người dùng
  tải file này từ Bàn đăng bài và upload thủ công vào trường subtitle/caption của
  nền tảng; không được âm thầm quay lại phương án burn-in.

### 5.9 Content Agent và gói nội dung đăng bài (đã chốt)
- Content Agent chạy **bên trong app** bằng LLM API; Google Drive/ChatGPT Project
  hiện tại chỉ là prototype tham khảo, không phải dependency bắt buộc.
- App truyền trực tiếp dữ liệu đang quản lý: `video_key`, title/description/tags
  nguồn, toàn bộ SRT Việt, thumbnail gốc và Channel Profile. Không tìm folder
  Drive, không suy luận input/output từ tên file.
- Output là dữ liệu có cấu trúc: YouTube title/description/keywords/hashtags;
  Facebook caption/hashtags; thumbnail text/image prompt. Mỗi trường sửa, khóa,
  regenerate và copy riêng được.
- Prompt tách thành bốn lớp: Channel Profile (brand voice/CTA/template), Platform
  Rules, Video Context và Output Schema. Không hard-code một prompt khổng lồ cho
  mọi kênh.
- Kiểm tra trước khi duyệt: giới hạn độ dài theo profile, hashtag/từ khóa không
  liên quan, chữ Trung còn sót, trường bắt buộc và claim không có trong nguồn.
- Thumbnail mới có thể làm thủ công từ prompt ở MVP; sinh ảnh tự động là adapter
  tùy chọn về sau, không chặn quy trình đăng.

---

## 6. Nguồn: Discovery + Ingest + quản lý cookie

### 6.1 Discovery (tìm & chọn video — không tải)
Không copy link từng video. Hai chế độ nhập, đều dùng yt-dlp đọc **chỉ metadata**
(`--flat-playlist -J`), chưa tải nội dung → nhanh, nhẹ:
- **Dán link kênh/tác giả/playlist:** yt-dlp liệt kê toàn bộ video của trang đó.
- **Gõ từ khóa:** search extractor (`bilisearch:` cho Bilibili, `ytsearch:` cho
  YouTube). Douyin search hạn chế → ưu tiên dán link tác giả.

Kết quả đổ ra **bảng** trong dashboard: tiêu đề, thời lượng, ngày đăng, lượt xem,
thumbnail, id, trạng thái (mới / đã tải). Người dùng tick chọn → **enqueue job
tải** cho các video đã chọn (chuyển sang 6.2).

**Watchlist (theo dõi):** lưu link kênh/tác giả → hệ thống định kỳ chạy lại
discovery → hiện video mới chưa tải. Đây cũng là cơ chế tự phát hiện nội dung mới.

### 6.2 Ingest (tải thật)
- yt-dlp tải Douyin/Bilibili khi được nạp cookie đăng nhập (chủ dự án đã có tài
  khoản). Bilibili cần login để lấy HD; Douyin cần cookie + link có chữ ký hết
  hạn nhanh → **phải tải và lưu ngay, không lưu link để lấy lại**.
- HD thường tách 2 luồng (hình + tiếng) → yt-dlp tải cả hai, ffmpeg ghép thành
  `.mp4` → đẩy lên Asset Store thành `raw` → xóa bản tạm trên VPS.

### 6.3 Quản lý cookie
- Lưu cookie an toàn theo từng nguồn (mã hóa tại rest); nhập từ file cookie
  (định dạng Netscape, xuất từ trình duyệt đã đăng nhập).
- Cảnh báo cookie hết hạn: khi một nguồn báo lỗi tải/liệt kê liên tiếp → báo
  dashboard để nạp lại cookie.

---

## 7. Asset Store & chính sách lưu giữ

Mỗi video giữ một chuỗi tài sản:
- `raw` — file gốc tải về (to nhất)
- `desubbed` — bản đã xóa hard-sub
- `transcript`, `script` (bản dịch theo câu), `cast` (nhãn nhân vật) — text, nhẹ
- `dub/` — các đoạn giọng theo câu
- `out_16x9.mp4`, `out_9x16.mp4` — video lồng tiếng thành phẩm, không burn-in sub
- `out_16x9.srt`, `out_9x16.srt` — phụ đề Việt rời tương ứng
- `publish_content` — title/description/caption/hashtag/thumbnail prompt đã duyệt
- `publication_tasks` — task riêng cho từng nền tảng/kênh, lịch, assignee,
  checklist, URL/post ID và thời gian đăng

**Chính sách lưu giữ (quyết định của chủ dự án — "đăng xong thì xóa hết file nặng"):**
- Chỉ sau khi **mọi publication task bắt buộc** đã hoàn tất checklist và có
  URL/post ID do người dùng nhập → mới cho phép xác nhận đạt và xóa `raw` +
  `desubbed` + `dub` + các file video thành phẩm `.mp4`; không xóa file `.srt`.
- **Chỉ giữ lâu dài phần text nhẹ:** `transcript` / `script` / `cast`, các file
  `.srt` thành phẩm, `publish_content` và `publication_tasks` (để tái sử dụng,
  tích lũy cast sheet và lưu vết nội dung/trạng thái đã đăng).
- Hệ quả: muốn render lại một video đã đăng thì phải tải lại từ nguồn và xóa sub
  lại từ đầu (chấp nhận được — chi phí lưu trữ gần như bằng 0).
- Trước khi đăng xác nhận, file nặng vẫn còn để làm lại nếu phát hiện lỗi.

---

## 8. Content Agent & đăng thủ công có quản lý

**Quyết định:** bỏ Postiz và không tự xây uploader YouTube/Facebook. App tối ưu
khâu chuẩn bị, bàn giao và theo dõi; người dùng chịu trách nhiệm thao tác đăng.

### 8.1 Bàn đăng bài (Manual Publishing Workspace)
- Mỗi video/kênh/nền tảng là một `publication_task` riêng; YouTube đã đăng không
  làm task Facebook tự hoàn tất.
- Hiển thị video preview + nút tải MP4, SRT và thumbnail.
- Tab YouTube/Facebook chứa các trường Content Agent đã sinh; mỗi trường có
  Edit / Copy / Regenerate / Lock và lịch sử phiên bản.
- Checklist tối thiểu: upload MP4, upload SRT, chọn thumbnail, copy metadata,
  chọn playlist/category nếu áp dụng, đăng/lên lịch, nhập URL hoặc post ID.
- App quản lý `scheduled_at`, `assigned_to`, ghi chú, deadline và cảnh báo task
  quá hạn; không quản lý OAuth/token đăng bài.

### 8.2 Trạng thái publication task
`READY_FOR_CONTENT → CONTENT_GENERATED → CONTENT_APPROVED → READY_TO_PUBLISH →
POSTING_MANUAL → PUBLISHED → VERIFIED`; có nhánh `NEEDS_REVISION` quay lại bước
duyệt nội dung. Chỉ người dùng hoặc bước kiểm chứng URL mới được đặt `PUBLISHED`.

### 8.3 Bằng chứng đăng
- Khi đăng xong, người dùng dán URL/post ID; app lưu platform, channel, thời gian,
  metadata cuối cùng và người thực hiện.
- Kiểm chứng URL public/read-only là tùy chọn về sau. MVP chấp nhận xác nhận tay.
- Không tự động xóa asset nếu thiếu URL, còn task bắt buộc chưa hoàn tất hoặc một
  nền tảng đang ở `NEEDS_REVISION`.

---

## 8b. Orchestration: tự xây, không dùng n8n

**Quyết định:** phần lõi (pipeline, studio, quản lý) **tự xây REST API + job
queue**, không dùng n8n.

Lý do:
- Phần lõi có mô hình dữ liệu riêng (segment, cast sheet), adapter TTS, LLM gán
  nhân vật — không phải "nối API". Nhét vào node n8n sẽ thành viết code trong
  Function node, tệ hơn viết code thẳng.
- Job GPU chạy lâu + lifecycle worker + retry theo logic nghiệp vụ + human-in-
  the-loop (dừng chờ duyệt cast sheet) → n8n xử lý gượng ép.
- Code thật dễ debug, test và version control; workflow n8n là JSON blob khó review.
- Thêm n8n = thêm một service phải host + bảo trì cho lợi ích nhỏ.

**Kỹ thuật đề xuất:** Redis + RQ (hoặc Celery) làm hàng đợi job cho pipeline Python.

**n8n để về sau (tùy chọn, không bắt buộc):** chỉ cân nhắc cho glue no-code ở rìa
hệ thống (theo dõi nguồn có video mới, thông báo cookie hết hạn). Kiến trúc tách
khối qua job queue/API cho phép cắm n8n vào sau mà không sửa phần lõi.

## 9. Rủi ro & giới hạn

| Rủi ro | Mức | Xử lý |
|--------|-----|-------|
| Xóa hard-sub để lại vệt mờ trên nền động | Cao | Kiểm chứng ở MVP; giới hạn cố hữu của mã nguồn mở |
| OmniVoice chưa đạt latency/chất lượng trên RTX 3060 | Trung | Benchmark câu thật; giữ model nóng; cache voice prompt; đo p50/p95 và peak VRAM |
| OmniVoice tăng VRAM sau nhiều lượt generate | Cao | Segment ngắn; concurrency 1; giám sát VRAM; restart tiến trình TTS có kiểm soát |
| Pretrained model OmniVoice là CC-BY-NC | Cao | Chặn production kiếm tiền cho tới khi có quyền thương mại hoặc trọng số phù hợp |
| LLM gán nhân vật sai | Trung | Bước sửa ngoại lệ; chế độ `dual`/`single` an toàn hơn |
| Quên xóa EzyCloudX worker gây tiếp tục tính phí | Cao | Idle TTL, cảnh báo lặp lại, trạng thái `SAFE_TO_TERMINATE`; ưu tiên official API nếu có |
| Chi phí GPU cho desub | Trung | Mask vùng nhỏ; batch job; theo dõi chi phí/video và snapshot đơn giá lúc thuê |
| Cookie nguồn hết hạn | Thấp | Cảnh báo tự động khi tải lỗi hàng loạt |
| Người dùng quên đăng hoặc quên lưu URL | Trung | Lịch, assignee, checklist, cảnh báo quá hạn; chặn cleanup |
| Nội dung AI sai hoặc quá đà SEO | Trung | Grounding bằng meta/SRT/thumbnail; duyệt tay; regenerate từng trường |
| Bản quyền (Content ID) | Ngoài kỹ thuật | Trách nhiệm chủ dự án về nguồn đầu vào |

### 9.1 Ước tính chi phí vận hành (ở 10 video/ngày — MVP sẽ đo số thật)
- GPU EzyCloudX: tách chi phí Batch Media Worker và Interactive TTS Worker. App
  lưu snapshot CP/giờ, thời điểm READY/TERMINATED và chi phí ước tính; chỉ quy đổi
  VND từ tỷ lệ mua CP thực tế, không xem số CP là số tiền.
- LLM API (dịch + gán nhân vật + metadata): ~1–5 USD/tháng.
- VPS control plane: ~10–20 USD/tháng. R2: ~vài USD/tháng (đăng xong xóa file nặng).
- **Tổng cỡ 100–350 USD/tháng** khi chạy hết công suất.
- Vận hành khác: backup PostgreSQL hằng ngày lên R2 (text/cast sheet là tài sản
  quý nhất); "xác nhận đạt" là nút bấm tay trong dashboard.

---

## 10. Lộ trình theo giai đoạn

Mỗi giai đoạn có spec → plan → triển khai riêng.

### Giai đoạn 1 — MVP (làm trước, kiểm chứng rủi ro)
Chạy trọn **1 video** từ đầu đến cuối bằng **script CLI**, chưa có web UI/Content Agent:
tải → xóa hard-sub (mask cố định) → bóc lời (**so sánh OCR vs ASR**) → dịch →
lồng **1 giọng** → **Demucs giữ nhạc nền** → render video lồng tiếng 16:9 không
burn-in phụ đề + xuất file SRT rời cùng tên.
**Mục tiêu:** đo (a) chất lượng xóa hard-sub, (b) độ tự nhiên giọng lồng,
(c) OCR hay ASR chính xác hơn, (d) chi phí GPU thật/video. Nếu đạt, phần còn
lại chỉ là mở rộng; nếu không, biết sớm mà không tốn công xây cả hệ thống.

### Giai đoạn 2 — Studio & tự động hóa
Web dashboard + hàng đợi job + `MANUAL_REGISTERED_WORKER` cho EzyCloudX;
`API_PROVISIONED_WORKER` chỉ bật khi có official API; Channel/Series Profile;
chế độ giọng `dual`/`multi-auto` + cast sheet + studio sửa ngoại lệ; xuất 9:16.

### Giai đoạn 3 — Content Agent & đăng thủ công
Content Agent; Bàn đăng bài; task theo từng kênh/nền tảng; lịch + assignee +
checklist; lưu URL/post ID; chính sách lưu giữ tự động; cảnh báo cookie.

---

## 11. Màn hình & chức năng Dashboard

Nhóm điều hướng và các màn hình chính (phần lớn thuộc Giai đoạn 2–3; MVP chạy CLI).

**Nhóm Vận hành**
1. **Tổng quan (Dashboard home)** — số video theo trạng thái; job đang chạy; lịch
   đăng sắp tới; chi phí GPU; cảnh báo (cookie hết hạn, job lỗi).
2. **Nguồn & Watchlist** — dán link kênh/tác giả hoặc tìm kiếm → bảng video → tick
   chọn → tải hàng loạt; quản lý watchlist tự quét video mới; chống trùng.
3. **Hàng đợi xử lý (Jobs)** — job theo từng bước pipeline + tiến độ; retry job lỗi;
   xem log; thêm/enroll/drain GPU worker; theo dõi heartbeat, image version và
   chi phí ước tính; hướng dẫn người dùng xóa rental trên EzyCloudX.
4. **Thư viện video (Library)** — mọi video + trạng thái (raw → published); lọc theo
   kênh/bộ/trạng thái; mở chi tiết để vào Studio.

**Nhóm Sản xuất**
5. **Studio biên tập (Editor)** ★ màn hình phức tạp nhất — bảng segment từng câu:
   sửa text Việt, gán/đổi giọng, nghe thử, re-gen câu; duyệt cast sheet; sửa ngoại
   lệ; preview → xác nhận render.

**Nhóm Cấu hình**
6. **Hồ sơ (Channel & Series)** — intro/outro, kiểu sub, cấu hình OmniVoice, nền tảng
   đăng; mask vùng xóa sub (vẽ khung trực tiếp); chế độ giọng; cast sheet.
7. **Bàn đăng bài & Kênh** — calendar/task sắp đăng; gói MP4/SRT/thumbnail;
   Content Agent; form YouTube/Facebook có Copy từng trường; assignee/checklist;
   nhập URL/post ID và xác nhận hoàn tất.
8. **Cài đặt** — OmniVoice, LLM API key; GPU provider; Asset Store (MinIO/R2);
   cookie nguồn; chính sách lưu giữ mặc định.

## 12. Tech stack

Ràng buộc quyết định: **toàn bộ chuỗi AI/media (yt-dlp, video-subtitle-remover,
faster-whisper, OmniVoice, pyannote, LLM SDK) đều là Python** →
pipeline + GPU worker bắt buộc Python.

| Lớp | Ngôn ngữ / Công cụ | Lý do |
|-----|--------------------|-------|
| Pipeline + GPU worker | Python 3.11+ (PyTorch, ffmpeg qua subprocess) | Mọi tool AI/media là Python |
| Backend API | FastAPI (Python) | Dùng chung model với worker, một ngôn ngữ cho backend |
| Hàng đợi job | Redis + RQ (hoặc Celery) | Nhẹ, chuẩn Python |
| Database | PostgreSQL | Trạng thái, hồ sơ, segment, cast sheet, job |
| Frontend (Dashboard + Studio) | TypeScript + React | Studio editor tương tác cao |
| Object storage | MinIO / R2 | Asset Store |
| Phát hành GPU Worker | Docker + GitHub Actions + GHCR | Build một lần, pull image theo version/digest trên mọi máy thuê |
| Chuẩn bị đăng | Content Agent trong FastAPI + React workspace | Sinh nội dung có cấu trúc, copy/download, checklist và trạng thái |
| Đăng bài | Người dùng thao tác trên YouTube/Facebook | Giữ toàn quyền SEO, thumbnail, playlist và thiết lập nền tảng |

**Phương án bị loại:**
- All-Node/TS: media/AI không có trên Node → vẫn phải gọi Python.
- All-Python UI (Streamlit/Gradio): hợp prototype/MVP, nhưng Studio editor cần
  tương tác tinh vi → React vẫn đáng.

**Theo giai đoạn:** GĐ1 (MVP) **thuần Python, chỉ CLI** — chưa cần FastAPI/React.
TypeScript/React chỉ xuất hiện ở GĐ2 khi dựng giao diện.

## 13. Quyết định đã chốt

- Nguồn đầu vào: video người khác từ Douyin/Bilibili (chủ dự án chịu trách nhiệm bản quyền).
- Định dạng ra: cả 16:9 và 9:16.
- Hạ tầng: VPS + GPU cloud thuê theo giờ (bật khi dùng studio).
- GPU runtime: ưu tiên EzyCloudX Docker GPU headless; Batch Media Worker và
  Interactive TTS Worker là hai container/vòng đời độc lập, không thuê 2 GPU trong
  một container chỉ để gộp hai vai trò.
- TTS: **chỉ OmniVoice**; initial dub và re-gen segment chạy trên Interactive TTS
  Worker giữ nóng trong phiên edit. Production kiếm tiền bị chặn cho tới khi giải
  quyết quyền sử dụng pretrained model CC-BY-NC.
- Triển khai GPU Worker: Docker image có version trên GHCR; thuê thêm worker bằng
  bản ghi động + enrollment token, không sửa code và không clone source lên máy thuê.
- Chi phí GPU: snapshot đơn giá theo từng phiên thuê và hiển thị là ước tính cho
  tới khi provider có official billing API.
- Khối lượng: 5–10 video/ngày, 3–5 kênh.
- Thể loại: recap phim/truyện, tin tức/trend, game/highlight, kiến thức tổng hợp.
- Sub gốc: hard-sub cháy vào hình; nguồn nước ngoài → dịch sang Việt.
- Gán giọng: tùy biến theo hồ sơ (single/dual/multi-auto).
- Đặt tên cấu hình: Channel Profile + Series Profile (thay "template").
- Lưu trữ: có asset store; sau khi đăng xác nhận đạt → xóa `raw` + `desubbed` +
  `dub` + render, **chỉ giữ text** (`script`/`cast`). Chi phí lưu trữ ~0.
- Object storage: **Cloudflare R2** (S3-compatible, đổi sang MinIO được); MVP dùng
  thư mục local.
- Auth nguồn: đã có tài khoản Douyin/Bilibili → nạp cookie.
- Orchestration: tự xây REST API + job queue (Redis + RQ/Celery), không dùng n8n.
- Nguyên tắc "tự host" = tối ưu chi phí + quyền kiểm soát, không cấm SaaS cứng nhắc.
- Audio: **Demucs tách giọng gốc, giữ nhạc + hiệu ứng** (không ducking toàn bộ).
- Bản 9:16 = **highlight 1–3 phút do LLM chọn, sửa tay được trong Studio**.
- Metadata (title/mô tả/hashtag/thumbnail): **LLM tự sinh + duyệt trong Studio**.
- Đăng bài: **không Postiz, không uploader tự động**; Content Agent chuẩn bị gói
  nội dung, người dùng copy/upload thủ công, app lưu checklist + URL/post ID.
- Bóc lời: OCR hard-sub làm chính, ASR đối chiếu — MVP so sánh rồi chốt.
- Đầu ra: **video đã lồng tiếng Việt, không burn-in phụ đề** + file `.srt` tiếng
  Việt rời cùng basename cho từng tỷ lệ khung hình.
