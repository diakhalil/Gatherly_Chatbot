from dotenv import load_dotenv
from pydantic_ai import Agent

load_dotenv()

general_agent = Agent(
    "google:gemini-3.6-flash",
    instructions=(
        "You are a general-purpose specialist"
        "Answer general knowledge questions clearly and concisely"
        "Do not answer questions that require the product RAG datasets"
    ),
)

