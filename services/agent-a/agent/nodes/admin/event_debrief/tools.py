"""LangChain tools for post-event debrief inspection.

These inspect what already happened. They must not call readiness
forecast/score tools.
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from agent.db import fetch_all, fetch_one
from agent.services.event_issue_client import (
    classify_event_issue as classify_event_issue_http,
)
from agent.utils.progress import emit_progress


class EventIdArgs(BaseModel):
    event_id: int = Field(..., description="Gatherly event ID to inspect.")


class ReviewTextArgs(BaseModel):
    text: str = Field(
        ...,
        description=(
            "Team-leader debrief or review text to classify into a "
            "Gatherly ops issue: clothing, transport, staffing, venue, "
            "weather, or all_clear."
        ),
    )


def _dumps(payload: Any) -> str:
    return json.dumps(payload, default=str)


def build_debrief_tools() -> list:
    async def load_event_review(event_id: int) -> str:
        """Load the latest team-leader review for an event from SQL."""
        await emit_progress(
            "event_review",
            "running",
            "Loading team-leader review",
            "event_debrief_agent",
        )
        row = fetch_one(
            """
            SELECT reviewerId, eventId, starRating, content, visibility, createdAt
              FROM REVIEW
             WHERE eventId = %s
             ORDER BY createdAt DESC
             LIMIT 1
            """,
            (event_id,),
        )
        payload = (
            {
                "status": "not_found",
                "event_id": event_id,
                "message": "No team-leader review exists for this event yet.",
            }
            if not row
            else {"status": "success", "review": row}
        )
        await emit_progress(
            "event_review",
            "completed",
            "Loaded team-leader review",
            "event_debrief_agent",
        )
        return _dumps(payload)

    async def classify_event_issue(text: str) -> str:
        """REQUIRED. Fine-tuned DistilBERT classifier. Call this after you have debrief text
            and BEFORE any inspect_* tool. You must not infer the issue from the wording.
            Returns label, confidence, scores, and suggested_followup_tool."""
        await emit_progress(
            "event_issue",
            "running",
            "Classifying event issue",
            "event_debrief_agent",
        )
        result = classify_event_issue_http(text)
        label = result.get("label")
        followup = {
            "clothing": "inspect_event_clothing",
            "transport": "inspect_event_transport",
            "venue": "inspect_event_venue",
            "staffing": "inspect_event_staffing",
            "weather": None,
            "all_clear": None,
        }.get(label)
        result["suggested_followup_tool"] = followup
        await emit_progress(
            "event_issue",
            "completed",
            f"Issue classified as {label or 'unknown'}",
            "event_debrief_agent",
        )
        return _dumps(result)

    async def inspect_event_clothing(event_id: int) -> str:
        """Inspect recorded clothing inventory for a past event."""
        await emit_progress(
            "inspect_clothing",
            "running",
            "Inspecting clothing records",
            "event_debrief_agent",
        )
        row = fetch_one(
            """
            SELECT e.eventId, e.title, cl.clothesId, cl.clothingLabel,
                   cl.description,
                   (
                     SELECT GROUP_CONCAT(CONCAT(size, ':', stockQty) SEPARATOR ', ')
                       FROM clothing_stock cs
                      WHERE cs.clothingId = e.clothesId
                   ) AS stockInfo
              FROM events e
         LEFT JOIN clothing cl ON cl.clothesId = e.clothesId
             WHERE e.eventId = %s
            """,
            (event_id,),
        )
        await emit_progress(
            "inspect_clothing",
            "completed",
            "Loaded clothing records",
            "event_debrief_agent",
        )
        return _dumps({"status": "success" if row else "not_found", "clothing": row})

    async def inspect_event_transport(event_id: int) -> str:
        """Inspect recorded rides and transportation for a past event."""
        await emit_progress(
            "inspect_transport",
            "running",
            "Inspecting transport records",
            "event_debrief_agent",
        )
        rides = fetch_all(
            """
            SELECT ea.eventAppId, ea.senderId, ea.status, ea.needsRide,
                   ea.assignedRole, u.fName, u.lName
              FROM event_app ea
              JOIN users u ON u.userId = ea.senderId
             WHERE ea.eventId = %s AND ea.needsRide = 1
             LIMIT 50
            """,
            (event_id,),
        )
        transport = fetch_all(
            "SELECT * FROM transportation WHERE eventId = %s",
            (event_id,),
        )
        await emit_progress(
            "inspect_transport",
            "completed",
            "Loaded transport records",
            "event_debrief_agent",
        )
        return _dumps(
            {
                "status": "success",
                "hosts_needing_ride": rides,
                "transportation": transport,
            }
        )

    async def inspect_event_staffing(event_id: int) -> str:
        """Inspect accepted hosts recorded for a past event."""
        await emit_progress(
            "inspect_staffing",
            "running",
            "Inspecting staffing records",
            "event_debrief_agent",
        )
        event = fetch_one(
            "SELECT eventId, title, nbOfGuests, nbOfHosts, teamLeaderId FROM events WHERE eventId = %s",
            (event_id,),
        )
        hosts = fetch_all(
            """
            SELECT ea.eventAppId, ea.status, ea.assignedRole, ea.requestedRole,
                   u.fName, u.lName
              FROM event_app ea
              JOIN users u ON u.userId = ea.senderId
             WHERE ea.eventId = %s AND ea.status = 'accepted'
             LIMIT 50
            """,
            (event_id,),
        )
        await emit_progress(
            "inspect_staffing",
            "completed",
            "Loaded staffing records",
            "event_debrief_agent",
        )
        return _dumps(
            {
                "status": "success" if event else "not_found",
                "event": event,
                "accepted_hosts": hosts,
                "accepted_count": len(hosts),
            }
        )

    async def inspect_event_venue(event_id: int) -> str:
        """Inspect recorded venue and guest count for a past event."""
        await emit_progress(
            "inspect_venue",
            "running",
            "Inspecting venue records",
            "event_debrief_agent",
        )
        row = fetch_one(
            """
            SELECT e.eventId, e.title, e.nbOfGuests, e.location,
                   v.venueId, v.name AS venueName, v.capacity, v.city,
                   v.venueType
              FROM events e
         LEFT JOIN venues v ON v.venueId = e.venueId
             WHERE e.eventId = %s
            """,
            (event_id,),
        )
        await emit_progress(
            "inspect_venue",
            "completed",
            "Loaded venue records",
            "event_debrief_agent",
        )
        return _dumps({"status": "success" if row else "not_found", "venue": row})

    return [
        StructuredTool.from_function(
            coroutine=load_event_review,
            name="load_event_review",
            description=(
                "Load the latest team-leader review/debrief for an event ID. "
                "Use when the user asks what went wrong and did not paste the text."
            ),
            args_schema=EventIdArgs,
        ),
        StructuredTool.from_function(
            coroutine=classify_event_issue,
            name="classify_event_issue",
            description=(
                "Fine-tuned DistilBERT classifier for Gatherly post-event "
                "issues. Input: review/debrief text. Output: clothing, "
                "transport, staffing, venue, weather, or all_clear, plus "
                "confidence. Then call the suggested_followup_tool if any. "
                "Never call readiness/forecast tools."
            ),
            args_schema=ReviewTextArgs,
        ),
        StructuredTool.from_function(
            coroutine=inspect_event_clothing,
            name="inspect_event_clothing",
            description="Inspect recorded clothing/stock for a past event.",
            args_schema=EventIdArgs,
        ),
        StructuredTool.from_function(
            coroutine=inspect_event_transport,
            name="inspect_event_transport",
            description="Inspect recorded needsRide hosts and transportation rows.",
            args_schema=EventIdArgs,
        ),
        StructuredTool.from_function(
            coroutine=inspect_event_staffing,
            name="inspect_event_staffing",
            description="Inspect accepted hosts and guest/host counts for a past event.",
            args_schema=EventIdArgs,
        ),
        StructuredTool.from_function(
            coroutine=inspect_event_venue,
            name="inspect_event_venue",
            description="Inspect recorded venue capacity vs guest count.",
            args_schema=EventIdArgs,
        ),
    ]
