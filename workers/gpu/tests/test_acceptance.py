import json
from pathlib import Path

import pytest

from reup_worker.acceptance import benchmark_command, percentile, write_report


def test_percentile_interpolates_sorted_values() -> None:
    assert percentile([4.0, 1.0, 3.0, 2.0], 0.5) == 2.5
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.95) == pytest.approx(3.85)


async def test_command_benchmark_records_latency() -> None:
    report = await benchmark_command(["/usr/bin/true"], iterations=2, warmups=1, label="no-op")

    assert report["schemaVersion"] == 1
    assert report["kind"] == "command"
    assert report["timing"]["requests"] == 2
    assert report["commandLabel"] == "no-op"
    assert report["commandExecutable"] == "true"


def test_write_report_is_valid_json(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "report.json"
    write_report(target, {"schemaVersion": 1, "kind": "test"})

    assert json.loads(target.read_text()) == {"schemaVersion": 1, "kind": "test"}
    assert not target.with_suffix(".json.part").exists()
