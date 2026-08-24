# MVP Notes — Reup Dubbing Studio

This file is where every manual/acceptance result referenced by
`docs/MANUAL-CHECKLIST.md` gets recorded: desub template probing notes, TTS
engine listening notes, and the four MVP acceptance questions from the final
end-to-end run. Fill in each section as you complete the corresponding
checklist step; leave a section marked "not yet run" until it is.

## Desub template probe (Task 4 / checklist step 2)

- Tool / version probed:
- `[desub].cmd` template used:
- Run time on a 30s clip:
- Notes on subtitle-region cleanliness:

## TTS engine listening notes (Task 7-8 / checklist steps 5-6)

- VieNeu-TTS naturalness notes:
- F5-TTS-VN: configured? naturalness notes, or "needs benchmarking on a
  rented GPU":
- OmniVoice: configured? naturalness notes, or "needs benchmarking on a
  rented GPU":
- Engine judged most natural overall:

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
