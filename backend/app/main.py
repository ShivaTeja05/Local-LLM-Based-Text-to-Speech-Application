"""FastAPI entrypoint.  Run: uvicorn app.main:app --reload --port 8000"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, health, tts
from app.config import Settings, get_settings
from app.llm.base import LLMAdapter
from app.llm.ollama_adapter import OllamaAdapter
from app.llm.prompt import pinned_messages
from app.tts.base import TTSEngine

log = logging.getLogger("app")


def create_llm(settings: Settings) -> LLMAdapter:
    if settings.llm_backend == "ollama":
        return OllamaAdapter(settings)
    raise ValueError(f"Unknown LLM_BACKEND: {settings.llm_backend}")


def create_tts(settings: Settings) -> TTSEngine:
    if settings.tts_engine == "piper":
        from app.tts.piper_engine import PiperEngine  # heavy import, only when used

        return PiperEngine(settings)
    raise ValueError(f"Unknown TTS_ENGINE: {settings.tts_engine}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.llm = create_llm(settings)
    app.state.tts = create_tts(settings)
    await run_in_threadpool(app.state.tts.preload)  # load the default voice once
    warm_up = None
    if settings.warm_up_on_start:
        # In the background, so the server starts even if Ollama is still booting.
        warm_up = asyncio.create_task(app.state.llm.warm_up(pinned_messages()))
    log.info("Ready: llm=%s/%s tts=%s voice=%s", app.state.llm.name, app.state.llm.model,
             app.state.tts.name, app.state.tts.default_voice)
    yield
    if warm_up and not warm_up.done():
        warm_up.cancel()
    await app.state.llm.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per Ollama call is noise
    app = FastAPI(title="Ellie: Local LLM Text-to-Speech API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(chat.router)
    app.include_router(tts.router)
    return app


app = create_app()
