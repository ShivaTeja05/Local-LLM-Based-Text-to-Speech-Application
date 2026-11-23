"""FastAPI entrypoint.  Run: uvicorn app.main:app --reload --port 8000"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import chat, health, memory, stt, tts
from app.config import Settings, get_settings
from app.llm.base import LLMAdapter
from app.llm.ollama_adapter import OllamaAdapter
from app.llm.prompt import pinned_messages
from app.protection import ProtectionMiddleware
from app.stt.base import STTEngine
from app.tts.base import TTSEngine

log = logging.getLogger("app")


def create_llm(settings: Settings) -> LLMAdapter:
    if settings.llm_backend == "ollama":
        return OllamaAdapter(settings)
    raise ValueError(f"Unknown LLM_BACKEND: {settings.llm_backend}")


def create_tts(settings: Settings) -> TTSEngine:
    """TTS_ENGINE: "piper", "kokoro", or several joined by "+" (the first one's voice is the default)."""
    engines = []
    for name in settings.tts_engine.split("+"):
        if name == "piper":
            from app.tts.piper_engine import PiperEngine  # heavy imports, only when used

            engines.append(PiperEngine(settings))
        elif name == "kokoro":
            from app.tts.kokoro_engine import KokoroEngine

            kokoro = KokoroEngine(settings)
            if kokoro.available() or len(settings.tts_engine.split("+")) == 1:
                engines.append(kokoro)
            else:
                log.warning("Kokoro model not found at %s: Piper voices only", kokoro.model_path)
        else:
            raise ValueError(f"Unknown TTS engine: {name}")
    from app.tts.multi_engine import CuratedVoices, MultiEngine

    engine = engines[0] if len(engines) == 1 else MultiEngine(engines)
    return CuratedVoices(engine, settings.voices, settings.default_voice) if settings.voices else engine


def create_stt(settings: Settings) -> STTEngine | None:
    if settings.stt_engine == "none":
        return None
    if settings.stt_engine == "whisper":
        from app.stt.whisper_engine import WhisperEngine

        return WhisperEngine(settings)
    raise ValueError(f"Unknown STT_ENGINE: {settings.stt_engine}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.llm = create_llm(settings)
    app.state.tts = create_tts(settings)
    await run_in_threadpool(app.state.tts.preload)  # load the default voice once
    app.state.stt = create_stt(settings)
    stt_load = None
    if app.state.stt:  # load Whisper in the background, so the first recording is quick
        stt_load = asyncio.create_task(run_in_threadpool(app.state.stt.preload))
    warm_up = None
    if settings.warm_up_on_start:
        # In the background, so the server starts even if Ollama is still booting.
        warm_up = asyncio.create_task(app.state.llm.warm_up(pinned_messages()))
    log.info("Ready: llm=%s/%s tts=%s voice=%s", app.state.llm.name, app.state.llm.model,
             app.state.tts.name, app.state.tts.default_voice)
    yield
    for task in (warm_up, stt_load):
        if task and not task.done():
            task.cancel()
    await app.state.llm.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per Ollama call is noise
    app = FastAPI(title="Ellie: Local LLM Text-to-Speech API", version="0.1.0", lifespan=lifespan)
    # Added first, so it sits inside CORS: a 429 still carries CORS headers the browser can read.
    app.add_middleware(ProtectionMiddleware, enabled=settings.rate_limits,
                       max_generations=settings.max_concurrent_generations)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(chat.router)
    app.include_router(memory.router)
    app.include_router(tts.router)
    app.include_router(stt.router)
    if (settings.frontend_dist / "index.html").exists():
        # Mounted last, so /api/* routes always win.
        app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")
        log.info("Serving the frontend build from %s", settings.frontend_dist)
    return app


app = create_app()
