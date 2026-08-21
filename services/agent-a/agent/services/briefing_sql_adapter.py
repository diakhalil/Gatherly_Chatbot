from __future__ import annotations

def _dt(value) -> str | None:
    if value is None:
        return None
    # turns a datetime from mysql into a string
    # check if it is a datetime object
    if hasattr(value, "isoformat"):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)

def _doc(record_id: str, text: str = "", metadata: dict | None = None, **extra):
    # builds one standard record object that all briefing sub-agents understand. 
    # SQL returns flat rows; 
    # sub-agents expect this wrapped shape
    doc = {
        "record_id": record_id,
        "text": text or "",
        "metadata": metadata or {},
    }
    # merge extras
    # Anything in **extra is added at the top level of doc
    doc.update(extra)
    return doc

# checking for empty rows
# used when the expected output is 1 row only
def _first(rows: list[dict] | None) -> dict | None:
    if not rows:
        return None
    return rows[0]

# It takes labeled SQL rows the LLM fetched
# and builds the context dict that timeline, assignment, clothing, team, weather, and route sub-agents expect.
def build_briefing_context_from_sql(
    *,
    event_id: int,
    user_id: int,
    role: str,
    sql_results: dict[str, list[dict]],
    # {"assignment": [...], "event": [...], "team": [...]}
) -> dict:
    """
    Turn labeled SQL rows (from run_labeled_sql) into the context dict
    that assignment/timeline/clothing/team/weather/route sub-agents expect.
    """
    if role != "host":
        return {
            "status": "forbidden",
            "event_id": event_id,
            "message": "Host Event Briefing is available only to hosts.",
        }

    # Optional: host, venue, clothing, transport, team: only if the LLM ran those queries

    assignment_row = _first(sql_results.get("assignment"))
    if not assignment_row:
        return {
            "status": "not_assigned",
            "event_id": event_id,
            "message": (
                f"Host {user_id} does not have an accepted "
                f"assignment for event {event_id}."
            ),
        }

    event_row = _first(sql_results.get("event"))
    if not event_row:
        return {
            "status": "event_not_authorized",
            "event_id": event_id,
            "message": "The assigned event could not be retrieved.",
        }

    host_row = _first(sql_results.get("host"))

    venue_row = _first(sql_results.get("venue"))

    # Clothing: rows may be one clothing row or JOIN with stock (multiple rows)
    clothing_rows = sql_results.get("clothing") or []
    clothing_row = clothing_rows[0] if clothing_rows else None
    stock_by_size: dict[str, int] = {}
    for row in clothing_rows:
        size = row.get("size")
        qty = row.get("stockQty")
        if size is not None and qty is not None:
            stock_by_size[str(size)] = int(qty)

    transport_rows = sql_results.get("transport") or []
    team_rows = sql_results.get("team") or []

    lat = event_row.get("locationLat")
    lng = event_row.get("locationLng")
    if (lat is None or lng is None) and venue_row:
        lat = venue_row.get("latitude")
        lng = venue_row.get("longitude")

    assignment = _doc(
        record_id=f"event_app:{assignment_row['eventAppId']}",
        text="",
        metadata={
            "status": assignment_row.get("status"),
            "assigned_role": assignment_row.get("assignedRole")
            or assignment_row.get("requestedRole"),
            "requested_role": assignment_row.get("requestedRole"),
            "needs_ride": bool(assignment_row.get("needsRide")),
            "request_dress": bool(assignment_row.get("requestDress")),
            "request_transportation": bool(
                assignment_row.get("requestTransportation")
            ),
        },
    )

    event = _doc(
        record_id=f"event:{event_row['eventId']}",
        text=event_row.get("description") or "",
        metadata={
            "event_type": event_row.get("type"),
            "title": event_row.get("title"),
            "starts_at": _dt(event_row.get("startsAt")),
            "ends_at": _dt(event_row.get("endsAt")),
            "location": event_row.get("location"),
            "venue_id": event_row.get("venueId"),
            "clothing_id": event_row.get("clothesId"),
            "latitude": float(lat) if lat is not None else None,
            "longitude": float(lng) if lng is not None else None,
            "required_languages": [],
            "required_skills": [],
        },
    )

    host = None
    if host_row:
        host = _doc(
            record_id=f"host:{host_row['userId']}",
            text=host_row.get("description") or "",
            metadata={
                "clothing_size": host_row.get("clothingSize"),
                "eligibility": host_row.get("eligibility"),
                "name": f"{host_row['fName']} {host_row['lName']}",
            },
        )

    venue = None
    if venue_row:
        venue_text = " ".join(
            part
            for part in [
                venue_row.get("name") or "",
                venue_row.get("description") or "",
                venue_row.get("pickupInstructions") or "",
                venue_row.get("emergencyNotes") or "",
            ]
            if part
        )
        venue = _doc(
            record_id=f"venue:{venue_row['venueId']}",
            text=venue_text,
            metadata={
                "name": venue_row.get("name"),
                "city": venue_row.get("city"),
                "capacity": venue_row.get("capacity"),
                "indoor_outdoor": venue_row.get("indoorOutdoor"),
                "latitude": float(venue_row["latitude"])
                if venue_row.get("latitude") is not None
                else None,
                "longitude": float(venue_row["longitude"])
                if venue_row.get("longitude") is not None
                else None,
                "parking_available": bool(venue_row.get("parkingAvailable")),
                "wheelchair_accessible": bool(
                    venue_row.get("wheelchairAccessible")
                ),
            },
        )

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
            },
            image_url=clothing_row.get("picture"),
        )

    transportation = [
        _doc(
            record_id=f"transportation:{row.get('transportationId') or row.get('transportId')}",
            text=(
                f"Pickup {row.get('pickupLocation')} at "
                f"{_dt(row.get('departureTime') or row.get('pickupTime'))}"
            ),
            metadata={
                "pickup_location": row.get("pickupLocation"),
                "departure_time": _dt(
                    row.get("departureTime") or row.get("pickupTime")
                ),
                "return_time": _dt(row.get("returnTime")),
                "payment": float(row["payment"])
                if row.get("payment") is not None
                else None,
            },
        )
        for row in transport_rows
    ]

    team_members = []
    for row in team_rows:
        host_id = row.get("host_id") or row.get("senderId")
        if host_id is None:
            continue
        team_members.append(
            _doc(
                record_id=f"event_team_member:{host_id}",
                text=row.get("description") or "",
                metadata={
                    "host_id": host_id,
                    "host_name": f"{row.get('fName', '')} {row.get('lName', '')}".strip(),
                    "assigned_role": row.get("assigned_role")
                    or row.get("assignedRole")
                    or "host",
                    "languages": [],
                    "skills": [],
                    "rating": None,
                },
                image_url=row.get("profilePic"),
            )
        )

    return {
        "status": "success",
        "event_id": event_id,
        "user_id": user_id,
        "host": host,
        "assignment": assignment,
        "event": event,
        "venue": venue,
        "clothing": clothing,
        "transportation": transportation,
        "team_members": team_members,
        "source_count": (
            #assignment and event
            2
            + (1 if venue else 0)
            + (1 if clothing else 0)
            + len(transportation)
            + (1 if host else 0)
            + len(team_members)
        ),
    }
