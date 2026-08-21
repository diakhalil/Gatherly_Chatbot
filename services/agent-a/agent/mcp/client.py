from pathlib import Path
import os
from dotenv import load_dotenv
from langchain_mcp_adapters.client import MultiServerMCPClient

REPO_ROOT = Path(__file__).resolve().parents[3]

load_dotenv(REPO_ROOT / ".env")


MCP_API_TOKEN = os.getenv("MCP_API_TOKEN")
MCP_URL = os.getenv("MCP_URL", "http://127.0.0.1:8000/mcp")


def create_mcp_client() -> MultiServerMCPClient:
    return MultiServerMCPClient(
        {
            "tools_server": {
                "transport": "http",
                "url": MCP_URL,
                "headers": {
                    "Authorization": f"Bearer {MCP_API_TOKEN}"
                },
            }
        }
    )
