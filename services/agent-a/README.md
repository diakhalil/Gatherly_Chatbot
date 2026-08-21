# Agent A — LangGraph + FastAPI

Primary multi-agent system (supervisor, specialists, guards).

## Run locally

```bash
cd services/agent-a
pip install -r requirements.txt
uvicorn api.server:app --reload --port 8001
```

Requires MySQL + MCP server. Load env from repo root `.env`.
