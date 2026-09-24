# MVP Notes — Reup Dubbing Studio

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

## (c) OCR vs ASR accuracy

Read the table from `reup report <vid>`: which of the two transcripts is
more accurate line-by-line?

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
