from __future__ import annotations

import asyncio
from typing import Any

from agent.nodes.shared.weather import (
    analyze_venue_weather,
)
from agent.services.mcp_tools import GatherlyMCPClient


async def compare_venue_weather(
    event: dict[str, Any],
    ranked_venues: list[dict[str, Any]],
    limit: int = 5,
) -> dict[str, Any]:
    event_metadata = event.get("metadata", {})
    event_id = event_metadata.get("entity_id")
    starts_at = event_metadata.get("starts_at")

    if not starts_at:
        return {
            "status": "missing_event_date",
            "venue_weather": [],
        }

    mcp = GatherlyMCPClient()
    candidates = ranked_venues[:limit]

    async def inspect(venue: dict[str, Any]) -> dict[str, Any]:
        latitude = venue.get("latitude")
        longitude = venue.get("longitude")

        if latitude is None or longitude is None:
            return {
                "record_id": venue.get("record_id"),
                "name": venue.get("name"),
                "status": "missing_coordinates",
                "weather_score": 0,
                "risks": ["Venue coordinates are unavailable."],
            }

        report = await analyze_venue_weather(
            mcp=mcp,
            event_id=event_id,
            starts_at=starts_at,
            latitude=float(latitude),
            longitude=float(longitude),
            venue_setting=venue.get("indoor_outdoor"),
            sources=[],
        )

        report.update({
            "record_id": venue.get("record_id"),
            "name": venue.get("name"),
            "location_label": "Demo location",
            "location_verified": False,
            "google_maps_url": (
                "https://www.google.com/maps/search/"
                f"?api=1&query={latitude},{longitude}"
            ),
        })

        return report

    reports = await asyncio.gather(
        *(inspect(venue) for venue in candidates)
    )

    return {
        "status": "success",
        "venue_weather": reports,
    }
