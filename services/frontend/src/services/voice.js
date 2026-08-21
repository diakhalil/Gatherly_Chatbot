const VOICE_URL = "http://localhost:8005";

export async function transcribeAudio(blob) {
  const form = new FormData();
  form.append("audio", blob, "speech.webm");
  const response = await fetch(`${VOICE_URL}/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error("Speech to text failed");
  const data = await response.json();
  return String(data.text || "").trim();
}

export function speakableText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let currentAudio = null;
let currentObjectUrl = null;
// playbackWaiter stores the resolve and reject functions of the Promise waiting for speech playback to finish:
let playbackWaiter = null;

function clearAudio() {
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

export function stopSpeaking() {
  clearAudio();
  if (playbackWaiter) {
    const { resolve } = playbackWaiter;
    playbackWaiter = null;
    resolve();
  }
}

export function pauseSpeaking() {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
  }
}

export function resumeSpeaking() {
  if (currentAudio && currentAudio.paused) {
    return currentAudio.play();
  }
  return Promise.resolve();
}

export async function speakText(text) {
  const clean = speakableText(text);
  if (!clean) return;
  stopSpeaking();

  const response = await fetch(`${VOICE_URL}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clean }),
  });
  if (!response.ok) throw new Error("Text to speech failed");

  currentObjectUrl = URL.createObjectURL(await response.blob());
  const audio = new Audio(currentObjectUrl);
  currentAudio = audio;

  await new Promise((resolve, reject) => {
    playbackWaiter = { resolve, reject };
    audio.onended = () => {
      playbackWaiter = null;
      clearAudio();
      resolve();
    };
    audio.onerror = () => {
      playbackWaiter = null;
      clearAudio();
      reject(new Error("Voice playback failed"));
    };
    audio.play().catch((error) => {
      playbackWaiter = null;
      clearAudio();
      reject(error);
    });
  });
}
