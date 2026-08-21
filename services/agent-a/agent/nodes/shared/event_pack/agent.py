from __future__ import annotations

import re

from agent.llm.ai_model import llm
from agent.nodes.shared.event_pack.tools import build_event_pack_tools
from agent.state.agent_state import AgentState
from agent.utils.tool_loop import run_tool_loop
import os
AGENT_BASE_URL = os.getenv("AGENT_API_URL", "http://127.0.0.1:8001")


def _extract_event_id(task: str) -> int | None:
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


async def event_ops_workbook_agent(state: AgentState) -> dict:
    task = state["remaining_task"] or state["message"]
    event_id = _resolve_event_id(state, task)
    artifacts = dict(state.get("artifacts") or {})

    if state["role"] not in {"admin", "client"}:
        response = "Planning packs are available to admins and clients."
    elif not event_id:
        response = "Please specify the event ID for the planning pack."
    else:
        session: dict = {}
        tools = build_event_pack_tools(
            session,
            role=state["role"],
            user_id=state["user_id"],
        )
        system_prompt = f"""
You are the Event Planning Pack specialist for Gatherly.

Never invent SQL or guide facts. Use only your tools.

STRICT RULES:
- ONLY include topics the user explicitly asked for.
- NEVER add extra topics.
- Call search_ops_guides once per topic with topics=[single_topic].
- NEVER pass multiple topics in one call.
- Write the retrieval question from the user request. Include only the
  country/custom/angle THEY named. Never invent a default query.
- If arabic_traditions is requested but country or custom is missing,
  ask for that before searching. Do not assume Lebanon or henna.
- If the request is vague, ask only 1 to 3 short clarification questions.
- Final answer must be synthesized tables/bullets only.
- NEVER paste raw guide text, OCR chunks, or retrieval excerpts.
- Use search_ops_guides as input only; write your own summary.
- SQL/event facts: write in the user's language.
- Guide findings: write each section in the same language as that
  section's retrieved document (Arabic PDF → Arabic, French PDF → French,
  English PDF → English). Do not translate the whole reply into one language.
- Always name the exact PDF from text_sources.file_name (do not invent a filename).
- If text_sources is empty, say no guide PDF was retrieved.

Tools:
- load_event_pack_context(event_id): always call first
- search_ops_guides(question, topics): one call per topic
- export_planning_workbook(guide_sections): after retrieval, create Excel

Workbook rules:
- Always include event and team sheets when exporting.
- When calling export_planning_workbook, ALWAYS pass guide_sections with
  the synthesized rows you already wrote in chat.
- Each requested topic = one guide_sections entry with a title from the
  user request plus 4-8 rows in the retrieved document's language,
  plus a final Sources row with the exact PDF name.
- Chat answer and Excel rows must match, including source PDF names.
- Do not export if the user asked for guide topics and guide_sections is empty.
- export_planning_workbook must run AFTER search_ops_guides, never after SQL only.

Workflow:
1) load_event_pack_context({event_id})
2) If request is too broad, ask short clarification questions and stop
3) Otherwise, call search_ops_guides once per requested topic
4) export_planning_workbook(guide_sections=[...]) using YOUR summary
5) Write a short markdown answer with a small SQL table and clear guide findings
6) Include the download link

Default event ID: {event_id}
Do not mention tool names in the final answer.
"""
        response = await run_tool_loop(
            llm=llm,
            system_prompt=system_prompt,
            user_message=task,
            tools=tools,
        )
        context = session.get("context")
        if context and context.get("status") == "success":
            artifacts["event_pack"] = context
        ops_guides = session.get("ops_guides")
        if ops_guides:
            artifacts["ops_guides"] = ops_guides

        wb_path = session.get("workbook_path")
        if wb_path:
            filename = session.get("workbook_filename") or "planning_pack.xlsx"
            download_url = f"{AGENT_BASE_URL}/exports/{filename}"
            # Drop LLM-invented download markdown; keep the real exported file.
            response = re.sub(
                r"\[([^\]]+)\]\(https?://[^\s)]+/exports/[^)]+\)",
                "",
                response or "",
            )
            response = re.sub(
                r"https?://[^\s)]+/exports/[^\s)]+",
                "",
                response,
            )
            response = response.rstrip() + (
                f"\n\n[Download {filename}]({download_url})"
            )
            artifacts["workbook"] = {
                "filename": filename,
                "download_url": download_url,
            }

    return {
        "response": response,
        "selected_agent": "event_ops_workbook_agent",
        "specialist_results": state["specialist_results"] + [response],
        "completed_agents": state["completed_agents"]
        + ["event_ops_workbook_agent"],
        "remaining_task": "",
        "artifacts": artifacts,
    }
