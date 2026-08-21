from langgraph.types import Command

from agent.agent import run_agent
from agent.graph.agent_graph import graph


async def run_eval_case(case: dict) -> dict:
    conversation_id = f"eval-{case['id']}"

    state, config = await run_agent(
        case["message"],
        case["role"],
        case["user_id"],
        conversation_id,
        case.get("history", []),
        case.get("summary", ""),
    )

    if "__interrupt__" in state and case.get("requires_approval", False):
        state = await graph.ainvoke(Command(resume=True), config=config)

    return state
