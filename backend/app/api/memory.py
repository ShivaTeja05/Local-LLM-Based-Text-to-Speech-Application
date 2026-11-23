"""POST /api/memory: fold dropped turns into the rolling memory note (ARCHITECTURE.md §4)."""

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request

from app.config import Settings, get_settings
from app.llm.base import LLMAdapter, LLMError
from app.llm.context import ContextError, split_history
from app.llm.memory import clean_note, memory_messages
from app.schemas import Memory, MemoryRequest

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/memory", response_model=Memory)
async def update_memory(req: MemoryRequest, request: Request, settings: Settings = Depends(get_settings)) -> Memory:
    """The client calls this when a chat reply reports more dropped turns than its note covers,
    sending the same transcript it sent to /api/chat. Returns the updated note."""
    try:
        turns, _ = split_history([m.model_dump() for m in req.messages], settings)
    except ContextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    upto = min(req.upto, len(turns))
    start = min(req.memory.turns, upto)
    if start >= upto:  # nothing new to fold in
        return req.memory

    llm: LLMAdapter = request.app.state.llm
    started, parts = time.perf_counter(), []
    try:
        async for delta in llm.stream_chat(memory_messages(req.memory.note, turns[start:upto]),
                                           options={"temperature": 0.2, "num_predict": 120}):
            parts.append(delta)
    except LLMError as exc:
        log.warning("memory update failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not update the memory note") from exc

    note = clean_note("".join(parts)) or req.memory.note
    log.info("memory turns=%d->%d chars=%d ms=%d", start, upto, len(note), (time.perf_counter() - started) * 1000)
    return Memory(note=note, turns=upto)
