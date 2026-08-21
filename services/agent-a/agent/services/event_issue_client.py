from __future__ import annotations

import os

import httpx

CLASSIFIER_URL = os.getenv("CLASSIFIER_URL", "http://127.0.0.1:8006")


def classify_event_issue(text: str) -> dict:
    """Call the fine-tuned DistilBERT event-issue classifier."""
    cleaned = (text or "").strip()
    if not cleaned:
        return {
            "status": "invalid_request",
            "message": "Review/debrief text is required.",
        }

    try:
        response = httpx.post(
            f"{CLASSIFIER_URL.rstrip('/')}/classify",
            json={"text": cleaned},
            timeout=30.0,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        return {
            "status": "classifier_unavailable",
            "message": (
                "Could not reach the event-issue classifier at "
                f"{CLASSIFIER_URL}. Start it with: "
                "python -m uvicorn app:app --host 127.0.0.1 --port 8006"
            ),
            "error": str(exc),
        }

    return {
        "status": "success",
        "label": payload.get("label"),
        "confidence": payload.get("confidence"),
        "scores": payload.get("scores") or {},
        "text": cleaned,
    }
