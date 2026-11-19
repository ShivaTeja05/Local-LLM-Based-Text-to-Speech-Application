# Local LLM-Based Text-to-Speech Application

A web-based conversational prototype. You type a message, a **small LLM running locally** writes
a reply, and a **local British English voice** reads it aloud. An optional animated avatar
lip-syncs to the speech.

| Part | Technology |
|---|---|
| Front end | Angular 19 (TypeScript), Web Audio API, SVG avatar |
| Back end | Python 3.11, FastAPI, Server-Sent Events |
| LLM (local) | Ollama + `llama3.2:3b` |
| TTS (local) | Piper, British voice `en_GB-cori-high` |
| Deployment | Docker Compose (nginx + backend + Ollama) |

📐 **Architecture, design decisions and delivery plan:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

> 🚧 Work in progress. Install and run instructions will be added once the backend and
> frontend are in place.
