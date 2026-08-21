from agent.state.agent_state import AgentState
from agent.llm.ai_model import llm
import json
from datetime import datetime, timezone

ALLOWED_AGENTS = {
    "sql_agent",
    "general_agent",
    "event_readiness_agent",
    "event_debrief_agent",
    "host_event_briefing_agent",
    "client_event_explorer_agent",
    "invitation_site_agent",
    "rag_agent",
    "visual_style_agent",
    "event_ops_workbook_agent",
}

MAX_ITERATIONS = 5
import logging
logger = logging.getLogger("gatherly.agent-a")

def combine_results(results: list[str]) -> str:
    return "\n\n".join(
        result.strip()
        for result in results
        if result and result.strip()
    )

def supervisor(state:AgentState):

    completed_agents = set(state["completed_agents"])
    required_agents = state["required_agents"]
    agent_tasks = state["agent_tasks"]
    combined_response = combine_results(state["specialist_results"])
    history_text = "\n".join(
        f"{item['role'].upper()}: {item['content']}"
        for item in state.get("history", [])
    )

    if not history_text:
        history_text = "No previous conversation."

    summary_text = state.get("summary", "").strip()
    if not summary_text:
        summary_text = "No previous summary."

   
        
        
    if not required_agents:
        prompt = f"""
            You are a routing planner.
            Create the complete specialist plan before any specialist runs.  

            sql_agent handles:
            - ALL Gatherly SQL lookups: hosts, events, venues, applications, clothing,
            transport, teammates/accepted hosts on an event, training, reviews.
            - Plain data questions (no MCP briefing): e.g. "who are my teammates on event N",
            venue search by city/name/capacity.

            general_agent handles:
            - Greetings and pure general knowledge (no Gatherly data).
            - After sql_agent in the same turn: friendly explanation of SQL results only.
            - NEVER alone for Gatherly facts.

            event_readiness_agent handles:
            - Complete readiness assessments for a specific Gatherly event.
            - Admin-only. Partial readiness: weather/staffing/logistics risk for an event.
            - NOT a host asking "what's the weather for my event" — use host_event_briefing_agent.
            - Requests to check whether an event is ready, safe, prepared,
              properly staffed, weather-ready, or logistically ready.
            - This specialist chooses which readiness tools to call.
              You only route to it; you do not choose its tools.
            - The request must concern a specific event ID.
            - Do NOT use for past reviews, debriefs, or "what went wrong".

            event_debrief_agent handles:
            - Post-event inspection of a team-leader review/debrief.
            - Phrases like: "what went wrong", "classify this review",
              "inspect the debrief", clothing/transport/staffing/venue/weather
              issue from a past event.
            - Uses classify_event_issue then inspects recorded SQL facts.
            - This is PAST inspection, not future readiness.
            - Available to admins. Prefer an event ID; pasted debrief text is OK.
            - Do NOT use event_readiness_agent for these questions.

            host_event_briefing_agent handles:
            - Host prep for an assigned event (hosts only, needs event ID): full briefing,
            arrival time, weather, route, outfit check.
            - NOT plain teammate/host lists, use sql_agent for those.
            - This specialist chooses its tools; you only route to it.
            - Host prep for an assigned event: weather, route, outfit, timeline, full briefing.
            - Host weather questions (e.g. "weather for event 186") route here, not readiness.
            - Plain teammate lists -> sql_agent, not here.

            
            client_event_explorer_agent handles:
            - Ranked venue comparison ONLY for a client's own event.
            - Partial explorer asks: suitability-only, weather comparison,
              or full compare/recommend with routes when relevant.
            - Requires a specific event ID owned by the client.
            - Use ONLY when the user wants to compare/recommend/evaluate venues
              FOR that event (capacity, accessibility, parking, weather, routes).
            - Do NOT use for plain venue search by city/name without an event ID.
            - This specialist chooses which explorer tools to call.
              You only route to it; you do not choose its tools.

            visual_style_agent handles:
            - User uploaded an inspiration / décor / venue look photo.
            - Match style via VLM description + image embeddings + wedding theme guides.
            - Phrases like: "what style is this", "match this look", "find similar décor"
            when an image is attached.
            - Do NOT use for Excel/ops checklists (other agent).
            - Do NOT use for event venue SQL compare (client_event_explorer_agent).
            - Prefer this over rag_agent when an image is attached for style matching.

            event_ops_workbook_agent handles:
            - Planning pack / organizer checklist / sustainable workbook
            for a specific event ID (admin or client).
            - Phrases like: "planning pack", "export checklist",
            "planning excel", "how to organize this event",
            "sustainable tasks for event N".
            - Arabic traditions ONLY when the user names a country or
            a specific custom (e.g. Lebanese henna) — not a full dump.
            - Requires a specific event ID.
            - Do NOT use for venue compare, readiness, visual style photos,
            or wedding-theme décor looks (those are other agents).
            - This specialist loads SQL itself. Do not also call sql_agent.


            invitation_site_agent handles:
            - Building / generating / publishing a guest invitation website
            for a specific event (React site, invite page, Netlify link).
            - Phrases like: "create an invitation", "build invite site",
            "generate wedding website", "deploy invitation for event N".
            - Requires a specific event ID.
            - Do NOT use for host briefings, readiness, or venue comparison.
            - Use alone (do not combine with sql_agent merely to fetch event fields).

            rag_agent handles:
            - Catering / food / menu / dietary guidance grounded in RAG docs.
            - Wedding themes, décor styles, invitation look/feel, bouquets,
            table settings, trends, checklists from the document corpus.
            - Theme/style venue INSPIRATION from docs (forest, rustic, boho,
            enchanted, garden look) when the user wants examples/photos/ideas,
            NOT a lookup in Gatherly's venues table.
            - Phrases like: "catering ideas", "rustic wedding theme",
            "show me décor", "forest wedding venues", "show me wedding venues
            for a forest theme", "what does a forest venue look like",
            "what does a boho invitation look like",
            "sustainable event tips from the guides".
            - Do NOT use for Gatherly SQL data (hosts, events table, applications).
            - Do NOT use for readiness / host briefing / venue compare for an event ID.
            - Do NOT use for generating/deploying an invitation website
            (that is invitation_site_agent).
            - Use alone for pure RAG questions.

            Rules:
            - You are a router only. Never answer the user yourself.
            - Use exactly one specialist when one specialist can answer completely alone.
            - Partial workflow asks still route to the matching specialist
              (e.g. teammates -> sql_agent; outfit/weather/route -> host_event_briefing_agent;
                weather readiness -> event_readiness_agent).
              Do not invent new agent names for sub-tasks.
            - Use sql_agent then general_agent when a Gatherly SQL answer would
            benefit from a friendly explanation after the grounded fact.
            - Use sql_agent only (no general_agent) for direct data lookups.
            - Do not add general_agent merely to rewrite a complete retrieval answer
            unless the user’s tone is personal/conversational or asks "why".
            - Preserve the order: sql_agent first, then general_agent.
            - Each task must contain only that specialist’s portion.
            - Use event_readiness_agent when the user asks for a complete
            readiness assessment of a specific event OR a partial readiness facet.
            - Do not use sql_agent together with event_readiness_agent
            merely to fetch event details; the readiness specialist performs
            its own SQL context collection.
            - Use event_debrief_agent for "what went wrong", review/debrief
            classification, or inspecting a past event's team-leader feedback.
            - Do not combine event_debrief_agent with event_readiness_agent.
            - Do not use sql_agent merely to fetch a review when the user
            wants the issue classified.
            
            - sql_agent: direct DB facts (teammates, host lists, event/venue lookups).
            - host_event_briefing_agent: briefing prep with MCP (timeline, weather, route, outfit).
            - Do not combine sql_agent with specialists that load their own SQL.

            - Use client_event_explorer_agent ONLY when a client asks to find,
            recommend, compare or evaluate venues for their specific event ID.
            - If the user searches Gatherly venues by Lebanese city/name/capacity
            with NO event ID (e.g. "venues in Byblos", "Pearl Ballroom"),
            use sql_agent only.
            - If the user asks for themed/styled venue examples or "show me"
            forest/rustic/boho/garden wedding venues from guides/photos,
            use rag_agent only — NOT sql_agent.
            - Do not combine sql_agent with client_event_explorer_agent
            merely to fetch event or venue information; the explorer loads
            its own SQL context.

            - NEVER route Gatherly data questions to general_agent ALONE.
            - For sql_agent tasks, instruct the specialist to answer only from
            SQL results and say if evidence is insufficient.
            - Use event_ops_workbook_agent for planning packs / checklists
            / organizer Excel for a specific event ID.

            - Use rag_agent for catering/theme/décor/doc-grounded wedding advice.
            Never invent those from general_agent when RAG applies.
            - If Image attached is yes and the user wants style/look/theme matching,
            use visual_style_agent only (not rag_agent).

            Current date/time (UTC): {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}

            Examples:

            "Find an active Arabic-speaking wedding host."
            -> sql_agent only

            "Find a wedding venue, then explain generally how venue capacity is planned."
            -> sql_agent, then general_agent

            "Give me my host briefing for event 31."
            -> host_event_briefing_agent only

            "What's the weather risk for event 27?" (admin)
            -> event_readiness_agent only

            "What is the weather for event 186?" (host)
            -> host_event_briefing_agent only

            "What went wrong at event 1?"
            -> event_debrief_agent only

            "Classify this team-leader debrief: the van never showed for hosts who needed a ride."
            -> event_debrief_agent only

            "Check my outfit for event 31."
            -> host_event_briefing_agent only

            "Search venues in Byblos"
            -> sql_agent only

            "Compare suitable venues for my event 1."
            -> client_event_explorer_agent only

            "What is an AI agent?"
            -> general_agent only

            "Hello, what can you help me with?"
            -> general_agent only

            "Search venues in Byblos"
            -> sql_agent only

            "Find venues with capacity at least 400"
            -> sql_agent only

            "Compare suitable venues for my event 1."
            -> client_event_explorer_agent only

            "Create an invitation website for event 186."
            -> invitation_site_agent only

            "Suggest catering ideas for a rustic wedding."
            -> rag_agent only

            "What does a boho wedding table setting look like?"
            -> rag_agent only

            "Give sustainable event planning tips from the guides."
            -> rag_agent only

            "Show me forest wedding venues"
            -> rag_agent only

            "Show me examples of forest wedding venues"
            -> rag_agent only

            "What does a forest wedding venue look like?"
            -> rag_agent only

            "Find venues in Byblos"
            -> sql_agent only

            "Build and deploy a guest invite site for event 42."
            -> invitation_site_agent only

            Reply with exactly one JSON object:
            {{
            "required_agents": ["sql_agent"],
            "agent_tasks": {{
                "sql_agent": "focused task"
            }}
            }}

            Use a two-item required_agents list only for a genuine multi-part request.

            Conversation summary:
            {summary_text}
            
            Conversation history:
            {history_text}

            When the current question depends on previous messages, rewrite the
            specialist task as a complete standalone request containing the needed context.

            Image attached: {"yes" if state.get("image_bytes") else "no"}

            User question:
            {state["message"]}
        """

        raw_plan = llm.invoke(prompt).text.strip()
        if raw_plan.startswith("```"):
            raw_plan = raw_plan.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

        try:
            parsed_plan = json.loads(raw_plan)
            proposed_agents = parsed_plan.get("required_agents", [])
            proposed_tasks = parsed_plan.get("agent_tasks", {})
        except (json.JSONDecodeError, AttributeError):
            proposed_agents = []
            proposed_tasks = {}

        validated_agents = []

        if isinstance(proposed_agents, list):
            for agent_name in proposed_agents:
                if (
                    agent_name in ALLOWED_AGENTS
                    and agent_name not in validated_agents
                ):
                    validated_agents.append(agent_name)

        # Safe fallback: preserve the original retrieval-agent fallback
        if not validated_agents:
            validated_agents = ["sql_agent"]
            proposed_tasks = {
                "sql_agent": state["message"],
            }

        # There are only two specialists; reject oversized plans.
        validated_agents = validated_agents[:2]

        if not isinstance(proposed_tasks, dict):
            proposed_tasks = {}

        validated_tasks = {
            agent_name: (
                proposed_tasks.get(agent_name, state["message"])
                if isinstance(proposed_tasks.get(agent_name), str)
                else state["message"]
            )
            for agent_name in validated_agents
        }

        required_agents = validated_agents
        agent_tasks = validated_tasks

    pending_agents = [
        agent_name
        for agent_name in required_agents
        if agent_name not in completed_agents
    ]

    if not pending_agents:
        return {
            "next_agent": "end",
            "response": combined_response,
            "remaining_task": "",
        }

    if state["iteration_count"] >= MAX_ITERATIONS:
        response = combined_response

        if response:
            response += "\n\n"

        response += "The maximum number of routing attempts was reached."

    
        return {
            "next_agent": "end",
            "response": response,
            "remaining_task": "",
        }

    decision = pending_agents[0]
    remaining_task = agent_tasks.get(decision, state["message"])

    if not isinstance(remaining_task, str) or not remaining_task.strip():
        remaining_task = state["message"]

    logger.info("Supervisor route | required=%s next=%s", required_agents, decision)
    return {
        "next_agent": decision,
        "required_agents": required_agents,
        "agent_tasks": agent_tasks,
        "remaining_task": remaining_task.strip(),
        "iteration_count": state["iteration_count"] + 1,
    }
