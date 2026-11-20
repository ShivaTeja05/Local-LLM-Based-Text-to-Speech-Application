# Local LLM-Based Text-to-Speech Application

A web-based conversational prototype. You type a message, a **small LLM running locally** writes
a reply, and a **local British English voice** reads it aloud. An optional animated avatar
lip-syncs to the speech. Nothing is sent to a cloud AI service.

| Part | Technology |
|---|---|
| Front end | Angular 19 (TypeScript), Web Audio API, SVG avatar *(in progress)* |
| Back end | Python 3.11, FastAPI, Server-Sent Events |
| LLM (local) | Ollama + `llama3.2:3b` |
| TTS (local) | Piper, British voice `en_GB-cori-high` (+ 3 more UK voices) |
| Deployment | Docker Compose (nginx + backend + Ollama) *(planned)* |

📐 **Architecture, design decisions and delivery plan:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Backend: install and run

### Prerequisites

- **Python 3.11+**
- **[Ollama](https://ollama.com/download)** running locally

### 1. Get the model

```bash
ollama pull llama3.2:3b
```

### 2. Install the backend

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

### 3. Download the British voices (~290 MB, from the official `rhasspy/piper-voices`)

```bash
./scripts/download_voices.sh
```

### 4. (Optional) configure

```bash
cp .env.example .env
```

Every setting has a sensible default. See [`backend/.env.example`](backend/.env.example).

### 5. Run

```bash
uvicorn app.main:app --reload --port 8000
```

Interactive API docs: <http://localhost:8000/docs>

### 6. Try it

```bash
curl -s localhost:8000/api/health
```

```bash
curl -sN localhost:8000/api/chat/stream -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"How are you?"}]}'
```

```bash
curl -s localhost:8000/api/tts -H 'Content-Type: application/json' -d '{"text":"I am very well, thank you. How are you?"}' -o reply.wav
```

Then play `reply.wav` (on macOS: `afplay reply.wav`).

### Tests

```bash
cd backend && .venv/bin/python -m pytest -q
```

- **Unit and API tests** use fake LLM/TTS back ends, so they need no model.
- **End-to-end tests** (`tests/test_e2e.py`) run the real chain: Ollama → API → Piper → WAV.
  They check reply style, memory, context trimming, every voice, the full sentence-by-sentence
  pipeline, concurrency and the Ollama-down fallback. They skip themselves if Ollama or the
  voices are missing. To run only these with a latency report:

```bash
cd backend && .venv/bin/python -m pytest tests/test_e2e.py -v -s
```

---

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | – | LLM and TTS status |
| POST | `/api/chat/stream` | `{"messages":[{"role":"user","content":"..."}]}` | SSE: `token`…, then `done` (or `error`) |
| POST | `/api/chat` | same | `{"reply": "...", ...}` |
| POST | `/api/tts` | `{"text": "...", "voice": "en_GB-cori-high"}` | `audio/wav` |
| GET | `/api/voices` | – | installed voices |

Send the **whole conversation** in `messages`. The backend trims it to the context window
itself, in a way that keeps Ollama's prompt cache effective
([§4](docs/ARCHITECTURE.md#4-context-window-and-conversation-memory)).

## Measured performance (Apple M3 Pro, warm model)

| Step | Time |
|---|---|
| Full short reply, streamed | ~0.5 s |
| Speech for one sentence (Piper) | 0.2–0.4 s |
| Repeated phrase (TTS cache) | ~1 ms |
| Long conversation: prompt processing, cache hit vs trim turn | ~0.18 s vs ~4.4 s |

## Known limitations

- A 3B model can occasionally state facts wrongly with confidence. It is tuned for friendly
  conversation, not factual accuracy.
- Piper reads most text well. Unusual formats (some abbreviations, codes) may sound odd. Common
  cases (money, dates, URLs) are fixed in `backend/app/tts/normalise.py`.
