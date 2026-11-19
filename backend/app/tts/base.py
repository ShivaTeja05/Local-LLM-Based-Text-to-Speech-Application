"""TTS engine interface. Routes depend on this, never on a concrete engine."""

from dataclasses import dataclass
from typing import Protocol


class TTSError(RuntimeError):
    """Synthesis failed."""


class VoiceNotFoundError(TTSError):
    """Requested voice is not installed."""


class EmptySpeechError(TTSError):
    """Nothing speakable is left after normalisation (e.g. emoji only)."""


@dataclass(frozen=True)
class VoiceInfo:
    id: str
    label: str
    is_default: bool = False


class TTSEngine(Protocol):
    name: str
    default_voice: str

    def list_voices(self) -> list[VoiceInfo]: ...

    def synthesize(self, text: str, voice_id: str | None = None) -> bytes:
        """Return a complete WAV file (16-bit mono PCM). Blocking: call from a thread pool."""
        ...

    def health(self) -> dict: ...
