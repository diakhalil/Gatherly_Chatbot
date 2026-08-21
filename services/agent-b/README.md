# Agent System B (Google ADK)

Independent HTTP service: codes a React+Vite invitation site, optionally
builds it and deploys to Netlify. Agent A will call this over HTTP later
(`AGENT_B_URL`); never via Python import.

## Endpoints

- `GET /health`
- `POST /v1/invitations/generate`

## Local run

```bash
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8002
```

Root `.env` needs `GEMINI_API_KEY` (mapped to `GOOGLE_API_KEY`).
For live publish: `NETLIFY_AUTH_TOKEN` (+ Node.js on PATH for `npm run build`).
