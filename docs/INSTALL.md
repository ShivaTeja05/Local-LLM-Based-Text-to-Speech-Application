# Install and run locally

Everything here runs on your own machine. For the hosted demo, see [DEPLOYMENT.md](DEPLOYMENT.md).
Back to the [README](../README.md).

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
| `backend` | FastAPI + Piper, with the five regional British voices built into the image |
| `ollama` | runs `llama3.2:3b` (CPU, or an NVIDIA GPU: see the comment in `docker-compose.yml`) |
| `ollama-pull` | one-off job that downloads the model if the volume does not have it yet |

**On a Mac**, Ollama inside Docker cannot use the GPU. If the Ollama app is installed, use it
instead (about twice as fast, and no second copy of the model):

```bash
docker compose -f docker-compose.yml -f docker-compose.host-ollama.yml up -d --build
```

Settings (port, model) are in [`.env.example`](../.env.example): copy it to `.env`. Stop with
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

**Optional, Use my voice:** PyTorch (CPU) and the OpenVoice v2 converter (131 MB). Without them the
app works as before and the "Use my voice" button is simply not shown.

```bash
uv pip install --python .venv/bin/python -r requirements-clone.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

```bash
./scripts/download_voices.sh --clone
```

### 4. (Optional) configure

```bash
cp .env.example .env
```

Every setting has a sensible default. See [`backend/.env.example`](../backend/.env.example).

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


## API

Interactive docs are at `/docs` when running locally (they are switched off on the public server).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | – | LLM, TTS and STT status, the models and voice count |
| POST | `/api/chat/stream` | `{"messages":[{"role":"user","content":"..."}], "memory"?: {...}, "model"?: "..."}` | SSE: `token`…, then `done` (or `error`) |
| POST | `/api/chat` | same | `{"reply": "...", ...}` |
| POST | `/api/memory` | `{"messages": [...], "memory": {...}, "upto": n}` | the updated memory note |
| POST | `/api/tts` | `{"text": "...", "voice": "uk-south"}` | `audio/wav` |
| GET | `/api/voices` | – | the five voices: `uk-south`, `uk-north`, `uk-midlands`, `uk-east`, `uk-west` |
| POST | `/api/stt` | the recording as the body (`audio/webm`, `audio/mp4` or `audio/wav`) | `{"text": "...", "seconds": 3.2}` |

Send the **whole conversation** in `messages`. The backend trims it to the context window
itself, in a way that keeps Ollama's prompt cache effective
([§4](ARCHITECTURE.md#4-context-window-and-conversation-memory)).

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
