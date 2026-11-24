"""POST /api/tts → audio/wav and GET /api/voices."""

import logging
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from app.schemas import TTSRequest, Voice
from app.tts.base import EmptySpeechError, TTSEngine, TTSError, VoiceNotFoundError
from app.voiceclone.cloner import CloneError, decode_fingerprint

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
    target = None
    if req.fingerprint:
        cloner = getattr(request.app.state, "cloner", None)
        if cloner is None:
            raise HTTPException(status_code=503, detail="Use my voice is switched off on this server")
        try:
            target = decode_fingerprint(req.fingerprint)
        except CloneError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        # Synthesis is CPU-bound: keep it off the event loop so SSE streams stay responsive.
        audio = await run_in_threadpool(engine.synthesize, req.text, req.voice)
        if target is not None:
            audio = await run_in_threadpool(cloner.convert, audio, req.voice or engine.default_voice, target)
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EmptySpeechError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (TTSError, CloneError) as exc:
        log.error("TTS failed: %s", exc)
        raise HTTPException(status_code=500, detail="Speech synthesis failed") from exc

    log.info("tts voice=%s%s chars=%d bytes=%d ms=%d", req.voice or engine.default_voice,
             "+mine" if target is not None else "", len(req.text), len(audio), (time.perf_counter() - started) * 1000)
    return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/voices", response_model=list[Voice])
async def voices(request: Request) -> list[Voice]:
    engine: TTSEngine = request.app.state.tts
    return [Voice(id=v.id, label=v.label, is_default=v.is_default) for v in engine.list_voices()]
