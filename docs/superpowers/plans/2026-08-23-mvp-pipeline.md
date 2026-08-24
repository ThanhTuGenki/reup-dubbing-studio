# Reup Dubbing Studio — Giai đoạn 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline CLI Python chạy trọn 1 video: tải → xóa hard-sub (mask cố định) → bóc lời (OCR + ASR để so sánh) → dịch LLM → lồng 1 giọng → Demucs giữ nhạc nền → render 16:9, kèm log thời gian từng bước.

**Architecture:** Monorepo Python duy nhất (`src/reup/`), mỗi bước pipeline là một module thuần có hàm build-command/transform tách khỏi side-effect để test được. Công cụ ngoài nặng (video-subtitle-remover, TTS engine) gọi qua **command template trong config.toml** — đổi CLI của tool không phải sửa code. File lưu trong thư mục local `data/videos/{id}/` (chuẩn bị sẵn layout giống Asset Store R2 sau này).

**Tech Stack:** Python 3.11+, yt-dlp, video-subtitle-remover (subprocess), PaddleOCR, faster-whisper, Anthropic SDK (dịch), VieNeu-TTS (+ F5-TTS-VN, OmniVoice khi có CUDA), Demucs, ffmpeg, typer (CLI), pytest.

**Spec:** `docs/superpowers/specs/2026-08-23-reup-dubbing-studio-design.md`

## Global Constraints

- Python ≥ 3.11; virtualenv tại `.venv/`; chạy local trên macOS (Apple Silicon, không CUDA) — mọi bước phải chạy được CPU/MPS.
- MVP **không có**: web UI, Postiz, đa giọng, 9:16, metadata, intro/outro, R2 (chỉ thư mục local `data/`).
- Đơn vị dữ liệu xuyên suốt: **Segment** (câu) — mọi bước đọc/ghi JSON list Segment.
- LLM dịch: Anthropic API, model mặc định `claude-sonnet-5`, API key từ env `ANTHROPIC_API_KEY`.
- ffmpeg gọi qua `subprocess`, không dùng thư viện bọc.
- Mọi hàm build command/filter trả về `list[str]` hoặc `str` thuần để unit-test không cần chạy tool thật.
- Test nặng (cần model/mạng) đánh dấu `@pytest.mark.integration`, mặc định skip: pytest chỉ chạy unit khi `-m "not integration"`.
- Commit message tiếng Anh, format `feat:/test:/chore:`.
- Video test phải là nội dung chủ dự án có quyền dùng.
- **Mọi lệnh subprocess trong module pipeline (Task 3 trở đi) phải chạy qua
  `reup.logutil.run_logged(cmd, log_path)` (Task 0b) thay cho `subprocess.run`
  trực tiếp** — bắt stdout/stderr vào file log, lỗi thì raise kèm 20 dòng cuối.
  Các code block trong Task 3–10 viết `subprocess.run` là dạng rút gọn; khi
  implement, thay bằng `run_logged(cmd, store.p(vid, f"logs/{stage}.log"))`.
- Lint/format: **ruff** (`ruff check` + `ruff format`), line-length 100 — chạy
  trước mỗi commit. Type hints đầy đủ, `from __future__ import annotations`.

## Quy ước code, log, debug

**Cấu trúc code:** mỗi module pipeline tách 2 tầng — hàm thuần
`build_*_cmd()/mix_filter()/group_*()` (unit-test được, không side-effect) và
hàm runner mỏng gọi subprocess/model. Không import chéo giữa các stage; chỉ
`cli.py` điều phối. Thư viện nặng (whisper, paddle, demucs, anthropic) import
**bên trong hàm** để `import reup` luôn nhanh và test không cần cài chúng.

**Log:**
- Dùng `logging` chuẩn, logger theo module: `log = logging.getLogger("reup.desub")`.
  Format: `%(asctime)s %(levelname)s %(name)s %(message)s`.
- Console mức INFO (mỗi stage 1 dòng bắt đầu + 1 dòng xong kèm thời gian);
  file `data/videos/{id}/logs/pipeline.log` mức DEBUG (setup trong `cli.run`).
- Output của tool ngoài: mỗi stage 1 file `data/videos/{id}/logs/{stage}.log`
  (ffmpeg/VSR/demucs/TTS rất ồn — không đổ ra console, không trộn lẫn nhau).
- Thất bại subprocess: raise `RuntimeError` kèm đường dẫn log + 20 dòng cuối —
  đọc lỗi ngay tại terminal, không phải mò.
- Không `print()` trong module pipeline; `typer.echo` chỉ ở `cli.py`.

**Debug:** mọi sản phẩm trung gian nằm lại trong `data/videos/{id}/` (không xóa
ở MVP); stage nào có output rồi thì `reup run` bỏ qua → sửa code một bước, xóa
đúng file output của bước đó, chạy lại là đủ. `timings.json` cho biết bước nào
đang tốn thời gian.

## File Structure

```
idea/                          # repo root (git init ở Task 0)
├── pyproject.toml
├── config.toml                # command templates + settings
├── .gitignore                 # .venv, data/, __pycache__, *.wav ngoài fixtures
├── data/videos/{id}/          # raw.mp4, desubbed.mp4, segments_asr.json,
│                              # segments_ocr.json, script.json, dub/, bg.wav,
│                              # mix.wav, sub.srt, out_16x9.mp4, timings.json,
│                              # logs/{pipeline,ingest,desub,stt,tts,mix,render}.log
├── .ruff.toml                 # lint/format, line-length 100
├── src/reup/
│   ├── __init__.py
│   ├── logutil.py             # run_logged + setup_logging
│   ├── config.py              # load config.toml
│   ├── segments.py            # Segment + JSON I/O + SRT writer
│   ├── assets.py              # AssetStore: layout thư mục local
│   ├── ingest.py              # yt-dlp download
│   ├── desub.py               # wrapper video-subtitle-remover
│   ├── stt_asr.py             # faster-whisper → Segments
│   ├── stt_ocr.py             # ffmpeg frames + PaddleOCR → Segments
│   ├── translate.py           # LLM dịch Segments
│   ├── tts.py                 # TTSAdapter + template adapters
│   ├── audio.py               # demucs + timing fit + mix filter
│   ├── render.py              # burn sub + mux → out_16x9.mp4
│   └── cli.py                 # typer: từng bước + run end-to-end + report
└── tests/
    ├── test_segments.py  test_assets.py  test_ingest.py  test_desub.py
    ├── test_stt_asr.py  test_stt_ocr.py  test_translate.py  test_tts.py
    ├── test_audio.py  test_render.py  test_cli.py
```

---

### Task 0: Scaffold dự án

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `src/reup/__init__.py`, `tests/__init__.py`, `config.toml`

**Interfaces:**
- Produces: package `reup` import được; `pytest` chạy; marker `integration` đăng ký.

- [ ] **Step 1: git init + .gitignore**

```bash
cd /Users/genkisystem/Desktop/Project/idea
git init
cat > .gitignore <<'EOF'
.venv/
__pycache__/
*.pyc
data/
.env
tools/
EOF
```

- [ ] **Step 2: pyproject.toml**

```toml
[project]
name = "reup"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "typer>=0.12",
  "yt-dlp>=2026.1.1",
  "anthropic>=0.40",
  "faster-whisper>=1.0",
  "pytest>=8.0",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
addopts = "-m 'not integration'"
markers = ["integration: needs models/network/ffmpeg, run manually"]
testpaths = ["tests"]
```

(PaddleOCR, demucs, TTS engine cài ở task tương ứng — chúng nặng và kén platform.)

- [ ] **Step 3: config.toml khung**

```toml
[paths]
data_root = "data"
tools_dir = "tools"           # nơi clone repo ngoài (VSR...)

[llm]
model = "claude-sonnet-5"

[desub]
# template điền ở Task 4 sau khi probe CLI thật của video-subtitle-remover
cmd = ""

[tts.vieneu]
cmd = ""                      # điền ở Task 7

[tts.f5]
cmd = ""                      # điền ở Task 8 (cần CUDA)

[tts.omnivoice]
cmd = ""                      # điền ở Task 8 (cần CUDA)
```

- [ ] **Step 4: package + venv + cài + smoke test**

```bash
mkdir -p src/reup tests
touch src/reup/__init__.py tests/__init__.py
python3 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/python -c "import reup; print('ok')"
.venv/bin/pytest   # Expected: no tests ran, exit 0/5 — không lỗi import
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold reup package"
```

---

### Task 0b: logutil — run_logged + setup_logging + ruff

**Files:**
- Create: `src/reup/logutil.py`, `.ruff.toml`
- Test: `tests/test_logutil.py`

**Interfaces:**
- Produces:
  - `run_logged(cmd: list[str], log_path: Path) -> None` — chạy subprocess, ghi
    stdout+stderr vào `log_path` (append, kèm dòng header là command); nếu exit
    code ≠ 0 raise `RuntimeError` chứa đường dẫn log + 20 dòng cuối.
  - `setup_logging(logfile: Path | None = None) -> None` — console INFO, file DEBUG.
- Mọi task sau dùng `run_logged` thay `subprocess.run` (xem Global Constraints).

- [ ] **Step 1: Failing tests**

```python
# tests/test_logutil.py
import pytest
from reup.logutil import run_logged

def test_success_writes_log(tmp_path):
    log = tmp_path / "x.log"
    run_logged(["python3", "-c", "print('hello')"], log)
    content = log.read_text()
    assert "hello" in content and "$ python3" in content

def test_failure_raises_with_tail(tmp_path):
    log = tmp_path / "x.log"
    with pytest.raises(RuntimeError) as e:
        run_logged(["python3", "-c", "import sys; print('boom'); sys.exit(3)"], log)
    assert "boom" in str(e.value) and str(log) in str(e.value)
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement**

```python
# src/reup/logutil.py
from __future__ import annotations
import logging, shlex, subprocess
from pathlib import Path

def run_logged(cmd: list[str], log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(f"\n$ {shlex.join(cmd)}\n")
        f.flush()
        proc = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
    if proc.returncode != 0:
        tail = "".join(log_path.read_text(encoding="utf-8").splitlines(keepends=True)[-20:])
        raise RuntimeError(
            f"Lệnh thất bại (exit {proc.returncode}): {cmd[0]}\nLog: {log_path}\n--- 20 dòng cuối ---\n{tail}")

def setup_logging(logfile: Path | None = None) -> None:
    fmt = "%(asctime)s %(levelname)s %(name)s %(message)s"
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    handlers[0].setLevel(logging.INFO)
    if logfile:
        logfile.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(logfile, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        handlers.append(fh)
    logging.basicConfig(level=logging.DEBUG, format=fmt, handlers=handlers, force=True)
```

```toml
# .ruff.toml
line-length = 100
[lint]
select = ["E", "F", "I", "UP", "B"]
```

- [ ] **Step 4: Run — PASS.** Chạy `ruff check src tests && ruff format src tests` (cài: `.venv/bin/pip install ruff`).
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: run_logged subprocess wrapper and logging setup"`

---

### Task 1: Segment model + JSON + SRT

**Files:**
- Create: `src/reup/segments.py`
- Test: `tests/test_segments.py`

**Interfaces:**
- Produces:
  - `@dataclass Segment(index: int, start: float, end: float, text_src: str = "", text_vi: str = "", speaker: str = "narrator")`
  - `save_segments(segs: list[Segment], path: Path) -> None` / `load_segments(path: Path) -> list[Segment]`
  - `to_srt(segs: list[Segment], use_vi: bool = True) -> str`
  - `fmt_ts(seconds: float) -> str` → `"HH:MM:SS,mmm"`

- [ ] **Step 1: Failing tests**

```python
# tests/test_segments.py
from pathlib import Path
from reup.segments import Segment, save_segments, load_segments, to_srt, fmt_ts

def test_roundtrip(tmp_path: Path):
    segs = [Segment(0, 0.0, 2.5, text_src="你好", text_vi="Xin chào")]
    p = tmp_path / "s.json"
    save_segments(segs, p)
    assert load_segments(p) == segs

def test_fmt_ts():
    assert fmt_ts(3661.5) == "01:01:01,500"
    assert fmt_ts(0.0) == "00:00:00,000"

def test_to_srt():
    segs = [Segment(0, 0.0, 1.0, text_vi="A"), Segment(1, 1.2, 3.0, text_vi="B")]
    srt = to_srt(segs)
    assert "1\n00:00:00,000 --> 00:00:01,000\nA\n" in srt
    assert "2\n00:00:01,200 --> 00:00:03,000\nB\n" in srt
```

- [ ] **Step 2: Run — Expected FAIL** `ModuleNotFoundError`: `.venv/bin/pytest tests/test_segments.py -v`

- [ ] **Step 3: Implement**

```python
# src/reup/segments.py
from __future__ import annotations
import json
from dataclasses import dataclass, asdict
from pathlib import Path

@dataclass
class Segment:
    index: int
    start: float
    end: float
    text_src: str = ""
    text_vi: str = ""
    speaker: str = "narrator"

def save_segments(segs: list[Segment], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([asdict(s) for s in segs], ensure_ascii=False, indent=1), encoding="utf-8")

def load_segments(path: Path) -> list[Segment]:
    return [Segment(**d) for d in json.loads(path.read_text(encoding="utf-8"))]

def fmt_ts(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def to_srt(segs: list[Segment], use_vi: bool = True) -> str:
    out = []
    for i, sg in enumerate(segs, 1):
        text = sg.text_vi if use_vi else sg.text_src
        out.append(f"{i}\n{fmt_ts(sg.start)} --> {fmt_ts(sg.end)}\n{text}\n")
    return "\n".join(out)
```

- [ ] **Step 4: Run — Expected PASS**
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: Segment model with JSON and SRT output"`

---

### Task 2: AssetStore layout local

**Files:**
- Create: `src/reup/assets.py`
- Test: `tests/test_assets.py`

**Interfaces:**
- Produces: `class AssetStore(root: Path)` với:
  - `dir(vid: str) -> Path` (tạo `root/videos/{vid}`, mkdir)
  - `p(vid: str, name: str) -> Path` — name tự do: `"raw.mp4"`, `"dub/0001.wav"`…
  - `write_json(vid, name, obj)` / `read_json(vid, name)`

- [ ] **Step 1: Failing tests**

```python
# tests/test_assets.py
from reup.assets import AssetStore

def test_layout(tmp_path):
    st = AssetStore(tmp_path)
    assert st.dir("v1").is_dir()
    assert st.p("v1", "raw.mp4") == tmp_path / "videos" / "v1" / "raw.mp4"
    st.p("v1", "dub/0001.wav")  # tạo thư mục cha
    assert (tmp_path / "videos" / "v1" / "dub").is_dir()

def test_json_roundtrip(tmp_path):
    st = AssetStore(tmp_path)
    st.write_json("v1", "timings.json", {"desub": 12.5})
    assert st.read_json("v1", "timings.json") == {"desub": 12.5}
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement**

```python
# src/reup/assets.py
from __future__ import annotations
import json
from pathlib import Path

class AssetStore:
    def __init__(self, root: Path):
        self.root = Path(root)

    def dir(self, vid: str) -> Path:
        d = self.root / "videos" / vid
        d.mkdir(parents=True, exist_ok=True)
        return d

    def p(self, vid: str, name: str) -> Path:
        path = self.dir(vid) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_json(self, vid: str, name: str, obj) -> None:
        self.p(vid, name).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

    def read_json(self, vid: str, name: str):
        return json.loads(self.p(vid, name).read_text(encoding="utf-8"))
```

- [ ] **Step 4: PASS.** **Step 5: Commit** `git commit -am "feat: local AssetStore layout"`

---

### Task 3: Ingest (yt-dlp)

**Files:**
- Create: `src/reup/ingest.py`
- Test: `tests/test_ingest.py`

**Interfaces:**
- Produces:
  - `build_ytdlp_cmd(url: str, out_path: Path, cookies: Path | None = None) -> list[str]`
  - `download(url, out_path, cookies=None) -> Path` (chạy subprocess, raise nếu fail)
  - `video_id(url: str) -> str` — id ổn định từ URL (sha1 8 ký tự).

- [ ] **Step 1: Failing tests**

```python
# tests/test_ingest.py
from pathlib import Path
from reup.ingest import build_ytdlp_cmd, video_id

def test_cmd_basic():
    cmd = build_ytdlp_cmd("https://ex.com/v", Path("/tmp/raw.mp4"))
    assert cmd[0] == "yt-dlp"
    assert "--merge-output-format" in cmd and "mp4" in cmd
    assert "-o" in cmd and "/tmp/raw.mp4" in cmd
    assert "--cookies" not in cmd

def test_cmd_cookies():
    cmd = build_ytdlp_cmd("https://ex.com/v", Path("o.mp4"), cookies=Path("c.txt"))
    i = cmd.index("--cookies")
    assert cmd[i + 1] == "c.txt"

def test_video_id_stable():
    assert video_id("https://ex.com/v") == video_id("https://ex.com/v")
    assert len(video_id("https://ex.com/v")) == 8
```

- [ ] **Step 2: FAIL.** **Step 3: Implement**

```python
# src/reup/ingest.py
from __future__ import annotations
import hashlib, subprocess
from pathlib import Path

def video_id(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:8]

def build_ytdlp_cmd(url: str, out_path: Path, cookies: Path | None = None) -> list[str]:
    cmd = ["yt-dlp", "--merge-output-format", "mp4",
           "-f", "bv*+ba/b", "-o", str(out_path)]
    if cookies:
        cmd += ["--cookies", str(cookies)]
    return cmd + [url]

def download(url: str, out_path: Path, cookies: Path | None = None) -> Path:
    subprocess.run(build_ytdlp_cmd(url, out_path, cookies), check=True)
    return out_path
```

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Integration test thủ công (đánh dấu, không chạy CI):** thêm vào cuối test file:

```python
import pytest, subprocess

@pytest.mark.integration
def test_download_real(tmp_path):
    from reup.ingest import download
    out = download("https://www.bilibili.com/video/<VIDEO_CÓ_QUYỀN_DÙNG>", tmp_path / "raw.mp4")
    assert out.exists() and out.stat().st_size > 0
```

Chạy tay: `.venv/bin/pytest -m integration tests/test_ingest.py -v` (điền URL thật do chủ dự án cung cấp; nếu cần cookie: xuất từ trình duyệt bằng extension "Get cookies.txt LOCALLY", lưu `data/cookies/bilibili.txt`).

- [ ] **Step 6: Commit** `git commit -am "feat: yt-dlp ingest"`

---

### Task 4: Desub wrapper (video-subtitle-remover)

**Files:**
- Create: `src/reup/desub.py`, sửa `config.toml` (điền `[desub].cmd`)
- Test: `tests/test_desub.py`

**Interfaces:**
- Consumes: `config.toml [desub].cmd` — template chuỗi có placeholder `{input} {output} {ymin} {ymax} {xmin} {xmax}`.
- Produces:
  - `render_cmd(template: str, input: Path, output: Path, mask: tuple[int,int,int,int]) -> list[str]` (mask = ymin,ymax,xmin,xmax theo pixel)
  - `desub(input, output, mask, template) -> Path`

- [ ] **Step 1: Failing test**

```python
# tests/test_desub.py
from pathlib import Path
from reup.desub import render_cmd

def test_render_cmd():
    t = "python tools/vsr/backend/main.py --input {input} --output {output} --area {ymin},{ymax},{xmin},{xmax}"
    cmd = render_cmd(t, Path("in.mp4"), Path("out.mp4"), (600, 700, 0, 1280))
    assert cmd == ["python", "tools/vsr/backend/main.py", "--input", "in.mp4",
                   "--output", "out.mp4", "--area", "600,700,0,1280"]
```

- [ ] **Step 2: FAIL.** **Step 3: Implement**

```python
# src/reup/desub.py
from __future__ import annotations
import shlex, subprocess
from pathlib import Path

def render_cmd(template: str, input: Path, output: Path, mask: tuple[int, int, int, int]) -> list[str]:
    ymin, ymax, xmin, xmax = mask
    filled = template.format(input=str(input), output=str(output),
                             ymin=ymin, ymax=ymax, xmin=xmin, xmax=xmax)
    return shlex.split(filled)

def desub(input: Path, output: Path, mask: tuple[int, int, int, int], template: str) -> Path:
    if not template:
        raise RuntimeError("Chưa cấu hình [desub].cmd trong config.toml")
    subprocess.run(render_cmd(template, input, output, mask), check=True)
    if not output.exists():
        raise RuntimeError(f"desub không tạo ra file {output}")
    return output
```

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Cài & probe tool thật (thủ công, ghi kết quả vào config):**

```bash
mkdir -p tools && git clone https://github.com/YaoFANGUK/video-subtitle-remover tools/vsr
cd tools/vsr && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# Đọc README + chạy help để xác nhận cách truyền input/output/vùng sub:
.venv/bin/python backend/main.py --help || cat README.md | head -80
```

Điền template thật vào `config.toml [desub].cmd` theo cú pháp tool in ra (dùng đúng placeholder `{input} {output} {ymin} {ymax} {xmin} {xmax}`; nếu tool nhận vùng qua biến môi trường/format khác, chỉnh template — **không sửa code desub.py**). Chạy thử trên clip 30 giây cắt từ video test (`ffmpeg -i raw.mp4 -t 30 -c copy clip.mp4`), mở output xem vùng sub đã sạch chưa. Ghi thời gian chạy vào `docs/superpowers/plans/mvp-notes.md`.

- [ ] **Step 6: Commit** `git commit -am "feat: desub wrapper with command template"`

---

### Task 5: Bóc lời — ASR (faster-whisper) + OCR (PaddleOCR)

**Files:**
- Create: `src/reup/stt_asr.py`, `src/reup/stt_ocr.py`
- Test: `tests/test_stt_asr.py`, `tests/test_stt_ocr.py`

**Interfaces:**
- Produces:
  - `stt_asr.whisper_to_segments(raw_segs: list) -> list[Segment]` — raw item có `.start .end .text`
  - `stt_asr.transcribe(path: Path, model_size="large-v3") -> list[Segment]`
  - `stt_ocr.group_ocr_lines(lines: list[tuple[float, str]], gap: float = 1.0) -> list[Segment]`
  - `stt_ocr.frame_extract_cmd(video: Path, out_dir: Path, mask, fps: int = 2) -> list[str]`
  - `stt_ocr.transcribe(video, mask, workdir) -> list[Segment]`

- [ ] **Step 1: Failing tests**

```python
# tests/test_stt_asr.py
from types import SimpleNamespace
from reup.stt_asr import whisper_to_segments

def test_map():
    raw = [SimpleNamespace(start=0.0, end=2.0, text=" 你好 "),
           SimpleNamespace(start=2.5, end=4.0, text="再见")]
    segs = whisper_to_segments(raw)
    assert segs[0].text_src == "你好" and segs[0].index == 0
    assert segs[1].start == 2.5 and segs[1].index == 1
```

```python
# tests/test_stt_ocr.py
from reup.stt_ocr import group_ocr_lines, frame_extract_cmd
from pathlib import Path

def test_group_same_text_merges():
    lines = [(0.0, "你好"), (0.5, "你好"), (1.0, "你好"), (1.5, "再见"), (2.0, "再见")]
    segs = group_ocr_lines(lines)
    assert len(segs) == 2
    assert segs[0].text_src == "你好" and segs[0].start == 0.0 and segs[0].end == 1.5
    assert segs[1].start == 1.5

def test_group_gap_splits():
    lines = [(0.0, "A"), (0.5, "A"), (5.0, "A")]   # đứt quãng > gap
    segs = group_ocr_lines(lines, gap=1.0)
    assert len(segs) == 2

def test_frame_cmd_has_crop_and_fps():
    cmd = frame_extract_cmd(Path("v.mp4"), Path("fr"), (600, 700, 0, 1280), fps=2)
    j = " ".join(cmd)
    assert "crop=1280:100:0:600" in j and "fps=2" in j
```

- [ ] **Step 2: FAIL.** **Step 3: Implement**

```python
# src/reup/stt_asr.py
from __future__ import annotations
from pathlib import Path
from .segments import Segment

def whisper_to_segments(raw_segs: list) -> list[Segment]:
    return [Segment(index=i, start=float(r.start), end=float(r.end), text_src=r.text.strip())
            for i, r in enumerate(raw_segs)]

def transcribe(path: Path, model_size: str = "large-v3") -> list[Segment]:
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="auto", compute_type="int8")
    raw, _info = model.transcribe(str(path), language="zh", vad_filter=True)
    return whisper_to_segments(list(raw))
```

```python
# src/reup/stt_ocr.py
from __future__ import annotations
import re, subprocess
from pathlib import Path
from .segments import Segment

def _norm(t: str) -> str:
    return re.sub(r"[\s，。！？,.!?…~·]", "", t)

def frame_extract_cmd(video: Path, out_dir: Path, mask: tuple[int, int, int, int], fps: int = 2) -> list[str]:
    ymin, ymax, xmin, xmax = mask
    w, h = xmax - xmin, ymax - ymin
    return ["ffmpeg", "-y", "-i", str(video),
            "-vf", f"crop={w}:{h}:{xmin}:{ymin},fps={fps}",
            str(out_dir / "%06d.jpg")]

def group_ocr_lines(lines: list[tuple[float, str]], gap: float = 1.0) -> list[Segment]:
    segs: list[Segment] = []
    for t, text in lines:
        if not text.strip():
            continue
        if segs and _norm(text) == _norm(segs[-1].text_src) and t - segs[-1].end <= gap:
            segs[-1].end = t + 0.5
        else:
            if segs:
                segs[-1].end = min(segs[-1].end, t)
            segs.append(Segment(index=len(segs), start=t, end=t + 0.5, text_src=text.strip()))
    return segs

def transcribe(video: Path, mask: tuple[int, int, int, int], workdir: Path, fps: int = 2) -> list[Segment]:
    frames = workdir / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    subprocess.run(frame_extract_cmd(video, frames, mask, fps), check=True)
    from paddleocr import PaddleOCR
    ocr = PaddleOCR(lang="ch", use_textline_orientation=True)
    lines: list[tuple[float, str]] = []
    for i, f in enumerate(sorted(frames.glob("*.jpg"))):
        res = ocr.predict(str(f))
        text = " ".join(r.get("rec_texts", [""])[0] if isinstance(r, dict) else "" for r in res) if res else ""
        lines.append((i / fps, text))
    return group_ocr_lines(lines)
```

- [ ] **Step 4: PASS (unit).**
- [ ] **Step 5: Cài lib nặng + integration thủ công:**

```bash
.venv/bin/pip install paddleocr paddlepaddle
.venv/bin/python - <<'EOF'
from pathlib import Path
from reup.stt_asr import transcribe as asr
from reup.stt_ocr import transcribe as ocr
from reup.segments import save_segments
clip = Path("data/videos/test/clip.mp4")   # clip 30s từ Task 4
save_segments(asr(clip, model_size="small"), Path("data/videos/test/segments_asr.json"))
save_segments(ocr(clip, (600, 700, 0, 1280), Path("data/videos/test")), Path("data/videos/test/segments_ocr.json"))
EOF
```

Lưu ý: API PaddleOCR đổi giữa các version — nếu `predict` trả cấu trúc khác, sửa phần đọc `rec_texts` trong `stt_ocr.transcribe` theo output thật (in `res` ra xem). Mask lấy theo clip thật.

- [ ] **Step 6: Commit** `git commit -am "feat: ASR and OCR transcription to segments"`

---

### Task 6: Dịch LLM

**Files:**
- Create: `src/reup/translate.py`
- Test: `tests/test_translate.py`

**Interfaces:**
- Produces:
  - `build_prompt(segs: list[Segment]) -> str` — JSON lines `{index, text}` + yêu cầu dịch Việt tự nhiên, **độ dài tương đương** (để khớp timing), giữ nguyên index, trả JSON.
  - `parse_response(text: str) -> dict[int, str]`
  - `translate(segs, client=None, model="claude-sonnet-5") -> list[Segment]` — điền `text_vi`; `client` inject được để test.

- [ ] **Step 1: Failing tests**

```python
# tests/test_translate.py
import json
from reup.segments import Segment
from reup.translate import build_prompt, parse_response, translate

def test_prompt_contains_lines_and_rules():
    p = build_prompt([Segment(0, 0, 1, text_src="你好")])
    assert '"index": 0' in p and "你好" in p and "độ dài tương đương" in p

def test_parse_plain_and_fenced():
    body = json.dumps([{"index": 0, "vi": "Xin chào"}], ensure_ascii=False)
    assert parse_response(body) == {0: "Xin chào"}
    assert parse_response(f"```json\n{body}\n```") == {0: "Xin chào"}

class FakeClient:
    class messages:
        @staticmethod
        def create(**kw):
            class R:
                content = [type("B", (), {"text": '[{"index": 0, "vi": "Xin chào"}]'})]
            return R()

def test_translate_fills_vi():
    segs = translate([Segment(0, 0, 1, text_src="你好")], client=FakeClient())
    assert segs[0].text_vi == "Xin chào"
```

- [ ] **Step 2: FAIL.** **Step 3: Implement**

```python
# src/reup/translate.py
from __future__ import annotations
import json, re
from .segments import Segment

_RULES = (
    "Bạn là dịch giả phim. Dịch từng dòng tiếng Trung sau sang tiếng Việt tự nhiên, "
    "văn nói, phù hợp lồng tiếng; giữ độ dài tương đương câu gốc (để khớp thời lượng đọc); "
    "giữ nguyên index; chỉ trả về JSON dạng [{\"index\": n, \"vi\": \"...\"}], không giải thích.\n"
)

def build_prompt(segs: list[Segment]) -> str:
    lines = json.dumps([{"index": s.index, "text": s.text_src} for s in segs], ensure_ascii=False, indent=1)
    return _RULES + lines

def parse_response(text: str) -> dict[int, str]:
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        raise ValueError(f"Không tìm thấy JSON trong phản hồi: {text[:200]}")
    return {int(d["index"]): d["vi"] for d in json.loads(m.group(0))}

def translate(segs: list[Segment], client=None, model: str = "claude-sonnet-5") -> list[Segment]:
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    resp = client.messages.create(model=model, max_tokens=8000,
                                  messages=[{"role": "user", "content": build_prompt(segs)}])
    vi = parse_response(resp.content[0].text)
    for s in segs:
        s.text_vi = vi.get(s.index, "")
    return segs
```

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Integration thủ công** (cần `ANTHROPIC_API_KEY`): dịch `segments_ocr.json` của clip test, lưu `script.json`, đọc lướt xem chất lượng. Với video dài, chia batch ~50 câu/lần gọi (thêm vòng lặp trong bước CLI, Task 9).
- [ ] **Step 6: Commit** `git commit -am "feat: LLM translation of segments"`

---

### Task 7: TTS adapter + VieNeu

**Files:**
- Create: `src/reup/tts.py`; sửa `config.toml [tts.vieneu].cmd`
- Test: `tests/test_tts.py`

**Interfaces:**
- Produces:
  - `class TemplateTTS(name: str, template: str)` với `synth(text: str, out_wav: Path) -> Path` — template có `{text}` và `{out}`.
  - `synth_segments(segs, adapter, dub_dir: Path) -> list[Path]` — mỗi câu 1 file `dub/{index:04d}.wav`, bỏ qua câu `text_vi` rỗng.
  - `get_adapter(name: str, cfg: dict) -> TemplateTTS` — đọc `cfg["tts"][name]["cmd"]`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_tts.py
from pathlib import Path
from reup.tts import TemplateTTS, synth_segments, get_adapter
from reup.segments import Segment

def test_template_cmd(monkeypatch):
    calls = []
    monkeypatch.setattr("subprocess.run", lambda cmd, check: calls.append(cmd))
    a = TemplateTTS("x", 'echo --text {text} --out {out}')
    a.synth("xin chào", Path("o.wav"))
    assert calls[0] == ["echo", "--text", "xin chào", "--out", "o.wav"]

def test_synth_segments_paths(monkeypatch, tmp_path):
    monkeypatch.setattr("subprocess.run", lambda cmd, check: None)
    a = TemplateTTS("x", "echo {text} {out}")
    segs = [Segment(0, 0, 1, text_vi="A"), Segment(1, 1, 2, text_vi="")]
    outs = synth_segments(segs, a, tmp_path)
    assert outs == [tmp_path / "0000.wav"]

def test_get_adapter_reads_config():
    a = get_adapter("vieneu", {"tts": {"vieneu": {"cmd": "run {text} {out}"}}})
    assert a.name == "vieneu"
```

- [ ] **Step 2: FAIL.** **Step 3: Implement**

```python
# src/reup/tts.py
from __future__ import annotations
import shlex, subprocess
from pathlib import Path
from .segments import Segment

class TemplateTTS:
    def __init__(self, name: str, template: str):
        if not template:
            raise RuntimeError(f"Chưa cấu hình [tts.{name}].cmd trong config.toml")
        self.name, self.template = name, template

    def synth(self, text: str, out_wav: Path) -> Path:
        filled = self.template.replace("{text}", text).replace("{out}", str(out_wav))
        subprocess.run(shlex.split(filled), check=True)
        return out_wav

def synth_segments(segs: list[Segment], adapter: TemplateTTS, dub_dir: Path) -> list[Path]:
    dub_dir.mkdir(parents=True, exist_ok=True)
    outs = []
    for s in segs:
        if not s.text_vi.strip():
            continue
        outs.append(adapter.synth(s.text_vi, dub_dir / f"{s.index:04d}.wav"))
    return outs

def get_adapter(name: str, cfg: dict) -> TemplateTTS:
    return TemplateTTS(name, cfg["tts"][name]["cmd"])
```

Lưu ý escape: `shlex.split` chạy sau khi thay `{text}` — nếu text chứa quote gây lỗi, đổi sang ghi text ra file tạm và template dùng `{textfile}`; quyết định khi probe engine thật ở Step 5.

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Cài VieNeu-TTS + viết script bọc + điền template (thủ công):**

```bash
git clone https://github.com/pnnbao97/VieNeu-TTS tools/vieneu
cd tools/vieneu && python3 -m venv .venv && .venv/bin/pip install -e . 2>/dev/null || .venv/bin/pip install -r requirements.txt
```

Đọc README của VieNeu để biết API Python, rồi tạo `tools/vieneu_say.py` (script bọc — chỉnh import theo README thật):

```python
# tools/vieneu_say.py — usage: python vieneu_say.py "<text>" out.wav [ref.wav]
import sys
from vieneu import VieNeuTTS   # tên class/module theo README thật của VieNeu
tts = VieNeuTTS()
tts.synthesize(sys.argv[1], output_path=sys.argv[2])
```

Điền `config.toml`:
```toml
[tts.vieneu]
cmd = "tools/vieneu/.venv/bin/python tools/vieneu_say.py {text} {out}"
```
Chạy thử 1 câu: nghe file wav ra loa. Ghi nhận xét độ tự nhiên vào `mvp-notes.md`.

- [ ] **Step 6: Commit** `git commit -am "feat: TTS adapter with VieNeu template"`

---

### Task 8: Bench so sánh TTS (F5-TTS-VN + OmniVoice, cần CUDA — best-effort)

**Files:**
- Create: `src/reup/cli.py` (khởi tạo, mới có lệnh `bench-tts`); sửa `config.toml`
- Test: `tests/test_cli.py`

**Interfaces:**
- Produces: lệnh `reup bench-tts --text "..." --engines vieneu,f5,omnivoice --out-dir bench/` — chạy cùng câu qua mọi engine **có template khác rỗng**, in bảng thời gian; engine chưa cấu hình thì báo "skipped".
- Consumes: `tts.get_adapter`, `config.load_config`.

- [ ] **Step 1: Tạo `src/reup/config.py` + failing test**

```python
# src/reup/config.py
from __future__ import annotations
import tomllib
from pathlib import Path

def load_config(path: Path = Path("config.toml")) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))
```

```python
# tests/test_cli.py
from typer.testing import CliRunner
from reup.cli import app

def test_bench_skips_unconfigured(tmp_path, monkeypatch):
    cfgfile = tmp_path / "config.toml"
    cfgfile.write_text('[tts.vieneu]\ncmd = ""\n[tts.f5]\ncmd = ""\n[tts.omnivoice]\ncmd = ""\n')
    r = CliRunner().invoke(app, ["bench-tts", "--text", "xin chào",
                                 "--out-dir", str(tmp_path), "--config", str(cfgfile)])
    assert r.exit_code == 0
    assert r.output.count("skipped") == 3
```

- [ ] **Step 2: FAIL.** **Step 3: Implement `cli.py` (khung + bench-tts)**

```python
# src/reup/cli.py
from __future__ import annotations
import time
from pathlib import Path
import typer
from .config import load_config
from .tts import TemplateTTS

app = typer.Typer(no_args_is_help=True)

@app.command("bench-tts")
def bench_tts(text: str = typer.Option(...),
              engines: str = typer.Option("vieneu,f5,omnivoice"),
              out_dir: Path = typer.Option(Path("bench")),
              config: Path = typer.Option(Path("config.toml"))):
    cfg = load_config(config)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in engines.split(","):
        tpl = cfg.get("tts", {}).get(name, {}).get("cmd", "")
        if not tpl:
            typer.echo(f"{name}: skipped (chưa cấu hình)")
            continue
        t0 = time.time()
        TemplateTTS(name, tpl).synth(text, out_dir / f"{name}.wav")
        typer.echo(f"{name}: {time.time() - t0:.1f}s -> {out_dir / (name + '.wav')}")

if __name__ == "__main__":
    app()
```

Thêm `reup = "reup.cli:app"` vào `[project.scripts]` trong pyproject, `pip install -e .` lại.

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Cấu hình F5/OmniVoice (best-effort, thủ công):** trên Mac không CUDA — thử cài F5-TTS-VN chạy CPU/MPS (chậm chấp nhận được cho 1 câu bench); OmniVoice tương tự. Mỗi engine: clone/cài vào `tools/`, viết script bọc kiểu `tools/f5_say.py` như Task 7, điền template. **Nếu engine nào không chạy nổi trên Mac → để template rỗng, ghi chú vào `mvp-notes.md` "cần bench trên GPU thuê (Task 10)" — không block.** Chạy `reup bench-tts --text "<2 câu thật trong script.json>"` và nghe so sánh; ghi kết luận engine nào tự nhiên nhất.
- [ ] **Step 6: Commit** `git commit -am "feat: bench-tts CLI comparing TTS engines"`

---

### Task 9: Audio (Demucs + timing fit + mix) và Render 16:9

**Files:**
- Create: `src/reup/audio.py`, `src/reup/render.py`
- Test: `tests/test_audio.py`, `tests/test_render.py`

**Interfaces:**
- Produces:
  - `audio.demucs_cmd(input: Path, out_dir: Path) -> list[str]` — two-stems vocals; stem nền nằm ở `out_dir/htdemucs/{tên file}/no_vocals.wav`.
  - `audio.fit_tempo(clip_dur: float, slot_dur: float, max_speed=1.15, min_speed=0.9) -> float`
  - `audio.mix_filter(segs, clip_durs: dict[int, float]) -> str` — filtergraph: input 0 = bg, inputs 1..N = dub clips theo thứ tự segs có text_vi; mỗi clip `atempo=<f>,adelay=<ms>|<ms>`; cuối `amix=inputs=<N+1>:normalize=0`.
  - `audio.mix(bg: Path, segs, dub_dir: Path, out: Path) -> Path` (dùng ffprobe đo clip_dur, chạy ffmpeg)
  - `render.render_cmd(video: Path, audio: Path, srt: Path, out: Path) -> list[str]` — burn sub + thay audio track.
- Consumes: `Segment`, `to_srt` (Task 1).

- [ ] **Step 1: Failing tests**

```python
# tests/test_audio.py
from pathlib import Path
from reup.audio import demucs_cmd, fit_tempo, mix_filter
from reup.segments import Segment

def test_demucs_cmd():
    cmd = demucs_cmd(Path("in.mp4"), Path("sep"))
    assert cmd[:2] == ["demucs", "--two-stems=vocals"] and "-o" in cmd

def test_fit_tempo_clamps():
    assert fit_tempo(2.0, 2.0) == 1.0
    assert fit_tempo(3.0, 2.0) == 1.15          # cần 1.5 nhưng kẹp trần
    assert abs(fit_tempo(2.2, 2.0) - 1.1) < 1e-9
    assert fit_tempo(1.0, 2.0) == 1.0            # ngắn hơn slot: không kéo chậm quá 1.0? -> giữ 1.0

def test_mix_filter_structure():
    segs = [Segment(0, 1.0, 3.0, text_vi="a"), Segment(1, 4.0, 6.0, text_vi="b")]
    f = mix_filter(segs, {0: 2.0, 1: 2.4})
    assert "[1]atempo=1.000,adelay=1000|1000[d0]" in f
    assert "[2]atempo=1.200,adelay=4000|4000[d1]" in f
    assert "amix=inputs=3:normalize=0" in f
```

```python
# tests/test_render.py
from pathlib import Path
from reup.render import render_cmd

def test_render_cmd():
    cmd = render_cmd(Path("v.mp4"), Path("mix.wav"), Path("s.srt"), Path("out.mp4"))
    j = " ".join(cmd)
    assert "subtitles=s.srt" in j and "-map 0:v" in j and "-map 1:a" in j and "libx264" in j
```

- [ ] **Step 2: FAIL.** **Step 3: Implement**

```python
# src/reup/audio.py
from __future__ import annotations
import json, subprocess
from pathlib import Path
from .segments import Segment

def demucs_cmd(input: Path, out_dir: Path) -> list[str]:
    return ["demucs", "--two-stems=vocals", "-o", str(out_dir), str(input)]

def fit_tempo(clip_dur: float, slot_dur: float, max_speed: float = 1.15, min_speed: float = 1.0) -> float:
    if slot_dur <= 0 or clip_dur <= slot_dur:
        return 1.0
    return min(max_speed, max(min_speed, clip_dur / slot_dur))

def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                          "-show_format", str(path)], capture_output=True, check=True)
    return float(json.loads(out.stdout)["format"]["duration"])

def mix_filter(segs: list[Segment], clip_durs: dict[int, float]) -> str:
    parts, labels = [], []
    voiced = [s for s in segs if s.text_vi.strip()]
    for k, s in enumerate(voiced):
        tempo = fit_tempo(clip_durs[s.index], s.end - s.start)
        ms = round(s.start * 1000)
        parts.append(f"[{k + 1}]atempo={tempo:.3f},adelay={ms}|{ms}[d{k}]")
        labels.append(f"[d{k}]")
    parts.append(f"[0]{''.join(labels)}amix=inputs={len(voiced) + 1}:normalize=0")
    return ";".join(parts)

def mix(bg: Path, segs: list[Segment], dub_dir: Path, out: Path) -> Path:
    voiced = [s for s in segs if s.text_vi.strip()]
    clips = [dub_dir / f"{s.index:04d}.wav" for s in voiced]
    durs = {s.index: probe_duration(c) for s, c in zip(voiced, clips)}
    cmd = ["ffmpeg", "-y", "-i", str(bg)]
    for c in clips:
        cmd += ["-i", str(c)]
    cmd += ["-filter_complex", mix_filter(segs, durs), str(out)]
    subprocess.run(cmd, check=True)
    return out
```

```python
# src/reup/render.py
from __future__ import annotations
import subprocess
from pathlib import Path

def render_cmd(video: Path, audio: Path, srt: Path, out: Path) -> list[str]:
    style = "FontName=Be Vietnam Pro,FontSize=18,OutlineColour=&H80000000,Outline=2"
    return ["ffmpeg", "-y", "-i", str(video), "-i", str(audio),
            "-vf", f"subtitles={srt}:force_style='{style}'",
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-crf", "20", "-c:a", "aac", "-shortest", str(out)]

def render(video: Path, audio: Path, srt: Path, out: Path) -> Path:
    subprocess.run(render_cmd(video, audio, srt, out), check=True)
    return out
```

Sửa test `test_fit_tempo_clamps` dòng cuối cho khớp thiết kế (min_speed=1.0: không kéo chậm — câu ngắn hơn slot cứ để khoảng lặng).

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Cài demucs + integration thủ công:** `.venv/bin/pip install demucs`; chạy demucs trên clip test (lấy `no_vocals.wav` làm `bg.wav`), mix với dub của Task 7, render, **mở out_16x9.mp4 xem + nghe**: nhạc nền còn, giọng Việt đúng chỗ, sub Việt hiện đúng.
- [ ] **Step 6: Commit** `git commit -am "feat: demucs mix and 16:9 render"`

---

### Task 10: CLI end-to-end `reup run` + report so sánh + acceptance

**Files:**
- Modify: `src/reup/cli.py`
- Test: `tests/test_cli.py` (thêm)
- Create: `docs/superpowers/plans/mvp-notes.md` (kết quả đo)

**Interfaces:**
- Consumes: mọi module trước.
- Produces:
  - `reup run URL --mask ymin,ymax,xmin,xmax [--cookies file] [--engine vieneu] [--stt ocr|asr]` — chạy tuần tự: ingest → desub → stt(cả OCR lẫn ASR, dùng bản `--stt` chọn làm chính) → translate (batch 50 câu/lần) → tts → demucs+mix → render; sau **mỗi bước** ghi thời gian vào `timings.json`; bước đã có output thì skip (resume được).
  - `reup report VID` — in markdown bảng so sánh OCR vs ASR từng câu (`segments_ocr.json` vs `segments_asr.json`) + tổng thời gian từng bước từ `timings.json`.

- [ ] **Step 1: Failing test (điều phối + resume, mock toàn bộ stage)**

```python
# tests/test_cli.py (thêm)
from typer.testing import CliRunner
from reup.cli import app

def test_run_calls_stages_in_order(monkeypatch, tmp_path):
    order = []
    import reup.cli as c
    for name in ["stage_ingest", "stage_desub", "stage_stt", "stage_translate",
                 "stage_tts", "stage_mix", "stage_render"]:
        monkeypatch.setattr(c, name, lambda ctx, _n=name: order.append(_n))
    r = CliRunner().invoke(app, ["run", "https://x/v", "--mask", "600,700,0,1280",
                                 "--data-root", str(tmp_path)])
    assert r.exit_code == 0
    assert order == ["stage_ingest", "stage_desub", "stage_stt", "stage_translate",
                     "stage_tts", "stage_mix", "stage_render"]
```

- [ ] **Step 2: FAIL.** **Step 3: Implement — thêm vào `cli.py`**

```python
# thêm vào src/reup/cli.py
import time
from dataclasses import dataclass, field
from .assets import AssetStore
from .segments import load_segments, save_segments, to_srt
from . import ingest as ing, desub as ds, stt_asr, stt_ocr, translate as tr, tts as tts_m, audio as au, render as rd

@dataclass
class Ctx:
    store: AssetStore
    vid: str
    url: str
    mask: tuple[int, int, int, int]
    cookies: Path | None
    engine: str
    stt_main: str
    cfg: dict
    timings: dict = field(default_factory=dict)

def _timed(ctx: Ctx, name: str, fn):
    t0 = time.time()
    fn()
    ctx.timings[name] = round(time.time() - t0, 1)
    ctx.store.write_json(ctx.vid, "timings.json", ctx.timings)

def stage_ingest(ctx: Ctx):
    out = ctx.store.p(ctx.vid, "raw.mp4")
    if not out.exists():
        _timed(ctx, "ingest", lambda: ing.download(ctx.url, out, ctx.cookies))

def stage_desub(ctx: Ctx):
    out = ctx.store.p(ctx.vid, "desubbed.mp4")
    if not out.exists():
        _timed(ctx, "desub", lambda: ds.desub(ctx.store.p(ctx.vid, "raw.mp4"), out,
                                              ctx.mask, ctx.cfg["desub"]["cmd"]))

def stage_stt(ctx: Ctx):
    raw = ctx.store.p(ctx.vid, "raw.mp4")
    p_ocr, p_asr = ctx.store.p(ctx.vid, "segments_ocr.json"), ctx.store.p(ctx.vid, "segments_asr.json")
    if not p_ocr.exists():
        _timed(ctx, "stt_ocr", lambda: save_segments(
            stt_ocr.transcribe(raw, ctx.mask, ctx.store.dir(ctx.vid)), p_ocr))
    if not p_asr.exists():
        _timed(ctx, "stt_asr", lambda: save_segments(stt_asr.transcribe(raw), p_asr))

def stage_translate(ctx: Ctx):
    out = ctx.store.p(ctx.vid, "script.json")
    if out.exists():
        return
    segs = load_segments(ctx.store.p(ctx.vid, f"segments_{ctx.stt_main}.json"))
    def go():
        for i in range(0, len(segs), 50):
            tr.translate(segs[i:i + 50], model=ctx.cfg["llm"]["model"])
        save_segments(segs, out)
    _timed(ctx, "translate", go)

def stage_tts(ctx: Ctx):
    dub = ctx.store.dir(ctx.vid) / "dub"
    if dub.exists() and any(dub.glob("*.wav")):
        return
    segs = load_segments(ctx.store.p(ctx.vid, "script.json"))
    adapter = tts_m.get_adapter(ctx.engine, ctx.cfg)
    _timed(ctx, "tts", lambda: tts_m.synth_segments(segs, adapter, dub))

def stage_mix(ctx: Ctx):
    out = ctx.store.p(ctx.vid, "mix.wav")
    if out.exists():
        return
    sep = ctx.store.dir(ctx.vid) / "sep"
    def go():
        import subprocess
        subprocess.run(au.demucs_cmd(ctx.store.p(ctx.vid, "desubbed.mp4"), sep), check=True)
        bg = next(sep.rglob("no_vocals.wav"))
        segs = load_segments(ctx.store.p(ctx.vid, "script.json"))
        au.mix(bg, segs, ctx.store.dir(ctx.vid) / "dub", out)
    _timed(ctx, "mix", go)

def stage_render(ctx: Ctx):
    out = ctx.store.p(ctx.vid, "out_16x9.mp4")
    if out.exists():
        return
    segs = load_segments(ctx.store.p(ctx.vid, "script.json"))
    srt = ctx.store.p(ctx.vid, "sub.srt")
    srt.write_text(to_srt(segs), encoding="utf-8")
    _timed(ctx, "render", lambda: rd.render(ctx.store.p(ctx.vid, "desubbed.mp4"),
                                            ctx.store.p(ctx.vid, "mix.wav"), srt, out))

@app.command()
def run(url: str,
        mask: str = typer.Option(..., help="ymin,ymax,xmin,xmax"),
        cookies: Path = typer.Option(None),
        engine: str = typer.Option("vieneu"),
        stt: str = typer.Option("ocr", help="ocr|asr — bản dùng để dịch"),
        data_root: Path = typer.Option(Path("data")),
        config: Path = typer.Option(Path("config.toml"))):
    m = tuple(int(x) for x in mask.split(","))
    ctx = Ctx(AssetStore(data_root), ing.video_id(url), url, m, cookies, engine, stt, load_config(config))
    from .logutil import setup_logging
    setup_logging(ctx.store.p(ctx.vid, "logs/pipeline.log"))
    for stage in [stage_ingest, stage_desub, stage_stt, stage_translate,
                  stage_tts, stage_mix, stage_render]:
        stage(ctx)
    typer.echo(f"Done: {ctx.store.p(ctx.vid, 'out_16x9.mp4')}")

@app.command()
def report(vid: str, data_root: Path = typer.Option(Path("data"))):
    st = AssetStore(data_root)
    ocr = load_segments(st.p(vid, "segments_ocr.json"))
    asr = load_segments(st.p(vid, "segments_asr.json"))
    typer.echo("| t | OCR | ASR |\n|---|-----|-----|")
    for o in ocr[:200]:
        near = min(asr, key=lambda a: abs(a.start - o.start), default=None)
        typer.echo(f"| {o.start:.1f} | {o.text_src} | {near.text_src if near else ''} |")
    typer.echo(f"\nTimings: {st.read_json(vid, 'timings.json')}")
```

- [ ] **Step 4: PASS (unit).**
- [ ] **Step 5: Acceptance end-to-end (thủ công):** chạy `reup run <URL video có quyền dùng> --mask <đo từ frame thật>` trên **video đầy đủ** (không phải clip). Sau đó `reup report <vid>`. Đánh giá 4 câu hỏi MVP, ghi vào `docs/superpowers/plans/mvp-notes.md`:
  - (a) Desub: xem 5 đoạn ngẫu nhiên — vệt mờ chấp nhận được?
  - (b) Giọng: nghe 3 phút — đủ tự nhiên để đăng?
  - (c) OCR vs ASR: bản nào đúng hơn (nhìn bảng report)?
  - (d) Thời gian từng bước trên Mac (từ timings.json) → ngoại suy chi phí GPU thuê: thuê 1 máy RunPod RTX 4090 (~0.4 USD/h), lặp lại `reup run` trên đó, so timings → USD/video.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: end-to-end run command and OCR/ASR report"`

---

## Self-review (đã chạy)

- **Spec coverage (phạm vi MVP):** tải+cookie (T3), desub+mask (T4), OCR vs ASR (T5, T10 report), dịch LLM độ dài tương đương (T6), 1 giọng + bench 3 engine (T7, T8), Demucs giữ nhạc (T9), render 16:9 + sub Việt (T9), timing fit atempo ≤1.15 (T9 `fit_tempo`), đo chi phí (T10 timings + hướng dẫn GPU). Ngoài phạm vi MVP đúng như spec: không UI/Postiz/9:16/metadata/đa giọng.
- **Placeholder scan:** các điểm "điền sau khi probe" (VSR CLI, VieNeu API, PaddleOCR output) là bước probe có hành động và kết quả cụ thể, cô lập trong config template/script bọc — code chính không đổi. Không còn TBD nào khác.
- **Type consistency:** `Segment` dùng thống nhất; `AssetStore.p/dir/write_json/read_json` khớp giữa T2 và T10; `TemplateTTS.synth(text, out_wav)` khớp T7/T8/T10; tên file asset thống nhất (`raw.mp4`, `desubbed.mp4`, `segments_ocr/asr.json`, `script.json`, `dub/`, `mix.wav`, `sub.srt`, `out_16x9.mp4`, `timings.json`).
