from __future__ import annotations

import asyncio
from typing import Any

from agent.services.mcp_tools import GatherlyMCPClient


async def compare_venue_routes(
    ranked_venues: list[dict[str, Any]],
    *,
    origin_latitude: float,
    origin_longitude: float,
    limit: int = 5,
) -> dict[str, Any]:
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
            }

        route = await mcp.calculate_route(
            origin_latitude=origin_latitude,
            origin_longitude=origin_longitude,
            destination_latitude=float(latitude),
            destination_longitude=float(longitude),
            travel_mode="driving",
        )

        distance_km = route.get("distance_km")
        travel_minutes = route.get("duration_minutes")

        if distance_km is None:
            route_score = 0
        elif distance_km <= 5:
            route_score = 100
        elif distance_km <= 15:
            route_score = 80
        elif distance_km <= 30:
            route_score = 60
        elif distance_km <= 50:
            route_score = 40
        else:
            route_score = 20

        google_maps_url = (
            "https://www.google.com/maps/dir/?api=1"
            f"&origin={origin_latitude},{origin_longitude}"
            f"&destination={latitude},{longitude}"
            "&travelmode=driving"
        )

        return {
            "record_id": venue.get("record_id"),
            "name": venue.get("name"),
            "status": route.get("status", "unknown"),
            "provider": route.get("provider", "OSRM"),
            "distance_km": distance_km,
            "travel_minutes": travel_minutes,
            "route_score": route_score,
            "google_maps_directions_url": google_maps_url,
            "location_label": "Demo destination",
            "location_verified": False,
        }

    routes = await asyncio.gather(
        *(inspect(venue) for venue in candidates)
    )

    return {
        "status": "success",
        "origin_storage": "temporary_not_saved",
        "venue_routes": routes,
    }

