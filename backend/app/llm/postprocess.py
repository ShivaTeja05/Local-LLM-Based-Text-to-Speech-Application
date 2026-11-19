"""Keep LLM output in a plain, speakable form."""

import re

# Emoji and pictographs, variation selectors and zero-width joiners.
EMOJI_RE = re.compile(
    "[\U0001f000-\U0001faff\U00002600-\U000027bf\U0001f1e6-\U0001f1ff️‍]+"
)
MARKUP_RE = re.compile(r"[*`#~]")
SPEAKER_PREFIX_RE = re.compile(r"^\s*(ellie|assistant)\s*:\s*", re.IGNORECASE)
SENTENCE_END_RE = re.compile(r"[.!?…](?=[\"')\]]*\s|[\"')\]]*$)")


def clean_delta(delta: str) -> str:
    """Per-token cleaning while streaming: remove markdown symbols and emoji.
    Whitespace is preserved because tokens carry their own leading spaces."""
    return EMOJI_RE.sub("", MARKUP_RE.sub("", delta))


def finalize(text: str, truncated: bool = False) -> str:
    """Final reply text (sent in the SSE ``done`` event and by the non-streaming endpoint)."""
    text = clean_delta(text)
    text = SPEAKER_PREFIX_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    if truncated:
        # Generation hit num_predict mid-sentence: cut back to the last complete sentence.
        ends = list(SENTENCE_END_RE.finditer(text))
        if ends:
            text = text[: ends[-1].end()].rstrip()
        elif text:
            text += "…"
    return text
