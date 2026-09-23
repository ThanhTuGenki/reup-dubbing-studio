from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.enrollment_envelope import EnrollmentEnvelope
from ...models.problem_details import ProblemDetails
from ...models.session_identity import SessionIdentity
from ...types import UNSET, Response


def _get_kwargs(
    *,
    body: SessionIdentity,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/enroll",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> EnrollmentEnvelope | ProblemDetails:
    if response.status_code == 201:
        response_201 = EnrollmentEnvelope.from_dict(response.json())

        return response_201

    response_default = ProblemDetails.from_dict(response.json())

    return response_default


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[EnrollmentEnvelope | ProblemDetails]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: SessionIdentity,
) -> Response[EnrollmentEnvelope | ProblemDetails]:
    """Exchange an enrollment token for a scoped credential and first session

    Args:
        body (SessionIdentity):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EnrollmentEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: SessionIdentity,
) -> EnrollmentEnvelope | ProblemDetails | None:
    """Exchange an enrollment token for a scoped credential and first session

    Args:
        body (SessionIdentity):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EnrollmentEnvelope | ProblemDetails
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: SessionIdentity,
) -> Response[EnrollmentEnvelope | ProblemDetails]:
    """Exchange an enrollment token for a scoped credential and first session

    Args:
        body (SessionIdentity):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EnrollmentEnvelope | ProblemDetails]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: SessionIdentity,
) -> EnrollmentEnvelope | ProblemDetails | None:
    """Exchange an enrollment token for a scoped credential and first session

    Args:
        body (SessionIdentity):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EnrollmentEnvelope | ProblemDetails
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
