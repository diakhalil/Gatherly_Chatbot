"""HTTP client for Gatherly RAG (never import gatherly_rag Python)."""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_TIMEOUT = 180.0


def rag_base_url() -> str:
    return (os.getenv("RAG_API_URL") or "http://127.0.0.1:8003").rstrip("/")


async def ask_rag(question: str, *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Call structured RAG ask endpoint (answer + cards)."""
    url = f"{rag_base_url()}/v1/ask"
    payload = {"question": question}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload)
        try:
            data = response.json()
        except ValueError:
            data = {"detail": response.text}
        if response.status_code >= 400:
            detail = data.get("detail") if isinstance(data, dict) else data
            raise RuntimeError(f"RAG HTTP {response.status_code}: {detail}")
        if not isinstance(data, dict):
            raise RuntimeError(f"RAG returned unexpected payload: {data!r}")
        return data

async def ask_rag_by_image(
    image_bytes: bytes,
    filename: str = "upload.jpg",
    question: str = "",
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Call RAG image pipeline (VLM → embeddings → answer)."""
    url = f"{rag_base_url()}/v1/ask_by_image"
    files = {"file": (filename, image_bytes, "application/octet-stream")}
    data = {"question": question or ""}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, files=files, data=data)
        try:
            payload = response.json()
        except ValueError:
            payload = {"detail": response.text}
        if response.status_code >= 400:
            detail = payload.get("detail") if isinstance(payload, dict) else payload
            raise RuntimeError(f"RAG HTTP {response.status_code}: {detail}")
        if not isinstance(payload, dict):
            raise RuntimeError(f"RAG returned unexpected payload: {payload!r}")
        return payload


def extract_answer(data: dict[str, Any]) -> str:
    content = str(data.get("answer") or "").strip()
    return content or "The RAG service returned an empty answer."


async def ask_rag_ops(
    question: str,
    topics: list[str],
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Call ops-scoped RAG (organizer / checklist / sustainable / Arabic)."""
    url = f"{rag_base_url()}/v1/ask_ops"
    payload = {
        "question": question,
        "topics": topics,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload)
        try:
            data = response.json()
        except ValueError:
            data = {"detail": response.text}
        if response.status_code >= 400:
            detail = data.get("detail") if isinstance(data, dict) else data
            raise RuntimeError(f"RAG HTTP {response.status_code}: {detail}")
        if not isinstance(data, dict):
            raise RuntimeError(f"RAG returned unexpected payload: {data!r}")
        return data
