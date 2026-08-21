from agent.state.agent_state import AgentState
import re

SENSITIVE_OUTPUT_PATTERNS = [
    # statements that appear to reveal credentials
    r"\b(api|secret|access)\s*key\s*(is|:|=)\s*\S+",
    r"\bpassword\s*(is|:|=)\s*\S+",
    r"\bbearer\s+[a-zA-Z0-9._\-]+",

    # common API-key formats
    r"\bsk-[a-zA-Z0-9]{20,}\b",
    r"\bAIza[a-zA-Z0-9_\-]{20,}\b",

    # direct disclosure of internal instructions
    r"\b(my|the)\s+system\s+prompt\s+(is|contains|says)\b",
    r"\bhere\s+(is|are)\s+(my|the)\s+(hidden|internal|system)\s+instructions?\b",
]

def output_guard(state:AgentState):
    response=state["response"].strip()
    response_lower=response.lower()

    if not response:
        guard_message="The agent produced an empty response."
        return{
            "output_safe": False,
            "guard_message": guard_message,
            "response": guard_message,
            "next_agent": "end",            
        }

    matched_pattern = next(
        (
            pattern
            for pattern in SENSITIVE_OUTPUT_PATTERNS
            if re.search(pattern, response, re.IGNORECASE)
        ),
        None,
    )

    if matched_pattern:
        guard_message=(
            "The response was blocked by the output guards because it may expose "
            "sensitive information."            
        )
        return {
            "output_safe": False,
            "guard_message": guard_message,
            "response": guard_message,
            "next_agent": "end",
        }


    return {
        "output_safe": True,
        "guard_message": "",
    }    
