from langgraph.graph import StateGraph, START, END
from agent.state.agent_state import AgentState
from agent.nodes.shared.supervisor import supervisor
from agent.nodes.shared.general_agent import general_agent
from agent.nodes.shared.sql_agent import sql_agent
from guards.input_guard import input_guard
from guards.output_guard import output_guard
from langgraph.checkpoint.memory import InMemorySaver
from agent.nodes.admin.event_readiness.agent import (
    event_readiness_agent,
)
from agent.nodes.admin.event_debrief.agent import (
    event_debrief_agent,
)

from agent.nodes.host.event_briefing.agent import (
    host_event_briefing_agent,
)
from agent.nodes.client.event_explorer.agent import (
    client_event_explorer_agent,
)
from agent.nodes.shared.invitation_agent import invitation_site_agent
from agent.nodes.shared.rag_agent import rag_agent
from agent.nodes.shared.visual_style_agent import visual_style_agent
from agent.nodes.shared.event_pack.agent import event_ops_workbook_agent



def route_to_specialist(state: AgentState) -> str:
    return state["next_agent"]


def route_after_input_guard(state: AgentState) -> str:
    if state["input_safe"]:
        return "supervisor"

    return "end"


# create the graph
graph_builder=StateGraph(AgentState)

graph_builder.add_node("input_guard", input_guard)
graph_builder.add_node("output_guard", output_guard)
graph_builder.add_node("supervisor",supervisor)
graph_builder.add_node("general_agent",general_agent)
graph_builder.add_node("sql_agent", sql_agent)
graph_builder.add_node("event_readiness_agent",event_readiness_agent,)
graph_builder.add_node("event_debrief_agent", event_debrief_agent)
graph_builder.add_node("host_event_briefing_agent",host_event_briefing_agent)
graph_builder.add_node("client_event_explorer_agent",client_event_explorer_agent,)
graph_builder.add_node("invitation_site_agent", invitation_site_agent)
graph_builder.add_node("rag_agent", rag_agent)
graph_builder.add_node("visual_style_agent", visual_style_agent)
graph_builder.add_node("event_ops_workbook_agent", event_ops_workbook_agent)


graph_builder.add_conditional_edges(
    "supervisor",
    route_to_specialist,
    {
        "general_agent": "general_agent",
        "sql_agent": "sql_agent",
        "event_readiness_agent": "event_readiness_agent",
        "event_debrief_agent": "event_debrief_agent",
        "host_event_briefing_agent": "host_event_briefing_agent",
        "client_event_explorer_agent": "client_event_explorer_agent",
        "invitation_site_agent": "invitation_site_agent",
        "end": "output_guard",
        "rag_agent": "rag_agent",
        "visual_style_agent": "visual_style_agent",
        "event_ops_workbook_agent": "event_ops_workbook_agent",
    },
)


graph_builder.add_conditional_edges(
    "input_guard",
    route_after_input_guard,
    {
        "supervisor": "supervisor",
        "end": END,
    },
)

graph_builder.add_edge(START, "input_guard")
graph_builder.add_edge("general_agent", "supervisor")
graph_builder.add_edge("sql_agent", "supervisor")
graph_builder.add_edge("event_readiness_agent","supervisor",)
graph_builder.add_edge("event_debrief_agent", "supervisor")
graph_builder.add_edge("host_event_briefing_agent","supervisor")
graph_builder.add_edge(
    "client_event_explorer_agent",
    "supervisor",
)
graph_builder.add_edge("invitation_site_agent", "supervisor")
graph_builder.add_edge("rag_agent", "supervisor")
graph_builder.add_edge("visual_style_agent", "supervisor")
graph_builder.add_edge("event_ops_workbook_agent", "supervisor")
graph_builder.add_edge("output_guard", END)



memory = InMemorySaver()

# Compile the graph
graph = graph_builder.compile(checkpointer=memory)
