"""STTEngine using faster-whisper (CTranslate2): local, CPU, int8."""

import io
import logging
import threading

from app.config import Settings, cpu_threads
from app.stt.base import AudioTooLongError, STTError, Transcript

log = logging.getLogger(__name__)


class WhisperEngine:
    name = "whisper"

    def __init__(self, settings: Settings):
        self.model = settings.stt_model
        self._max_seconds = settings.stt_max_seconds
        self._threads = cpu_threads(settings.stt_threads, 1 / 3)  # leave room for the LLM (§10.2)
        self._whisper = None
        self._lock = threading.Lock()
        self._error: str | None = None

    def _load(self):
        with self._lock:
            if self._whisper is None:
                from faster_whisper import WhisperModel  # heavy import, only when used

                log.info("Loading Whisper model %s (%d threads)", self.model, self._threads)
                try:
                    self._whisper = WhisperModel(self.model, device="cpu", compute_type="int8",
                                                 cpu_threads=self._threads)
                    self._error = None
                except Exception as exc:  # model missing and no network, corrupt cache, ...
                    log.error("Whisper failed to load: %s", exc)  # details stay in the server log
                    self._error = "The voice input model could not be loaded"
                    raise STTError(f"Could not load Whisper model {self.model}: {exc}") from exc
            return self._whisper

    def preload(self) -> None:
        try:
            self._load()
        except STTError as exc:
            log.warning("%s", exc)

    def transcribe(self, audio: bytes) -> Transcript:
        whisper = self._load()
        try:
            segments, info = whisper.transcribe(
                io.BytesIO(audio), language="en", beam_size=1, vad_filter=True,
                condition_on_previous_text=False,
            )
            if info.duration > self._max_seconds:
                raise AudioTooLongError(f"Recordings can be at most {self._max_seconds} seconds")
            text = " ".join(s.text.strip() for s in segments).strip()
        except STTError:
            raise
        except Exception as exc:  # undecodable audio raises from PyAV
            raise STTError(f"Could not read the recording: {exc}") from exc
        return Transcript(text=text, seconds=round(info.duration, 2))

    def health(self) -> dict:
        result = {"ok": self._error is None, "engine": self.name, "model": self.model,
                  "loaded": self._whisper is not None}
        if self._error:
            result["error"] = self._error
        return result
