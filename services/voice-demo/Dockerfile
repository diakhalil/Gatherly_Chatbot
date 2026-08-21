FROM python:3.11-slim

ENV PIP_DEFAULT_TIMEOUT=600

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        espeak-ng \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --retries 15 --timeout 600 \
        -r requirements.txt

COPY app.py .
COPY static ./static

EXPOSE 8005
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8005"]