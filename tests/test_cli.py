from typer.testing import CliRunner

from reup.cli import app


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


def test_bench_skips_unconfigured(tmp_path, monkeypatch):
    cfgfile = tmp_path / "config.toml"
    cfgfile.write_text('[tts.vieneu]\ncmd = ""\n[tts.f5]\ncmd = ""\n[tts.omnivoice]\ncmd = ""\n')
    r = CliRunner().invoke(
        app,
        ["bench-tts", "--text", "xin chào", "--out-dir", str(tmp_path), "--config", str(cfgfile)],
    )
    assert r.exit_code == 0
    assert r.output.count("skipped") == 3
