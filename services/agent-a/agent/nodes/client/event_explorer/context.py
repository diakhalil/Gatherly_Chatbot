from __future__ import annotations

from typing import Any

from agent.db import fetch_all, fetch_one


def _dt(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def _normalize_venue(row: dict, current_venue_id: int | None) -> dict[str, Any]:
    venue_id = row["venueId"]
    lat = float(row["latitude"]) if row.get("latitude") is not None else None
    lng = float(row["longitude"]) if row.get("longitude") is not None else None
    description = row.get("description") or ""
    # venue_match scores event_type against description text
    type_hint = row.get("venueType") or ""
    if type_hint and type_hint.lower() not in description.lower():
        description = f"{description} {type_hint}".strip()

    return {
        "record_id": f"venue:{venue_id}",
        "name": row.get("name") or f"Venue {venue_id}",
        "description": description,
        "image_url": row.get("mainImage"),
        "capacity": int(row.get("capacity") or 0),
        "is_current_venue": current_venue_id == venue_id,
        "indoor_outdoor": row.get("indoorOutdoor"),
        "parking_available": bool(row.get("parkingAvailable")),
        "wheelchair_accessible": bool(row.get("wheelchairAccessible")),
        "city": row.get("city"),
        "district": row.get("district"),
        "latitude": lat,
        "longitude": lng,
        "location": {
            "mode": "database_coordinates",
            "verified": True,
            "label": row.get("address") or row.get("name"),
            "latitude": lat,
            "longitude": lng,
        },
        "retrieval_score": None,
    }


async def build_client_event_context(
    *,
    event_id: int,
    user_id: int,
) -> dict[str, Any]:
    """
    Load the client's event + candidate venues from SQL.
    Ownership: events.clientId must equal user_id.
    """

    event_row = fetch_one(
        """
        SELECT eventId, title, type, description, location,
               startsAt, endsAt, nbOfGuests, nbOfHosts, status,
               venueId, clientId, locationLat, locationLng
          FROM events
         WHERE eventId = %s
           AND clientId = %s
        """,
        (event_id, user_id),
    )

    if not event_row:
        return {
            "status": "event_not_found_or_forbidden",
            "event_id": event_id,
            "user_id": user_id,
            "message": (
                "The event does not exist or does not belong to this client."
            ),
        }

    current_venue_id = event_row.get("venueId")
    guest_count = int(event_row.get("nbOfGuests") or 0)
    event_type = event_row.get("type") or ""

    current_venue_row = None
    if current_venue_id:
        current_venue_row = fetch_one(
            "SELECT * FROM venues WHERE venueId = %s",
            (current_venue_id,),
        )

    # Candidate venues: enough capacity first, then a few extras
    candidate_rows = fetch_all(
        """
        SELECT *
          FROM venues
         WHERE capacity >= %s
         ORDER BY capacity ASC
         LIMIT 8
        """,
        (guest_count,),
    )

    if len(candidate_rows) < 8:
        extra = fetch_all(
            """
            SELECT *
              FROM venues
             ORDER BY capacity DESC
             LIMIT 8
            """,
        )
        seen = {row["venueId"] for row in candidate_rows}
        for row in extra:
            if row["venueId"] not in seen:
                candidate_rows.append(row)
                seen.add(row["venueId"])
            if len(candidate_rows) >= 8:
                break

    by_id: dict[int, dict] = {}
    if current_venue_row:
        by_id[current_venue_row["venueId"]] = current_venue_row
    for row in candidate_rows:
        by_id[row["venueId"]] = row

    normalized_venues = [
        _normalize_venue(row, current_venue_id)
        for row in by_id.values()
    ]

    lat = event_row.get("locationLat")
    lng = event_row.get("locationLng")
    if (lat is None or lng is None) and current_venue_row:
        lat = current_venue_row.get("latitude")
        lng = current_venue_row.get("longitude")

    event = {
        "record_id": f"event:{event_row['eventId']}",
        "text": event_row.get("description") or "",
        "metadata": {
            "entity_id": event_row["eventId"],
            "event_type": event_type,
            "guest_count": guest_count,
            "accessibility_required": False,
            "venue_id": current_venue_id,
            "starts_at": _dt(event_row.get("startsAt")),
            "ends_at": _dt(event_row.get("endsAt")),
            "title": event_row.get("title"),
            "latitude": float(lat) if lat is not None else None,
            "longitude": float(lng) if lng is not None else None,
        },
    }

    return {
        "status": "success",
        "event_id": event_id,
        "user_id": user_id,
        "event": event,
        "candidate_venues": normalized_venues,
        "source_count": 1 + len(normalized_venues),
    }
    