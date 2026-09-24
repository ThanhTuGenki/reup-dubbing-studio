# GPU Worker acceptance runbook

Mốc nghiệm thu GPU chỉ được chạy trên image immutable đã duyệt và máy NVIDIA
`linux/amd64`. Không đánh dấu roadmap hoàn tất từ smoke test không inference hoặc
từ kết quả trên Apple Silicon. Mỗi lần chạy phải giữ lại JSON do
`reup-gpu-acceptance` sinh ra và chép kết luận vào `acceptance-log.md`.

Container EzyCloudX được thuê ngày 2026-09-24 không có Docker CLI/daemon bên
trong. Vì vậy các lệnh `docker run` dưới đây chỉ dùng được khi provider cho phép
chạy image trực tiếp hoặc cấp Docker daemon. Lần chạy bằng OCI unpack + `proot`
trên container sẵn có chỉ là phép thử chẩn đoán: nó cần chèn thư viện driver từ
host, có thể làm lệch latency, và không thay thế nghiệm thu image immutable.
Xem `acceptance-log.md` trước khi dùng lại kết quả của lần chạy đó.

## Điều kiện trước khi thuê

- Chốt provider, region, GPU, giá theo giờ và trần chi phí với người sở hữu dự án.
- Dùng digest artifact từ workflow `GPU Worker images`, không dùng tag mutable.
- Chuẩn bị một video ngắn có quyền sử dụng, có tiếng nói và hard-sub để so sánh
  ASR/OCR; chuẩn bị voice sample cùng transcript chính xác cho OmniVoice.
- Không đưa enrollment token, signed URL, cookie hoặc nội dung nhạy cảm vào JSON
  acceptance. Thư mục `workers/gpu/acceptance/` bị Git ignore.

## Ghi inventory

Override entrypoint vì entrypoint production mặc định khởi động Agent:

```bash
docker run --rm --gpus all \
  --entrypoint reup-gpu-acceptance \
  -e REUP_WORKER_IMAGE_DIGEST=sha256:<digest> \
  -v "$PWD/acceptance:/evidence" \
  ghcr.io/ThanhTuGenki/gpu-worker-batch@sha256:<digest> \
  inventory --output /evidence/batch-inventory.json
```

JSON ghi model GPU, VRAM, driver, platform, Python, image digest và contract
version. Ghi riêng rate/region và tổng thời gian billing vào acceptance log vì
container không thể xác minh hóa đơn của provider.

## Batch Media

Dùng subcommand `command` để đo cold/warm latency và peak VRAM của đúng command
trong image. Chạy ASR, OCR và Demucs bằng interpreter đã tách sẵn; mỗi output
được giữ trên volume evidence để review thủ công. Ví dụ ASR:

```bash
reup-gpu-acceptance command \
  --output /evidence/asr-warm.json --label asr-warm \
  --warmups 1 --iterations 5 -- \
  /opt/reup-worker/bin/python -m reup_worker.tools.asr \
  --input /fixtures/sample.mp4 --output /evidence/asr.json \
  --language vi --model medium
```

Lặp cùng pattern cho:

- OCR: `/opt/reup-ocr/bin/python -m reup_worker.tools.ocr`;
- Demucs: `/opt/reup-demucs/bin/python -m demucs --two-stems vocals -n htdemucs`;
- FFmpeg: command render H.264/AAC dùng cùng input và preset production.

Chạy lần đầu với `--warmups 0 --iterations 1` để ghi cold latency, sau đó một
lần warm riêng. Không dùng nhiều iteration cho command ghi cùng output nếu tool
không hỗ trợ overwrite an toàn; đổi đường dẫn hoặc bọc command bằng script test
trong volume evidence.

Evidence chỉ lưu label và tên executable, không lưu toàn bộ argv để tránh vô
tình ghi signed URL/token. Không truyền secret trực tiếp trên command line.

## OmniVoice 100-request stability

Image TTS có load-test giữ đúng một subprocess nóng, chuẩn bị prompt một lần,
validate WAV 24 kHz sau từng request và lấy p50/p95/peak VRAM. Mặc định chạy 101
request để vừa đáp ứng ngưỡng 100 vừa chứng minh restart có kiểm soát tại giới
hạn production 100 request:

```bash
reup-gpu-acceptance tts \
  --output /evidence/tts-101.json \
  --output-dir /evidence/tts-audio \
  --reference /fixtures/voice.wav \
  --reference-text "Transcript chính xác của voice sample" \
  --text "Đây là câu kiểm thử tiếng Việt." \
  --language vi --requests 101 --restart-after 100
```

`observedProcessStarts` phải ít nhất là 2 ở bài 101 request. Nghe ngẫu nhiên đầu,
giữa và cuối batch; ghi naturalness/pronunciation vào acceptance log. Official
weights hiện là CC-BY-NC nên bài test chỉ phục vụ prototype, không gỡ commercial
license gate.

## Điều kiện đạt

- Tất cả stage tạo output hợp lệ, không OOM, không process crash và không rò
  secret vào evidence/log.
- Có cold/warm latency, p50/p95, peak VRAM và throughput concurrency 1.
- TTS hoàn tất ít nhất 100 request và restart đúng cấu hình.
- Nếu debug trên GPU 24 GB, phải chạy lại capacity acceptance trên RTX 3060
  12 GB trước khi ghi 3060 là cấu hình supported.
- Ghi digest, GPU/VRAM, driver/CUDA, provider/region/rate, billing duration, tổng
  chi phí và known failures vào `docs/operations/acceptance-log.md`.
