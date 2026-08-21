from __future__ import annotations

import re
from datetime import datetime, timedelta

# Operational default (not a policy document)
DEFAULT_ARRIVAL_MINUTES = 30


def build_host_timeline(context: dict) -> dict:
    if context.get("status") != "success":
        return {
            "status": context.get("status", "error"),
            "message": context.get("message"),
        }

    event = context["event"]
    event_meta = event.get("metadata", {})

    starts_at_text = event_meta.get("starts_at")
    ends_at_text = event_meta.get("ends_at")

    if not starts_at_text or not ends_at_text:
        return {
            "status": "missing_schedule",
            "event_id": context["event_id"],
            "message": "The event schedule is incomplete.",
        }

    default_arrival_minutes = DEFAULT_ARRIVAL_MINUTES

    venue = context.get("venue") or {}
    venue_text = venue.get("text", "")

    venue_match = re.search(
        r"(\d+)\s+minutes?\s+before\s+guest\s+arrival",
        venue_text,
        flags=re.IGNORECASE,
    )

    venue_instruction_minutes = (
        int(venue_match.group(1))
        if venue_match
        else None
    )

    arrival_minutes = max(
        default_arrival_minutes,
        venue_instruction_minutes or 0,
    )

    starts_at = datetime.fromisoformat(starts_at_text)
    ends_at = datetime.fromisoformat(ends_at_text)
    required_arrival = starts_at - timedelta(
        minutes=arrival_minutes
    )

    timeline = [
        {
            "type": "required_arrival",
            "label": "Host check-in",
            "time": required_arrival.isoformat(
                sep=" ",
                timespec="minutes",
            ),
            "description": (
                "Check in, attend the briefing, complete venue "
                "orientation, and verify clothing."
            ),
        },
        {
            "type": "event_start",
            "label": "Event starts",
            "time": starts_at.isoformat(
                sep=" ",
                timespec="minutes",
            ),
            "description": "Be at the assigned station.",
        },
        {
            "type": "event_end",
            "label": "Event ends",
            "time": ends_at.isoformat(
                sep=" ",
                timespec="minutes",
            ),
            "description": (
                "Remain until checkout unless released by "
                "the team leader."
            ),
        },
    ]

    return {
        "status": "success",
        "event_id": context["event_id"],
        "arrival_minutes_before_start": arrival_minutes,
        "arrival_requirements": {
            "general_policy_minutes": default_arrival_minutes,
            "venue_instruction_minutes": venue_instruction_minutes,
            "selected_minutes": arrival_minutes,
            "decision": (
                "The required arrival uses the maximum of the default "
                "arrival window and any venue-specific instruction, "
                "so the stricter earlier arrival time is selected."
            ),
        },
        "required_arrival": required_arrival.isoformat(
            sep=" ",
            timespec="minutes",
        ),
        "starts_at": starts_at.isoformat(
            sep=" ",
            timespec="minutes",
        ),
        "ends_at": ends_at.isoformat(
            sep=" ",
            timespec="minutes",
        ),
        "timeline": timeline,
        "policy_sources": [],
    }
