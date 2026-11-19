"""Application settings, loaded from environment variables and an optional .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # --- HTTP -------------------------------------------------------------
    # JSON list in env, e.g. CORS_ORIGINS='["http://localhost:4200"]'
    cors_origins: list[str] = ["http://localhost:4200"]
    log_level: str = "INFO"

    # --- LLM (see docs/ARCHITECTURE.md §3–§5) -----------------------------
    llm_backend: str = "ollama"
    ollama_url: str = "http://localhost:11434"
    llm_model: str = "llama3.2:3b"
    ollama_keep_alive: str = "30m"
    llm_timeout_s: float = 60.0
    warm_up_on_start: bool = True

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
    tts_engine: str = "piper"
    voices_dir: Path = BACKEND_DIR / "voices"
    default_voice: str = "en_GB-cori-high"
    tts_length_scale: float = 1.05   # >1 = slightly slower, more relaxed delivery
    tts_max_chars: int = 1000
    tts_cache_size: int = 256


@lru_cache
def get_settings() -> Settings:
    return Settings()
