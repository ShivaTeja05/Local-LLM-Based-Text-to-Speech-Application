"""LLMAdapter implementation for a local Ollama server."""

import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.config import Settings
from app.llm.base import LLMError, LLMUnavailableError, StreamStats

log = logging.getLogger(__name__)


class OllamaAdapter:
    name = "ollama"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.model = settings.llm_model
        self._keep_alive = settings.ollama_keep_alive
        self._options = {
            "temperature": settings.temperature,
            "top_p": settings.top_p,
            "num_predict": settings.num_predict,
            "repeat_penalty": settings.repeat_penalty,
            "num_ctx": settings.num_ctx,  # always explicit: never rely on Ollama's default
        }
        self._client = client or httpx.AsyncClient(
            base_url=settings.ollama_url,
            timeout=httpx.Timeout(settings.llm_timeout_s, connect=5.0),
        )

    def _payload(self, messages: list[dict[str, str]], **overrides) -> dict:
        return {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "think": False,  # disable reasoning traces on thinking-capable models
            "keep_alive": self._keep_alive,
            "options": {**self._options, **overrides},
        }

    async def stream_chat(
        self, messages: list[dict[str, str]], stats: StreamStats | None = None
    ) -> AsyncIterator[str]:
        try:
            async with self._client.stream("POST", "/api/chat", json=self._payload(messages)) as resp:
                if resp.status_code != 200:
                    body = (await resp.aread()).decode(errors="replace")
                    raise LLMError(_error_message(body) or f"Ollama returned HTTP {resp.status_code}")
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if "error" in chunk:
                        raise LLMError(chunk["error"])
                    delta = chunk.get("message", {}).get("content", "")
                    if delta:
                        yield delta
                    if chunk.get("done"):
                        if stats is not None:
                            stats.prompt_tokens = chunk.get("prompt_eval_count")
                            stats.completion_tokens = chunk.get("eval_count")
                            stats.truncated = chunk.get("done_reason") == "length"
                            stats.extra = {
                                "prompt_eval_ms": round(chunk.get("prompt_eval_duration", 0) / 1e6),
                                "eval_ms": round(chunk.get("eval_duration", 0) / 1e6),
                            }
                        break
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise LLMUnavailableError(f"Cannot reach Ollama: {exc}") from exc
        except httpx.TimeoutException as exc:
            raise LLMUnavailableError("Ollama timed out") from exc

    async def health(self) -> dict:
        try:
            resp = await self._client.get("/api/tags", timeout=3.0)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            return {"ok": False, "backend": self.name, "model": self.model, "error": str(exc)}
        names = {m.get("name") for m in resp.json().get("models", [])}
        installed = self.model in names or f"{self.model}:latest" in names
        result = {"ok": installed, "backend": self.name, "model": self.model}
        if not installed:
            result["error"] = f"Model not installed. Run: ollama pull {self.model}"
        return result

    async def warm_up(self, messages: list[dict[str, str]]) -> None:
        """Load the model and cache the pinned prompt prefix (1-token generation)."""
        payload = self._payload(messages, num_predict=1)
        payload["stream"] = False
        try:
            resp = await self._client.post("/api/chat", json=payload)
            resp.raise_for_status()
            log.info("LLM warm-up complete (%s)", self.model)
        except httpx.HTTPError as exc:
            log.warning("LLM warm-up failed: %s", exc)

    async def aclose(self) -> None:
        await self._client.aclose()


def _error_message(body: str) -> str | None:
    try:
        return json.loads(body).get("error")
    except (ValueError, AttributeError):
        return None
