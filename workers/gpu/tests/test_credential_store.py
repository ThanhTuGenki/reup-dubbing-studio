from pathlib import Path

import pytest

from reup_worker.credential_store import CredentialStore


def test_credential_is_written_with_owner_only_permissions(tmp_path: Path) -> None:
    path = tmp_path / "state" / "credential"
    store = CredentialStore(path)
    store.save("wrk_example")
    assert store.load() == "wrk_example"
    assert path.stat().st_mode & 0o777 == 0o600


def test_credential_rejects_unsafe_permissions(tmp_path: Path) -> None:
    path = tmp_path / "credential"
    path.write_text("wrk_example", encoding="utf-8")
    path.chmod(0o644)
    with pytest.raises(PermissionError):
        CredentialStore(path).load()
