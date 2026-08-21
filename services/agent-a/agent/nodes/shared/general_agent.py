from agent.llm.ai_model import llm
from agent.state.agent_state import AgentState


def general_agent(state: AgentState):
    task = state["remaining_task"] or state["message"]
    history_text = "\n".join(
        f"{item['role'].upper()}: {item['content']}"
        for item in state.get("history", [])
    )

    summary_text = state.get("summary", "").strip()
    if not summary_text:
        summary_text = "No previous summary."

    if not history_text:
        history_text = "No previous conversation."

    prior_sql = "\n\n".join(
        result.strip()
        for result in state.get("specialist_results", [])
        if result and result.strip()
    )
    if not prior_sql:
        prior_sql = "No prior SQL results in this turn."

    prompt = f"""
        You are Gatherly's general-purpose specialist.

        MODE A — If "Prior SQL results" below contain a Gatherly answer:
        - Explain that answer in clear, friendly plain language.
        - Do NOT change factual conclusions from the SQL specialist.
        - Do NOT invent Gatherly facts.
        - Do NOT cite new evidence; paraphrase the SQL result only.

        MODE B — If there are no prior SQL results (or task is greeting/general knowledge):
        - Answer greetings and pure general knowledge (AI, programming, math, writing).
        - Do NOT answer Gatherly-specific facts without prior SQL results.

        Prior SQL results:
        {prior_sql}

        Conversation summary:
        {summary_text}
        Conversation history:
        {history_text}

        Current user question:
        {state["message"]}

        Assigned task:
        {task}
    """

    response = llm.invoke(prompt).text.strip()

    updated_results = state["specialist_results"] + [response]
    updated_completed_agents = state["completed_agents"] + ["general_agent"]

    return {
        "response": response,
        "selected_agent": "general_agent",
        "specialist_results": updated_results,
        "completed_agents": updated_completed_agents,
        "remaining_task": "",
    }
