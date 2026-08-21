"""Match an uploaded look via VLM → image embeddings → RAG."""

from __future__ import annotations

from agent.services.rag_client import ask_rag_by_image, extract_answer
from agent.state.agent_state import AgentState


async def visual_style_agent(state: AgentState) -> dict:
    task = (state["remaining_task"] or state["message"] or "").strip()
    artifacts = dict(state.get("artifacts") or {})
    image_bytes = state.get("image_bytes")
    image_filename = state.get("image_filename") or "upload.jpg"

    if not image_bytes:
        response = (
            "Please attach an inspiration photo so I can match a style "
            "from the Gatherly guides."
        )
    else:
        try:
            raw = await ask_rag_by_image(
                image_bytes,
                filename=image_filename,
                question=task,
            )
            response = extract_answer(raw)
            if raw.get("vlm_description"):
                response = (
                    f"**What I see:** {raw['vlm_description']}\n\n"
                    f"{response}"
                )
            artifacts["rag"] = {
                "status": "success",
                "mode": raw.get("mode"),
                "cards": raw.get("cards") or [],
                "text_sources": raw.get("text_sources") or raw.get("sources") or [],
                "image_sources": raw.get("image_sources") or [],
                "public_base_url": raw.get("public_base_url"),
                "vlm_description": raw.get("vlm_description"),
            }
        except Exception as error:
            response = (
                "I could not run visual style matching. "
                f"Details: {error}"
            )

    return {
        "response": response,
        "selected_agent": "visual_style_agent",
        "specialist_results": state["specialist_results"] + [response],
        "completed_agents": state["completed_agents"]
        + ["visual_style_agent"],
        "remaining_task": "",
        "artifacts": artifacts,
    }

