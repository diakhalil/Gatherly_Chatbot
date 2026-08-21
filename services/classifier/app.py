from pathlib import Path

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models" / "event-issue"

tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
model.eval()
id2label = {int(k): v for k, v in model.config.id2label.items()}

app = FastAPI(title="Gatherly Event Issue Classifier")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ClassifyRequest(BaseModel):
    text: str


@app.get("/", response_class=HTMLResponse)
def index():
    return """
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>Event issue classifier</title>
    <style>
      body { font-family: sans-serif; max-width: 40rem; margin: 3rem auto; }
      textarea { width: 100%; min-height: 6rem; }
      pre { background: #f4f4f4; padding: 1rem; }
    </style></head>
    <body>
      <h1>Gatherly event-issue classifier</h1>
      <textarea id="text" placeholder="Paste a team-leader debrief"></textarea>
      <p><button id="go">Classify</button></p>
      <pre id="out"></pre>
      <script>
        document.getElementById("go").onclick = async () => {
          const text = document.getElementById("text").value;
          const res = await fetch("/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          document.getElementById("out").textContent = JSON.stringify(await res.json(), null, 2);
        };
      </script>
    </body></html>
    """


@app.post("/classify")
def classify(body: ClassifyRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=128)
    with torch.no_grad():
        probs = torch.softmax(model(**inputs).logits, dim=-1)[0]

    idx = int(probs.argmax())
    scores = {id2label[i]: round(float(probs[i]), 4) for i in range(len(probs))}
    return {
        "label": id2label[idx],
        "confidence": round(float(probs[idx]), 4),
        "scores": scores,
    }
