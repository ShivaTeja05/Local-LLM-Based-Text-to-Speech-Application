# Local LLM-Based Text-to-Speech Application

A web-based conversational prototype. You type a message, a **small LLM running locally** writes
a reply, and a **local British English voice** reads it aloud. An optional animated avatar
lip-syncs to the speech. Nothing is sent to a cloud AI service.

| Part | Technology |
|---|---|
| Front end | Angular 21 LTS (TypeScript, signals), Web Audio API, animated SVG avatar |
| Back end | Python 3.11, FastAPI, Server-Sent Events |
| LLM (local) | Ollama + `llama3.2:3b`, plus an optional LoRA fine-tune of it (`ellie-british`, [training/](training/README.md)) |
| TTS (local) | Piper, **five regional English accents** (South, North, Midlands, East, West) from one 77 MB multi-speaker voice; Kokoro-82M as an optional second engine |
| Voice input (local) | faster-whisper `base.en`: push-to-talk into the message box |
| Deployment | Docker Compose: nginx (Angular build + `/api` proxy), backend, Ollama. Or one port without Docker. |

📐 **Architecture, design decisions and delivery plan:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

### What it does

- Type a message (Enter sends, Shift+Enter adds a line) or tap a starter prompt.
- Ellie's reply **streams in word by word** and is **spoken in British English as it is written**,
  one sentence at a time, with a local Piper voice.
- **▶ Play / ■ Stop** on every reply (replays from a cache, no new synthesis). **Stop** while
  she is writing keeps the partial reply.
- **Speak replies aloud** switch and a **voice picker with five regional English accents**, each
  with a ▶ preview: Southern England (South, female, the default), Newcastle (North, female),
  Birmingham (Midlands, male), Suffolk (East, male) and South-West England (West, female).
- **Natural pauses and breaths:** a short, human-sized pause between sentences (longer after
  questions and long sentences) and a soft inhale before long sentences. A switch turns it off.
  Light, dark or system **theme**. All remembered in the browser.
- **🎤 Push-to-talk:** click the microphone, speak, click again. Local Whisper writes it into the
  message box so you can check it before sending. Talking over Ellie stops her speaking.
- **Animated avatar** whose mouth follows the real loudness of the speech (60 fps lip-sync),
  with blinking, a thinking look, and happy or concerned expressions read from the reply.
- **Conversation memory:** follow-up questions work. In long chats, turns that no longer fit the
  model's context window are folded into a short **memory note**, so Ellie still knows your name
  later on. The chat survives a page refresh, and **New conversation** clears it.
- **Standard vs fine-tuned model** switch (when the `ellie-british` adapter is installed): compare
  the base model with its long style prompt against the LoRA fine-tune with a one-line prompt.
- Honest states: a live status (model and voice), a clear message and **Try again** if the
  backend is down, and text chat keeps working if speech fails.
- Works on desktop, tablet and phone (the sidebar folds into a top bar and a menu sheet).

---

## Run with Docker (one command)

Needs only [Docker](https://docs.docker.com/get-docker/) (with Compose v2.24+) and about 6 GB of disk.

```bash
docker compose up -d --build
```

Open <http://localhost:8080>. The first start downloads the model (~2 GB) into a Docker volume,
so it takes a few minutes; later starts take seconds. Follow it with `docker compose logs -f`.

| Service | What it does |
|---|---|
| `web` | nginx: serves the Angular build and proxies `/api` (unbuffered, for streaming) and `/docs` |
| `backend` | FastAPI + Piper, with the 4 British voices built into the image |
| `ollama` | runs `llama3.2:3b` (CPU, or an NVIDIA GPU: see the comment in `docker-compose.yml`) |
| `ollama-pull` | one-off job that downloads the model if the volume does not have it yet |

**On a Mac**, Ollama inside Docker cannot use the GPU. If the Ollama app is installed, use it
instead (about twice as fast, and no second copy of the model):

```bash
docker compose -f docker-compose.yml -f docker-compose.host-ollama.yml up -d --build
```

Settings (port, model) are in [`.env.example`](.env.example): copy it to `.env`. Stop with
`docker compose down` (add `-v` to delete the downloaded model too).

## Quick start without Docker (everything on one port)

With Ollama running and the backend installed (below):

```bash
cd frontend && npm install && npm run build && cd ..
```

```bash
cd backend && .venv/bin/uvicorn app.main:app --port 8000
```

Open <http://localhost:8000>.

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

### 3. Download the British voices

The five regional voices come from one Piper model, `en_GB-vctk-medium` (77 MB, from the official
`rhasspy/piper-voices`). Add `--kokoro` for the optional Kokoro engine (~120 MB, checksummed). The
Whisper model for voice input (~145 MB) downloads itself the first time the backend starts.

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

## Frontend: install and run

### Prerequisites

- **Node.js 20.19+, 22.12+ or 24+** (Angular 21 LTS)
- The backend running on port 8000 (above)

### Install

```bash
cd frontend
npm install
```

### Develop

```bash
npm start
```

Open <http://localhost:4200>. The dev server proxies `/api` to `localhost:8000` (`proxy.conf.json`).

### Production build

```bash
npm run build
```

The output is in `frontend/dist/frontend/browser`. When that folder exists, the backend serves it
at `/`, so the whole app runs from <http://localhost:8000>.

### Tests

Unit tests (Vitest, no backend needed): the SSE parser, the sentence splitter, tone detection and
every path of the conversation service, using fakes for the API and the audio player.

```bash
npm test
```

End-to-end tests (Playwright) against the **real** stack, on desktop and phone sizes. They start
the backend and the dev server themselves if they are not already running.

```bash
npx playwright install chromium
```

```bash
npm run e2e
```

They cover:
- the brief's "How are you?" example, written and spoken sentence by sentence, with lip-sync checked at 60 fps;
- replay from the cache, speech off, voice choice and preview;
- memory across turns, keyboard use, reload and New conversation;
- backend down and speech failing, the 500-character limit, themes, and the tablet and phone layouts.

To run the same tests against a deployment that is already running (Docker, a demo server):

```bash
E2E_BASE_URL=http://localhost:8080 npm run e2e
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
| Frontend production bundle (transfer size) | ~53 KB |

**CPU only** (Docker on the same Mac, 11 cores, no GPU): the model writes 24–40 words (tokens)
per second, and a short reply finishes in 1–4 s. The model and Piper share the CPU: each gets a
fixed share of the cores (`LLM_NUM_THREAD`, `TTS_THREADS`, automatic by default). Without that,
the model slowed to under 3 tokens per second whenever speech was being made.

## Known limitations

- A 3B model can occasionally state facts wrongly with confidence. It is tuned for friendly
  conversation, not factual accuracy.
- Piper reads most text well. Unusual formats (some abbreviations, codes) may sound odd. Common
  cases (money, dates, URLs) are fixed in `backend/app/tts/normalise.py`.
