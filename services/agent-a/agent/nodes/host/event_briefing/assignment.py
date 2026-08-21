from __future__ import annotations


def analyze_host_assignment(context: dict) -> dict:
    if context.get("status") != "success":
        return {
            "status": context.get("status", "error"),
            "message": context.get(
                "message",
                "Host assignment context is unavailable.",
            ),
        }

    assignment = context["assignment"]
    event = context["event"]

    assignment_meta = assignment.get("metadata", {})
    event_meta = event.get("metadata", {})

    assigned_role = assignment_meta.get("assigned_role")
    needs_ride = bool(assignment_meta.get("needs_ride"))
    requested_clothing = bool(
        assignment_meta.get("request_dress")
    )

    responsibilities = {
        "team_leader": [
            "Attend the pre-event coordination briefing.",
            "Confirm host attendance and task distribution.",
            "Escalate operational issues to the event administrator.",
        ],
        "host": [
            "Attend the pre-event host briefing.",
            "Follow the assigned guest-service responsibilities.",
            "Report operational issues to the team leader.",
        ],
    }

    checklist = [
        "Review the venue and event schedule.",
        "Confirm attendance before the event.",
        "Carry required identification.",
    ]

    if needs_ride:
        checklist.append("Confirm your transportation pickup details.")

    if requested_clothing:
        checklist.append("Confirm that the requested outfit is available.")

    return {
        "status": "success",
        "event_id": context["event_id"],
        "host_id": context["user_id"],
        "application_status": assignment_meta.get("status"),
        "assigned_role": assigned_role,
        "event_type": event_meta.get("event_type"),
        "starts_at": event_meta.get("starts_at"),
        "ends_at": event_meta.get("ends_at"),
        "required_languages": event_meta.get(
            "required_languages",
            [],
        ),
        "required_skills": event_meta.get(
            "required_skills",
            [],
        ),
        "needs_ride": needs_ride,
        "requested_clothing": requested_clothing,
        "responsibilities": responsibilities.get(
            assigned_role,
            responsibilities["host"],
        ),
        "checklist": checklist,
        "source_records": [
            assignment.get("record_id"),
            event.get("record_id"),
        ],
    }

