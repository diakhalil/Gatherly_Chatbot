from __future__ import annotations

import json
import re

from agent.llm.ai_model import llm
from agent.nodes.admin.event_debrief.tools import build_debrief_tools
from agent.state.agent_state import AgentState
from agent.utils.tool_loop import run_tool_loop


def _extract_event_id(task: str) -> int | None:
    prompt = f"""
You extract the Gatherly event ID for a post-event debrief inspection.

Return exactly one JSON object:
{{
  "event_id": 1
}}

If no event ID is provided, return:
{{
  "event_id": null
}}

User request:
{task}
"""
    raw = llm.invoke(prompt).text.strip()
    try:
        parsed = json.loads(raw)
        event_id = parsed.get("event_id")
        if event_id is not None:
            event_id = int(event_id)
            if event_id > 0:
                return event_id
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        pass

    match = re.search(
        r"\bevent(?:\s+id)?\s*#?\s*(\d+)\b",
        task,
        flags=re.IGNORECASE,
    )
    return int(match.group(1)) if match else None


def _resolve_event_id(state: AgentState, task: str) -> int | None:
    preferred = state.get("preferred_event_id")
    if preferred:
        try:
            value = int(preferred)
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass
    return _extract_event_id(task)


async def event_debrief_agent(state: AgentState) -> dict:
    task = state["remaining_task"] or state["message"]
    event_id = _resolve_event_id(state, task)
    artifacts = dict(state.get("artifacts") or {})

    if state["role"] != "admin":
        response = "Only administrators can inspect post-event debriefs."
    else:
        tools = build_debrief_tools()
        event_note = (
            f"Default event ID: {event_id}."
            if event_id
            else "No event ID was provided. Classify pasted debrief text, or ask for an event ID."
        )
        system_prompt = f"""
You inspect PAST Gatherly events. You do not assess future readiness.

Never invent SQL facts. Use only your tools.
Never call event-readiness, weather-forecast, or scoring tools.

Tools:
- load_event_review(event_id): latest team-leader debrief from SQL
- classify_event_issue(text): fine-tuned DistilBERT classifier
  (clothing / transport / staffing / venue / weather / all_clear)
- inspect_event_clothing(event_id)
- inspect_event_transport(event_id)
- inspect_event_staffing(event_id)
- inspect_event_venue(event_id)

Workflow (required order):
1) If there is an event ID and the user did not paste a debrief: load_event_review.
2) You MUST call classify_event_issue on the review content (or pasted text).
   Do not guess clothing/transport/staffing/venue/weather/all_clear yourself.
   The fine-tuned DistilBERT tool is the only allowed source of the label.
3) After you have the classifier JSON, call at most one inspect tool if
   suggested_followup_tool is set. If it is null, stop inspecting.

Forbidden:
- Inspecting clothing/transport/staffing/venue before classify_event_issue has returned.
- Inventing a label or confidence.
- Readiness/forecast/scoring tools.

Final answer MUST include:
- This is a post-event inspection
- The classifier label in backticks
- The confidence percentage
- The top 3 scores from the tool JSON
- Then the debrief quote and any recorded facts


Style: short, admin-facing. Mention this is a post-event inspection.
{event_note}
Do not mention tool names in the final answer.
"""
        response = await run_tool_loop(
            llm=llm,
            system_prompt=system_prompt,
            user_message=task,
            tools=tools,
        )

    return {
        "response": response,
        "selected_agent": "event_debrief_agent",
        "specialist_results": state["specialist_results"] + [response],
        "completed_agents": state["completed_agents"] + ["event_debrief_agent"],
        "remaining_task": "",
        "artifacts": artifacts,
    }
