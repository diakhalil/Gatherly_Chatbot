from typing import Any, NotRequired, TypedDict


class AgentState(TypedDict):
    message: str
    role: str
    user_id: int
    history: list[dict[str, str]]
    response: str
    next_agent: str
    selected_agent: str  # who handled the req when routing ends
    iteration_count: int
    specialist_results: list[str]
    completed_agents: list[str]
    required_agents: list[str]
    agent_tasks: dict[str, str]
    remaining_task: str
    input_safe: bool
    output_safe: bool
    guard_message: str
    input_classification: str
    summary: str
    preferred_event_id: NotRequired[int | None]
    origin_latitude: NotRequired[float | None]
    origin_longitude: NotRequired[float | None]
    artifacts: NotRequired[dict[str, Any]]
    image_bytes: NotRequired[bytes | None]
    image_filename: NotRequired[str | None]
