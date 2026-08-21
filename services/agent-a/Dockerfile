FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /repo/services/agent-a

COPY requirements.txt .
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt \
    && python -m pip install langchain-groq pymysql

COPY . .

EXPOSE 8001
CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8001"]
