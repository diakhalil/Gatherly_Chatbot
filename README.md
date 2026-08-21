# Gatherly

Event platform for **clients** (plan and explore venues), **hosts** (briefings and assignments), and **admins** (readiness and operations). A chatbot routes each request to a specialist.

## How it works

```text
Frontend (React) → Backend (Node/MySQL) → Agent A (LangGraph)
                                            ├── SQL / RAG / visual style
                                            ├── host briefing, admin readiness, client explorer
                                            ├── MCP (weather, route, charts)
                                            └── Agent B (invitation sites)
```

RAG uses Qdrant. MySQL stays on the host machine (not in Compose by default).

## Services

| Folder | Role | Port |
|---|---|---|
| `services/frontend` | React UI | 3000 |
| `services/backend` | Product API, auth, chat proxy | 5050 |
| `services/agent-a` | Supervisor + specialists | 8001 |
| `services/agent-b` | Invitation site generator | 8002 |
| `services/mcp-server` | Weather, routing, visualizations | 8000 |
| `services/gatherly_rag` | Document/image RAG | 8003 |
| `services/voice-demo` | Voice demo | 8005 |

## Setup

1. Copy `.env.example` to `.env` and fill in keys (`GEMINI_API_KEY`, `MCP_API_TOKEN`, DB, JWT, …).
2. Make sure MySQL is running with database `Gatherly`.
3. Start the stack:

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

Qdrant runs as `vector-db` on port 6333. Ollama (for RAG) is expected on the host at `localhost:11434`.

## Local run (without Docker)

```bash

cd services/mcp-server && python server.py


cd services/agent-a && uvicorn api.server:app --reload --port 8001


cd services/backend && npm start


cd services/frontend && npm start
```

RAG, Agent B, voice and classifier are optional unless you need document Q&A or invitation sites.

## Docs

- Evaluation: `docs/EVALUATION.md`