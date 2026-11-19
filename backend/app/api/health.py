"""GET /api/health: status of the LLM and TTS components."""

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    llm = await request.app.state.llm.health()
    tts = await run_in_threadpool(request.app.state.tts.health)
    return {"status": "ok" if llm["ok"] and tts["ok"] else "degraded", "llm": llm, "tts": tts}
