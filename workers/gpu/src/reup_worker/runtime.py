import os
import shutil
import subprocess
import time
from pathlib import Path
from uuid import UUID

from reup_worker_contract.models.session_identity import SessionIdentity
from reup_worker_contract.models.session_identity_cpu_inventory import SessionIdentityCpuInventory
from reup_worker_contract.models.session_identity_gpu_inventory_item import SessionIdentityGpuInventoryItem
from reup_worker_contract.models.worker_capacity import WorkerCapacity
from reup_worker_contract.types import UNSET

from .settings import WorkerSettings


def build_identity(settings: WorkerSettings) -> SessionIdentity:
    gpu_inventory = detect_gpus()
    cpu = SessionIdentityCpuInventory()
    cpu["logicalCores"] = os.cpu_count() or 1
    free_bytes = shutil.disk_usage(settings.workspace_root.parent.resolve()).free
    vram_values = [item.additional_properties.get("vramMb") for item in gpu_inventory]
    vram = sum(value for value in vram_values if isinstance(value, int))
    return SessionIdentity(
        session_nonce=uuid_v7(),
        role=settings.role,
        image_digest=settings.image_digest,
        agent_version=settings.agent_version,
        contract_version=settings.contract_version,
        capabilities=list(settings.capabilities),
        gpu_inventory=gpu_inventory,
        cpu_inventory=cpu,
        capacity=WorkerCapacity(
            max_concurrent_tasks=1,
            available_task_slots=1,
            scratch_free_bytes=str(free_bytes),
            vram_free_mb=vram if vram else UNSET,
        ),
    )


def detect_gpus() -> list[SessionIdentityGpuInventoryItem]:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],  # noqa: S607
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return []
    inventory: list[SessionIdentityGpuInventoryItem] = []
    for line in result.stdout.splitlines():
        model, separator, raw_vram = line.rpartition(",")
        if not separator:
            continue
        item = SessionIdentityGpuInventoryItem()
        item["model"] = model.strip()
        item["vramMb"] = int(raw_vram.strip())
        inventory.append(item)
    return inventory


def uuid_v7() -> UUID:
    timestamp = int(time.time() * 1000) & ((1 << 48) - 1)
    random_bits = int.from_bytes(os.urandom(10), "big")
    value = timestamp << 80
    value |= 0x7 << 76
    value |= (random_bits >> 66) << 64
    value |= 0b10 << 62
    value |= random_bits & ((1 << 62) - 1)
    return UUID(int=value)


def ensure_workspace_parent(path: Path) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
