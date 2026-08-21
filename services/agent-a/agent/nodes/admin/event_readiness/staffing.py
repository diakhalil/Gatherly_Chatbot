from __future__ import annotations


async def analyze_staffing(state: dict) -> dict:
    """
    Analyze staffing readiness using the shared RAG context.
    This agent performs no additional retrieval.
    """

    context = state.get("readiness_context", {})

    if context.get("status") != "success":
        return {
            "staffing_report": {
                "status": "missing_context",
                "risks": [],
                "recommendations": [],
                "message": (
                    "A valid readiness context was not provided."
                ),
            }
        }

    event = context.get("event") or {}
    applications = context.get("applications", [])
    hosts = context.get("hosts", [])

    event_metadata = event.get("metadata", {})

    required_hosts = int(
        event_metadata.get("required_hosts") or 0
    )
    assigned_hosts = len(applications)
    shortage = max(required_hosts - assigned_hosts, 0)

    required_languages = set(
        event_metadata.get("required_languages") or []
    )
    required_skills = set(
        event_metadata.get("required_skills") or []
    )

    available_languages = {
        language
        for host in hosts
        for language in host.get(
            "metadata", {}
        ).get("languages", [])
    }

    available_skills = {
        skill
        for host in hosts
        for skill in host.get(
            "metadata", {}
        ).get("skills", [])
    }

    missing_languages = sorted(
        required_languages - available_languages
    )
    missing_skills = sorted(
        required_skills - available_skills
    )

    has_team_leader = any(
        application.get(
            "metadata", {}
        ).get("assigned_role") == "team_leader"
        for application in applications
    )

    hosts_needing_ride = [
        application.get(
            "metadata", {}
        ).get("host_name")
        for application in applications
        if application.get(
            "metadata", {}
        ).get("needs_ride")
    ]

    inactive_host_ids = [
        host.get("metadata", {}).get("entity_id")
        for host in hosts
        if not host.get("metadata", {}).get("active", False)
    ]

    ineligible_host_ids = [
        host.get("metadata", {}).get("entity_id")
        for host in hosts
        if host.get(
            "metadata", {}
        ).get("eligibility") != "approved"
    ]

    assigned_host_names = [
        application.get(
            "metadata", {}
        ).get("host_name")
        for application in applications
    ]

    risks = []
    recommendations = []

    if shortage:
        risks.append(
            f"The event is short by {shortage} host(s)."
        )
        recommendations.append(
            f"Assign at least {shortage} additional host(s)."
        )

    if missing_languages:
        risks.append(
            "Missing required languages: "
            + ", ".join(missing_languages)
        )
        recommendations.append(
            "Assign hosts who cover the missing languages."
        )

    if missing_skills:
        risks.append(
            "Missing required skills: "
            + ", ".join(missing_skills)
        )
        recommendations.append(
            "Assign hosts who cover the missing skills."
        )

    if not has_team_leader:
        risks.append("No team leader is assigned.")
        recommendations.append(
            "Assign an approved host as team leader."
        )

    if inactive_host_ids:
        risks.append(
            "Inactive assigned host IDs: "
            + ", ".join(map(str, inactive_host_ids))
        )
        recommendations.append(
            "Replace inactive assigned hosts."
        )

    if ineligible_host_ids:
        risks.append(
            "Ineligible assigned host IDs: "
            + ", ".join(map(str, ineligible_host_ids))
        )
        recommendations.append(
            "Review or replace ineligible assigned hosts."
        )

    if hosts_needing_ride:
        recommendations.append(
            "Confirm transportation for: "
            + ", ".join(hosts_needing_ride)
        )

    return {
        "staffing_report": {
            "status": "success",
            "event_id": context.get("event_id"),
            "required_hosts": required_hosts,
            "assigned_hosts": assigned_hosts,
            "shortage": shortage,
            "assigned_host_names": assigned_host_names,
            "has_team_leader": has_team_leader,
            "required_languages": sorted(required_languages),
            "available_languages": sorted(available_languages),
            "missing_languages": missing_languages,
            "required_skills": sorted(required_skills),
            "available_skills": sorted(available_skills),
            "missing_skills": missing_skills,
            "hosts_needing_ride": hosts_needing_ride,
            "inactive_host_ids": inactive_host_ids,
            "ineligible_host_ids": ineligible_host_ids,
            "risks": risks,
            "recommendations": recommendations,
            "sources": [event] + applications + hosts,
        }
    }
