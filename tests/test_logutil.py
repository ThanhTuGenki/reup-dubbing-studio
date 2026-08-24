import subprocess

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


def test_no_log_path_runs_without_file():
    run_logged(["python3", "-c", "print('hi')"])


def test_no_log_path_raises_on_failure():
    with pytest.raises(subprocess.CalledProcessError):
        run_logged(["python3", "-c", "import sys; sys.exit(3)"])
