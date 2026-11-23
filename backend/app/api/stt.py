"""POST /api/stt: a voice recording in, its transcript out (push-to-talk, ARCHITECTURE.md §8)."""

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from app.config import Settings, get_settings
from app.stt.base import AudioTooLongError, STTEngine, STTError

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["stt"])


@router.post(
    "/stt",
    openapi_extra={"requestBody": {"content": {"audio/webm": {}, "audio/mp4": {}, "audio/wav": {}},
                                   "required": True}},
)
async def stt(request: Request, settings: Settings = Depends(get_settings)) -> dict:
    """Send the raw recording as the body (``Content-Type: audio/webm``, ``audio/mp4`` or
    ``audio/wav``). Returns ``{"text": "...", "seconds": 3.2}``. The text goes into the message
    box for the user to check before sending; it is never sent to the LLM directly."""
    engine: STTEngine | None = getattr(request.app.state, "stt", None)
    if engine is None:
        raise HTTPException(status_code=503, detail="Voice input is switched off on this server")
    if not request.headers.get("content-type", "").startswith("audio/"):
        raise HTTPException(status_code=415, detail="Send the recording as audio/* in the request body")
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=422, detail="The recording is empty")
    if len(audio) > settings.stt_max_bytes:
        raise HTTPException(status_code=413, detail="The recording is too large")

    started = time.perf_counter()
    try:
        result = await run_in_threadpool(engine.transcribe, audio)
    except AudioTooLongError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except STTError as exc:
        log.warning("stt failed: %s", exc)
        raise HTTPException(status_code=422, detail="Sorry, I couldn't make out that recording") from exc
    log.info("stt bytes=%d seconds=%.1f chars=%d ms=%d", len(audio), result.seconds, len(result.text),
             (time.perf_counter() - started) * 1000)
    return {"text": result.text, "seconds": result.seconds}
