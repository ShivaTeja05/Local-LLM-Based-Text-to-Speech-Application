"""Request/response models for the HTTP API."""

from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]  # clients can never inject a system message
    content: str = Field(max_length=4000)


class Memory(BaseModel):
    """Rolling note of turns that no longer fit the context window. The client keeps it."""

    note: str = Field(default="", max_length=1000)
    turns: int = Field(default=0, ge=0, le=400)  # how many of the oldest turns the note covers


class ChatRequest(BaseModel):
    # The front end sends the whole transcript; the backend trims it (ARCHITECTURE.md §4).
    messages: list[ChatMessage] = Field(min_length=1, max_length=400)
    memory: Memory | None = None
    # One of the server's allowed models (health.llm.models); omitted = the default model.
    model: str | None = Field(default=None, max_length=100)


class MemoryRequest(BaseModel):
    """Fold turns[memory.turns:upto] of this transcript into the note."""

    messages: list[ChatMessage] = Field(min_length=1, max_length=400)
    memory: Memory = Field(default_factory=Memory)
    upto: int = Field(ge=1, le=400)  # the turns_dropped value from the chat response


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
