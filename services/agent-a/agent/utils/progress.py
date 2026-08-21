"""Progress reporting for streaming chat (tools emit steps)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextvars import ContextVar

ProgressCallback = Callable[[dict], Awaitable[None]]

_progress_reporter: ContextVar[ProgressCallback | None] = ContextVar(
    "progress_reporter",
    default=None,
)


def set_progress_reporter(callback: ProgressCallback | None):
    return _progress_reporter.set(callback)


def reset_progress_reporter(token) -> None:
    _progress_reporter.reset(token)


async def emit_progress(
    step: str,
    status: str,
    message: str,
    agent: str,
) -> None:
    callback = _progress_reporter.get()
    if callback is None:
        return
    await callback({
        "step": step,
        "status": status,
        "message": message,
        "agent": agent,
    })
