import asyncio
from typing import Any
from uuid import uuid4

from agent.graph.agent_graph import graph


def create_initial_state(
    user_message: str,
    role: str,
    user_id: int,
    history: list[dict[str, str]] | None = None,
    summary: str = "",
    preferred_event_id: int | None = None,
    origin_latitude: float | None = None,
    origin_longitude: float | None = None,
    image_bytes: bytes | None = None,
    image_filename: str | None = None,
) -> dict:
    return {
        "message": user_message,
        "role": role,
        "user_id": user_id,
        "history": history or [],
        "response": "",
        "next_agent": "",
        "selected_agent": "",
        "iteration_count": 0,
        "specialist_results": [],
        "input_safe": True,
        "output_safe": True,
        "guard_message": "",
        "input_classification": "",
        "completed_agents": [],
        "required_agents": [],
        "agent_tasks": {},
        "remaining_task": user_message,
        "summary": summary or "",
        "preferred_event_id": preferred_event_id,
        "origin_latitude": origin_latitude,
        "origin_longitude": origin_longitude,
        "artifacts": {},
        "image_bytes": image_bytes,
        "image_filename": image_filename,
    }


async def run_agent(
    user_message: str,
    role: str,
    user_id: int,
    conversation_id: str,
    history: list[dict[str, str]] | None = None,
    summary: str = "",
    preferred_event_id: int | None = None,
    origin_latitude: float | None = None,
    origin_longitude: float | None = None,
    image_bytes: bytes | None = None,
    image_filename: str | None = None,
):
    initial_state = create_initial_state(
        user_message,
        role,
        user_id,
        history,
        summary=summary,
        preferred_event_id=preferred_event_id,
        origin_latitude=origin_latitude,
        origin_longitude=origin_longitude,
        image_bytes=image_bytes,
        image_filename=image_filename,
    )

    config = {
        "configurable": {
            "thread_id": conversation_id,
        }
    }

    final_state = await graph.ainvoke(initial_state, config=config)

    return final_state, config


async def main():
    user_message = input("You: ")
    role = input("Role (admin/host/client): ").strip().lower()
    user_id = int(input("User ID: ").strip())
    conversation_id = str(uuid4())

    final_state, _config = await run_agent(
        user_message,
        role,
        user_id,
        conversation_id,
        [],
    )

    print("Handled by:", final_state["selected_agent"])
    print("Final route:", final_state["next_agent"])
    print("Response:", final_state["response"])
    artifacts: dict[str, Any] = final_state.get("artifacts") or {}
    if artifacts:
        print("Artifacts keys:", list(artifacts.keys()))


if __name__ == "__main__":
    asyncio.run(main())
