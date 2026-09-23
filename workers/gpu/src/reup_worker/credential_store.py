import os
from pathlib import Path


class CredentialStore:
    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> str | None:
        if not self._path.exists():
            return None
        mode = self._path.stat().st_mode & 0o777
        if mode & 0o077:
            raise PermissionError("worker credential file must not be accessible by group or others")
        value = self._path.read_text(encoding="utf-8").strip()
        return value or None

    def save(self, credential: str) -> None:
        self._path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = self._path.with_suffix(".tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(descriptor, credential.encode("utf-8"))
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, self._path)
        self._path.chmod(0o600)

    def clear(self) -> None:
        self._path.unlink(missing_ok=True)
