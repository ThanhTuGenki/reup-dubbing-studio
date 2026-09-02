# Manual Checklist — Reup Dubbing Studio MVP

Every step below needs something this sandbox does not have: a rights-cleared
video, a rented GPU, a multi-gigabyte model download, or a human ear/eye. They
were deliberately deferred while building the pipeline. Work through them in
order — later steps assume the config filled in by earlier ones.

## Environment notes (read first)

- **`REUP_TEST_URL`** gates the one integration test that performs a real
  download (`tests/test_ingest.py`, marked `@pytest.mark.integration`). It is
  skipped by default (`pyproject.toml`'s `addopts = "-m 'not integration'"`).
  Set it to a URL you have rights to use before running that test:
  ```bash
  export REUP_TEST_URL="https://www.bilibili.com/video/<VIDEO_CÓ_QUYỀN_DÙNG>"
  ```
- **`UF_HIDDEN` / `chflags nohidden`**: this project lives under
  `~/Desktop`, and a third-party desktop-hiding utility on this machine
  repeatedly sets the macOS `UF_HIDDEN` flag on files there — including the
  venv's `.pth` files under `.venv/lib/python3.11/site-packages/`. CPython's
  `site.py` skips hidden `.pth` files, so `import reup` intermittently fails
  with `ModuleNotFoundError: No module named 'reup'`, unrelated to any code
  change. If that happens, run:
  ```bash
  chflags nohidden .venv/lib/python3.11/site-packages/*.pth
  ```
  and retry. This is a transient fix (the flag can reappear within
  seconds to minutes) — no code, test, or config file should ever be changed
  to work around it (no `sys.path` hacks, no `conftest.py`, no baked-in
  `PYTHONPATH`). The durable fixes are either of:
  - exclude this project folder from that desktop-hiding utility, or
  - move the project out of `~/Desktop` entirely.

## 1. Real download (Task 3)

A human with a rights-cleared video URL must run:
```bash
export REUP_TEST_URL="https://www.bilibili.com/video/<VIDEO_CÓ_QUYỀN_DÙNG>"
.venv/bin/pytest -m integration tests/test_ingest.py -v
```
If the video needs auth cookies: export cookies from the browser using the
"Get cookies.txt LOCALLY" extension, save to `data/cookies/bilibili.txt`, and
pass `cookies=Path("data/cookies/bilibili.txt")` when calling `download(...)`
(the integration test as written does not pass cookies — extend it manually
if the chosen test video requires them).

## 2. Measure the subtitle mask, then install and probe video-subtitle-remover (Task 4)

The mask is the first artifact you must produce, and the only fully manual
input in the whole pipeline — every later step (desub, OCR framing,
`reup run --mask`) depends on getting it right. Measure it from a real frame
of `raw.mp4`:

```bash
ffmpeg -ss 60 -i raw.mp4 -vframes 1 frame.png
```

Open `frame.png` in any image viewer/editor that shows pixel coordinates
(e.g. Preview's pointer position, GIMP, or `qlmanage -p frame.png` plus a
screenshot tool with a ruler). Find the rectangle that fully covers the
burned-in subtitle band across the frames you spot-check (subtitles can
shift a few pixels between lines, so pick bounds a little generous), and
read off:
- `ymin` — the top edge's y pixel coordinate
- `ymax` — the bottom edge's y pixel coordinate
- `xmin` — the left edge's x pixel coordinate
- `xmax` — the right edge's x pixel coordinate

The mask is always written and passed in that exact order,
**`ymin,ymax,xmin,xmax`** — this is the order `_parse_mask` in `cli.py`
expects, and the order every pipeline function (`desub.render_cmd`,
`stt_ocr.frame_extract_cmd`) takes as its `mask: tuple[int, int, int, int]`
argument. Check a few frames spread across the video (subtitle position is
usually fixed, but confirm it doesn't move for on-screen graphics/credits).
Record the mask you land on in `docs/superpowers/plans/mvp-notes.md`.

```bash
mkdir -p tools && git clone https://github.com/YaoFANGUK/video-subtitle-remover tools/vsr
cd tools/vsr && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# Read README + run help to confirm how input/output/subtitle-area are passed:
.venv/bin/python backend/main.py --help || cat README.md | head -80
```

Fill in the real template into `config.toml [desub].cmd`, using exactly the
placeholders `{input} {output} {ymin} {ymax} {xmin} {xmax}` — do not change
`desub.py`. Example shape (adjust flags/order to match what the tool's
`--help`/README actually prints):
```toml
[desub]
cmd = "python tools/vsr/backend/main.py --input {input} --output {output} --area {ymin},{ymax},{xmin},{xmax}"
```
If the tool takes the subtitle area via environment variables or a different
format instead of a single CLI flag, adjust the template string accordingly
(still only using the same six placeholders) — `render_cmd`/`desub` code does
not need to change either way.

After filling the template, test on a 30-second clip:
```bash
ffmpeg -i raw.mp4 -t 30 -c copy clip.mp4
```
Run desub on `clip.mp4`, open the output, and visually confirm the
subtitle-burned region is clean. Record the run time in
`docs/superpowers/plans/mvp-notes.md`.

## 3. Install `paddleocr`/`paddlepaddle` and run ASR + OCR on a real clip (Task 5)

```bash
.venv/bin/pip install paddleocr paddlepaddle
.venv/bin/python - <<'EOF'
from pathlib import Path
from reup.stt_asr import transcribe as asr
from reup.stt_ocr import transcribe as ocr
from reup.segments import save_segments
clip = Path("data/videos/test/clip.mp4")   # clip 30s từ bước 2
save_segments(asr(clip, model_size="small"), Path("data/videos/test/segments_asr.json"))
save_segments(ocr(clip, (600, 700, 0, 1280), Path("data/videos/test")), Path("data/videos/test/segments_ocr.json"))
EOF
```

Notes:
- The mask `(600, 700, 0, 1280)` must be adjusted to match the real clip's
  subtitle band; it is `(ymin, ymax, xmin, xmax)` in pixels.
- PaddleOCR's `predict()` output shape varies between versions. If the real
  output doesn't match what `extract_texts` in `src/reup/stt_ocr.py`
  currently handles, print `res` from a real call and adjust `extract_texts`
  accordingly — it is a small, independently unit-tested pure function (see
  `tests/test_stt_ocr.py::test_extract_texts_current_shape`,
  `test_extract_texts_legacy_shape`, `test_extract_texts_empty_or_absent`),
  so this should be a safe, localized change. Re-run
  `.venv/bin/pytest tests/test_stt_ocr.py -v` after adjusting to confirm the
  existing shape tests still pass, and add a new test case for the newly
  observed shape.
- `faster-whisper` is already a hard dependency (not installed in this
  step), so `asr(...)` will download the `small` Whisper model weights on
  first run — expect a network call and a multi-hundred-MB download.
- `faster-whisper` runs on CTranslate2, which has no Apple Silicon MPS
  backend — ASR runs on CPU on this Mac (`device="auto"` resolves to CPU
  here, not GPU). Keep that in mind when reading `stt_asr` timings in
  `timings.json`: don't misread Mac CPU time as "Mac GPU time" when
  extrapolating rented-GPU cost in step 8.

## 4. Real translation smoke test (Task 6)

Translate a test clip's `segments_ocr.json` with the real `translate()`
(real Anthropic client, `ANTHROPIC_API_KEY` set — not a fake client), save
the result as `script.json`, and read through it to judge translation
quality. `reup run` already batches 50 lines per call via `stage_translate`
in `cli.py`, so for a video that's the command to use directly (see step 7).

## 5. Set up OmniVoice on the Interactive TTS Worker (Task 7)

1. Thuê một EzyCloudX Docker GPU 1× RTX 3060 12 GB và đăng ký worker với vai trò
   `INTERACTIVE_TTS`. Không cài engine TTS trên Mac để làm acceptance chính.
2. Cài phiên bản OmniVoice đã pin trong image `reup-dubbing-tts-worker`; ghi lại
   phiên bản PyTorch, CUDA và FlashInfer trong `mvp-notes.md`.
3. Tạo voice-clone prompt một lần từ reference audio 3–10 giây và transcript đã
   biết; lưu prompt để các lần sinh sau không tải/transcribe lại reference.
4. Wrapper/API phải nhận tối thiểu `text`, `language_id`, `voice_prompt`,
   `target_duration` và `out`. Mỗi segment tạo một WAV riêng.
5. Chạy câu tiếng Việt thật, nghe kết quả và xác nhận duration khớp slot. Ghi nhận
   độ tự nhiên, phát âm, thời gian cold/warm và peak VRAM.
6. Không dùng cho production kiếm tiền cho tới khi trạng thái quyền thương mại của
   pretrained model CC-BY-NC đã được giải quyết và ghi nhận.

## 6. OmniVoice stability and interactive-latency acceptance (Task 8)

Chạy acceptance trên đúng Docker GPU dự kiến dùng cho Studio:

- ít nhất 30 câu Việt, gồm tên riêng, số, câu dài và hội thoại ngắn;
- một nhóm câu tiếng Anh để kiểm tra hướng đa ngôn ngữ tương lai;
- đo warm p50/p95 latency và peak VRAM;
- chạy liên tục ít nhất 100 request, concurrency 1, để phát hiện VRAM tăng/OOM;
- sửa một segment trong Studio, re-gen đúng segment đó và nghe preview mà không
  render lại toàn video;
- thử `na-01` và `eu-01` nếu có thể; chọn region bằng latency thật, không chỉ bằng
  CP/giờ hoặc băng thông quảng cáo.

Nếu VRAM tăng vượt ngưỡng, xác minh Worker Agent restart tiến trình OmniVoice có
kiểm soát và tiếp tục nhận request mà không mất voice prompt/output đã lưu.

## 7. Install demucs and run a real mix/render smoke test (Task 9)

```bash
.venv/bin/pip install demucs
```
Run `demucs_cmd(...)` on a real test clip, use the resulting
`htdemucs/<name>/no_vocals.wav` as the background track, run
`audio.mix(...)` against the real dub clips from step 5/6, run
`render.render(...)`, then open `out_16x9.mp4` and confirm:
- background music/sound effects survive,
- the Vietnamese dub lines land at the right timestamps,
- no Vietnamese subtitles are burned into the video,
- `out_16x9.srt` exists beside `out_16x9.mp4`, contains the Vietnamese
  subtitles, and its cues match the dubbed lines' timestamps.

## 8. Full pipeline acceptance pass (Task 10, brief Step 5)

Once steps 1–7 above are done (real download works, desub template filled
in, `paddleocr`/`paddlepaddle` installed, OmniVoice worker configured,
demucs installed), export the Anthropic key `stage_translate`
needs (the same one used in step 4 — `reup run` calls it just as much):
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```
Sanity-check that `[llm] model` in `config.toml` names a model this account
can actually call before committing to a full run — a typo or an
unavailable model name will only surface once translation starts, after
ingest/desub/OCR/ASR have already run:
```bash
.venv/bin/python -c "
import anthropic, tomllib
cfg = tomllib.load(open('config.toml', 'rb'))
anthropic.Anthropic().messages.create(
    model=cfg['llm']['model'], max_tokens=8,
    messages=[{'role': 'user', 'content': 'ping'}])
print('model OK')
"
```
Then run the whole pipeline end to end on a **full video** (not a clip):
```bash
.venv/bin/reup run <URL video có quyền dùng> --mask <đo từ frame thật> [--cookies data/cookies/bilibili.txt] [--engine omnivoice] [--stt ocr]
.venv/bin/reup report <vid>
```
`reup run` is resumable — re-running the same command after a failure skips
every stage whose output artifact already exists. `reup report <vid>` prints
a markdown table comparing OCR vs ASR text per segment plus every stage's
timing from `timings.json`.

Answer the four MVP acceptance questions and record the answers in
`docs/superpowers/plans/mvp-notes.md`:

- **(a) Desub quality** — look at 5 random timestamps in `desubbed.mp4`
  (spread across the video): is the cleaned-up region acceptable (no
  distracting smear/ghosting where the burned-in subtitles used to be)?
- **(b) Dub naturalness** — listen to 3 minutes of `out_16x9.mp4`'s audio:
  is the synthesised Vietnamese voice natural enough to publish?
- **(c) OCR vs ASR accuracy** — read the table from `reup report <vid>`:
  which of the two transcripts is more accurate line-by-line?
- **(d) Per-stage cost** — read `timings.json` (echoed at the end of the
  `report` output) for how long each stage took on this Mac. Extrapolate to
  rented-GPU cost: rent one RunPod RTX 4090 instance (~US$0.40/hour), repeat
  `reup run` there, compare its `timings.json` against the Mac run, and
  compute US$-per-video from the GPU-hours actually used.
