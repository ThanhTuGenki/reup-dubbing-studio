import logging

import pytest
import typer
from typer.testing import CliRunner

from reup.assets import AssetStore
from reup.cli import Ctx, _parse_mask, app
from reup.ingest import video_id
from reup.segments import Segment, load_segments, save_segments


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


def _valid_run_config(tmp_path):
    """A config.toml satisfying _validate_run_args for the default
    engine="vieneu"/stt="ocr": the real repo-root config.toml intentionally
    ships every [tts.*] cmd empty as an unfilled template, so tests that
    exercise a successful `reup run` validation path need their own config
    with a non-empty cmd for the engine actually used."""
    cfgfile = tmp_path / "config.toml"
    cfgfile.write_text(
        '[llm]\nmodel = "m"\n[desub]\ncmd = "true"\n[tts.vieneu]\ncmd = "true {text} {out}"\n'
    )
    return cfgfile


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
    cfgfile = _valid_run_config(tmp_path)
    r = CliRunner().invoke(
        app,
        [
            "run",
            "https://x/v",
            "--mask",
            "600,700,0,1280",
            "--data-root",
            str(tmp_path),
            "--config",
            str(cfgfile),
        ],
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

    cfgfile = _valid_run_config(tmp_path)
    args = [
        "run",
        "https://x/v",
        "--mask",
        "600,700,0,1280",
        "--data-root",
        str(tmp_path),
        "--config",
        str(cfgfile),
    ]
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


def test_stage_mix_skips_demucs_when_no_vocals_already_exists(tmp_path, monkeypatch):
    import reup.cli as c

    store = AssetStore(tmp_path)
    vid = "vid-mix-resume"
    segs = [Segment(index=0, start=0.0, end=1.0, text_src="a", text_vi="chào")]
    save_segments(segs, store.p(vid, "script.json"))

    # no_vocals.wav already there from a previous (successful) demucs run
    sep_out = store.dir(vid) / "sep" / "htdemucs" / "desubbed"
    sep_out.mkdir(parents=True, exist_ok=True)
    (sep_out / "no_vocals.wav").write_bytes(b"bg")

    calls = []
    monkeypatch.setattr(c, "run_logged", lambda cmd, log_path=None: calls.append(cmd))
    monkeypatch.setattr(
        c.au, "mix", lambda bg, segs, dub_dir, out, log_path=None: out.write_bytes(b"mix")
    )

    ctx = Ctx(store, vid, "https://x/v", (0, 1, 0, 1), None, "vieneu", "ocr", {})
    c.stage_mix(ctx)

    assert calls == []  # demucs (the longest stage) must not have been re-run
    assert store.p(vid, "mix.wav").exists()


def test_stage_translate_saves_each_batch_before_a_later_batch_fails(tmp_path, monkeypatch):
    import reup.cli as c

    store = AssetStore(tmp_path)
    vid = "vid-translate"
    n = 55  # two batches of 50/5, so a failure on batch 2 can be observed
    segs = [Segment(index=i, start=float(i), end=float(i) + 1, text_src=f"s{i}") for i in range(n)]
    save_segments(segs, store.p(vid, "segments_ocr.json"))

    monkeypatch.setattr("anthropic.Anthropic", lambda: "fake-client")

    batch_calls: list[list[int]] = []

    def fake_translate(batch, client=None, model=None):
        batch_calls.append([s.index for s in batch])
        if len(batch_calls) == 2:
            raise RuntimeError("simulated API failure on the second batch")
        for s in batch:
            s.text_vi = f"vi{s.index}"
        return batch

    monkeypatch.setattr(c.tr, "translate", fake_translate)

    ctx = Ctx(
        store, vid, "https://x/v", (0, 1, 0, 1), None, "vieneu", "ocr", {"llm": {"model": "m"}}
    )

    with pytest.raises(RuntimeError):
        c.stage_translate(ctx)

    # The first (successful, paid-for) batch must have been persisted even
    # though the second batch blew up -- a pre-fix implementation only
    # calls save_segments() after ALL batches, so script.json would not
    # exist here at all.
    saved = load_segments(store.p(vid, "script.json"))
    assert saved[0].text_vi == "vi0"
    assert saved[49].text_vi == "vi49"
    assert saved[50].text_vi == ""  # second batch never completed


def test_stage_translate_resumes_after_a_previous_batch_failure(tmp_path, monkeypatch):
    """A failed batch must not silently ship an untranslated gap: once
    script.json exists but is incomplete (some segment with source text has
    blank text_vi), stage_translate must re-enter translation on the next
    invocation rather than skipping because the file merely exists."""
    import reup.cli as c

    store = AssetStore(tmp_path)
    vid = "vid-translate-resume"
    n = 55  # two batches of 50/5
    segs_src = [
        Segment(index=i, start=float(i), end=float(i) + 1, text_src=f"s{i}") for i in range(n)
    ]
    save_segments(segs_src, store.p(vid, "segments_ocr.json"))

    monkeypatch.setattr("anthropic.Anthropic", lambda: "fake-client")

    call_count = {"n": 0}

    def fake_translate_fails_on_batch_2(batch, client=None, model=None):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated API failure on the second batch")
        for s in batch:
            s.text_vi = f"vi{s.index}"
        return batch

    monkeypatch.setattr(c.tr, "translate", fake_translate_fails_on_batch_2)

    ctx = Ctx(
        store, vid, "https://x/v", (0, 1, 0, 1), None, "vieneu", "ocr", {"llm": {"model": "m"}}
    )

    with pytest.raises(RuntimeError):
        c.stage_translate(ctx)

    saved_after_failure = load_segments(store.p(vid, "script.json"))
    assert saved_after_failure[50].text_vi == ""  # confirm still incomplete

    # Second invocation: script.json exists but is incomplete, so
    # stage_translate must actually re-enter translation, not skip.
    translate_calls: list[list[int]] = []

    def fake_translate_succeeds(batch, client=None, model=None):
        translate_calls.append([s.index for s in batch])
        for s in batch:
            s.text_vi = f"vi{s.index}"
        return batch

    monkeypatch.setattr(c.tr, "translate", fake_translate_succeeds)

    c.stage_translate(ctx)

    assert translate_calls  # translate() was actually invoked again
    saved_after_resume = load_segments(store.p(vid, "script.json"))
    assert all(s.text_vi.strip() for s in saved_after_resume)


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


def test_parse_mask_rejects_inverted_or_zero_width():
    with pytest.raises(typer.BadParameter):
        _parse_mask("700,600,0,1280")  # ymin > ymax: inverted -> negative-size crop
    with pytest.raises(typer.BadParameter):
        _parse_mask("600,600,0,1280")  # ymin == ymax: zero-height crop
    with pytest.raises(typer.BadParameter):
        _parse_mask("600,700,1280,0")  # xmin > xmax: inverted -> negative-size crop
    with pytest.raises(typer.BadParameter):
        _parse_mask("-10,700,0,1280")  # negative ymin


def test_validate_run_args_rejects_bad_stt():
    from reup.cli import _validate_run_args

    with pytest.raises(typer.BadParameter):
        _validate_run_args("ocrr", "vieneu", {"tts": {"vieneu": {"cmd": "x"}}})


def test_validate_run_args_rejects_unknown_engine():
    from reup.cli import _validate_run_args

    with pytest.raises(typer.BadParameter):
        _validate_run_args("ocr", "vieneuu", {"tts": {"vieneu": {"cmd": "x"}}})


def test_validate_run_args_rejects_missing_config_sections():
    from reup.cli import _validate_run_args

    with pytest.raises(typer.BadParameter):
        _validate_run_args("ocr", "vieneu", {"tts": {"vieneu": {"cmd": "x"}}})  # missing desub/llm


def test_validate_run_args_rejects_engine_with_empty_cmd():
    # The engine section can exist (every [tts.*] template ships with
    # cmd = "" by default) without being usable. Validation must catch that
    # up front too, or A8's whole point -- failing before paid work runs --
    # is defeated by the common real case of a present-but-unconfigured
    # engine.
    from reup.cli import _validate_run_args

    with pytest.raises(typer.BadParameter):
        _validate_run_args(
            "ocr",
            "vieneu",
            {"tts": {"vieneu": {"cmd": ""}}, "desub": {"cmd": ""}, "llm": {"model": "m"}},
        )


def test_validate_run_args_accepts_valid_config():
    from reup.cli import _validate_run_args

    _validate_run_args(
        "ocr",
        "vieneu",
        {"tts": {"vieneu": {"cmd": "x"}}, "desub": {"cmd": ""}, "llm": {"model": "m"}},
    )


def test_run_rejects_unknown_engine_before_touching_the_network(tmp_path, monkeypatch):
    import reup.cli as c

    called = []
    monkeypatch.setattr(c, "stage_ingest", lambda ctx: called.append("ingest"))
    r = CliRunner().invoke(
        app,
        [
            "run",
            "https://x/v",
            "--mask",
            "600,700,0,1280",
            "--data-root",
            str(tmp_path),
            "--engine",
            "vieneuu",
        ],
    )
    assert r.exit_code != 0
    assert called == []  # never reached the stage loop / paid work


def test_run_catches_runtime_error_and_reports_cleanly(monkeypatch, tmp_path):
    import reup.cli as c

    def boom(ctx):
        raise RuntimeError(
            "Lệnh thất bại (exit 1): ffmpeg\nLog: /tmp/x.log\n--- 20 dòng cuối ---\nboom"
        )

    monkeypatch.setattr(c, "stage_ingest", boom)
    cfgfile = _valid_run_config(tmp_path)
    r = CliRunner().invoke(
        app,
        [
            "run",
            "https://x/v",
            "--mask",
            "600,700,0,1280",
            "--data-root",
            str(tmp_path),
            "--config",
            str(cfgfile),
        ],
    )
    assert r.exit_code == 1
    assert "boom" in r.output
    assert "Traceback" not in r.output


def test_bench_skips_unconfigured(tmp_path, monkeypatch):
    cfgfile = tmp_path / "config.toml"
    cfgfile.write_text('[tts.vieneu]\ncmd = ""\n[tts.f5]\ncmd = ""\n[tts.omnivoice]\ncmd = ""\n')
    r = CliRunner().invoke(
        app,
        ["bench-tts", "--text", "xin chào", "--out-dir", str(tmp_path), "--config", str(cfgfile)],
    )
    assert r.exit_code == 0
    assert r.output.count("skipped") == 3


def test_bench_tts_strips_engine_names(tmp_path):
    cfgfile = tmp_path / "config.toml"
    cfgfile.write_text('[tts.vieneu]\ncmd = ""\n[tts.f5]\ncmd = ""\n[tts.omnivoice]\ncmd = ""\n')
    r = CliRunner().invoke(
        app,
        [
            "bench-tts",
            "--text",
            "xin chào",
            "--engines",
            "vieneu, f5 , omnivoice",
            "--out-dir",
            str(tmp_path),
            "--config",
            str(cfgfile),
        ],
    )
    assert r.exit_code == 0
    # Without stripping, " f5 " and " omnivoice" never match the config's
    # "f5"/"omnivoice" keys, so they'd print with a leading space and the
    # lookup would silently report the wrong reason.
    assert "\n f5:" not in r.output
    assert "\n omnivoice:" not in r.output
    assert "f5: skipped (chưa cấu hình)" in r.output
    assert "omnivoice: skipped (chưa cấu hình)" in r.output
