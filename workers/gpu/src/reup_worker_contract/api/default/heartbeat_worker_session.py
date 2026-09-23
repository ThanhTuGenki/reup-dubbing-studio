from http import HTTPStatus
from typing import Any, cast
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.heartbeat import Heartbeat
from ...models.heartbeat_envelope import HeartbeatEnvelope
from ...models.problem_details import ProblemDetails
from ...types import UNSET, Response


def _get_kwargs(
    session_id: UUID,
    *,
    body: Heartbeat,
    idempotency_key: str,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/sessions/{session_id}/heartbeat".format(
            session_id=session_id,
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> HeartbeatEnvelope | ProblemDetails:
    if response.status_code == 200:
        response_200 = HeartbeatEnvelope.from_dict(response.json())

        return response_200

    response_default = ProblemDetails.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[HeartbeatEnvelope | ProblemDetails]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: Heartbeat,
    idempotency_key: str,
) -> Response[HeartbeatEnvelope | ProblemDetails]:
    """Update capacity and receive drain or cancellation signals

    Args:
        session_id (UUID):
        idempotency_key (str):
        body (Heartbeat):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[HeartbeatEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: Heartbeat,
    idempotency_key: str,
) -> HeartbeatEnvelope | ProblemDetails | None:
    """Update capacity and receive drain or cancellation signals

    Args:
        session_id (UUID):
        idempotency_key (str):
        body (Heartbeat):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        HeartbeatEnvelope | ProblemDetails
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    session_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: Heartbeat,
    idempotency_key: str,
) -> Response[HeartbeatEnvelope | ProblemDetails]:
    """Update capacity and receive drain or cancellation signals

    Args:
        session_id (UUID):
        idempotency_key (str):
        body (Heartbeat):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[HeartbeatEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: Heartbeat,
    idempotency_key: str,
) -> HeartbeatEnvelope | ProblemDetails | None:
    """Update capacity and receive drain or cancellation signals

    Args:
        session_id (UUID):
        idempotency_key (str):
        body (Heartbeat):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        HeartbeatEnvelope | ProblemDetails
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
