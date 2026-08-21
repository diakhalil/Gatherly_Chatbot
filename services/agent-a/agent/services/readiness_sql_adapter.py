from __future__ import annotations

READINESS_SCOPES = frozenset({"full", "weather", "staffing", "logistics"})

SCOPE_LABELS = {
    "weather": ["event", "venue"],
    "staffing": ["event", "applications", "hosts"],
    "logistics": ["event", "venue", "applications", "hosts", "transport", "clothing"],
    "full": ["event", "venue", "applications", "hosts", "transport", "clothing"],
}


def labels_for_scope(scope: str | None) -> list[str]:
    normalized = (scope or "full").strip().lower()
    if normalized not in READINESS_SCOPES:
        normalized = "full"
    return list(SCOPE_LABELS[normalized])


def _normalize_scope(scope: str | None) -> str:
    normalized = (scope or "full").strip().lower()
    if normalized not in READINESS_SCOPES:
        return "full"
    return normalized


def _dt(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def _doc(record_id: str, text: str = "", metadata: dict | None = None, **extra):
    doc = {
        "record_id": record_id,
        "text": text or "",
        "metadata": metadata or {},
    }
    doc.update(extra)
    return doc


def _first(rows: list[dict] | None) -> dict | None:
    if not rows:
        return None
    return rows[0]


def build_readiness_context_from_sql(
    *,
    event_id: int,
    role: str,
    sql_results: dict[str, list[dict]],
    scope: str = "full",
) -> dict:
    """
    Turn labeled SQL rows (from gatherly_sql_lookup) into the readiness
    context dict that weather / staffing / logistics agents expect.
    """
    normalized_scope = _normalize_scope(scope)

    if role != "admin":
        return {
            "status": "forbidden",
            "event_id": event_id,
            "scope": normalized_scope,
            "message": (
                "Only administrators can run a complete "
                "event-readiness assessment."
            ),
        }

    event_row = _first(sql_results.get("event"))
    if not event_row:
        return {
            "status": "event_not_found",
            "event_id": event_id,
            "scope": normalized_scope,
            "message": f"Event {event_id} was not found in the database.",
        }

    venue_row = _first(sql_results.get("venue"))
    application_rows = sql_results.get("applications") or []
    host_rows = sql_results.get("hosts") or []
    transport_rows = sql_results.get("transport") or []

    clothing_rows = sql_results.get("clothing") or []
    clothing_row = clothing_rows[0] if clothing_rows else None
    stock_by_size: dict[str, int] = {}
    for row in clothing_rows:
        size = row.get("size")
        qty = row.get("stockQty")
        if size is not None and qty is not None:
            stock_by_size[str(size)] = int(qty)

    lat = event_row.get("locationLat")
    lng = event_row.get("locationLng")
    if (lat is None or lng is None) and venue_row:
        lat = venue_row.get("latitude")
        lng = venue_row.get("longitude")

    transportation_planned = bool(transport_rows) or any(
        bool(row.get("requestTransportation")) or bool(row.get("needsRide"))
        for row in application_rows
    )

    event = _doc(
        record_id=f"event:{event_row['eventId']}",
        text=event_row.get("description") or "",
        metadata={
            "event_type": event_row.get("type"),
            "title": event_row.get("title"),
            "starts_at": _dt(event_row.get("startsAt")),
            "ends_at": _dt(event_row.get("endsAt")),
            "required_hosts": int(event_row.get("nbOfHosts") or 0),
            "guest_count": int(event_row.get("nbOfGuests") or 0),
            "venue_id": event_row.get("venueId"),
            "clothing_id": event_row.get("clothesId"),
            "latitude": float(lat) if lat is not None else None,
            "longitude": float(lng) if lng is not None else None,
            "required_languages": [],
            "required_skills": [],
            "accessibility_required": False,
            "transportation_planned": transportation_planned,
        },
    )

    venue = None
    if venue_row:
        venue = _doc(
            record_id=f"venue:{venue_row['venueId']}",
            text=venue_row.get("description") or "",
            metadata={
                "name": venue_row.get("name"),
                "city": venue_row.get("city"),
                "capacity": int(venue_row.get("capacity") or 0),
                "indoor_outdoor": venue_row.get("indoorOutdoor"),
                "wheelchair_accessible": bool(
                    venue_row.get("wheelchairAccessible")
                ),
                "parking_available": bool(
                    venue_row.get("parkingAvailable")
                ),
                "latitude": float(venue_row["latitude"])
                if venue_row.get("latitude") is not None
                else None,
                "longitude": float(venue_row["longitude"])
                if venue_row.get("longitude") is not None
                else None,
            },
        )

    applications = [
        _doc(
            record_id=f"event_app:{row['eventAppId']}",
            text="",
            metadata={
                "host_id": row.get("senderId"),
                "host_name": f"{row.get('fName', '')} {row.get('lName', '')}".strip(),
                "status": row.get("status"),
                "assigned_role": row.get("assignedRole")
                or row.get("requestedRole"),
                "needs_ride": bool(row.get("needsRide")),
                "request_dress": bool(row.get("requestDress")),
            },
        )
        for row in application_rows
        if row.get("eventAppId") is not None
    ]

    hosts = [
        _doc(
            record_id=f"host:{row['userId']}",
            text=row.get("description") or "",
            metadata={
                "entity_id": row["userId"],
                "host_id": row["userId"],
                "name": f"{row.get('fName', '')} {row.get('lName', '')}".strip(),
                "clothing_size": row.get("clothingSize"),
                "eligibility": row.get("eligibility"),
                "active": bool(row.get("isActive")),
                "languages": [],
                "skills": [],
            },
        )
        for row in host_rows
        if row.get("userId") is not None
    ]

    transportation = [
        _doc(
            record_id=f"transportation:{row.get('transportationId')}",
            text=(
                f"Pickup {row.get('pickupLocation')} at "
                f"{_dt(row.get('departureTime'))}"
            ),
            metadata={
                "pickup_location": row.get("pickupLocation"),
                "departure_time": _dt(row.get("departureTime")),
                "return_time": _dt(row.get("returnTime")),
                "passenger_count": 4,
            },
        )
        for row in transport_rows
        if row.get("transportationId") is not None
    ]

    clothing = None
    if clothing_row and clothing_row.get("clothesId"):
        clothing = _doc(
            record_id=f"clothing:{clothing_row['clothesId']}",
            text=clothing_row.get("description")
            or clothing_row.get("clothingLabel")
            or "",
            metadata={
                "label": clothing_row.get("clothingLabel"),
                "stock_by_size": stock_by_size,
                "suitable_event_types": [],
            },
            image_url=clothing_row.get("picture"),
        )

    return {
        "status": "success",
        "event_id": event_id,
        "scope": normalized_scope,
        "event": event,
        "venue": venue,
        "applications": applications,
        "hosts": hosts,
        "transportation": transportation,
        "clothing": clothing,
        "source_count": (
            1
            + (1 if venue else 0)
            + len(applications)
            + len(hosts)
            + len(transportation)
            + (1 if clothing else 0)
        ),
    }

