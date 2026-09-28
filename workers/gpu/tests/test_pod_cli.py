import sys
from pathlib import Path

import pytest

from reup_worker.pod.cli import SubprocessLauncher, main

DIGEST = "sha256:" + "d" * 64


def test_check_accepts_a_valid_pod_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    for key, value in {
        "REUP_CONTROL_PLANE_URL": "https://cp.example/worker/v1",
        "REUP_WORKER_IMAGE_DIGEST": DIGEST,
        "REUP_BATCH_ENROLLMENT_TOKEN": "batch-secret",
        "REUP_TTS_ENROLLMENT_TOKEN": "tts-secret",
        "REUP_POD_STATE_ROOT": str(tmp_path),
    }.items():
        monkeypatch.setenv(key, value)
    main(["--check"])
    output = capsys.readouterr().out
    assert "[supervisor] configuration ok: roles=batch,tts tailscale=no" in output
    assert "secret" not in output


def test_invalid_environment_exits_2_and_names_variables(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    for key in ("REUP_CONTROL_PLANE_URL", "REUP_CONTROL_PLANE_HOST", "REUP_WORKER_IMAGE_DIGEST"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("REUP_POD_STATE_ROOT", str(tmp_path))
    with pytest.raises(SystemExit) as raised:
        main(["--check"])
    assert raised.value.code == 2
    assert "[supervisor] set REUP_CONTROL_PLANE_HOST or REUP_CONTROL_PLANE_URL" in capsys.readouterr().out


async def test_subprocess_launcher_prefixes_output(capsys: pytest.CaptureFixture[str]) -> None:
    lines: list[tuple[str, str]] = []
    launcher = SubprocessLauncher(lambda source, message: lines.append((source, message)))
    handle = await launcher.start("batch", [sys.executable, "-c", "print('hello'); import sys; sys.exit(3)"], {})
    assert await handle.wait() == 3
    assert await handle.wait() == 3
    assert ("batch", "hello") in lines


async def test_an_oversized_line_is_truncated_but_relaying_continues() -> None:
    lines: list[tuple[str, str]] = []
    launcher = SubprocessLauncher(lambda source, message: lines.append((source, message)))
    script = "import sys\nsys.stdout.write('a' * 200000 + '\\n')\nsys.stdout.write('normal line\\n')\nsys.exit(7)\n"
    handle = await launcher.start("batch", [sys.executable, "-c", script], {})
    assert await handle.wait() == 7
    long_entries = [message for source, message in lines if source == "batch" and message.startswith("a")]
    assert len(long_entries) == 1
    assert long_entries[0].endswith("…[truncated]")
    assert len(long_entries[0]) == 16 * 1024 + len("…[truncated]")
    assert ("batch", "normal line") in lines


async def test_a_final_line_without_a_trailing_newline_is_still_relayed() -> None:
    lines: list[tuple[str, str]] = []
    launcher = SubprocessLauncher(lambda source, message: lines.append((source, message)))
    script = "import sys\nsys.stdout.write('partial')\nsys.stdout.flush()\n"
    handle = await launcher.start("batch", [sys.executable, "-c", script], {})
    assert await handle.wait() == 0
    assert ("batch", "partial") in lines
