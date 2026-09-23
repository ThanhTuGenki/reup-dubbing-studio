from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.worker_role import WorkerRole, check_worker_role
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_identity_cpu_inventory import SessionIdentityCpuInventory
    from ..models.session_identity_gpu_inventory_item import SessionIdentityGpuInventoryItem
    from ..models.worker_capacity import WorkerCapacity


T = TypeVar("T", bound="SessionIdentity")


@_attrs_define
class SessionIdentity:
    """
    Attributes:
        session_nonce (UUID):
        role (WorkerRole):
        image_digest (str):
        agent_version (str):
        contract_version (int):
        capabilities (list[str]):
        gpu_inventory (list[SessionIdentityGpuInventoryItem]):
        cpu_inventory (SessionIdentityCpuInventory):
        capacity (WorkerCapacity):
    """

    session_nonce: UUID
    role: WorkerRole
    image_digest: str
    agent_version: str
    contract_version: int
    capabilities: list[str]
    gpu_inventory: list[SessionIdentityGpuInventoryItem]
    cpu_inventory: SessionIdentityCpuInventory
    capacity: WorkerCapacity

    def to_dict(self) -> dict[str, Any]:
        from ..models.session_identity_cpu_inventory import SessionIdentityCpuInventory
        from ..models.session_identity_gpu_inventory_item import SessionIdentityGpuInventoryItem
        from ..models.worker_capacity import WorkerCapacity

        session_nonce = str(self.session_nonce)

        role: str = self.role

        image_digest = self.image_digest

        agent_version = self.agent_version

        contract_version = self.contract_version

        capabilities = self.capabilities

        gpu_inventory = []
        for gpu_inventory_item_data in self.gpu_inventory:
            gpu_inventory_item = gpu_inventory_item_data.to_dict()
            gpu_inventory.append(gpu_inventory_item)

        cpu_inventory = self.cpu_inventory.to_dict()

        capacity = self.capacity.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionNonce": session_nonce,
                "role": role,
                "imageDigest": image_digest,
                "agentVersion": agent_version,
                "contractVersion": contract_version,
                "capabilities": capabilities,
                "gpuInventory": gpu_inventory,
                "cpuInventory": cpu_inventory,
                "capacity": capacity,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_identity_cpu_inventory import SessionIdentityCpuInventory
        from ..models.session_identity_gpu_inventory_item import SessionIdentityGpuInventoryItem
        from ..models.worker_capacity import WorkerCapacity

        d = dict(src_dict)
        session_nonce = UUID(d.pop("sessionNonce"))

        role = check_worker_role(d.pop("role"))

        image_digest = d.pop("imageDigest")

        agent_version = d.pop("agentVersion")

        contract_version = d.pop("contractVersion")

        capabilities = cast(list[str], d.pop("capabilities"))

        gpu_inventory = []
        _gpu_inventory = d.pop("gpuInventory")
        for gpu_inventory_item_data in _gpu_inventory:
            gpu_inventory_item = SessionIdentityGpuInventoryItem.from_dict(gpu_inventory_item_data)

            gpu_inventory.append(gpu_inventory_item)

        cpu_inventory = SessionIdentityCpuInventory.from_dict(d.pop("cpuInventory"))

        capacity = WorkerCapacity.from_dict(d.pop("capacity"))

        session_identity = cls(
            session_nonce=session_nonce,
            role=role,
            image_digest=image_digest,
            agent_version=agent_version,
            contract_version=contract_version,
            capabilities=capabilities,
            gpu_inventory=gpu_inventory,
            cpu_inventory=cpu_inventory,
            capacity=capacity,
        )

        return session_identity
