"""Application settings, loaded from environment variables and an optional .env file."""

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # --- HTTP -------------------------------------------------------------
    # JSON list in env, e.g. CORS_ORIGINS='["http://localhost:4200"]'
    cors_origins: list[str] = ["http://localhost:4200"]
    # Also allow origins matching this pattern, e.g. a Vercel site and its preview deployments:
    # CORS_ORIGIN_REGEX='https://ellie[a-z0-9-]*\.vercel\.app'
    cors_origin_regex: str | None = None
    # Per-client rate limits and a cap on simultaneous replies (app/protection.py). On by default;
    # the local browser tests switch them off because they send many messages a minute.
    rate_limits: bool = True
    max_concurrent_generations: int = 2
    log_level: str = "INFO"

    # --- LLM (see docs/ARCHITECTURE.md §3–§5) -----------------------------
    llm_backend: str = "ollama"
    ollama_url: str = "http://localhost:11434"
    llm_model: str = "llama3.2:3b"
    # Other models a client may choose per message (only these: never a free-form name).
    llm_alt_models: list[str] = ["ellie-british"]
    # Fine-tuned models that were trained with, and so get, the one-line prompt (training/).
    short_prompt_models: list[str] = ["ellie-british"]
    ollama_keep_alive: str = "30m"
    llm_timeout_s: float = 60.0
    warm_up_on_start: bool = True

    # CPU threads for the model. 0 = automatic: half the cores, leaving room for speech.
    # (With every core, llama.cpp stalls almost completely whenever Piper runs alongside it.)
    llm_num_thread: int = 0

    temperature: float = 0.7
    top_p: float = 0.9
    num_predict: int = 160
    repeat_penalty: float = 1.1

    # --- Context window (§4) ----------------------------------------------
    num_ctx: int = 4096
    history_token_budget: int = 3000
    max_user_chars: int = 500        # latest user message hard limit (422 above it)
    max_assistant_chars: int = 1000  # older assistant messages are truncated, not rejected
    trim_chunk_turns: int = 6       # drop old turns in chunks to keep the prompt prefix stable

    # --- TTS (§6) ---------------------------------------------------------
    # "piper", "kokoro", or both: "piper+kokoro" (the first engine's voice is the default).
    # Kokoro is optional (scripts/download_voices.sh --kokoro), skipped with a warning if missing.
    tts_engine: str = "piper"
    voices_dir: Path = BACKEND_DIR / "voices"
    kokoro_model: Path = BACKEND_DIR / "voices" / "kokoro" / "kokoro-v1.0.int8.onnx"
    kokoro_voices: Path = BACKEND_DIR / "voices" / "kokoro" / "voices-v1.0.bin"
    kokoro_default_voice: str = "bf_emma"
    kokoro_speed: float = 1.0
    default_voice: str = "uk-south"
    # The voices the app offers, in picker order: five regional English accents (piper_engine.py).
    # Empty = every installed voice. Add e.g. "kokoro-bf_emma" with TTS_ENGINE=piper+kokoro.
    voices: list[str] = ["uk-south", "uk-north", "uk-midlands", "uk-east", "uk-west"]
    tts_length_scale: float = 1.05   # >1 = slightly slower, more relaxed delivery
    tts_max_chars: int = 1000
    tts_cache_size: int = 256
    # CPU threads for Piper. 0 = automatic: a third of the cores. Its threads never spin-wait.
    tts_threads: int = 0

    # --- Voice input (§8) ---------------------------------------------------
    stt_engine: str = "whisper"      # "none" switches voice input off
    stt_model: str = "base.en"       # faster-whisper model name (or a local folder)
    stt_threads: int = 0             # 0 = automatic: a third of the cores
    stt_max_seconds: float = 30.0
    stt_max_bytes: int = 5_000_000

    # --- Frontend ---------------------------------------------------------
    # If the Angular production build exists, the API also serves it at "/", so the whole
    # app runs on one port (e.g. for a demo link). In development, `ng serve` proxies instead.
    frontend_dist: Path = BACKEND_DIR.parent / "frontend" / "dist" / "frontend" / "browser"


def cpu_threads(configured: int, share: float) -> int:
    """A configured thread count, or (for 0) that share of this machine's CPU cores."""
    if configured > 0:
        return configured
    return max(1, int((os.cpu_count() or 2) * share))


@lru_cache
def get_settings() -> Settings:
    return Settings()
