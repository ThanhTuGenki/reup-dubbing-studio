# MVP Notes — Reup Dubbing Studio

## Local preparation before the next GPU rental — 2026-09-25

- Local API `http://localhost:3100` and Web `http://localhost:5173` are running;
  PostgreSQL migrations are applied. These ports are local development settings.
- Cloudflare R2 bucket `reup-dubbing-studio-storage` passes the application's
  write/HEAD/read/delete probe. Bucket CORS allows `http://localhost:5173` with
  `GET`, `PUT`, and `HEAD`; an actual `PUT` preflight returned HTTP 204.
- Voice Profile `01a0d909-db86-7c7f-8a8a-07ca3fdea065` is `READY`. The user's
  9.672-second `MinhQuanVoice.mp3` and confirmed transcript were uploaded via
  the API's presigned grant, committed, and read back successfully. The user
  confirmed commercial rights for this recording on 2026-09-25. This does not
  change the separate CC-BY-NC license gate on OmniVoice model weights.
- Channel Profile `01a0d90e-6532-7544-98ee-259ca515ec7e` is `ACTIVE` and
  `READY`: Vietnamese target and subtitles, single voice, 16:9 output, and
  `removeHardSubEnabled=false`.
- The user's 119.633-second H.264/AAC video was staged privately at
  `_acceptance/2026-09-25/video.mp4` in R2. HEAD returned 30,817,733 bytes;
  the SHA-256 is `33d4cf635f19c114d0be19c6a2850e1c6374dd1e82e06a645789717af16f757d`.
  This fixture is not yet an application Video asset.

**Pre-rental gate remains open.** The current API only creates a `DOWNLOAD`
task from a discovered source; it has no local MP4 import. No Control Plane
runner executes `DOWNLOAD`, and no orchestration creates the remaining MVP
tasks. Thus the current Web/API cannot yet process the staged video end to end
or demonstrate Queue, Library, and Studio output transitions. These are code
gaps to close before renting a GPU for Milestone 10; Content Agent credentials
are not a prerequisite for the phase-one CLI MVP.

This file is where every manual/acceptance result referenced by
`docs/operations/manual-checklist.md` gets recorded: desub template probing notes, OmniVoice
acceptance notes, and the four MVP acceptance questions from the final
end-to-end run. Fill in each section as you complete the corresponding
checklist step; leave a section marked "not yet run" until it is.

## Desub template probe (Task 4 / checklist step 2)

- Tool / version probed:
- `[desub].cmd` template used:
- Run time on a 30s clip:
- Notes on subtitle-region cleanliness:

## OmniVoice acceptance notes (Task 7-8 / checklist steps 5-6)

- EzyCloudX Docker GPU/region/rate snapshot:
- OmniVoice version, CUDA/FlashInfer configuration:
- Vietnamese naturalness and pronunciation notes:
- English/cross-lingual voice-cloning notes:
- Warm p50/p95 latency, peak VRAM and 100-request stability:
- License/commercial-rights status:

## GPU Worker acceptance (roadmap milestone 9)

> Product decision 2026-09-25: OCR/PaddleOCR was removed from the MVP. The OCR
> measurements and failures below are retained as historical evidence and are
> no longer an acceptance gate. Transcript generation uses faster-whisper only.

### 2026-09-25 — final-digest retest, partial

Milestone 9 remains open. On an EzyCloudX
`na-01` RTX 3090 (24,576 MiB, NVIDIA driver 610.43.02; rental UI rate 9,900
provider credits/hour), the final CI batch image digest
`sha256:c383da610941d5ae895a576296e5922350a47b564c4c3e490b2f2501657a1a21`
and TTS image digest
`sha256:36349d8744627396c345316097d58e2568a35699d25903f3c26d671ff80c6325`
were unpacked and exercised. This rented container still lacked a Docker
daemon, so inference ran through `proot` with host NVIDIA driver libraries
added to the unpacked images. The image bytes match the published digests,
but this is not native Docker runtime or performance acceptance. Final billed
duration and cost were unavailable.

Fixtures were a 20-second excerpt of the user's 119.6-second Chinese video
and a 9.67-second Vietnamese voice sample. The user confirmed the exact voice
reference text: “Bạn đã bao giờ sống trong một ngôi nhà bị một thanh kiếm
chém làm đôi chưa? Đó là lúc tôi dễ dàng học được cách làm mô hình tương tự.
Đầu tiên, xây dựng khung cổng địa ngục cao 7 khối và 13 khối”. The video
contains hard subtitles; removal remains outside this acceptance scope.
Source fixtures, raw JSON, failure logs, three TTS WAVs, Demucs stems, and
rendered MP4 are saved in Git-ignored
`workers/gpu/acceptance/2026-09-25-rtx3090/`. The two transferred archives
have SHA-256 `ae99616fc5e3ee8682a8bcd3fd1d265a77f2c2cd7948cb0c5b71dbffe634e6ab`
(metrics) and `ab06bafa2c3216c5e637c2afbe79a450fd8f8d416bfa53b66e07f0d21c4dfc16`
(media). A later ASR retry archive has SHA-256
`67a1654a048ad75e90f04803d0514e99348671d72573a4a7c6cc6946742b927f`.

| Stage on final digest | Cold (s) | Warm p50 / p95 (s) | Warm throughput, concurrency 1 | Peak VRAM (MiB) | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| ASR, faster-whisper `medium` | 6.318 | 5.032 / 5.034, direct `proot` | 0.200 runs/s | 2,332 | Chinese transcript with timestamps; three direct warm runs succeeded, while repeated acceptance-harness runs exited `-11` |
| OCR, PaddleOCR | unavailable | unavailable | unavailable | unavailable | Stopped after loading cached `PP-OCRv6_medium_det`; no output or reliable latency |
| Demucs `htdemucs` | 19.376 | 13.866 / 14.056 | 0.072 runs/s | 1,146 | Both vocal and background stems created |
| FFmpeg H.264/AAC render | 21.503 | 20.178 / 20.735 | 0.050 renders/s | 4 | Valid 20.011-second MP4 created |
| OmniVoice, 101 requests | Model load and prompt preparation excluded | 1.157 / 1.194 | 0.721 requests/s including restart | 5,258 | 101/101 valid 24 kHz WAVs; two process starts |

OmniVoice mean latency was 1.388 seconds and maximum was 24.140 seconds,
including the configured restart after request 100. The primary 101-request
report used the user-confirmed reference text. An earlier report used an
ASR-derived reference with one incorrect word and is retained only as
diagnostic evidence. No human naturalness/pronunciation review is recorded.
Official model weights remain CC-BY-NC, so commercial use is still gated.

ASR cold inference succeeded, and a later direct `proot` benchmark completed
three warm runs after one warmup. Repeated warm runs through
`reup-gpu-acceptance command` failed with exit `-11`, including
`OMP_NUM_THREADS=1`; the direct benchmark does not clear that harness failure.
OCR stalled both through the acceptance
harness and direct `proot`. One CPU run with `CUDA_VISIBLE_DEVICES=''` reached
inference but raised Paddle's `ConvertPirAttribute2RuntimeAttribute` oneDNN
error. A one-frame CPU retry with `FLAGS_use_mkldnn=0` timed out after 90
seconds during model setup. Its log is saved beside the other failure logs.
The cause of the GPU OCR stall is not established.
A final one-frame GPU retry with `OMP_NUM_THREADS=1` also timed out after 45
seconds while Paddle was preparing its PIR inference program; its log was
saved locally. No OCR output was produced on this rental.
The ASR harness failure still needs native-runtime diagnosis. OCR is no longer a
supported stage.

**Remaining gates:** resolve the repeated ASR acceptance-harness crash, run every
supported stage in the normal Worker
runtime, review voice quality, capture final rental billing, and perform the
capacity test on the required RTX 3060 12 GB. The 3090 VRAM observations do
not establish 3060 support.

### 2026-09-24 — earlier diagnostic run

The measurements below used locally patched image contents and an 11-second
synthetic fixture. They remain here for comparison and do not replace the
final-digest retest above.

- **Status: partial diagnostic run on 2026-09-24; milestone 9 is not accepted.**
  The rented machine was an EzyCloudX Docker GPU container without a Docker
  daemon. OCI images were unpacked and run with `proot` and host NVIDIA driver
  libraries. The measured images were patched locally to add missing Python
  dependencies, so these numbers do **not** certify the final immutable images
  or native Docker performance. Raw JSON and outputs are saved locally in the
  Git-ignored `workers/gpu/acceptance/2026-09-24-rtx3090-debug/` directory.
- Provider / region / rate: EzyCloudX, `na-ca`, RTX 3090, 9,400 provider credits
  per hour as shown in the rental UI screenshot. Final billed duration and cost
  were not retrieved before the rental ended.
- GPU / driver / CUDA: NVIDIA GeForce RTX 3090, 24,576 MiB, driver 580.82.07;
  `nvidia-smi` reported CUDA 13.0. Image base runtime is CUDA 12.8.1.
- Final CI build: [run 36022441676](https://github.com/ThanhTuGenki/reup-dubbing-studio/actions/runs/36022441676)
  succeeded. The final batch digest is
  `sha256:c383da610941d5ae895a576296e5922350a47b564c4c3e490b2f2501657a1a21`;
  final TTS digest is
  `sha256:36349d8744627396c345316097d58e2568a35699d25903f3c26d671ff80c6325`.
  Neither final digest received the full inference acceptance run before the
  rental ended.

The diagnostic fixture was an 11-second public JFK speech clip from the
`faster-whisper` test data, placed in a 1280×720 video with a burned English
text line and a quiet synthetic tone. Each warm measurement starts a new
subprocess with model files cached; it does not measure a continuously loaded
model except for OmniVoice. Throughput is completed operations divided by
elapsed time at concurrency 1.

| Stage | Cold (s) | Warm p50 / p95 (s) | Warm throughput | Peak VRAM (MiB) |
| --- | ---: | ---: | ---: | ---: |
| ASR, faster-whisper `medium` | 23.82 | 3.60 / 3.91 | 0.272 videos/s | 2,044 |
| OCR, PaddleOCR | 60.33 | 45.06 / 85.74 | 0.019 videos/s | 956 |
| Demucs `htdemucs` | 9.60 | 6.56 / 6.87 | 0.151 videos/s | 1,144 |
| FFmpeg H.264/AAC 1920×1080 render | 3.26 | 3.34 / 3.60 | 0.301 videos/s | 4 |
| OmniVoice, 101 requests | Model load and prompt preparation excluded | 1.03 / 1.08 | 0.790 requests/s | 5,810 |

- OmniVoice produced 101/101 validated 24 kHz WAV files and showed two process
  starts with `restart-after=100`; mean latency was 1.266 s and maximum was
  16.290 s including the restart. This was on the locally patched TTS image.
- ASR returned the exact English source sentence. OCR returned the burned text.
  Demucs produced `vocals.wav` and `no_vocals.wav`; FFmpeg produced an 11.008 s
  MP4 using the background stem and a generated TTS WAV. Voice quality was not
  approved by a human listener. A diagnostic ASR check of TTS WAVs 1, 50 and
  101 produced different Vietnamese transcriptions, so pronunciation needs
  review before acceptance.
- Runtime failures found and fixed on branch `fix/gpu-image-publish-m9`:
  GHCR owner capitalization prevented push; Paddle wheel download timed out;
  the image omitted generated-contract dependencies (`attrs`, `python-dateutil`);
  Demucs environment omitted `numpy`; and the Ubuntu apt mirror served stale
  package metadata. Image smoke now imports the actual Python modules.
- Remaining gates: run all stages on the final immutable digests in the normal
  Worker runtime, repeat the 101-request test and quality review, obtain actual
  billing cost, and run capacity acceptance on an RTX 3060 12 GB before marking
  that GPU supported. The observed 5,810 MiB OmniVoice peak on the 3090 does
  not establish RTX 3060 compatibility.

## (a) Desub quality

Look at 5 random timestamps in `desubbed.mp4` (spread across the video): is
the cleaned-up region acceptable (no distracting smear/ghosting where the
burned-in subtitles used to be)?

*Not yet run.*

## (b) Dub naturalness

Listen to 3 minutes of `out_16x9.mp4`'s audio: is the synthesised Vietnamese
voice natural enough to publish?

*Not yet run.*

## (c) ASR accuracy

Read the transcript from `reup report <vid>` and compare representative lines
with the source audio.

*Not yet run.*

## (d) Per-stage cost

Read `timings.json` (echoed at the end of the `report` output) for how long
each stage took on this Mac. Extrapolate to rented-GPU cost: rent one
RunPod RTX 4090 instance (~US$0.40/hour), repeat `reup run` there, compare
its `timings.json` against the Mac run, and compute US$-per-video from the
GPU-hours actually used.

- Mac timings.json:
- RunPod timings.json:
- US$/video estimate:

*Not yet run.*
