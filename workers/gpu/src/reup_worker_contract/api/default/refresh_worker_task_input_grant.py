from http import HTTPStatus
from typing import Any, cast
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.download_grant_envelope import DownloadGrantEnvelope
from ...models.lease_action_request import LeaseActionRequest
from ...models.problem_details import ProblemDetails
from ...types import UNSET, Response


def _get_kwargs(
    task_id: UUID,
    attempt_id: UUID,
    asset_id: UUID,
    *,
    body: LeaseActionRequest,
    idempotency_key: str,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/tasks/{task_id}/attempts/{attempt_id}/inputs/{asset_id}/refresh".format(
            task_id=task_id,
            attempt_id=attempt_id,
            asset_id=asset_id,
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> DownloadGrantEnvelope | ProblemDetails:
    if response.status_code == 200:
        response_200 = DownloadGrantEnvelope.from_dict(response.json())

        return response_200

    response_default = ProblemDetails.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[DownloadGrantEnvelope | ProblemDetails]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    task_id: UUID,
    attempt_id: UUID,
    asset_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: LeaseActionRequest,
    idempotency_key: str,
) -> Response[DownloadGrantEnvelope | ProblemDetails]:
    """Refresh a download grant for an authorized task input

    Args:
        task_id (UUID):
        attempt_id (UUID):
        asset_id (UUID):
        idempotency_key (str):
        body (LeaseActionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DownloadGrantEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        task_id=task_id,
        attempt_id=attempt_id,
        asset_id=asset_id,
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    task_id: UUID,
    attempt_id: UUID,
    asset_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: LeaseActionRequest,
    idempotency_key: str,
) -> DownloadGrantEnvelope | ProblemDetails | None:
    """Refresh a download grant for an authorized task input

    Args:
        task_id (UUID):
        attempt_id (UUID):
        asset_id (UUID):
        idempotency_key (str):
        body (LeaseActionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DownloadGrantEnvelope | ProblemDetails
    """

    return sync_detailed(
        task_id=task_id,
        attempt_id=attempt_id,
        asset_id=asset_id,
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    task_id: UUID,
    attempt_id: UUID,
    asset_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: LeaseActionRequest,
    idempotency_key: str,
) -> Response[DownloadGrantEnvelope | ProblemDetails]:
    """Refresh a download grant for an authorized task input

    Args:
        task_id (UUID):
        attempt_id (UUID):
        asset_id (UUID):
        idempotency_key (str):
        body (LeaseActionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DownloadGrantEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        task_id=task_id,
        attempt_id=attempt_id,
        asset_id=asset_id,
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    task_id: UUID,
    attempt_id: UUID,
    asset_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: LeaseActionRequest,
    idempotency_key: str,
) -> DownloadGrantEnvelope | ProblemDetails | None:
    """Refresh a download grant for an authorized task input

    Args:
        task_id (UUID):
        attempt_id (UUID):
        asset_id (UUID):
        idempotency_key (str):
        body (LeaseActionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DownloadGrantEnvelope | ProblemDetails
    """

    return (
        await asyncio_detailed(
            task_id=task_id,
            attempt_id=attempt_id,
            asset_id=asset_id,
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
