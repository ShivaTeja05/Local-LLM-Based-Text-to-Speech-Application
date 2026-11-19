"""Request/response models for the HTTP API."""

from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]  # clients can never inject a system message
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    # The front end sends the whole transcript; the backend trims it (ARCHITECTURE.md §4).
    messages: list[ChatMessage] = Field(min_length=1, max_length=400)


class ChatResponse(BaseModel):
    reply: str
    model: str
    truncated: bool
    turns_dropped: int
    prompt_tokens: int | None = None


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    voice: str | None = Field(default=None, max_length=100, pattern=r"^[A-Za-z0-9_\-]+$")


class Voice(BaseModel):
    id: str
    label: str
    is_default: bool
