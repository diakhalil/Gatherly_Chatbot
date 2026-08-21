"""HTTP client for Gatherly Agent System B."""

from __future__ import annotations

import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

import httpx


DEFAULT_TIMEOUT = 600.0

ProgressCallback = Callable[[dict], Awaitable[None]]


def agent_b_base_url() -> str:
    return (
        os.getenv("AGENT_B_URL")
        or "http://127.0.0.1:8002"
    ).rstrip("/")


async def generate_invitation(
    payload: dict[str, Any],
    *,
    on_progress: ProgressCallback | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    url = f"{agent_b_base_url()}/v1/invitations/generate/stream"
    final_result: dict[str, Any] | None = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST",
            url,
            json=payload,
        ) as response:
            if response.status_code >= 400:
                body = await response.aread()

                try:
                    error_data = json.loads(body)
                    detail = error_data.get("detail", "Agent B request failed")
                except (json.JSONDecodeError, AttributeError):
                    detail = "Agent B request failed"

                raise RuntimeError(
                    f"Agent B HTTP {response.status_code}: {detail}"
                )

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue

                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")
                event_data = event.get("data") or {}

                if event_type == "progress" and on_progress:
                    await on_progress(event_data)

                elif event_type == "result":
                    final_result = event_data

                elif event_type == "error":
                    raise RuntimeError(
                        event_data.get(
                            "message",
                            "Agent B generation failed",
                        )
                    )

    if final_result is None:
        raise RuntimeError(
            "Agent B stream ended without a final result"
        )

    return final_result