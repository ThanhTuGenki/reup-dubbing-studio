from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.asset_kind import AssetKind, check_asset_kind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.download_grant import DownloadGrant
    from ..models.task_input_asset_metadata import TaskInputAssetMetadata


T = TypeVar("T", bound="TaskInputAsset")


@_attrs_define
class TaskInputAsset:
    """
    Attributes:
        slot (str):
        kind (AssetKind):
        asset_id (UUID):
        metadata (TaskInputAssetMetadata):
        download (DownloadGrant):
    """

    slot: str
    kind: AssetKind
    asset_id: UUID
    metadata: TaskInputAssetMetadata
    download: DownloadGrant

    def to_dict(self) -> dict[str, Any]:
        from ..models.download_grant import DownloadGrant
        from ..models.task_input_asset_metadata import TaskInputAssetMetadata

        slot = self.slot

        kind: str = self.kind

        asset_id = str(self.asset_id)

        metadata = self.metadata.to_dict()

        download = self.download.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slot": slot,
                "kind": kind,
                "assetId": asset_id,
                "metadata": metadata,
                "download": download,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.download_grant import DownloadGrant
        from ..models.task_input_asset_metadata import TaskInputAssetMetadata

        d = dict(src_dict)
        slot = d.pop("slot")

        kind = check_asset_kind(d.pop("kind"))

        asset_id = UUID(d.pop("assetId"))

        metadata = TaskInputAssetMetadata.from_dict(d.pop("metadata"))

        download = DownloadGrant.from_dict(d.pop("download"))

        task_input_asset = cls(
            slot=slot,
            kind=kind,
            asset_id=asset_id,
            metadata=metadata,
            download=download,
        )

        return task_input_asset
