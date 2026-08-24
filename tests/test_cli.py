import logging

import pytest
import typer
from typer.testing import CliRunner

from reup.assets import AssetStore
from reup.cli import Ctx, _parse_mask, app
from reup.ingest import video_id
from reup.segments import Segment, save_segments


@pytest.fixture(autouse=True)
def _reset_root_logging_handlers():
    """`reup.cli.run` calls `setup_logging`, which reconfigures the root
    logger's handlers on every invocation. A `logging.StreamHandler()` bound
    while Typer's `CliRunner` has swapped `sys.stdout` for capture can outlive
    that swap and blow up ("I/O operation on closed file") the next time any
    logger writes to it in a later test. Snapshot/restore around each test so
    handlers added here never leak into the rest of the suite.
    """
    root = logging.getLogger()
    before = root.handlers[:]
    yield
    for h in root.handlers:
        if h not in before:
            try:
                h.close()
            except Exception:
                pass
    root.handlers[:] = before


def test_run_calls_stages_in_order(monkeypatch, tmp_path):
    order = []
    import reup.cli as c

    for name in [
        "stage_ingest",
        "stage_desub",
        "stage_stt",
        "stage_translate",
        "stage_tts",
        "stage_mix",
        "stage_render",
    ]:
        monkeypatch.setattr(c, name, lambda ctx, _n=name: order.append(_n))
    r = CliRunner().invoke(
        app,
        ["run", "https://x/v", "--mask", "600,700,0,1280", "--data-root", str(tmp_path)],
    )
    assert r.exit_code == 0
    assert order == [
        "stage_ingest",
        "stage_desub",
        "stage_stt",
        "stage_translate",
        "stage_tts",
        "stage_mix",
        "stage_render",
    ]


def test_run_preserves_timings_across_resume(monkeypatch, tmp_path):
    import reup.cli as c

    def fake_noop(ctx):
        pass

    def fake_ingest(ctx):
        c._timed(ctx, "ingest", lambda: None)

    for name in [
        "stage_desub",
        "stage_stt",
        "stage_translate",
        "stage_tts",
        "stage_mix",
        "stage_render",
    ]:
        monkeypatch.setattr(c, name, fake_noop)
    monkeypatch.setattr(c, "stage_ingest", fake_ingest)

    args = ["run", "https://x/v", "--mask", "600,700,0,1280", "--data-root", str(tmp_path)]
    r1 = CliRunner().invoke(app, args)
    assert r1.exit_code == 0

    store = AssetStore(tmp_path)
    vid = video_id("https://x/v")
    timings1 = store.read_json(vid, "timings.json")
    assert "ingest" in timings1

    # Second invocation: "ingest" is now skipped entirely (its artifact already
    # exists in the real pipeline), but "desub" records a fresh timing. The
    # earlier "ingest" entry must survive in timings.json.
    monkeypatch.setattr(c, "stage_ingest", fake_noop)
    monkeypatch.setattr(c, "stage_desub", lambda ctx: c._timed(ctx, "desub", lambda: None))

    r2 = CliRunner().invoke(app, args)
    assert r2.exit_code == 0

    timings2 = store.read_json(vid, "timings.json")
    assert "ingest" in timings2
    assert "desub" in timings2


def test_stage_tts_reruns_on_partial_dub_and_skips_when_complete(tmp_path, monkeypatch):
    import reup.cli as c

    store = AssetStore(tmp_path)
    vid = "vid-tts"
    segs = [
        Segment(index=0, start=0.0, end=1.0, text_src="a", text_vi="chào"),
        Segment(index=1, start=1.0, end=2.0, text_src="b", text_vi="tạm biệt"),
    ]
    save_segments(segs, store.p(vid, "script.json"))

    dub = store.dir(vid) / "dub"
    dub.mkdir(parents=True, exist_ok=True)
    (dub / "0000.wav").write_bytes(b"x")  # only one of the two expected wavs

    called = []
    monkeypatch.setattr(c.tts_m, "get_adapter", lambda name, cfg: object())
    monkeypatch.setattr(
        c.tts_m,
        "synth_segments",
        lambda segs, adapter, dub_dir, log_path=None: called.append(True),
    )

    ctx = Ctx(store, vid, "https://x/v", (0, 1, 0, 1), None, "vieneu", "ocr", {})
    c.stage_tts(ctx)
    assert called == [True]  # partial dub dir -> stage reruns

    (dub / "0001.wav").write_bytes(b"x")  # now complete
    called.clear()
    c.stage_tts(ctx)
    assert called == []  # complete dub dir -> stage skips


def test_timed_logs_stage_start_and_completion(tmp_path, caplog):
    import reup.cli as c

    store = AssetStore(tmp_path)
    ctx = Ctx(store, "vid-log", "https://x/v", (0, 1, 0, 1), None, "vieneu", "ocr", {})
    with caplog.at_level(logging.INFO, logger="reup.cli"):
        c._timed(ctx, "demo", lambda: None)
    records = [r for r in caplog.records if r.name == "reup.cli"]
    assert len(records) == 2
    assert "demo" in records[0].message and "start" in records[0].message.lower()
    assert "demo" in records[1].message and "done" in records[1].message.lower()


def test_stage_mix_runs_demucs_through_run_logged(tmp_path, monkeypatch):
    import reup.cli as c

    store = AssetStore(tmp_path)
    vid = "vid-mix"
    segs = [Segment(index=0, start=0.0, end=1.0, text_src="a", text_vi="chào")]
    save_segments(segs, store.p(vid, "script.json"))
    sep = store.dir(vid) / "sep" / "htdemucs" / "desubbed"

    calls = []

    def fake_run_logged(cmd, log_path=None):
        calls.append((cmd, log_path))
        # simulate demucs having produced the background stem
        sep.mkdir(parents=True, exist_ok=True)
        (sep / "no_vocals.wav").write_bytes(b"bg")

    monkeypatch.setattr(c, "run_logged", fake_run_logged)
    monkeypatch.setattr(c.au, "demucs_cmd", lambda inp, out_dir: ["demucs", "fake"])
    monkeypatch.setattr(
        c.au, "mix", lambda bg, segs, dub_dir, out, log_path=None: out.write_bytes(b"mix")
    )

    ctx = Ctx(store, vid, "https://x/v", (0, 1, 0, 1), None, "vieneu", "ocr", {})
    c.stage_mix(ctx)

    assert len(calls) == 1
    cmd, log_path = calls[0]
    assert cmd == ["demucs", "fake"]
    assert str(log_path).endswith("logs/demucs.log")
    assert store.p(vid, "mix.wav").exists()


def test_report_handles_missing_transcripts_without_raising(tmp_path):
    store = AssetStore(tmp_path)

    vid_ocr_only = "vid-ocr-only"
    save_segments(
        [Segment(index=0, start=0.0, end=1.0, text_src="hello")],
        store.p(vid_ocr_only, "segments_ocr.json"),
    )
    r = CliRunner().invoke(app, ["report", vid_ocr_only, "--data-root", str(tmp_path)])
    assert r.exit_code == 0
    assert "Thiếu segments_asr.json" in r.output

    vid_asr_only = "vid-asr-only"
    save_segments(
        [Segment(index=0, start=0.0, end=1.0, text_src="hello")],
        store.p(vid_asr_only, "segments_asr.json"),
    )
    r = CliRunner().invoke(app, ["report", vid_asr_only, "--data-root", str(tmp_path)])
    assert r.exit_code == 0
    assert "Thiếu segments_ocr.json" in r.output

    vid_neither = "vid-neither"
    store.dir(vid_neither)
    r = CliRunner().invoke(app, ["report", vid_neither, "--data-root", str(tmp_path)])
    assert r.exit_code == 0
    assert "Chưa có" in r.output


def test_parse_mask_rejects_bad_values():
    with pytest.raises(typer.BadParameter):
        _parse_mask("--5,1,2,3")
    with pytest.raises(typer.BadParameter):
        _parse_mask("600,700,0")


def test_bench_skips_unconfigured(tmp_path, monkeypatch):
    cfgfile = tmp_path / "config.toml"
    cfgfile.write_text('[tts.vieneu]\ncmd = ""\n[tts.f5]\ncmd = ""\n[tts.omnivoice]\ncmd = ""\n')
    r = CliRunner().invoke(
        app,
        ["bench-tts", "--text", "xin chào", "--out-dir", str(tmp_path), "--config", str(cfgfile)],
    )
    assert r.exit_code == 0
    assert r.output.count("skipped") == 3
