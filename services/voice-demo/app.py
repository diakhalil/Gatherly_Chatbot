from pathlib import Path
import tempfile #creates temporary audio files
import threading #prevents text to speech operations from interfering with each other

import pyttsx3
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from faster_whisper import WhisperModel
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
tts_lock = threading.Lock() # 1 speech generation at a time

model = WhisperModel("tiny", device="cpu", compute_type="int8")
# compute_type=int8 uses lower precision computation to reduce memory usage and improve cpu speed


app = FastAPI(title="Gatherly Voice Demo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# This permits the Gatherly frontend on another port to call the voice service on port 8005.


class SpeakRequest(BaseModel):
    text: str


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    # The browser normally uploads the recording as speech.webm. Retaining the extension helps the audio decoder recognise the format.
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        # The uploaded bytes are written to a temporary file because Faster Whisper receives a file path.
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(tmp_path)
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return {"text": text, "language": info.language}
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def synthesize(text: str) -> bytes:
    # convert text into wav audio
    # create a temp output file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        wav_path = tmp.name

    try:
        # generate speech
        with tts_lock:
            engine = pyttsx3.init()
            engine.save_to_file(text, wav_path)
            engine.runAndWait()
            engine.stop()
        return Path(wav_path).read_bytes()
    finally:
        # delete the recording
        Path(wav_path).unlink(missing_ok=True)


@app.post("/speak")
async def speak(body: SpeakRequest):
    # recieves the text as json and runs synthesis, gets the wav file and returns it
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    wav = await run_in_threadpool(synthesize, text)
    return Response(content=wav, media_type="audio/wav")
