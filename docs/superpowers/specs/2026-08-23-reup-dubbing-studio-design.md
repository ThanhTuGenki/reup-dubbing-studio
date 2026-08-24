# Reup Dubbing Studio — Thiết kế hệ thống

- **Ngày:** 2026-08-23
- **Trạng thái:** Bản thiết kế chờ duyệt (design, pre-implementation)
- **Chủ dự án:** tu_dinh@lrm.jp

---

## 1. Mục tiêu

Xây một ứng dụng **tự chủ** để reup video: tải video nguồn
(chủ yếu Douyin/Bilibili — tiếng Trung), **xóa hard-sub gốc**, **dịch + lồng
tiếng Việt**, **chèn sub Việt mới**, thêm intro/outro, xuất bản 16:9 và 9:16,
rồi **đăng và quản lý** trên nhiều kênh Facebook + YouTube.

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
- Chèn sub Việt mới, ducking audio gốc, ghép intro/outro + logo.
- Xuất 16:9 và 9:16.
- Đăng và lên lịch đa kênh qua Postiz.
- Quản lý trạng thái từng video qua dashboard.

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
- Kiểu sub Việt mới: font, cỡ, vị trí, màu, viền.
- Engine giọng mặc định (adapter TTS nào).
- Nền tảng đăng: kênh YouTube nào, Facebook Page nào (map sang Postiz).
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

1. **Control plane** (VPS rẻ, chạy 24/7)
   - Web dashboard (quản lý video, hồ sơ, cast sheet, studio biên tập).
   - Hàng đợi job (job queue) + database trạng thái.
   - Postiz (self-hosted) cho đăng bài.
   - Ingest điều phối tải (yt-dlp) — tác vụ nhẹ, chạy tại đây.

2. **GPU worker** (thuê theo giờ, tự bật khi có job, xong tự tắt)
   - Xóa hard-sub (inpainting) — nặng nhất.
   - ASR (faster-whisper).
   - TTS lồng tiếng.
   - Render ffmpeg.
   - Mô hình: RunPod/Vast.ai (~0.2–0.5 USD/giờ). Chỉ chạy khi có job studio.

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
   GPU Worker: desub -> ASR -> (dịch) ------+ (dịch có thể chạy ở VPS qua LLM API)
        |            -> gán nhân vật
        v
   Studio (VPS web): duyệt cast sheet, sửa ngoại lệ
        |
        v
   GPU Worker: TTS -> render (16:9 + 9:16)
        |
        v
   Postiz (VPS): lên lịch, đăng đa kênh
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
| 6 | Studio: duyệt cast sheet 1 lần/bộ + sửa ngoại lệ + chỉnh highlight nếu muốn | Web UI | VPS |
| 7 | Lồng tiếng từng câu theo giọng đã gán | TTS adapter | GPU |
| 8 | **Tách audio (Demucs): bỏ giọng gốc, giữ nhạc + hiệu ứng** → ghép giọng Việt + sub Việt + intro/outro; xuất 16:9 & 9:16 (highlight) | Demucs + ffmpeg | GPU |
| 8b | Sinh metadata: title/mô tả/hashtag (LLM từ script); thumbnail = khung hình + đè chữ theo mẫu → **duyệt trong Studio** trước khi đăng | LLM + ffmpeg | VPS |
| 9 | Lên lịch đăng đa kênh (so le tránh quota) | Postiz | VPS |

### 5.1 Xóa hard-sub (bước 2 — rủi ro nhất)
- Dùng [video-subtitle-remover](https://github.com/YaoFANGUK/video-subtitle-remover)
  (hỗ trợ CUDA + Apple Silicon).
- **Chỉ xử lý trong vùng mask** của Series Profile → nhanh và sạch hơn.
- **Giới hạn thực tế:** nền tĩnh xóa sạch; nền chuyển động phức tạp ngay sau chữ
  để lại vệt mờ. Không công cụ mã nguồn mở nào xóa hoàn hảo 100%.
- Đây là bước tốn GPU nhất → khoản chi phí lớn nhất.

### 5.2 Lồng tiếng (bước 7) — TTS adapter
Interface chung: `(text, giọng_mẫu/voice_id) -> WAV`. Viết 3 adapter, chọn theo
config, đổi engine chỉ sửa 1 dòng:
- [OmniVoice (k2-fsa)](https://github.com/k2-fsa/OmniVoice) — đa ngôn ngữ, rất
  nhanh (RTF ~0.025), voice design; dự kiến thắng về tốc độ/chi phí GPU.
- [F5-TTS-Vietnamese-ViVoice](https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice)
  — fine-tune riêng tiếng Việt; dự kiến tự nhiên nhất, cần GPU.
- [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) — clone giọng tức thì,
  chạy CPU realtime; phương án nhẹ/không GPU.

Chốt engine bằng cách chạy thử cùng một đoạn qua cả ba rồi nghe chọn.

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

### 5.8 Metadata đăng bài (đã chốt)
LLM sinh title/mô tả/hashtag theo từng nền tảng từ script; thumbnail = bắt khung
hình + đè chữ theo mẫu của Channel Profile. Tất cả **duyệt trong Studio** trước
khi đăng.

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
- `out_16x9`, `out_9x16` — bản render cuối

**Chính sách lưu giữ (quyết định của chủ dự án — "đăng xong thì xóa hết file nặng"):**
- Sau khi bản render cuối **đã đăng và được xác nhận đạt** → xóa `raw` +
  `desubbed` + `dub` + `out_*`.
- **Chỉ giữ lâu dài phần text nhẹ:** `transcript` / `script` / `cast` (để tái sử
  dụng và tích lũy cast sheet của bộ).
- Hệ quả: muốn render lại một video đã đăng thì phải tải lại từ nguồn và xóa sub
  lại từ đầu (chấp nhận được — chi phí lưu trữ gần như bằng 0).
- Trước khi đăng xác nhận, file nặng vẫn còn để làm lại nếu phát hiện lỗi.

---

## 8. Đăng & quản lý (Postiz)

- Dùng [Postiz](https://github.com/gitroomhq/postiz-app) self-hosted cho phần
  đăng: OAuth, refresh token, lịch đăng, quản lý đa kênh, API + n8n.
- Lý do không tự viết uploader: bảo trì Facebook Graph API/YouTube quota là việc
  nhàm chán và hay đổi; Postiz đã lo và cộng đồng cập nhật.
- Kiến trúc tách khối cho phép **thay Postiz bằng uploader tự viết** sau này mà
  không đụng studio, nếu Postiz không đáp ứng.

**Quota cần tôn trọng (lịch đăng so le):**
- YouTube Data API: ~100 video upload/ngày mặc định (đủ cho 5–10 video/ngày).
- Facebook Page: ~25 bài/Page/24h.

**Rào cản cần chuẩn bị trước (GĐ3):** Postiz self-host đòi hỏi tự tạo app
developer — Google Cloud (YouTube Data API, dễ) và **Facebook App Review** để có
quyền đăng lên Page qua API (có thể mất thời gian/bị từ chối). Nên nộp review
sớm; phương án dự phòng trong lúc chờ: xuất file + lên lịch tay qua Meta
Business Suite.

---

## 8b. Orchestration: tự xây, không dùng n8n

**Quyết định:** phần lõi (pipeline, studio, quản lý) **tự xây REST API + job
queue**, không dùng n8n.

Lý do:
- Phần lõi có mô hình dữ liệu riêng (segment, cast sheet), adapter TTS, LLM gán
  nhân vật — không phải "nối API". Nhét vào node n8n sẽ thành viết code trong
  Function node, tệ hơn viết code thẳng.
- Job GPU chạy lâu + worker tự bật/tắt + retry theo logic nghiệp vụ + human-in-
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
| Giọng lồng chưa tự nhiên | Trung | So sánh 3 engine ở MVP trước khi cam kết |
| LLM gán nhân vật sai | Trung | Bước sửa ngoại lệ; chế độ `dual`/`single` an toàn hơn |
| Chi phí GPU cho desub | Trung | Mask vùng nhỏ; worker tự tắt; theo dõi chi phí/video |
| Cookie nguồn hết hạn | Thấp | Cảnh báo tự động khi tải lỗi hàng loạt |
| Facebook App Review chậm/từ chối | Trung | Nộp sớm; dự phòng lên lịch tay qua Meta Business Suite |
| Bản quyền (Content ID) | Ngoài kỹ thuật | Trách nhiệm chủ dự án về nguồn đầu vào |

### 9.1 Ước tính chi phí vận hành (ở 10 video/ngày — MVP sẽ đo số thật)
- GPU thuê theo giờ (desub + Demucs + TTS + render, ~0.5–1.5 giờ/video):
  **~90–300 USD/tháng** — khoản lớn nhất, tối ưu bằng mask nhỏ + worker tự tắt.
- LLM API (dịch + gán nhân vật + metadata): ~1–5 USD/tháng.
- VPS control plane: ~10–20 USD/tháng. R2: ~vài USD/tháng (đăng xong xóa file nặng).
- **Tổng cỡ 100–350 USD/tháng** khi chạy hết công suất.
- Vận hành khác: backup PostgreSQL hằng ngày lên R2 (text/cast sheet là tài sản
  quý nhất); "xác nhận đạt" là nút bấm tay trong dashboard.

---

## 10. Lộ trình theo giai đoạn

Mỗi giai đoạn có spec → plan → triển khai riêng.

### Giai đoạn 1 — MVP (làm trước, kiểm chứng rủi ro)
Chạy trọn **1 video** từ đầu đến cuối bằng **script CLI**, chưa có web UI, chưa Postiz:
tải → xóa hard-sub (mask cố định) → bóc lời (**so sánh OCR vs ASR**) → dịch →
lồng **1 giọng** → **Demucs giữ nhạc nền** → render 16:9.
**Mục tiêu:** đo (a) chất lượng xóa hard-sub, (b) độ tự nhiên giọng lồng,
(c) OCR hay ASR chính xác hơn, (d) chi phí GPU thật/video. Nếu đạt, phần còn
lại chỉ là mở rộng; nếu không, biết sớm mà không tốn công xây cả hệ thống.

### Giai đoạn 2 — Studio & tự động hóa
Web dashboard + hàng đợi job + GPU worker tự bật/tắt; Channel/Series Profile;
chế độ giọng `dual`/`multi-auto` + cast sheet + studio sửa ngoại lệ; xuất 9:16.

### Giai đoạn 3 — Đăng & quản lý đa kênh
Ghép Postiz; lên lịch so le đa kênh; chính sách lưu giữ tự động; cảnh báo cookie.

---

## 11. Màn hình & chức năng Dashboard

Nhóm điều hướng và các màn hình chính (phần lớn thuộc Giai đoạn 2–3; MVP chạy CLI).

**Nhóm Vận hành**
1. **Tổng quan (Dashboard home)** — số video theo trạng thái; job đang chạy; lịch
   đăng sắp tới; chi phí GPU; cảnh báo (cookie hết hạn, job lỗi).
2. **Nguồn & Watchlist** — dán link kênh/tác giả hoặc tìm kiếm → bảng video → tick
   chọn → tải hàng loạt; quản lý watchlist tự quét video mới; chống trùng.
3. **Hàng đợi xử lý (Jobs)** — job theo từng bước pipeline + tiến độ; retry job lỗi;
   xem log; bật/tắt GPU worker; theo dõi chi phí.
4. **Thư viện video (Library)** — mọi video + trạng thái (raw → published); lọc theo
   kênh/bộ/trạng thái; mở chi tiết để vào Studio.

**Nhóm Sản xuất**
5. **Studio biên tập (Editor)** ★ màn hình phức tạp nhất — bảng segment từng câu:
   sửa text Việt, gán/đổi giọng, nghe thử, re-gen câu; duyệt cast sheet; sửa ngoại
   lệ; preview → xác nhận render.

**Nhóm Cấu hình**
6. **Hồ sơ (Channel & Series)** — intro/outro, kiểu sub, engine giọng, nền tảng
   đăng; mask vùng xóa sub (vẽ khung trực tiếp); chế độ giọng; cast sheet.
7. **Lịch đăng & Kênh** — calendar bài sắp đăng, kéo-thả đổi giờ; kết nối
   YouTube/Facebook qua Postiz; chỉ báo quota từng kênh.
8. **Cài đặt** — engine TTS, LLM API key; GPU provider; Asset Store (MinIO/R2);
   cookie nguồn; chính sách lưu giữ mặc định.

## 12. Tech stack

Ràng buộc quyết định: **toàn bộ chuỗi AI/media (yt-dlp, video-subtitle-remover,
faster-whisper, OmniVoice/F5-TTS/VieNeu, pyannote, LLM SDK) đều là Python** →
pipeline + GPU worker bắt buộc Python.

| Lớp | Ngôn ngữ / Công cụ | Lý do |
|-----|--------------------|-------|
| Pipeline + GPU worker | Python 3.11+ (PyTorch, ffmpeg qua subprocess) | Mọi tool AI/media là Python |
| Backend API | FastAPI (Python) | Dùng chung model với worker, một ngôn ngữ cho backend |
| Hàng đợi job | Redis + RQ (hoặc Celery) | Nhẹ, chuẩn Python |
| Database | PostgreSQL | Trạng thái, hồ sơ, segment, cast sheet, job |
| Frontend (Dashboard + Studio) | TypeScript + React | Studio editor tương tác cao |
| Object storage | MinIO / R2 | Asset Store |
| Đăng bài | Postiz (Node/TS) | Dùng lại nguyên, không tự code |

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
- Bóc lời: OCR hard-sub làm chính, ASR đối chiếu — MVP so sánh rồi chốt.
