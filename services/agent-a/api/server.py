from __future__ import annotations

import asyncio
import json
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel

from agent.agent import run_agent
from agent.graph.agent_graph import graph
from agent.utils.progress import (
    reset_progress_reporter,
    set_progress_reporter,
)

import base64
from pathlib import Path
from fastapi.responses import FileResponse

import sys
import logging

REPO_ROOT = Path(__file__).resolve().parents[3]
SHARED = REPO_ROOT / "logs" / "shared"
if str(SHARED) not in sys.path:
    sys.path.insert(0, str(SHARED))

from logging_setup import setup_logging

logger = setup_logging("gatherly.agent-a", also_console=True)




def _decode_chat_image(request: ChatRequest) -> tuple[bytes | None, str | None]:
    raw = (request.image_base64 or "").strip()
    if not raw:
        return None, None
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw), (request.image_filename or "upload.jpg")
    except Exception:
        return None, None

pending_requests: dict[str, dict] = {}

app = FastAPI(title="Gatherly Agent API")

EXPORT_DIR = Path(__file__).resolve().parents[1] / "exports"

@app.on_event("startup")
def startup() -> None:
    logger.info("Agent A API starting on port 8001")

@app.get("/exports/{filename}")
async def download_export(filename: str):
    safe = Path(filename).name
    filepath = EXPORT_DIR / safe
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        str(filepath),
        filename=safe,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

class ResumeRequest(BaseModel):
    request_id: str
    approved: bool


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    role: Literal["admin", "host", "client"]
    user_id: int
    conversation_id: str
    history: list[HistoryMessage] = []
    summary: str = ""
    event_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    image_base64: str | None = None
    image_filename: str | None = None



class HostBriefingRequest(BaseModel):
    event_id: int
    role: Literal["admin", "host", "client"]
    user_id: int
    conversation_id: str
    latitude: float
    longitude: float
    history: list[HistoryMessage] = []
    summary: str = ""


class ClientEventExplorerRequest(BaseModel):
    event_id: int
    user_id: int
    role: str
    origin_latitude: float
    origin_longitude: float
    conversation_id: str = ""
    history: list[HistoryMessage] = []
    summary: str = ""


class EventReadinessRequest(BaseModel):
    event_id: int
    user_id: int
    role: str
    conversation_id: str
    history: list[HistoryMessage] = []
    summary: str = ""


def _log_chat_request(request: ChatRequest, endpoint: str) -> None:
    logger.info(
        "Chat %s | role=%s user_id=%s event_id=%s conv=%s | message=%r",
        endpoint,
        request.role,
        request.user_id,
        request.event_id,
        request.conversation_id,
        (request.message or "")[:120],
    )

def _log_chat_result(final_state: dict[str, Any], endpoint: str) -> None:
    artifacts = final_state.get("artifacts") or {}
    logger.info(
        "Chat %s complete | handled_by=%s next=%s input_safe=%s | artifacts=%s",
        endpoint,
        final_state.get("selected_agent", ""),
        final_state.get("next_agent", ""),
        final_state.get("input_safe"),
        list(artifacts.keys()),
    )



def _history_payload(history: list[HistoryMessage]) -> list[dict]:
    return [item.model_dump() for item in history]


def _completed_payload(
    final_state: dict[str, Any],
    conversation_id: str,
) -> dict[str, Any]:
    artifacts = final_state.get("artifacts") or {}
    payload: dict[str, Any] = {
        "status": "completed",
        "response": final_state.get("response", ""),
        "handled_by": final_state.get("selected_agent", ""),
        "conversation_id": conversation_id,
        "artifacts": artifacts,
    }

    if artifacts.get("briefing"):
        payload["briefing"] = artifacts["briefing"]
    if artifacts.get("readiness"):
        payload["readiness"] = artifacts["readiness"]
    if artifacts.get("explorer"):
        payload.update(artifacts["explorer"])

    return payload


def progress_stream(runner):
    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def report_progress(event: dict) -> None:
            await queue.put({"type": "progress", "data": event})

        async def run_workflow() -> None:
            try:
                result = await runner(report_progress)
                await queue.put({"type": "result", "data": result})
            except Exception as error:
                await queue.put({
                    "type": "error",
                    "data": {"message": str(error)},
                })
            finally:
                await queue.put({"type": "done"})

        task = asyncio.create_task(run_workflow())

        while True:
            event = await queue.get()
            if event["type"] == "done":
                break
            yield f"data: {json.dumps(event, default=str)}\n\n"

        await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


async def _run_chat_with_progress(
    request: ChatRequest,
    report_progress,
) -> dict[str, Any]:
    _log_chat_request(request, "/chat/stream")
    token = set_progress_reporter(report_progress)
    try:
        await report_progress({
            "step": "supervisor",
            "status": "running",
            "message": "Routing your request through the supervisor",
            "agent": "supervisor",
        })
        image_bytes, image_filename = _decode_chat_image(request)
        final_state, config = await run_agent(
            request.message,
            request.role,
            request.user_id,
            request.conversation_id,
            _history_payload(request.history),
            summary=request.summary,
            preferred_event_id=request.event_id,
            origin_latitude=request.latitude,
            origin_longitude=request.longitude,
            image_bytes=image_bytes,
            image_filename=image_filename,
        )

        if "__interrupt__" in final_state:
            request_id = str(uuid4())
            pending_requests[request_id] = {"config": config}
            interrupt_data = final_state["__interrupt__"][0]
            return {
                "status": "approval_required",
                "request_id": request_id,
                "message": interrupt_data.value,
                "conversation_id": request.conversation_id,
            }

        await report_progress({
            "step": "complete",
            "status": "completed",
            "message": "Specialists finished",
            "agent": final_state.get("selected_agent") or "supervisor",
        })
        _log_chat_result(final_state, "/chat/stream")
        return _completed_payload(
            final_state,
            request.conversation_id,
        )
    
    finally:
        reset_progress_reporter(token)
    


@app.post("/chat")
async def chat(request: ChatRequest):
    _log_chat_request(request, "/chat")
    image_bytes, image_filename = _decode_chat_image(request)
    final_state, config = await run_agent(
        request.message,
        request.role,
        request.user_id,
        request.conversation_id,
        _history_payload(request.history),
        summary=request.summary,
        preferred_event_id=request.event_id,
        origin_latitude=request.latitude,
        origin_longitude=request.longitude,
        image_bytes=image_bytes,
        image_filename=image_filename,
    )

    if "__interrupt__" in final_state:
        request_id = str(uuid4())
        pending_requests[request_id] = {"config": config}
        interrupt_data = final_state["__interrupt__"][0]
        return {
            "status": "approval_required",
            "request_id": request_id,
            "message": interrupt_data.value,
            "conversation_id": request.conversation_id,
        }

    _log_chat_result(final_state, "/chat")
    return _completed_payload(final_state, request.conversation_id)


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    async def runner(report_progress):
        return await _run_chat_with_progress(request, report_progress)

    return progress_stream(runner)


@app.post("/resume")
async def resume(request: ResumeRequest):
    pending_request = pending_requests.get(request.request_id)
    if pending_request is None:
        return {
            "status": "error",
            "message": "Unknown request ID.",
        }

    config = pending_request["config"]
    final_state = await graph.ainvoke(
        Command(resume=request.approved),
        config=config,
    )
    pending_requests.pop(request.request_id, None)

    return {
        "status": "completed",
        "response": final_state["response"],
        "handled_by": final_state["selected_agent"],
        "artifacts": final_state.get("artifacts") or {},
    }