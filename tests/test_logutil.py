import logging
import subprocess

import pytest

from reup.logutil import run_logged, setup_logging


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


def test_setup_logging_configures_console_and_file_handlers(tmp_path):
    logfile = tmp_path / "pipeline.log"
    try:
        setup_logging(logfile)
        handlers = logging.getLogger().handlers
        file_handlers = [h for h in handlers if isinstance(h, logging.FileHandler)]
        console_handlers = [
            h
            for h in handlers
            if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
        ]
        assert len(file_handlers) == 1
        assert file_handlers[0].level == logging.DEBUG
        assert len(console_handlers) == 1
        assert console_handlers[0].level == logging.INFO
        assert logfile.parent.is_dir()
    finally:
        logging.shutdown()
        logging.getLogger().handlers.clear()
