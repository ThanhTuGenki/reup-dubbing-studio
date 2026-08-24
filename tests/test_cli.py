from typer.testing import CliRunner

from reup.cli import app


def test_bench_skips_unconfigured(tmp_path, monkeypatch):
    cfgfile = tmp_path / "config.toml"
    cfgfile.write_text('[tts.vieneu]\ncmd = ""\n[tts.f5]\ncmd = ""\n[tts.omnivoice]\ncmd = ""\n')
    r = CliRunner().invoke(
        app,
        ["bench-tts", "--text", "xin chào", "--out-dir", str(tmp_path), "--config", str(cfgfile)],
    )
    assert r.exit_code == 0
    assert r.output.count("skipped") == 3
