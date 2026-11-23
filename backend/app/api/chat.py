"""POST /api/chat/stream (SSE) and POST /api/chat (plain JSON)."""

import json
import logging
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.llm.base import LLMAdapter, LLMError, LLMUnavailableError, StreamStats
from app.llm.context import ContextError, ContextResult, build_messages
from app.llm.postprocess import clean_delta, finalize
from app.llm.prompt import FALLBACK_REPLY
from app.schemas import ChatRequest, ChatResponse

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])


def _model(req: ChatRequest, settings: Settings) -> str:
    """The model for this request: the default, or one of the allowed alternatives."""
    if req.model is None or req.model == settings.llm_model:
        return settings.llm_model
    if req.model not in settings.llm_alt_models:
        raise HTTPException(status_code=422, detail=f"Model '{req.model}' is not available on this server")
    return req.model


def _context(req: ChatRequest, settings: Settings, model: str) -> ContextResult:
    try:
        note = req.memory.note if req.memory else None
        return build_messages([m.model_dump() for m in req.messages], settings, note,
                              short=model in settings.short_prompt_models)
    except ContextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _log_turn(model: str, ctx: ContextResult, stats: StreamStats, started: float) -> None:
    log.info(
        "chat model=%s turns=%d dropped=%d est_hist_tokens=%d prompt_tokens=%s completion_tokens=%s "
        "prompt_eval_ms=%s total_ms=%d truncated=%s",
        model, ctx.turns_total, ctx.turns_dropped, ctx.est_history_tokens, stats.prompt_tokens,
        stats.completion_tokens, stats.extra.get("prompt_eval_ms"),
        (time.perf_counter() - started) * 1000, stats.truncated,
    )


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest, request: Request, settings: Settings = Depends(get_settings)
) -> StreamingResponse:
    """Server-Sent Events:

    - ``event: token`` ``data: {"t": "..."}``, one per text delta
    - ``event: done``  ``data: {"text": final_text, "truncated": bool, ...}``
    - ``event: error`` ``data: {"code": "...", "message": fallback_text}``
    """
    model = _model(req, settings)
    ctx = _context(req, settings, model)
    llm: LLMAdapter = request.app.state.llm

    async def events() -> AsyncIterator[str]:
        stats, parts, started = StreamStats(), [], time.perf_counter()
        try:
            async for delta in llm.stream_chat(ctx.messages, stats, model=model):
                cleaned = clean_delta(delta)
                if cleaned:
                    parts.append(cleaned)
                    yield _sse("token", {"t": cleaned})
        except LLMError as exc:
            code = "llm_unavailable" if isinstance(exc, LLMUnavailableError) else "llm_error"
            log.warning("chat stream failed (%s): %s", code, exc)
            yield _sse("error", {"code": code, "message": FALLBACK_REPLY})
            return

        text = finalize("".join(parts), stats.truncated)
        if not text:
            yield _sse("error", {"code": "empty_reply", "message": FALLBACK_REPLY})
            return
        _log_turn(model, ctx, stats, started)
        yield _sse("done", {
            "text": text,
            "truncated": stats.truncated,
            "model": model,
            "turns_dropped": ctx.turns_dropped,
            "prompt_tokens": stats.prompt_tokens,
        })

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},  # no proxy buffering
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, settings: Settings = Depends(get_settings)) -> ChatResponse:
    """Non-streaming fallback: same pipeline, whole reply in one JSON response."""
    model = _model(req, settings)
    ctx = _context(req, settings, model)
    llm: LLMAdapter = request.app.state.llm
    stats, parts, started = StreamStats(), [], time.perf_counter()
    try:
        async for delta in llm.stream_chat(ctx.messages, stats, model=model):
            parts.append(clean_delta(delta))
    except LLMError as exc:
        log.warning("chat failed: %s", exc)
        raise HTTPException(status_code=503, detail=FALLBACK_REPLY) from exc

    text = finalize("".join(parts), stats.truncated)
    if not text:
        raise HTTPException(status_code=503, detail=FALLBACK_REPLY)
    _log_turn(model, ctx, stats, started)
    return ChatResponse(
        reply=text, model=model, truncated=stats.truncated,
        turns_dropped=ctx.turns_dropped, prompt_tokens=stats.prompt_tokens,
    )
