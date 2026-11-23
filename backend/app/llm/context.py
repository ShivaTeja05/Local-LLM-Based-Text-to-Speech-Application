"""Context-window management (docs/ARCHITECTURE.md §4).

Builds the message list sent to the LLM:

    [pinned system prompt (persona + style example)]  +  [recent history turns]  +  [latest user message]

History is trimmed to a token budget by dropping the *oldest whole turns*, in fixed-size
chunks. The backend is stateless, so the number of dropped turns is a pure function of the
history: it is rounded up to a multiple of ``trim_chunk_turns``. Consecutive requests in the
same conversation therefore drop the same turns for several turns in a row, so the prompt
prefix stays identical and Ollama can reuse its KV cache (0.02 s vs ~4 s measured).
"""

import math
from dataclasses import dataclass

from app.config import Settings
from app.llm.prompt import pinned_messages

Message = dict[str, str]


class ContextError(ValueError):
    """The submitted history is invalid (maps to HTTP 422)."""


@dataclass
class ContextResult:
    messages: list[Message]
    turns_total: int
    turns_dropped: int
    est_history_tokens: int


def estimate_tokens(text: str) -> int:
    """Cheap, slightly pessimistic estimate (~4 chars/token + per-message overhead)."""
    return math.ceil(len(text) / 4) + 4


def group_turns(messages: list[Message]) -> list[list[Message]]:
    """Group messages into turns. A turn starts at each user message and includes the
    assistant replies that follow it, so trimming never splits a question from its answer."""
    turns: list[list[Message]] = []
    for msg in messages:
        if msg["role"] == "user" or not turns:
            turns.append([msg])
        else:
            turns[-1].append(msg)
    return turns


def split_history(history: list[Message], settings: Settings) -> tuple[list[list[Message]], str]:
    """Validate the transcript; return (older turns, latest user text)."""
    if not history:
        raise ContextError("messages must not be empty")
    latest = history[-1]
    if latest["role"] != "user":
        raise ContextError("the last message must be from the user")
    latest_text = latest["content"].strip()
    if not latest_text:
        raise ContextError("the last message must not be empty")
    if len(latest_text) > settings.max_user_chars:
        raise ContextError(f"the last message is longer than {settings.max_user_chars} characters")

    # Older messages: drop empties, truncate oversized ones (never reject old history).
    older: list[Message] = []
    for msg in history[:-1]:
        text = msg["content"].strip()
        if not text:
            continue
        limit = settings.max_user_chars if msg["role"] == "user" else settings.max_assistant_chars
        older.append({"role": msg["role"], "content": text[:limit]})
    return group_turns(older), latest_text


def build_messages(history: list[Message], settings: Settings, note: str | None = None,
                   short: bool = False) -> ContextResult:
    """``note`` is the rolling memory of dropped turns; it is only used once turns are dropped.
    ``short`` uses the one-line prompt (for a fine-tuned model)."""
    turns, latest_text = split_history(history, settings)
    turn_tokens = [sum(estimate_tokens(m["content"]) for m in t) for t in turns]
    budget = settings.history_token_budget - estimate_tokens(latest_text)

    # Smallest k such that turns[k:] fits the budget.
    k_min, total = len(turns), 0
    for i in range(len(turns) - 1, -1, -1):
        if total + turn_tokens[i] > budget:
            break
        total += turn_tokens[i]
        k_min = i

    # Round up to a whole chunk so the prefix stays stable between requests.
    chunk = max(1, settings.trim_chunk_turns)
    dropped = 0 if k_min == 0 else min(len(turns), math.ceil(k_min / chunk) * chunk)
    kept = turns[dropped:]

    pinned = pinned_messages(note.strip() if note and dropped else None, short)
    messages = [*pinned, *(m for t in kept for m in t), {"role": "user", "content": latest_text}]
    est = sum(turn_tokens[dropped:]) + estimate_tokens(latest_text)
    return ContextResult(messages, turns_total=len(turns), turns_dropped=dropped, est_history_tokens=est)
