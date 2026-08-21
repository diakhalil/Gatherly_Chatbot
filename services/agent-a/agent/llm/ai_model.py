import os
import pathlib
from dotenv import load_dotenv
from langchain_groq import ChatGroq

_ROOT = pathlib.Path(__file__).resolve().parents[4] 
load_dotenv(_ROOT / ".env")

# llm = ChatGroq(
#     model="openai/gpt-oss-120b",
#     api_key=os.getenv("GROQ_API_KEY"),
#     temperature=0,
# )


# load_dotenv()
from langchain_google_genai import ChatGoogleGenerativeAI
llm = ChatGoogleGenerativeAI(
    model="gemini-3.6-flash",
    google_api_key=os.getenv("GEMINI_API_KEY")
)

# from langchain_ollama import ChatOllama

# llm = ChatOllama(
#     model="qwen2.5:7b",
#     base_url="http://localhost:11434",
#     temperature=0,
# )