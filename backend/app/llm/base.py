"""LLM adapter interface. Routes depend on this, never on a concrete backend."""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol


class LLMError(RuntimeError):
    """The LLM backend returned an error (e.g. model not found)."""


class LLMUnavailableError(LLMError):
    """The LLM backend could not be reached."""


@dataclass
class StreamStats:
    """Filled in by the adapter once a stream finishes."""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    truncated: bool = False  # generation stopped because num_predict was hit
    extra: dict = field(default_factory=dict)


class LLMAdapter(Protocol):
    name: str
    model: str

    def stream_chat(
        self, messages: list[dict[str, str]], stats: StreamStats | None = None
    ) -> AsyncIterator[str]:
        """Yield text deltas for the assistant reply."""
        ...

    async def health(self) -> dict:
        """Return {"ok": bool, ...details}."""
        ...

    async def warm_up(self, messages: list[dict[str, str]]) -> None:
        """Load the model and prime the KV cache with the pinned prompt."""
        ...

    async def aclose(self) -> None: ...
