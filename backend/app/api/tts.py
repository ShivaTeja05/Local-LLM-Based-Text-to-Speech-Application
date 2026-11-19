"""POST /api/tts → audio/wav and GET /api/voices."""

import logging
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from app.schemas import TTSRequest, Voice
from app.tts.base import EmptySpeechError, TTSEngine, TTSError, VoiceNotFoundError

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["tts"])


@router.post(
    "/tts",
    response_class=Response,
    responses={200: {"content": {"audio/wav": {}}, "description": "WAV audio (16-bit mono PCM)"}},
)
async def tts(req: TTSRequest, request: Request) -> Response:
    engine: TTSEngine = request.app.state.tts
    started = time.perf_counter()
    try:
        # Synthesis is CPU-bound: keep it off the event loop so SSE streams stay responsive.
        audio = await run_in_threadpool(engine.synthesize, req.text, req.voice)
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EmptySpeechError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TTSError as exc:
        log.error("TTS failed: %s", exc)
        raise HTTPException(status_code=500, detail="Speech synthesis failed") from exc

    log.info("tts voice=%s chars=%d bytes=%d ms=%d", req.voice or engine.default_voice,
             len(req.text), len(audio), (time.perf_counter() - started) * 1000)
    return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/voices", response_model=list[Voice])
async def voices(request: Request) -> list[Voice]:
    engine: TTSEngine = request.app.state.tts
    return [Voice(id=v.id, label=v.label, is_default=v.is_default) for v in engine.list_voices()]
