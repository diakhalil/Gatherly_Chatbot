from __future__ import annotations

from typing import Any

EXPLORER_SCOPES = frozenset({"full", "suitability", "weather", "routes"})

# Same SQL pull for all scopes today; scope drives workflow hints, not labels.
SCOPE_LABELS = {
    "full": ["event", "current_venue", "candidates", "venue_extras"],
    "suitability": ["event", "current_venue", "candidates", "venue_extras"],
    "weather": ["event", "current_venue", "candidates", "venue_extras"],
    "routes": ["event", "current_venue", "candidates", "venue_extras"],
}

# event
# The client’s event row
# SELECT … FROM events WHERE eventId=? AND clientId=?


# current_venue
# Venue already booked on that event
# events JOIN venues for that event


# candidates
# Venues that can fit guest count
# SELECT * FROM venues WHERE capacity >= nbOfGuests … LIMIT 8


# venue_extras
# Extra venues to pad the list (biggest halls)
# SELECT * FROM venues ORDER BY capacity DESC LIMIT 8


def labels_for_scope(scope: str | None) -> list[str]:
    normalized = (scope or "full").strip().lower()
    if normalized not in EXPLORER_SCOPES:
        normalized = "full"
    return list(SCOPE_LABELS[normalized])


def _normalize_scope(scope: str | None) -> str:
    normalized = (scope or "full").strip().lower()
    if normalized not in EXPLORER_SCOPES:
        return "full"
    return normalized


def _dt(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def _first(rows: list[dict] | None) -> dict | None:
    if not rows:
        return None
    return rows[0]


def _normalize_venue(
    row: dict,
    current_venue_id: int | None,
) -> dict[str, Any]:
    venue_id = row["venueId"]
    lat = float(row["latitude"]) if row.get("latitude") is not None else None
    lng = float(row["longitude"]) if row.get("longitude") is not None else None
    description = row.get("description") or ""
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


def _merge_venue_rows(
    *,
    current_venue_row: dict | None,
    candidate_rows: list[dict],
    extra_rows: list[dict],
    max_venues: int = 8,
) -> list[dict]:
    """Same merge/fill logic as legacy context.py."""
    merged: list[dict] = list(candidate_rows)

    if len(merged) < max_venues:
        seen = {row["venueId"] for row in merged}
        for row in extra_rows:
            venue_id = row.get("venueId")
            if venue_id is None or venue_id in seen:
                continue
            merged.append(row)
            seen.add(venue_id)
            if len(merged) >= max_venues:
                break

    by_id: dict[int, dict] = {}
    if current_venue_row and current_venue_row.get("venueId") is not None:
        by_id[current_venue_row["venueId"]] = current_venue_row
    for row in merged:
        venue_id = row.get("venueId")
        if venue_id is not None:
            by_id[venue_id] = row

    return list(by_id.values())


def build_explorer_context_from_sql(
    *,
    event_id: int,
    user_id: int,
    role: str,
    sql_results: dict[str, list[dict]],
    scope: str = "full",
) -> dict[str, Any]:
    """
    Turn labeled SQL rows (from gatherly_sql_lookup) into the explorer
    context dict that venue_match / weather / route agents expect.
    """
    normalized_scope = _normalize_scope(scope)

    if role != "client":
        return {
            "status": "forbidden",
            "event_id": event_id,
            "user_id": user_id,
            "scope": normalized_scope,
            "message": "Client Event Explorer is available only to clients.",
        }

    event_row = _first(sql_results.get("event"))
    if not event_row:
        return {
            "status": "event_not_found_or_forbidden",
            "event_id": event_id,
            "user_id": user_id,
            "scope": normalized_scope,
            "message": (
                "The event does not exist or does not belong to this client."
            ),
        }

    row_client_id = event_row.get("clientId")
    if row_client_id is not None and int(row_client_id) != int(user_id):
        return {
            "status": "event_not_found_or_forbidden",
            "event_id": event_id,
            "user_id": user_id,
            "scope": normalized_scope,
            "message": (
                "The event does not exist or does not belong to this client."
            ),
        }

    current_venue_id = event_row.get("venueId")
    guest_count = int(event_row.get("nbOfGuests") or 0)
    event_type = event_row.get("type") or ""

    current_venue_row = _first(sql_results.get("current_venue"))
    candidate_rows = list(sql_results.get("candidates") or [])
    extra_rows = list(sql_results.get("venue_extras") or [])

    venue_rows = _merge_venue_rows(
        current_venue_row=current_venue_row,
        candidate_rows=candidate_rows,
        extra_rows=extra_rows,
    )

    normalized_venues = [
        _normalize_venue(row, current_venue_id)
        for row in venue_rows
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
        "scope": normalized_scope,
        "event": event,
        "candidate_venues": normalized_venues,
        "source_count": 1 + len(normalized_venues),
    }

