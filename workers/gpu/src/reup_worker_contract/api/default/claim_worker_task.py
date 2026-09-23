from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.claim_task_envelope import ClaimTaskEnvelope
from ...models.claim_task_request import ClaimTaskRequest
from ...models.problem_details import ProblemDetails
from ...types import UNSET, Response


def _get_kwargs(
    *,
    body: ClaimTaskRequest,
    idempotency_key: str,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/tasks/claim",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ClaimTaskEnvelope | ProblemDetails:
    if response.status_code == 200:
        response_200 = ClaimTaskEnvelope.from_dict(response.json())

        return response_200

    response_default = ProblemDetails.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ClaimTaskEnvelope | ProblemDetails]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ClaimTaskRequest,
    idempotency_key: str,
) -> Response[ClaimTaskEnvelope | ProblemDetails]:
    """Atomically claim the next eligible GPU task

    Args:
        idempotency_key (str):
        body (ClaimTaskRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ClaimTaskEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: ClaimTaskRequest,
    idempotency_key: str,
) -> ClaimTaskEnvelope | ProblemDetails | None:
    """Atomically claim the next eligible GPU task

    Args:
        idempotency_key (str):
        body (ClaimTaskRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ClaimTaskEnvelope | ProblemDetails
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ClaimTaskRequest,
    idempotency_key: str,
) -> Response[ClaimTaskEnvelope | ProblemDetails]:
    """Atomically claim the next eligible GPU task

    Args:
        idempotency_key (str):
        body (ClaimTaskRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ClaimTaskEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: ClaimTaskRequest,
    idempotency_key: str,
) -> ClaimTaskEnvelope | ProblemDetails | None:
    """Atomically claim the next eligible GPU task

    Args:
        idempotency_key (str):
        body (ClaimTaskRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ClaimTaskEnvelope | ProblemDetails
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
