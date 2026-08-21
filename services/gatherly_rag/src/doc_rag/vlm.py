from pathlib import Path
import base64
import mimetypes
import os
import time

from dotenv import load_dotenv
from google import genai
from google.genai import types
from openai import OpenAI
import ollama

load_dotenv()

PROMPT_VERSION = 1

DESCRIBE_PROMPT = (
    "Describe this image for semantic retrieval in 2 to 4 concise sentences. "
    "Focus on the main visible objects, event or setting, visual style, colors, "
    "decorations, materials, layout, and distinctive visual features. "
    "If text is visible, mention only what type of text it is and any short "
    "words or phrases that are important to understanding the image. "
    "Do not transcribe long text. "
    "Do not infer information that is not clearly visible."
)

# Cache identity MUST stay identical to completed local/API runs.
CACHE_MODEL_NAME = "qwen2.5vl:7b"

# Current Gemini multimodal flash model (optional backend).
GEMINI_VLM_MODEL = "gemini-3.5-flash"

# OpenRouter Qwen2.5-VL model with live endpoints.
OPENROUTER_API_MODEL = "qwen/qwen2.5-vl-72b-instruct"


class OllamaVLM:
    def __init__(
        self,
        model: str = CACHE_MODEL_NAME,
        host: str | None = None,
    ):
        self.model = model
        self.prompt_version = PROMPT_VERSION
        self.num_ctx = 4096

        if host:
            self.client = ollama.Client(host=host)
        else:
            self.client = ollama.Client()

    def describe_image(self, image_path: str | Path) -> str:
        image_path = Path(image_path).resolve()
        if not image_path.is_file():
            raise FileNotFoundError(f"Image was not found: {image_path}")

        response = self.client.chat(
            model=self.model,
            messages=[
                {
                    "role": "user",
                    "content": DESCRIBE_PROMPT,
                    "images": [str(image_path)],
                }
            ],
            options={
                "num_ctx": self.num_ctx,
                "temperature": 0,
            },
        )
        return response["message"]["content"].strip()


class OpenRouterQwenVLM:
    """Cloud Qwen2.5-VL via OpenRouter.

    Cache identity stays ``qwen2.5vl:7b`` so existing completed
    image_context.json files remain valid cache hits.
    """

    def __init__(
        self,
        api_model: str = OPENROUTER_API_MODEL,
        api_key: str | None = None,
    ):
        self.model = CACHE_MODEL_NAME
        self.prompt_version = PROMPT_VERSION
        self.num_ctx = 4096
        self.api_model = api_model

        key = api_key or os.getenv("OPENROUTER_API_KEY")
        if not key:
            raise ValueError(
                "OPENROUTER_API_KEY is missing from the environment."
            )

        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=key,
        )
        print(
            f"VLM backend: OpenRouter ({self.api_model}). "
            f"Cache identity: {CACHE_MODEL_NAME}.",
            flush=True,
        )

    def describe_image(self, image_path: str | Path) -> str:
        image_path = Path(image_path).resolve()
        if not image_path.is_file():
            raise FileNotFoundError(f"Image was not found: {image_path}")

        mime_type, _ = mimetypes.guess_type(image_path.name)
        if mime_type is None:
            mime_type = "image/jpeg"

        encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
        data_url = f"data:{mime_type};base64,{encoded}"

        response = self.client.chat.completions.create(
            model=self.api_model,
            temperature=0,
            max_tokens=512,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": DESCRIBE_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                }
            ],
        )
        content = response.choices[0].message.content
        if not content or not str(content).strip():
            raise RuntimeError("OpenRouter returned an empty VLM description.")
        return str(content).strip()


class GeminiVLM:
    """Cloud VLM via Gemini.

    Cache identity stays ``qwen2.5vl:7b`` so existing completed
    image_context.json files remain valid cache hits.
    """

    def __init__(
        self,
        api_model: str = GEMINI_VLM_MODEL,
        api_key: str | None = None,
        max_retries: int = 5,
    ):
        self.model = CACHE_MODEL_NAME
        self.prompt_version = PROMPT_VERSION
        self.num_ctx = 4096

        self.api_model = api_model
        self.max_retries = max_retries

        key = api_key or os.getenv("GEMINI_API_KEY")
        if not key:
            raise ValueError("GEMINI_API_KEY is missing from the environment.")

        self.client = genai.Client(api_key=key)
        print(
            f"VLM backend: Gemini ({self.api_model}). "
            f"Cache identity: {CACHE_MODEL_NAME}.",
            flush=True,
        )

    def describe_image(self, image_path: str | Path) -> str:
        image_path = Path(image_path).resolve()
        if not image_path.is_file():
            raise FileNotFoundError(f"Image was not found: {image_path}")

        mime_type, _ = mimetypes.guess_type(image_path.name)
        if mime_type is None:
            mime_type = "image/jpeg"

        image_bytes = image_path.read_bytes()
        last_error = None

        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.api_model,
                    contents=[
                        types.Part.from_bytes(
                            data=image_bytes,
                            mime_type=mime_type,
                        ),
                        DESCRIBE_PROMPT,
                    ],
                    config=types.GenerateContentConfig(
                        temperature=0,
                        max_output_tokens=512,
                    ),
                )
                text = (response.text or "").strip()
                if not text:
                    raise RuntimeError("Gemini returned an empty VLM description.")
                return text
            except Exception as error:
                last_error = error
                message = str(error).casefold()
                permanent = any(
                    marker in message
                    for marker in (
                        "404",
                        "not_found",
                        "no longer available",
                        "invalid_argument",
                        "api key",
                        "permission_denied",
                        "401",
                        "403",
                    )
                )
                retryable = (not permanent) and any(
                    marker in message
                    for marker in (
                        "429",
                        "resource_exhausted",
                        "rate limit",
                        "quota exceeded",
                        "503",
                        "500",
                        "timeout",
                        "temporarily",
                    )
                )
                if "no longer available" in message:
                    retryable = False
                if not retryable or attempt == self.max_retries:
                    raise
                sleep_seconds = min(2 ** attempt, 30)
                print(
                    f"Gemini temporary error on attempt {attempt}/"
                    f"{self.max_retries}; retrying in {sleep_seconds}s...\n"
                    f"  detail: {error}",
                    flush=True,
                )
                time.sleep(sleep_seconds)

        raise RuntimeError(f"Gemini VLM failed: {last_error}")


def describe_image_file(image_path: str | Path) -> str:
    """Describe an image for retrieval using the configured VLM backend."""
    backend = (os.getenv("VLM_BACKEND") or "gemini").strip().lower()
    if backend == "openrouter":
        return OpenRouterQwenVLM().describe_image(image_path)
    if backend == "ollama":
        return OllamaVLM().describe_image(image_path)
    return GeminiVLM().describe_image(image_path)