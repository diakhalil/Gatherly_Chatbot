FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --upgrade pip \
    && python -m pip install --no-cache-dir \
        torch --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install --no-cache-dir \
        -r requirements.txt fastapi uvicorn

COPY app.py labels.json ./
COPY models ./models

EXPOSE 8006
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8006"]
