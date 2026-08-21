"""Specialist that answers catering / wedding-doc questions via Gatherly RAG HTTP API."""

from __future__ import annotations

from agent.services.rag_client import ask_rag, extract_answer
from agent.state.agent_state import AgentState


async def rag_agent(state: AgentState) -> dict:
    task = (state["remaining_task"] or state["message"] or "").strip()
    artifacts = dict(state.get("artifacts") or {})

    if not task:
        response = "Please ask a catering, wedding-theme, or document question."
    else:
        try:
            raw = await ask_rag(task)
            response = extract_answer(raw)
            artifacts["rag"] = {
                "status": "success",
                "mode": raw.get("mode"),
                "cards": raw.get("cards") or [],
                "text_sources": raw.get("text_sources") or [],
                "image_sources": raw.get("image_sources") or [],
                "public_base_url": raw.get("public_base_url"),
            }
        except Exception as error:
            response = (
                "I could not reach the Gatherly RAG service. "
                "Make sure vector-db is up and the RAG API is running on "
                "RAG_API_URL. Details: {error}"
            ).format(error=error)

    return {
        "response": response,
        "selected_agent": "rag_agent",
        "specialist_results": state["specialist_results"] + [response],
        "completed_agents": state["completed_agents"] + ["rag_agent"],
        "remaining_task": "",
        "artifacts": artifacts,
    }
    