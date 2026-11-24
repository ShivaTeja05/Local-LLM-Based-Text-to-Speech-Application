"""POST /api/my-voice: a short reading (recorded in the app, or an uploaded file) in, a voice fingerprint out (Use my voice, ARCHITECTURE.md §6.3).

Nothing is stored: the recording is reduced to 256 numbers and discarded, and the fingerprint goes
back to the browser, which sends it with each speech request (POST /api/tts, "fingerprint").
"""

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from app.config import Settings, get_settings
from app.voiceclone.cloner import CloneError

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["my voice"])


@router.post(
    "/my-voice",
    openapi_extra={"requestBody": {"content": {"audio/webm": {}, "audio/mp4": {}, "audio/wav": {}},
                                   "required": True}},
)
async def my_voice(request: Request, settings: Settings = Depends(get_settings)) -> dict:
    """Send the recording as the body. Returns `{"fingerprint": "...", "base": "uk-south", "seconds": 12.3}`."""
    cloner = getattr(request.app.state, "cloner", None)
    if cloner is None:
        raise HTTPException(status_code=503, detail="Use my voice is switched off on this server")
    if not request.headers.get("content-type", "").startswith("audio/"):
        raise HTTPException(status_code=415, detail="Send the recording as audio/* in the request body")
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=422, detail="The recording is empty")
    if len(audio) > settings.voice_clone_max_bytes:
        raise HTTPException(status_code=413, detail="The recording is too large (15 MB at most)")
    started = time.perf_counter()
    try:
        result = await run_in_threadpool(cloner.enrol, audio)
    except CloneError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # The fingerprint itself is never logged.
    log.info("my-voice bytes=%d speech_s=%.1f base=%s ms=%d", len(audio), result["seconds"], result["base"],
             (time.perf_counter() - started) * 1000)
    return result
