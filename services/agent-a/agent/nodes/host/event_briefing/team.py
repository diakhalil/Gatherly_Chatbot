from __future__ import annotations


def build_safe_team_cards(context: dict) -> dict:
    if context.get("status") != "success":
        return {
            "status": context.get("status", "error"),
            "message": context.get("message"),
        }

    current_host_id = context["user_id"]
    team_members = context.get("team_members", [])

    cards = []

    for member in team_members:
        metadata = member.get("metadata", {})
        host_id = metadata.get("host_id")

        cards.append({
            "host_id": host_id,
            "name": metadata.get("host_name"),
            "assigned_role": metadata.get("assigned_role"),
            "languages": metadata.get("languages", []),
            "skills": metadata.get("skills", []),
            "rating": metadata.get("rating"),
            "image_url": member.get("image_url"),
            "is_current_host": host_id == current_host_id,
            "source_record": member.get("record_id"),
        })

    cards.sort(
        key=lambda card: (
            card["assigned_role"] != "team_leader",
            card["name"] or "",
        )
    )

    team_leader = next(
        (
            card
            for card in cards
            if card["assigned_role"] == "team_leader"
        ),
        None,
    )

    return {
        "status": "success",
        "event_id": context["event_id"],
        "team_size": len(cards),
        "team_leader": team_leader,
        "members": cards,
        "privacy_note": (
            "Only event-role and public host profile information "
            "is displayed. Private applications, clothing sizes, "
            "transport requests and eligibility are excluded."
        ),
    }
