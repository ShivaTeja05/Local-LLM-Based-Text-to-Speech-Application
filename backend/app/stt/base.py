"""Speech-to-text interface (voice input, docs/ARCHITECTURE.md §8)."""

from dataclasses import dataclass
from typing import Protocol


class STTError(RuntimeError):
    """The recording could not be transcribed."""


class AudioTooLongError(STTError):
    """The recording is longer than the configured limit."""


@dataclass(frozen=True)
class Transcript:
    text: str
    seconds: float  # length of the recording


class STTEngine(Protocol):
    name: str
    model: str

    def preload(self) -> None: ...

    def transcribe(self, audio: bytes) -> Transcript:
        """Any format the browser records (webm/opus, mp4/aac, wav). Blocking: use a thread pool."""
        ...

    def health(self) -> dict: ...
